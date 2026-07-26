(function (global) {
  global.Views = global.Views || {};

  async function render(root) {
    App.setHeader('今日复习');
    const today = DB.todayStr();
    const records = await DB.getAllStudyRecords(null);
    const due = Scheduler.getTodayReviews(records, today);

    if (due.length === 0) {
      const upcoming = records.filter((r) => r.review_level > 0 && r.review_level < 4);
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🎉</div>
          <p>今天没有需要复习的单词</p>
          <div style="color:var(--text-muted);font-size:13px">共有 ${upcoming.length} 个单词在复习队列中，按计划将在未来几天陆续到期</div>
          <button class="btn secondary block" style="margin-top:16px" id="go-study">去学习新单词</button>
        </div>`;
      root.querySelector('#go-study').addEventListener('click', () => App.navigate('/study'));
      return;
    }

    const byLevel = { 1: 0, 2: 0, 3: 0 };
    due.forEach((r) => byLevel[r.review_level]++);

    root.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">今日待复习 ${due.length} 个</h3>
        <div class="grid-2" style="margin-bottom:10px">
          <div class="stat-tile"><div class="num">${byLevel[1]}</div><div class="label">第1次复习</div></div>
          <div class="stat-tile"><div class="num">${byLevel[2]}</div><div class="label">第2次复习</div></div>
        </div>
        <div class="stat-tile" style="margin-bottom:16px"><div class="num">${byLevel[3]}</div><div class="label">第3次复习</div></div>
        <button class="btn" id="btn-start-review">开始复习</button>
      </div>
    `;
    root.querySelector('#btn-start-review').addEventListener('click', async () => {
      const items = await Promise.all(due.map(async (r) => ({
        record: r,
        word: await DB.getVocabularyItem(r.vocabulary_id),
      })));
      startSession(root, items.filter((it) => it.word));
    });
  }

  function startSession(root, queue) {
    let index = 0;
    let correct = 0, wrong = 0;
    let flipped = false;

    function drawCard() {
      flipped = false;
      const { word, record } = queue[index];
      root.innerHTML = `
        <div class="study-progress">第 ${index + 1} / ${queue.length} 个 &middot; ${Scheduler.levelLabel(record.review_level)}</div>
        <div class="progress-bar-track" style="margin-bottom:18px">
          <div class="progress-bar-fill" style="width:${(index / queue.length) * 100}%"></div>
        </div>
        <div class="study-card" id="study-card">
          <div class="study-card-inner">
            <div class="study-card-face study-card-front">
              <div class="pos-tag">${App.escapeHtml(word.part_of_speech || '')}</div>
              <div class="card-word">${App.escapeHtml(word.word)}</div>
              <div class="card-hint">先回忆，再点击卡片查看释义</div>
            </div>
            <div class="study-card-face study-card-back">
              <div class="card-meaning">${App.escapeHtml(word.meaning)}</div>
              ${word.example ? `<div class="card-example">${App.escapeHtml(word.example)}</div>` : ''}
            </div>
          </div>
        </div>
        <div class="judge-row">
          <button class="judge-btn no" id="btn-no">✗ 不认识</button>
          <button class="judge-btn yes" id="btn-yes">✓ 认识</button>
        </div>
      `;
      const cardEl = root.querySelector('#study-card');
      cardEl.addEventListener('click', () => {
        flipped = !flipped;
        cardEl.classList.toggle('flipped', flipped);
      });
      root.querySelector('#btn-yes').addEventListener('click', () => judge(true));
      root.querySelector('#btn-no').addEventListener('click', () => judge(false));
    }

    async function judge(recognized) {
      const { word } = queue[index];
      await DB.recordReviewOutcome(word.id, recognized);
      await DB.bumpDailyCounter('reviewed');
      if (recognized) correct++; else wrong++;
      index++;
      if (index >= queue.length) showSummary();
      else drawCard();
    }

    function showSummary() {
      const total = correct + wrong;
      const rate = total ? Math.round((correct / total) * 100) : 0;
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">✅</div>
          <h3>本次复习完成</h3>
          <div class="grid-2" style="margin:16px 0">
            <div class="stat-tile"><div class="num">${correct}</div><div class="label">认识（进入下一阶段）</div></div>
            <div class="stat-tile"><div class="num">${wrong}</div><div class="label">不认识（重新学习）</div></div>
          </div>
          <div style="color:var(--text-muted);margin-bottom:18px">正确率 ${rate}%</div>
          <button class="btn secondary block" id="btn-home">返回首页</button>
        </div>
      `;
      root.querySelector('#btn-home').addEventListener('click', () => App.navigate('/dashboard'));
      App.refreshBadge();
    }

    drawCard();
  }

  global.Views.review = { render };
})(window);
