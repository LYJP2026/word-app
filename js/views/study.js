(function (global) {
  global.Views = global.Views || {};

  async function render(root, { query }) {
    const libraries = await DB.listLibraries();
    let libId = Number(query.get('lib')) || null;

    if (libraries.length === 0) {
      App.setHeader('学习模式', { showBack: true });
      root.innerHTML = `<div class="empty-state"><div class="emoji">📚</div><p>请先导入一个词库</p>
        <button class="btn" id="go-import">导入词库</button></div>`;
      root.querySelector('#go-import').addEventListener('click', () => App.navigate('/import'));
      return;
    }

    if (!libId) {
      if (libraries.length === 1) {
        libId = libraries[0].id;
      } else {
        return renderLibraryPicker(root, libraries);
      }
    }

    await renderSetup(root, libId, libraries);
  }

  // Asked up front whenever the user has more than one library and hasn't
  // already picked one (e.g. via the dashboard's generic "学习新单词" entry).
  async function renderLibraryPicker(root, libraries) {
    App.setHeader('选择要学习的词库', { showBack: true });
    const cards = await Promise.all(libraries.map(async (lib) => {
      const words = await DB.listVocabulary(lib.id);
      const records = await DB.getAllStudyRecords(lib.id);
      const learnedIds = new Set(records.map((r) => r.vocabulary_id));
      const newCount = words.filter((w) => !learnedIds.has(w.id)).length;
      return { lib, total: words.length, newCount };
    }));

    root.innerHTML = `
      <div class="section-title">选择要学习的词库</div>
      ${cards.map(({ lib, total, newCount }) => `
        <div class="card" data-lib-id="${lib.id}" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">${App.escapeHtml(lib.name)}</h3>
            <span style="color:var(--text-muted);font-size:13px">›</span>
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:6px">共 ${total} 词 · ${newCount} 个尚未学习</div>
          ${total > 0 && newCount === 0 ? `<button class="btn secondary block" style="margin-top:10px" data-restart-lib="${lib.id}">从头再学</button>` : ''}
        </div>
      `).join('')}
    `;

    root.querySelectorAll('.card[data-lib-id]').forEach((card) => {
      card.addEventListener('click', () => App.navigate('/study?lib=' + card.dataset.libId));
    });

    root.querySelectorAll('[data-restart-lib]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const libId = Number(btn.dataset.restartLib);
        const lib = libraries.find((l) => l.id === libId);
        const ok = await App.confirmDialog('从头再学', `确定要重新学习「${lib.name}」吗？该词库的学习进度和复习计划将被清空，单词本身不会被删除。`, { confirmLabel: '确定重新学习' });
        if (!ok) return;
        await DB.resetLibraryProgress(libId);
        App.navigate('/study?lib=' + libId);
      });
    });
  }

  async function renderSetup(root, libId, libraries) {
    App.setHeader('学习模式', { showBack: true });
    const words = await DB.listVocabulary(libId);
    const records = await DB.getAllStudyRecords(libId);
    const learnedIds = new Set(records.map((r) => r.vocabulary_id));
    const newWords = words.filter((w) => !learnedIds.has(w.id));
    const dailyGoal = await DB.getSetting('dailyGoal', 20);

    if (newWords.length === 0) {
      const lib = libraries.find((l) => l.id === libId);
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🎉</div>
          <p>「${App.escapeHtml(lib ? lib.name : '')}」的单词已经全部学习完毕</p>
          <div style="color:var(--text-muted);font-size:13px">请返回词库重新选择学习内容，或前往复习</div>
          <div class="btn-row" style="margin-top:16px">
            <button class="btn secondary" id="go-library">返回词库</button>
            <button class="btn" id="go-review">去复习</button>
          </div>
        </div>
      `;
      root.querySelector('#go-library').addEventListener('click', () => App.navigate('/library'));
      root.querySelector('#go-review').addEventListener('click', () => App.navigate('/review'));
      return;
    }

    root.innerHTML = `
      <div class="card">
        <label class="field">选择词库
          <select id="lib-select">
            ${libraries.map((l) => `<option value="${l.id}" ${l.id === libId ? 'selected' : ''}>${App.escapeHtml(l.name)}</option>`).join('')}
          </select>
        </label>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:14px">
          该词库共 ${words.length} 词，其中 ${newWords.length} 个尚未学习
        </div>
        <label class="field">本次学习数量
          <input id="count-input" type="number" min="1" max="${Math.max(newWords.length, 1)}" value="${Math.max(Math.min(dailyGoal, newWords.length), 1)}">
        </label>
        <label class="checkbox-row" style="margin-bottom:16px">
          <input type="checkbox" id="shuffle-check" checked><span>随机顺序展示</span>
        </label>
        <button class="btn" id="btn-start">开始学习</button>
      </div>
    `;

    root.querySelector('#lib-select').addEventListener('change', (e) => {
      App.navigate('/study?lib=' + e.target.value);
    });

    root.querySelector('#btn-start').addEventListener('click', () => {
      let count = Number(root.querySelector('#count-input').value) || 1;
      count = Math.min(Math.max(count, 1), newWords.length);
      const shuffle = root.querySelector('#shuffle-check').checked;
      let pool = newWords.slice(0, count);
      if (shuffle) pool = shuffleArray(newWords).slice(0, count);
      showDirectionModal(root, libId, pool);
    });
  }

  // Asked every time right before a session starts: which side of the card
  // should appear first.
  function showDirectionModal(root, libId, pool) {
    const modal = App.openModal(`
      <h3>选择学习方向</h3>
      <p style="color:var(--text-muted);margin-bottom:16px">选择卡片正面先显示哪种语言</p>
      <button class="btn block" id="dir-jp2cn">和文中訳（先显示日语，翻译成中文）</button>
      <button class="btn secondary block" id="dir-cn2jp">中文和訳（先显示中文，翻译成日语）</button>
    `);
    modal.querySelector('#dir-jp2cn').addEventListener('click', () => {
      App.closeModal();
      startSession(root, libId, pool, 'jp2cn');
    });
    modal.querySelector('#dir-cn2jp').addEventListener('click', () => {
      App.closeModal();
      startSession(root, libId, pool, 'cn2jp');
    });
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startSession(root, libId, queue, direction = 'jp2cn') {
    let index = 0;
    let correct = 0, wrong = 0;
    let flipped = false;
    const wrongWords = [];

    function drawCard() {
      flipped = false;
      const word = queue[index];
      const jpFaceHtml = App.buildFlashcardFace({
        topTag: word.part_of_speech,
        primaryText: word.word,
        primarySpeak: word.word,
        secondaryText: word.example,
        secondarySpeak: word.example,
        hint: direction === 'cn2jp' ? '点击卡片回到中文' : '点击卡片查看中文',
      });
      const cnFaceHtml = App.buildFlashcardFace({
        primaryText: word.meaning,
        primarySpeak: word.meaning,
        primarySpeakLang: 'zh-CN',
        hint: direction === 'cn2jp' ? '点击卡片查看日语' : '点击卡片回到日语',
      });
      const frontHtml = direction === 'cn2jp' ? cnFaceHtml : jpFaceHtml;
      const backHtml = direction === 'cn2jp' ? jpFaceHtml : cnFaceHtml;
      root.innerHTML = `
        <div class="study-progress">第 ${index + 1} / ${queue.length} 个</div>
        <div class="progress-bar-track" style="margin-bottom:18px">
          <div class="progress-bar-fill" style="width:${(index / queue.length) * 100}%"></div>
        </div>
        <div class="study-card" id="study-card">
          <div class="study-card-inner">
            <div class="study-card-face study-card-front">${frontHtml}</div>
            <div class="study-card-face study-card-back">${backHtml}</div>
          </div>
        </div>
      `;
      const cardEl = root.querySelector('#study-card');
      cardEl.addEventListener('click', () => {
        flipped = !flipped;
        cardEl.classList.toggle('flipped', flipped);
      });
      App.bindSpeakButtons(root);
      App.showJudgeBar(() => judge(true), () => judge(false));
    }

    async function judge(recognized) {
      const word = queue[index];
      await DB.recordInitialLearning(word, recognized);
      await DB.bumpDailyCounter('learned');
      if (recognized) correct++; else { wrong++; wrongWords.push(word); }
      index++;
      if (index >= queue.length) {
        showSummary();
      } else {
        drawCard();
      }
    }

    function showSummary() {
      App.hideJudgeBar();
      const total = correct + wrong;
      const rate = total ? Math.round((correct / total) * 100) : 0;
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">✅</div>
          <h3>本次学习完成</h3>
          <div class="grid-2" style="margin:16px 0">
            <div class="stat-tile"><div class="num">${correct}</div><div class="label">认识</div></div>
            <div class="stat-tile"><div class="num">${wrong}</div><div class="label">不认识</div></div>
          </div>
          <div style="color:var(--text-muted);margin-bottom:18px">正确率 ${rate}%，明天开始进入第一次复习</div>
          ${wrongWords.length > 0 ? `<button class="btn block" id="btn-review-now">马上复习不认识的 ${wrongWords.length} 个单词</button>` : ''}
          <button class="btn ${wrongWords.length > 0 ? 'secondary' : ''} block" id="btn-again">再学一组</button>
          <button class="btn secondary block" id="btn-lib">返回词库</button>
        </div>
      `;
      const reviewNowBtn = root.querySelector('#btn-review-now');
      if (reviewNowBtn) {
        reviewNowBtn.addEventListener('click', async () => {
          App.setHeader('马上复习', { showBack: true });
          const reviewQueue = await Promise.all(wrongWords.map(async (w) => ({
            word: w,
            record: await DB.getStudyRecord(w.id),
          })));
          Views.review.startReviewFlow(root, reviewQueue.filter((it) => it.record));
        });
      }
      root.querySelector('#btn-again').addEventListener('click', () => App.navigate('/study?lib=' + libId));
      root.querySelector('#btn-lib').addEventListener('click', () => App.navigate('/library/words?lib=' + libId));
      App.refreshBadge();
    }

    drawCard();
  }

  global.Views.study = { render };
})(window);
