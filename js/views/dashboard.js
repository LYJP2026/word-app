(function (global) {
  global.Views = global.Views || {};

  async function render(root) {
    App.setHeader('小百合の単語帳');
    const libraries = await DB.listLibraries();

    if (libraries.length === 0) {
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">👋</div>
          <h3>欢迎使用</h3>
          <p>先导入你自己整理的中日对译 Excel/CSV 表，即可开始科学复习</p>
          <button class="btn" id="btn-import">导入我的词库</button>
        </div>`;
      root.querySelector('#btn-import').addEventListener('click', () => App.navigate('/import'));
      return;
    }

    const today = DB.todayStr();
    const [records, todayCounter] = await Promise.all([
      DB.getAllStudyRecords(null),
      DB.getDailyCounter(today),
    ]);
    const due = Scheduler.getTodayReviews(records, today);

    let totalWords = 0, notStarted = 0;
    for (const lib of libraries) {
      const words = await DB.listVocabulary(lib.id);
      totalWords += words.length;
      const learnedIds = new Set(records.filter((r) => r.library_id === lib.id).map((r) => r.vocabulary_id));
      notStarted += words.filter((w) => !learnedIds.has(w.id)).length;
    }

    root.innerHTML = `
      <div class="card" style="background:var(--primary);color:var(--primary-contrast)">
        <div style="font-size:14px;opacity:.9">今日待复习</div>
        <div style="font-size:38px;font-weight:700;margin:4px 0">${due.length} 个</div>
        <button class="btn secondary block" id="btn-review" style="color:var(--primary);margin-top:10px">${due.length > 0 ? '开始复习' : '今日已完成 🎉'}</button>
      </div>

      <div class="grid-2" style="margin-bottom:12px">
        <div class="stat-tile"><div class="num">${todayCounter.learned || 0}</div><div class="label">今日已学</div></div>
        <div class="stat-tile"><div class="num">${todayCounter.reviewed || 0}</div><div class="label">今日复习</div></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">快速开始</h3>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">共 ${libraries.length} 个词库 · ${totalWords} 个单词 · ${notStarted} 个待学</div>
        <div class="btn-row">
          <button class="btn secondary" id="btn-study">学习新单词</button>
          <button class="btn secondary" id="btn-import2">导入词库</button>
        </div>
      </div>

      <div class="section-title">我的词库</div>
      ${libraries.map((l) => `
        <div class="card" data-lib="${l.id}" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer">
          <span>${App.escapeHtml(l.name)}</span>
          <span style="color:var(--text-muted);font-size:13px">›</span>
        </div>
      `).join('')}
    `;

    root.querySelector('#btn-review').addEventListener('click', () => App.navigate('/review'));
    root.querySelector('#btn-study').addEventListener('click', () => App.navigate('/study'));
    root.querySelector('#btn-import2').addEventListener('click', () => App.navigate('/import'));
    root.querySelectorAll('[data-lib]').forEach((card) => {
      card.addEventListener('click', () => App.navigate('/library/words?lib=' + card.dataset.lib));
    });
  }

  global.Views.dashboard = { render };
})(window);
