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
    review: 'review',
    stats: 'stats',
    settings: 'settings',
    import: 'import',
  };

  async function render() {
    closeModal();
    const { top, segs, query } = parseHash();
    highlightNav(['dashboard', 'library', 'review', 'stats', 'settings'].includes(top) ? top : null);
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
    state, escapeHtml, toast, openModal, closeModal, setHeader,
    navigate, goBack, refreshBadge, render, applyTheme,
  };
})(window);
