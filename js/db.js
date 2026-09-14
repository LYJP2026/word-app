// IndexedDB data layer: Library / Vocabulary / StudyRecord / Settings
(function (global) {
  const DB_NAME = 'wordAppDB';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('libraries')) {
          const s = db.createObjectStore('libraries', { keyPath: 'id', autoIncrement: true });
          s.createIndex('name', 'name', { unique: false });
        }
        if (!db.objectStoreNames.contains('vocabulary')) {
          const s = db.createObjectStore('vocabulary', { keyPath: 'id', autoIncrement: true });
          s.createIndex('library_id', 'library_id', { unique: false });
          s.createIndex('word', 'word', { unique: false });
        }
        if (!db.objectStoreNames.contains('studyRecords')) {
          const s = db.createObjectStore('studyRecords', { keyPath: 'vocabulary_id' });
          s.createIndex('review_level', 'review_level', { unique: false });
          s.createIndex('library_id', 'library_id', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  function tx(storeNames, mode) {
    return openDB().then((db) => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function formatLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayStr(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return formatLocalDate(d);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  // ---------- Libraries ----------
  async function createLibrary(name) {
    const t = await tx('libraries', 'readwrite');
    const store = t.objectStore('libraries');
    const id = await reqToPromise(store.add({ name, created_at: nowISO() }));
    return id;
  }

  async function getOrCreateLibraryByName(name) {
    const libraries = await listLibraries();
    const existing = libraries.find((l) => l.name === name);
    if (existing) return existing.id;
    return createLibrary(name);
  }

  async function listLibraries() {
    const t = await tx('libraries', 'readonly');
    return reqToPromise(t.objectStore('libraries').getAll());
  }

  async function getLibrary(id) {
    const t = await tx('libraries', 'readonly');
    return reqToPromise(t.objectStore('libraries').get(id));
  }

  async function renameLibrary(id, name) {
    const t = await tx('libraries', 'readwrite');
    const store = t.objectStore('libraries');
    const lib = await reqToPromise(store.get(id));
    if (!lib) return;
    lib.name = name;
    await reqToPromise(store.put(lib));
  }

  async function deleteLibrary(id) {
    const words = await listVocabulary(id);
    const t = await tx(['libraries', 'vocabulary', 'studyRecords'], 'readwrite');
    for (const w of words) {
      t.objectStore('vocabulary').delete(w.id);
      t.objectStore('studyRecords').delete(w.id);
    }
    t.objectStore('libraries').delete(id);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- Vocabulary ----------
  async function addVocabulary(libraryId, entry) {
    const t = await tx('vocabulary', 'readwrite');
    const store = t.objectStore('vocabulary');
    const id = await reqToPromise(store.add({
      word: entry.word,
      meaning: entry.meaning,
      part_of_speech: entry.part_of_speech || '',
      example: entry.example || '',
      library_id: libraryId,
      created_at: nowISO(),
    }));
    return id;
  }

  async function bulkAddVocabulary(libraryId, entries) {
    const t = await tx('vocabulary', 'readwrite');
    const store = t.objectStore('vocabulary');
    const ids = [];
    for (const entry of entries) {
      ids.push(await reqToPromise(store.add({
        word: entry.word,
        meaning: entry.meaning,
        part_of_speech: entry.part_of_speech || '',
        example: entry.example || '',
        library_id: libraryId,
        created_at: nowISO(),
      })));
    }
    return ids;
  }

  async function listVocabulary(libraryId) {
    const t = await tx('vocabulary', 'readonly');
    const idx = t.objectStore('vocabulary').index('library_id');
    return reqToPromise(idx.getAll(IDBKeyRange.only(libraryId)));
  }

  async function getVocabularyItem(id) {
    const t = await tx('vocabulary', 'readonly');
    return reqToPromise(t.objectStore('vocabulary').get(id));
  }

  async function updateVocabulary(id, patch) {
    const t = await tx('vocabulary', 'readwrite');
    const store = t.objectStore('vocabulary');
    const item = await reqToPromise(store.get(id));
    if (!item) return;
    Object.assign(item, patch);
    await reqToPromise(store.put(item));
  }

  async function deleteVocabulary(id) {
    const t = await tx(['vocabulary', 'studyRecords'], 'readwrite');
    t.objectStore('vocabulary').delete(id);
    t.objectStore('studyRecords').delete(id);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function deleteVocabularyBulk(ids) {
    const t = await tx(['vocabulary', 'studyRecords'], 'readwrite');
    for (const id of ids) {
      t.objectStore('vocabulary').delete(id);
      t.objectStore('studyRecords').delete(id);
    }
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function clearLibraryVocabulary(libraryId) {
    const words = await listVocabulary(libraryId);
    await deleteVocabularyBulk(words.map((w) => w.id));
  }

  // Wipes only the learning/review progress for a library's words (so "开始
  // 学习" treats them all as brand new again) without touching the words
  // themselves — used by "从头再学".
  async function resetLibraryProgress(libraryId) {
    const words = await listVocabulary(libraryId);
    const t = await tx('studyRecords', 'readwrite');
    const store = t.objectStore('studyRecords');
    for (const w of words) store.delete(w.id);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- Study Records ----------
  async function getStudyRecord(vocabularyId) {
    const t = await tx('studyRecords', 'readonly');
    return reqToPromise(t.objectStore('studyRecords').get(vocabularyId));
  }

  async function getAllStudyRecords(libraryId) {
    const t = await tx('studyRecords', 'readonly');
    if (libraryId == null) return reqToPromise(t.objectStore('studyRecords').getAll());
    const idx = t.objectStore('studyRecords').index('library_id');
    return reqToPromise(idx.getAll(IDBKeyRange.only(libraryId)));
  }

  async function putStudyRecord(record) {
    const t = await tx('studyRecords', 'readwrite');
    await reqToPromise(t.objectStore('studyRecords').put(record));
  }

  // Mark a word as learned today (initial learning session): sets level 1, study_date = today
  async function recordInitialLearning(vocabularyItem, recognized) {
    const existing = await getStudyRecord(vocabularyItem.id);
    const isFirstTime = !existing;
    const today = todayStr();
    const record = existing || {
      vocabulary_id: vocabularyItem.id,
      library_id: vocabularyItem.library_id,
      correct_count: 0,
      wrong_count: 0,
    };
    record.library_id = vocabularyItem.library_id;
    record.study_date = today;
    record.review_level = 1;
    record.last_review_date = today;
    record.next_review_date = todayStr(1);
    if (recognized) record.correct_count = (record.correct_count || 0) + 1;
    else record.wrong_count = (record.wrong_count || 0) + 1;
    // Only ever set on the very first time this word is learned — this is
    // what drives "自习" (self-study), which should only ever offer words the
    // user got wrong on their first exposure, regardless of what happens to
    // them afterwards in official review.
    if (isFirstTime) record.initially_wrong = !recognized;
    await putStudyRecord(record);
    return record;
  }

  const LEVEL_DAYS = { 1: 1, 2: 7, 3: 30 };

  // Mark a review outcome: recognized -> advance level; not recognized -> reset to level 1 / today
  async function recordReviewOutcome(vocabularyId, recognized) {
    const record = await getStudyRecord(vocabularyId);
    if (!record) return null;
    const today = todayStr();
    record.last_review_date = today;
    if (recognized) {
      record.correct_count = (record.correct_count || 0) + 1;
      const nextLevel = (record.review_level || 1) + 1;
      if (nextLevel > 3) {
        record.review_level = 4; // mastered
        record.next_review_date = null;
      } else {
        record.review_level = nextLevel;
        record.next_review_date = addDays(record.study_date, LEVEL_DAYS[nextLevel]);
      }
    } else {
      record.wrong_count = (record.wrong_count || 0) + 1;
      record.study_date = today;
      record.review_level = 1;
      record.next_review_date = todayStr(1);
    }
    await putStudyRecord(record);
    return record;
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return formatLocalDate(d);
  }

  // ---------- Settings ----------
  async function getSetting(key, defaultValue) {
    const t = await tx('settings', 'readonly');
    const row = await reqToPromise(t.objectStore('settings').get(key));
    return row ? row.value : defaultValue;
  }

  async function setSetting(key, value) {
    const t = await tx('settings', 'readwrite');
    await reqToPromise(t.objectStore('settings').put({ key, value }));
  }

  // ---------- Daily activity counters (for stats / calendar / streak) ----------
  async function bumpDailyCounter(field) {
    const date = todayStr();
    const key = 'daily:' + date;
    const value = await getSetting(key, { learned: 0, reviewed: 0 });
    value[field] = (value[field] || 0) + 1;
    await setSetting(key, value);
  }

  async function getDailyCounter(dateStr) {
    return getSetting('daily:' + dateStr, { learned: 0, reviewed: 0 });
  }

  async function getAllDailyCounters() {
    const t = await tx('settings', 'readonly');
    const store = t.objectStore('settings');
    const range = IDBKeyRange.bound('daily:', 'daily:￿');
    const rows = await reqToPromise(store.getAll(range));
    const result = {};
    for (const row of rows) {
      result[row.key.slice('daily:'.length)] = row.value;
    }
    return result;
  }

  // ---------- Export / bulk import for backup ----------
  async function listAllVocabulary() {
    const t = await tx('vocabulary', 'readonly');
    return reqToPromise(t.objectStore('vocabulary').getAll());
  }

  async function exportAll() {
    const libraries = await listLibraries();
    const vocabulary = await listAllVocabulary();
    const studyRecords = await getAllStudyRecords(null);
    return { libraries, vocabulary, studyRecords, exported_at: nowISO() };
  }

  async function importAllReplace(data) {
    const t = await tx(['libraries', 'vocabulary', 'studyRecords'], 'readwrite');
    t.objectStore('libraries').clear();
    t.objectStore('vocabulary').clear();
    t.objectStore('studyRecords').clear();
    for (const lib of data.libraries || []) t.objectStore('libraries').put(lib);
    for (const v of data.vocabulary || []) t.objectStore('vocabulary').put(v);
    for (const r of data.studyRecords || []) t.objectStore('studyRecords').put(r);
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function clearAllData() {
    const t = await tx(['libraries', 'vocabulary', 'studyRecords', 'settings'], 'readwrite');
    t.objectStore('libraries').clear();
    t.objectStore('vocabulary').clear();
    t.objectStore('studyRecords').clear();
    t.objectStore('settings').clear();
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  global.DB = {
    todayStr, addDays, nowISO,
    createLibrary, getOrCreateLibraryByName, listLibraries, getLibrary, renameLibrary, deleteLibrary,
    addVocabulary, bulkAddVocabulary, listVocabulary, getVocabularyItem, updateVocabulary,
    deleteVocabulary, deleteVocabularyBulk, clearLibraryVocabulary, resetLibraryProgress,
    getStudyRecord, getAllStudyRecords, putStudyRecord, recordInitialLearning, recordReviewOutcome,
    getSetting, setSetting, exportAll, importAllReplace, clearAllData,
    bumpDailyCounter, getDailyCounter, getAllDailyCounters,
    LEVEL_DAYS,
  };
})(window);
