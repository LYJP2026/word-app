(function (global) {
  global.Views = global.Views || {};

  async function computeStreak(dailyCounters, todayStr) {
    const activeDates = new Set(
      Object.entries(dailyCounters)
        .filter(([, v]) => (v.learned || 0) > 0 || (v.reviewed || 0) > 0)
        .map(([d]) => d)
    );
    let streak = 0;
    let cursor = todayStr;
    while (activeDates.has(cursor)) {
      streak++;
      cursor = DB.addDays(cursor, -1);
    }
    return streak;
  }

  function buildCalendar(dailyCounters, todayStr) {
    const today = new Date(todayStr + 'T00:00:00');
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const counter = dailyCounters[dateStr];
      const active = counter && ((counter.learned || 0) > 0 || (counter.reviewed || 0) > 0);
      cells.push({ day: d, dateStr, active, isToday: dateStr === todayStr });
    }
    return { cells, year, month };
  }

  async function render(root) {
    App.setHeader('学习统计');
    const today = DB.todayStr();
    const [todayCounter, dailyCounters, libraries] = await Promise.all([
      DB.getDailyCounter(today),
      DB.getAllDailyCounters(),
      DB.listLibraries(),
    ]);
    const streak = await computeStreak(dailyCounters, today);

    let totalWords = 0, mastered = 0, learning = 0, notStarted = 0;
    const levelCounts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const lib of libraries) {
      const words = await DB.listVocabulary(lib.id);
      const records = await DB.getAllStudyRecords(lib.id);
      const recordMap = new Map(records.map((r) => [r.vocabulary_id, r]));
      totalWords += words.length;
      for (const w of words) {
        const rec = recordMap.get(w.id);
        const level = rec ? rec.review_level : 0;
        levelCounts[level] = (levelCounts[level] || 0) + 1;
        if (level === 4) mastered++;
        else if (level === 0) notStarted++;
        else learning++;
      }
    }

    const { cells, month } = buildCalendar(dailyCounters, today);
    const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
    const maxLevelCount = Math.max(...Object.values(levelCounts), 1);

    root.innerHTML = `
      <div class="section-title">今日数据</div>
      <div class="grid-2">
        <div class="stat-tile"><div class="num">${todayCounter.learned || 0}</div><div class="label">今日已学</div></div>
        <div class="stat-tile"><div class="num">${todayCounter.reviewed || 0}</div><div class="label">今日复习</div></div>
      </div>
      <div class="stat-tile" style="margin-top:10px"><div class="num">🔥 ${streak}</div><div class="label">连续学习天数</div></div>

      <div class="section-title">总体数据</div>
      <div class="grid-2">
        <div class="stat-tile"><div class="num">${totalWords}</div><div class="label">总单词数</div></div>
        <div class="stat-tile"><div class="num">${mastered}</div><div class="label">已掌握</div></div>
      </div>
      <div class="grid-2" style="margin-top:10px">
        <div class="stat-tile"><div class="num">${learning}</div><div class="label">学习中</div></div>
        <div class="stat-tile"><div class="num">${notStarted}</div><div class="label">待学</div></div>
      </div>

      <div class="section-title">掌握程度分布</div>
      <div class="card">
        ${[0, 1, 2, 3, 4].map((lvl) => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:4px">
              <span>${Scheduler.levelLabel(lvl)}</span><span>${levelCounts[lvl] || 0}</span>
            </div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${((levelCounts[lvl] || 0) / maxLevelCount) * 100}%"></div></div>
          </div>
        `).join('')}
      </div>

      <div class="section-title">学习日历（${month + 1}月）</div>
      <div class="card">
        <div class="calendar-grid" style="margin-bottom:6px">
          ${weekdayLabels.map((w) => `<div class="calendar-weekday">${w}</div>`).join('')}
        </div>
        <div class="calendar-grid">
          ${cells.map((c) => c ? `<div class="calendar-cell ${c.active ? 'has-activity' : ''} ${c.isToday ? 'today' : ''}">${c.day}</div>` : '<div></div>').join('')}
        </div>
      </div>
    `;
  }

  global.Views.stats = { render };
})(window);
