(function (global) {
  global.Views = global.Views || {};

  async function render(root, { segs, query }) {
    if (segs[1] === 'words') {
      return renderWordList(root, Number(query.get('lib')));
    }
    return renderLibraryList(root);
  }

  async function renderLibraryList(root) {
    App.setHeader('词库管理', {
      actionLabel: '＋',
      onAction: () => App.navigate('/import'),
    });
    const libraries = await DB.listLibraries();
    if (libraries.length === 0) {
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">📚</div>
          <p>还没有词库，先导入一份 Excel/CSV 对译表吧</p>
          <button class="btn" id="btn-go-import">导入词库</button>
        </div>`;
      root.querySelector('#btn-go-import').addEventListener('click', () => App.navigate('/import'));
      return;
    }

    const cards = await Promise.all(libraries.map(async (lib) => {
      const words = await DB.listVocabulary(lib.id);
      const records = await DB.getAllStudyRecords(lib.id);
      const recordMap = new Map(records.map((r) => [r.vocabulary_id, r]));
      let mastered = 0, learning = 0, notStarted = 0;
      for (const w of words) {
        const rec = recordMap.get(w.id);
        if (!rec) notStarted++;
        else if (rec.review_level === 4) mastered++;
        else learning++;
      }
      return { lib, total: words.length, mastered, learning, notStarted };
    }));

    root.innerHTML = `
      <div class="lib-list">
        ${cards.map(({ lib, total, mastered, learning, notStarted }) => `
          <div class="card" data-lib-id="${lib.id}">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <h3 style="margin:0">${App.escapeHtml(lib.name)}</h3>
              <span class="chip-btn" data-action="menu">⋯</span>
            </div>
            <div class="grid-2" style="margin-top:12px">
              <div class="stat-tile"><div class="num">${total}</div><div class="label">总单词数</div></div>
              <div class="stat-tile"><div class="num">${mastered}</div><div class="label">已掌握</div></div>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin:10px 2px">学习中 ${learning} · 待学 ${notStarted}</div>
            <div class="btn-row" style="margin-top:6px">
              <button class="btn secondary" data-action="words">词库详情</button>
              <button class="btn" data-action="study">开始学习</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    root.querySelectorAll('.card[data-lib-id]').forEach((card) => {
      const libId = Number(card.dataset.libId);
      card.querySelector('[data-action="words"]').addEventListener('click', () => App.navigate('/library/words?lib=' + libId));
      card.querySelector('[data-action="study"]').addEventListener('click', () => App.navigate('/study?lib=' + libId));
      card.querySelector('[data-action="menu"]').addEventListener('click', (e) => {
        e.stopPropagation();
        showLibMenu(libId, cards.find((c) => c.lib.id === libId).lib.name);
      });
    });
  }

  function showLibMenu(libId, name) {
    const modal = App.openModal(`
      <h3>${App.escapeHtml(name)}</h3>
      <button class="btn secondary block" id="m-import">追加导入单词</button>
      <button class="btn secondary block" id="m-export-xlsx">导出为 Excel (.xlsx)</button>
      <button class="btn secondary block" id="m-export-csv">导出为 CSV</button>
      <button class="btn secondary block" id="m-rename">重命名词库</button>
      <button class="btn danger block" id="m-delete">删除整个词库</button>
    `);
    modal.querySelector('#m-import').addEventListener('click', () => App.navigate('/import?lib=' + libId));
    modal.querySelector('#m-export-xlsx').addEventListener('click', () => exportLibrary(libId, name, 'xlsx'));
    modal.querySelector('#m-export-csv').addEventListener('click', () => exportLibrary(libId, name, 'csv'));
    modal.querySelector('#m-rename').addEventListener('click', () => renameLibraryFlow(libId, name));
    modal.querySelector('#m-delete').addEventListener('click', () => deleteLibraryFlow(libId, name));
  }

  async function exportLibrary(libId, name, format) {
    const words = await DB.listVocabulary(libId);
    const rows = [['日语单词', '中文释义', '词性/备注', '例句'],
      ...words.map((w) => [w.word, w.meaning, w.part_of_speech || '', w.example || ''])];
    let blob, filename;
    if (format === 'xlsx') {
      blob = SpreadsheetIO.buildXlsxBlob(rows);
      filename = `${name}.xlsx`;
    } else {
      blob = new Blob([SpreadsheetIO.buildCsvText(rows)], { type: 'text/csv;charset=utf-8' });
      filename = `${name}.csv`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    App.closeModal();
    App.toast('已导出 ' + filename);
  }

  function renameLibraryFlow(libId, oldName) {
    App.closeModal();
    const modal = App.openModal(`
      <h3>重命名词库</h3>
      <label class="field">词库名称<input id="rename-input" value="${App.escapeHtml(oldName)}"></label>
      <button class="btn block" id="rename-confirm">保存</button>
    `);
    modal.querySelector('#rename-confirm').addEventListener('click', async () => {
      const val = modal.querySelector('#rename-input').value.trim();
      if (!val) { App.toast('名称不能为空'); return; }
      await DB.renameLibrary(libId, val);
      App.closeModal();
      App.render();
    });
  }

  async function deleteLibraryFlow(libId, name) {
    App.closeModal();
    const ok = await App.confirmDialog('删除词库', `确定要删除词库「${name}」吗？其中的所有单词和学习记录都将被永久删除，此操作不可撤销。`, { confirmLabel: '确定删除' });
    if (!ok) return;
    await DB.deleteLibrary(libId);
    App.toast('已删除词库');
    App.render();
  }

  // ---------------- Word list within a library ----------------
  async function renderWordList(root, libId) {
    if (!libId) { App.navigate('/library'); return; }
    const lib = await DB.getLibrary(libId);
    if (!lib) { App.navigate('/library'); return; }
    App.setHeader(lib.name, { showBack: true });

    let words = await DB.listVocabulary(libId);
    const records = await DB.getAllStudyRecords(libId);
    const recordMap = new Map(records.map((r) => [r.vocabulary_id, r]));
    let selectMode = false;
    const selected = new Set();
    let searchTerm = '';

    function filtered() {
      if (!searchTerm) return words;
      const q = searchTerm.toLowerCase();
      return words.filter((w) => w.word.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q));
    }

    function levelChipHtml(w) {
      const rec = recordMap.get(w.id);
      const level = rec ? rec.review_level : 0;
      return `<span class="level-chip">${Scheduler.levelLabel(level)}</span>`;
    }

    function draw() {
      const list = filtered();
      root.innerHTML = `
        <div class="search-box"><input id="search-input" placeholder="搜索日语或中文…" value="${App.escapeHtml(searchTerm)}"></div>
        <div class="grid-2" style="margin-bottom:12px">
          <div class="stat-tile"><div class="num">${words.length}</div><div class="label">总单词数</div></div>
          <div class="stat-tile"><div class="num">${records.length}</div><div class="label">已学数</div></div>
        </div>
        <div class="btn-row" style="margin-bottom:10px">
          <button class="btn secondary" id="btn-toggle-select">${selectMode ? '取消批量' : '批量管理'}</button>
          <button class="btn" id="btn-add-word">＋ 手动添加</button>
        </div>
        ${selectMode ? `<button class="btn danger block" id="btn-batch-delete">删除选中（${selected.size}）</button>` : ''}
        <div class="card" style="padding:4px 12px">
          ${list.length === 0 ? '<div class="empty-state">没有匹配的单词</div>' : list.map((w) => `
            <div class="word-row" data-id="${w.id}">
              ${selectMode ? `<input type="checkbox" class="word-check" ${selected.has(w.id) ? 'checked' : ''}>` : ''}
              <div class="word-main">
                <div class="word-jp">${App.escapeHtml(w.word)} ${w.part_of_speech ? `<span class="level-chip">${App.escapeHtml(w.part_of_speech)}</span>` : ''}</div>
                <div class="word-cn">${App.escapeHtml(w.meaning)}</div>
              </div>
              ${levelChipHtml(w)}
              ${!selectMode ? `<div class="word-actions">
                <button class="chip-btn" data-action="edit">编辑</button>
                <button class="chip-btn" data-action="delete">删除</button>
              </div>` : ''}
            </div>
          `).join('')}
        </div>
      `;

      root.querySelector('#search-input').addEventListener('input', (e) => {
        searchTerm = e.target.value;
        draw();
        root.querySelector('#search-input').focus();
      });
      root.querySelector('#btn-toggle-select').addEventListener('click', () => {
        selectMode = !selectMode;
        selected.clear();
        draw();
      });
      root.querySelector('#btn-add-word').addEventListener('click', () => openNewWordModal());

      const batchDeleteBtn = root.querySelector('#btn-batch-delete');
      if (batchDeleteBtn) {
        batchDeleteBtn.addEventListener('click', async () => {
          if (selected.size === 0) { App.toast('请先选择要删除的单词'); return; }
          await DB.deleteVocabularyBulk(Array.from(selected));
          words = words.filter((w) => !selected.has(w.id));
          selected.clear();
          App.toast('已删除所选单词');
          draw();
        });
      }

      root.querySelectorAll('.word-check').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          const id = Number(e.target.closest('.word-row').dataset.id);
          if (e.target.checked) selected.add(id); else selected.delete(id);
          const btn = root.querySelector('#btn-batch-delete');
          if (btn) btn.textContent = `删除选中（${selected.size}）`;
        });
      });

      root.querySelectorAll('.word-row').forEach((row) => {
        const id = Number(row.dataset.id);
        const editBtn = row.querySelector('[data-action="edit"]');
        const delBtn = row.querySelector('[data-action="delete"]');
        if (editBtn) editBtn.addEventListener('click', () => {
          const word = words.find((w) => w.id === id);
          App.openWordEditModal(word, {
            onSaved: () => draw(),
            onDeleted: (deleted) => {
              words = words.filter((w) => w.id !== deleted.id);
              draw();
            },
          });
        });
        if (delBtn) delBtn.addEventListener('click', async () => {
          const word = words.find((w) => w.id === id);
          const ok = await App.confirmDialog('删除单词', `确定要删除「${word.word}」吗？相关的复习记录也会一并删除，此操作不可撤销。`, { confirmLabel: '确定删除' });
          if (!ok) return;
          await DB.deleteVocabulary(id);
          words = words.filter((w) => w.id !== id);
          App.toast('已删除');
          draw();
        });
      });
    }

    function openNewWordModal() {
      const modal = App.openModal(`
        <h3>添加单词</h3>
        <label class="field">日语单词/短语<input id="f-word"></label>
        <label class="field">中文释义<input id="f-meaning"></label>
        <label class="field">词性/备注<input id="f-pos"></label>
        <label class="field">例句<textarea id="f-example" rows="2"></textarea></label>
        <button class="btn block" id="f-save">保存</button>
      `);
      modal.querySelector('#f-save').addEventListener('click', async () => {
        const w = modal.querySelector('#f-word').value.trim();
        const m = modal.querySelector('#f-meaning').value.trim();
        const pos = modal.querySelector('#f-pos').value.trim();
        const ex = modal.querySelector('#f-example').value.trim();
        if (!w || !m) { App.toast('日语单词与中文释义为必填'); return; }
        const id = await DB.addVocabulary(libId, { word: w, meaning: m, part_of_speech: pos, example: ex });
        words.push({ id, word: w, meaning: m, part_of_speech: pos, example: ex, library_id: libId });
        App.closeModal();
        App.toast('已保存');
        draw();
      });
    }

    draw();
  }

  global.Views.library = { render };
})(window);
