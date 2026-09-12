// Main app shell: routing, header, toast, modal, nav badge.
(function (global) {
  const viewRoot = document.getElementById('view-root');
  const headerTitle = document.getElementById('header-title');
  const btnBack = document.getElementById('btn-back');
  const btnAction = document.getElementById('btn-header-action');
  const bottomNav = document.getElementById('bottom-nav');
  const reviewBadge = document.getElementById('review-badge');
  const toastRoot = document.getElementById('toast-root');

  const state = {
    currentLibraryId: null,
    history: [],
  };

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function toast(message, duration = 2200) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  function speak(text, lang = 'ja-JP') {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      toast('当前设备不支持语音朗读');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    window.speechSynthesis.speak(utter);
  }

  // Wires up every [data-speak-text] button within `root` to read its text
  // aloud on click, without also triggering an ancestor's click handler
  // (e.g. a study card's flip-on-click).
  function bindSpeakButtons(root) {
    root.querySelectorAll('[data-speak-text]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        speak(btn.dataset.speakText, btn.dataset.speakLang || 'ja-JP');
      });
    });
  }

  // Shared markup for one face of a flashcard (study / self-study / review all
  // use this so the layout, spacing and hint placement stay consistent):
  // a top slot for a small tag, a centered primary line (with an optional
  // pronunciation button), an optional secondary "definition/example" box,
  // and a bottom hint pill describing what tapping the card will do next.
  function buildFlashcardFace({
    topTag, primaryText, primarySpeak, primarySpeakLang = 'ja-JP',
    secondaryText, secondarySpeak, secondarySpeakLang = 'ja-JP', hint,
  }) {
    return `
      <div class="card-face-top">${topTag ? `<span class="pos-tag">${escapeHtml(topTag)}</span>` : ''}</div>
      <div class="card-face-main">
        <div class="card-primary-row">
          <span class="card-primary-text">${escapeHtml(primaryText)}</span>
          ${primarySpeak ? `<button class="speak-btn" data-speak-text="${escapeHtml(primarySpeak)}" data-speak-lang="${primarySpeakLang}" aria-label="朗读">🔊</button>` : ''}
        </div>
        ${secondaryText ? `<div class="card-secondary-box">
          <span>${escapeHtml(secondaryText)}</span>
          ${secondarySpeak ? `<button class="speak-btn small" data-speak-text="${escapeHtml(secondarySpeak)}" data-speak-lang="${secondarySpeakLang}" aria-label="朗读">🔊</button>` : ''}
        </div>` : ''}
      </div>
      <div class="card-face-bottom">${hint ? `<span class="card-hint">${escapeHtml(hint)}</span>` : ''}</div>
    `;
  }

  function openModal(innerHtml) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal-sheet">${innerHtml}</div>`;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    return backdrop;
  }

  function closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
    document.body.style.overflow = '';
  }

  function confirmDialog(title, message, { confirmLabel = '确定', danger = true } = {}) {
    return new Promise((resolve) => {
      const modal = openModal(`
        <h3>${escapeHtml(title)}</h3>
        <p style="color:var(--text-muted)">${escapeHtml(message)}</p>
        <div class="btn-row">
          <button class="btn secondary" id="confirm-cancel">取消</button>
          <button class="btn ${danger ? 'danger' : ''}" id="confirm-ok">${escapeHtml(confirmLabel)}</button>
        </div>
      `);
      modal.querySelector('#confirm-cancel').addEventListener('click', () => { closeModal(); resolve(false); });
      modal.querySelector('#confirm-ok').addEventListener('click', () => { closeModal(); resolve(true); });
    });
  }

  // Shared "edit an existing word" modal, used by both the library word list and
  // the review session so delete/edit behave identically everywhere.
  function openWordEditModal(word, { onSaved, onDeleted } = {}) {
    const modal = openModal(`
      <h3>编辑单词</h3>
      <label class="field">日语单词/短语<input id="w-word" value="${escapeHtml(word.word)}"></label>
      <label class="field">中文释义<input id="w-meaning" value="${escapeHtml(word.meaning)}"></label>
      <label class="field">词性/备注<input id="w-pos" value="${escapeHtml(word.part_of_speech || '')}"></label>
      <label class="field">日本語の定義<textarea id="w-example" rows="2">${escapeHtml(word.example || '')}</textarea></label>
      <div class="btn-row">
        <button class="btn danger" id="w-delete">删除单词</button>
        <button class="btn" id="w-save">保存</button>
      </div>
    `);
    modal.querySelector('#w-save').addEventListener('click', async () => {
      const w = modal.querySelector('#w-word').value.trim();
      const m = modal.querySelector('#w-meaning').value.trim();
      const pos = modal.querySelector('#w-pos').value.trim();
      const ex = modal.querySelector('#w-example').value.trim();
      if (!w || !m) { toast('日语单词与中文释义为必填'); return; }
      const patch = { word: w, meaning: m, part_of_speech: pos, example: ex };
      await DB.updateVocabulary(word.id, patch);
      Object.assign(word, patch);
      closeModal();
      toast('已保存');
      if (onSaved) onSaved(word);
    });
    modal.querySelector('#w-delete').addEventListener('click', async () => {
      closeModal();
      const ok = await confirmDialog('删除单词', `确定要删除「${word.word}」吗？相关的复习记录也会一并删除，此操作不可撤销。`, { confirmLabel: '确定删除' });
      if (!ok) return;
      await DB.deleteVocabulary(word.id);
      toast('已删除');
      if (onDeleted) onDeleted(word);
    });
  }

  function setHeader(title, opts = {}) {
    headerTitle.textContent = title;
    if (opts.showBack) {
      btnBack.classList.remove('hidden');
    } else {
      btnBack.classList.add('hidden');
    }
    if (opts.actionLabel) {
      btnAction.textContent = opts.actionLabel;
      btnAction.classList.remove('hidden');
      btnAction.onclick = opts.onAction || null;
    } else {
      btnAction.classList.add('hidden');
      btnAction.onclick = null;
    }
  }

  function parseHash() {
    let hash = location.hash.replace(/^#/, '');
    if (!hash) hash = '/dashboard';
    const [path, queryStr] = hash.split('?');
    const segs = path.split('/').filter(Boolean);
    const query = new URLSearchParams(queryStr || '');
    return { top: segs[0] || 'dashboard', segs, query };
  }

  function navigate(path) {
    location.hash = path;
  }

  function goBack() {
    history.back();
  }

  async function refreshBadge() {
    try {
      const records = await DB.getAllStudyRecords(null);
      const due = Scheduler.getTodayReviews(records, DB.todayStr());
      if (due.length > 0) {
        reviewBadge.textContent = due.length > 99 ? '99+' : String(due.length);
        reviewBadge.classList.remove('hidden');
      } else {
        reviewBadge.classList.add('hidden');
      }
    } catch (e) { /* ignore */ }
  }

  function highlightNav(top) {
    bottomNav.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === top);
    });
  }

  const VIEW_MAP = {
    dashboard: 'dashboard',
    library: 'library',
    study: 'study',
    selfstudy: 'selfstudy',
    review: 'review',
    stats: 'stats',
    settings: 'settings',
    import: 'import',
  };

  async function render() {
    closeModal();
    const { top, segs, query } = parseHash();
    highlightNav(['dashboard', 'library', 'selfstudy', 'review', 'stats', 'settings'].includes(top) ? top : null);
    const viewKey = VIEW_MAP[top] || 'dashboard';
    const view = global.Views[viewKey];
    setHeader('小百合の単語帳');
    viewRoot.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
      if (view && view.render) {
        await view.render(viewRoot, { segs, query });
      } else {
        viewRoot.innerHTML = '<div class="empty-state">页面不存在</div>';
      }
    } catch (err) {
      console.error(err);
      viewRoot.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div>加载出错：${escapeHtml(err.message || String(err))}</div>`;
    }
    refreshBadge();
  }

  bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-item');
    if (!btn) return;
    navigate('/' + btn.dataset.view);
  });

  btnBack.addEventListener('click', goBack);

  window.addEventListener('hashchange', render);

  window.addEventListener('DOMContentLoaded', async () => {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { /* ignore in dev */ }
    }
    const savedTheme = await (async () => {
      try { return await DB.getSetting('theme', 'system'); } catch (e) { return 'system'; }
    })();
    applyTheme(savedTheme);
    render();
    try { Notify.startWatcher(); } catch (e) { /* ignore */ }
  });

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  global.App = {
    state, escapeHtml, toast, openModal, closeModal, confirmDialog, openWordEditModal, setHeader,
    navigate, goBack, refreshBadge, render, applyTheme, speak, bindSpeakButtons, buildFlashcardFace,
  };
})(window);
