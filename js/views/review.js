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
      startReviewFlow(root, items.filter((it) => it.word));
    });
  }

  // Drives the whole review session, which may span several rounds: any word
  // marked "不认识" gets queued straight back into the next round, and this
  // repeats automatically until a round comes back with nothing wrong.
  function startReviewFlow(root, initialQueue) {
    let roundNumber = 1;
    let cumulativeCorrect = 0;
    let cumulativeWrong = 0;

    runRound(initialQueue);

    function runRound(queue) {
      let index = 0;
      let flipped = false;
      const wrongThisRound = [];

      function drawCard() {
        if (index >= queue.length) {
          if (wrongThisRound.length > 0) showContinuePrompt(wrongThisRound);
          else showFinalSummary();
          return;
        }
        flipped = false;
        const { word, record } = queue[index];
        root.innerHTML = `
          <div class="study-progress">第 ${roundNumber} 轮 &middot; 第 ${index + 1} / ${queue.length} 个 &middot; ${Scheduler.levelLabel(record.review_level)}</div>
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
                <div class="card-hint">先回忆，再点击卡片查看释义</div>
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

      async function judge(recognized) {
        const item = queue[index];
        await DB.recordReviewOutcome(item.word.id, recognized);
        await DB.bumpDailyCounter('reviewed');
        if (recognized) cumulativeCorrect++;
        else { cumulativeWrong++; wrongThisRound.push(item.word); }
        index++;
        drawCard();
      }

      drawCard();
    }

    function showContinuePrompt(wrongWords) {
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🔁</div>
          <h3>还有 ${wrongWords.length} 个单词不熟悉</h3>
          <div style="color:var(--text-muted);margin-bottom:18px">再复习一轮，直到全部标记为"认识"为止</div>
          <button class="btn block" id="btn-continue-round">继续复习</button>
          <button class="btn secondary block" id="btn-stop-early">先返回首页</button>
        </div>
      `;
      root.querySelector('#btn-continue-round').addEventListener('click', async () => {
        roundNumber++;
        const nextQueue = await Promise.all(wrongWords.map(async (word) => ({
          word,
          record: await DB.getStudyRecord(word.id),
        })));
        runRound(nextQueue.filter((it) => it.record));
      });
      root.querySelector('#btn-stop-early').addEventListener('click', () => App.navigate('/dashboard'));
      App.refreshBadge();
    }

    function showFinalSummary() {
      const total = cumulativeCorrect + cumulativeWrong;
      const rate = total ? Math.round((cumulativeCorrect / total) * 100) : 0;
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🎉</div>
          <h3>全部复习完成！</h3>
          <div style="color:var(--text-muted);margin-bottom:8px">所有单词都已标记为"认识"${roundNumber > 1 ? `（共复习了 ${roundNumber} 轮）` : ''}</div>
          <div class="grid-2" style="margin:16px 0">
            <div class="stat-tile"><div class="num">${cumulativeCorrect}</div><div class="label">认识次数</div></div>
            <div class="stat-tile"><div class="num">${cumulativeWrong}</div><div class="label">不认识次数</div></div>
          </div>
          <div style="color:var(--text-muted);margin-bottom:18px">总体正确率 ${rate}%</div>
          <button class="btn secondary block" id="btn-home">返回首页</button>
        </div>
      `;
      root.querySelector('#btn-home').addEventListener('click', () => App.navigate('/dashboard'));
      App.refreshBadge();
    }
  }

  global.Views.review = { render, startReviewFlow };
})(window);
