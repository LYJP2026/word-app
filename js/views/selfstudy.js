// "自习" (self-study): lets the user freely re-practice any word they've
// already learned, any time, as many times as they like. Unlike "复习", this
// never reads or writes review_level / study_date / next_review_date, so it
// never affects the official Ebbinghaus 1-7-30 schedule.
(function (global) {
  global.Views = global.Views || {};

  async function render(root, { query }) {
    const libraries = await DB.listLibraries();
    if (libraries.length === 0) {
      App.setHeader('自习', { showBack: false });
      root.innerHTML = `<div class="empty-state"><div class="emoji">📝</div><p>请先导入一个词库</p>
        <button class="btn" id="go-import">导入词库</button></div>`;
      root.querySelector('#go-import').addEventListener('click', () => App.navigate('/import'));
      return;
    }

    const libParam = query.get('lib');
    if (libParam) {
      return renderSetup(root, libParam === 'all' ? null : Number(libParam));
    }
    return renderPicker(root, libraries);
  }

  async function getLearnedWords(libId) {
    const [words, records] = await Promise.all([DB.listVocabulary(libId), DB.getAllStudyRecords(libId)]);
    const learnedIds = new Set(records.map((r) => r.vocabulary_id));
    return words.filter((w) => learnedIds.has(w.id));
  }

  async function renderPicker(root, libraries) {
    App.setHeader('自习', { showBack: false });
    const cards = await Promise.all(libraries.map(async (lib) => {
      const learned = await getLearnedWords(lib.id);
      return { lib, learnedCount: learned.length };
    }));
    const totalLearned = cards.reduce((sum, c) => sum + c.learnedCount, 0);

    if (totalLearned === 0) {
      root.innerHTML = `<div class="empty-state"><div class="emoji">📝</div><p>还没有已学的单词，先去学习新单词吧</p>
        <button class="btn" id="go-study">去学习</button></div>`;
      root.querySelector('#go-study').addEventListener('click', () => App.navigate('/study'));
      return;
    }

    root.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin:0 4px 14px">自习不受复习计划的时间限制，可以随时练习任意已学过的单词，也可以反复重来；判断结果不会影响"复习"页的正式进度安排。</div>
      <div class="card" id="all-libs-card" style="cursor:pointer">
        <h3 style="margin:0">全部词库</h3>
        <div style="font-size:13px;color:var(--text-muted);margin-top:6px">共 ${totalLearned} 个已学单词</div>
      </div>
      <div class="section-title">按词库自习</div>
      ${cards.filter((c) => c.learnedCount > 0).map(({ lib, learnedCount }) => `
        <div class="card" data-lib-id="${lib.id}" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">${App.escapeHtml(lib.name)}</h3>
            <span style="color:var(--text-muted);font-size:13px">›</span>
          </div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:6px">${learnedCount} 个已学单词</div>
        </div>
      `).join('')}
    `;

    root.querySelector('#all-libs-card').addEventListener('click', () => App.navigate('/selfstudy?lib=all'));
    root.querySelectorAll('.card[data-lib-id]').forEach((card) => {
      card.addEventListener('click', () => App.navigate('/selfstudy?lib=' + card.dataset.libId));
    });
  }

  async function renderSetup(root, libId) {
    const title = libId ? (await DB.getLibrary(libId))?.name || '自习' : '全部词库';
    App.setHeader(title, { showBack: true });

    let words;
    if (libId) {
      words = await getLearnedWords(libId);
    } else {
      const libraries = await DB.listLibraries();
      words = [];
      for (const lib of libraries) words.push(...(await getLearnedWords(lib.id)));
    }

    if (words.length === 0) {
      root.innerHTML = `<div class="empty-state"><div class="emoji">📝</div><p>该词库暂无已学的单词</p>
        <button class="btn secondary" id="go-back">返回</button></div>`;
      root.querySelector('#go-back').addEventListener('click', () => App.navigate('/selfstudy'));
      return;
    }

    root.innerHTML = `
      <div class="card">
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:14px">共 ${words.length} 个已学单词可供自习</div>
        <label class="field">本次自习数量
          <input id="count-input" type="number" min="1" max="${words.length}" value="${words.length}">
        </label>
        <label class="checkbox-row" style="margin-bottom:16px">
          <input type="checkbox" id="shuffle-check" checked><span>随机顺序展示</span>
        </label>
        <button class="btn" id="btn-start">开始自习</button>
      </div>
    `;

    root.querySelector('#btn-start').addEventListener('click', () => {
      let count = Number(root.querySelector('#count-input').value) || 1;
      count = Math.min(Math.max(count, 1), words.length);
      const shuffle = root.querySelector('#shuffle-check').checked;
      const pool = shuffle ? shuffleArray(words).slice(0, count) : words.slice(0, count);
      startSession(root, libId, pool);
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

  // A self-study pass never touches StudyRecord scheduling fields — it only
  // reads word content, and lets the user edit/delete words in passing.
  function startSession(root, libId, originalPool) {
    const queue = originalPool.slice();
    let index = 0;
    let correct = 0, wrong = 0;
    let flipped = false;

    function drawCard() {
      if (index >= queue.length) { showSummary(); return; }
      flipped = false;
      const word = queue[index];
      root.innerHTML = `
        <div class="study-progress">第 ${index + 1} / ${queue.length} 个</div>
        <div class="progress-bar-track" style="margin-bottom:18px">
          <div class="progress-bar-fill" style="width:${(index / queue.length) * 100}%"></div>
        </div>
        <div class="btn-row" style="margin-bottom:10px">
          <button class="chip-btn" id="btn-edit-word">✎ 编辑单词</button>
          <button class="chip-btn" id="btn-delete-word">🗑 删除单词</button>
        </div>
        <div class="study-card" id="study-card">
          <div class="study-card-inner">
            <div class="study-card-face study-card-front">
              <div class="pos-tag">${App.escapeHtml(word.part_of_speech || '')}</div>
              <div class="card-word-row">
                <div class="card-word">${App.escapeHtml(word.word)}</div>
                <button class="speak-btn" data-speak-text="${App.escapeHtml(word.word)}" aria-label="朗读单词">🔊</button>
              </div>
              <div class="card-hint">点击卡片查看释义</div>
            </div>
            <div class="study-card-face study-card-back">
              <div class="card-meaning">${App.escapeHtml(word.meaning)}</div>
              ${word.example ? `<div class="card-example"><span>${App.escapeHtml(word.example)}</span><button class="speak-btn small" data-speak-text="${App.escapeHtml(word.example)}" aria-label="朗读例句">🔊</button></div>` : ''}
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
      App.bindSpeakButtons(root);
      root.querySelector('#btn-yes').addEventListener('click', () => judge(true));
      root.querySelector('#btn-no').addEventListener('click', () => judge(false));
      root.querySelector('#btn-edit-word').addEventListener('click', () => {
        App.openWordEditModal(word, {
          onSaved: () => drawCard(),
          onDeleted: () => {
            queue.splice(index, 1);
            drawCard();
          },
        });
      });
      root.querySelector('#btn-delete-word').addEventListener('click', async () => {
        const ok = await App.confirmDialog('删除单词', `确定要删除「${word.word}」吗？相关的复习记录也会一并删除，此操作不可撤销。`, { confirmLabel: '确定删除' });
        if (!ok) return;
        await DB.deleteVocabulary(word.id);
        App.toast('已删除');
        queue.splice(index, 1);
        drawCard();
      });
    }

    function judge(recognized) {
      if (recognized) correct++; else wrong++;
      index++;
      drawCard();
    }

    function showSummary() {
      const total = correct + wrong;
      const rate = total ? Math.round((correct / total) * 100) : 0;
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">📝</div>
          <h3>本次自习完成</h3>
          <div class="grid-2" style="margin:16px 0">
            <div class="stat-tile"><div class="num">${correct}</div><div class="label">认识</div></div>
            <div class="stat-tile"><div class="num">${wrong}</div><div class="label">不认识</div></div>
          </div>
          <div style="color:var(--text-muted);margin-bottom:18px">正确率 ${rate}%（不影响正式复习进度）</div>
          <button class="btn block" id="btn-again">重新自习一遍</button>
          <button class="btn secondary block" id="btn-back">返回自习首页</button>
        </div>
      `;
      root.querySelector('#btn-again').addEventListener('click', async () => {
        // Re-fetch so a word deleted mid-round is dropped, and any edits are picked up.
        const stillExisting = [];
        for (const w of originalPool) {
          const fresh = await DB.getVocabularyItem(w.id);
          if (fresh) stillExisting.push(fresh);
        }
        if (stillExisting.length === 0) { App.navigate('/selfstudy'); return; }
        startSession(root, libId, stillExisting);
      });
      root.querySelector('#btn-back').addEventListener('click', () => App.navigate('/selfstudy'));
    }

    drawCard();
  }

  global.Views.selfstudy = { render };
})(window);
