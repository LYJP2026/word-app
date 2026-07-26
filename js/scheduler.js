// 7-day (1-7-30) spaced repetition scheduler, per the PRD pseudocode.
(function (global) {
  function daysBetween(fromStr, toStr) {
    const a = new Date(fromStr + 'T00:00:00');
    const b = new Date(toStr + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // records: array of {vocabulary_id, study_date, review_level, ...}
  // returns records due today, sorted by priority (level 1 > 2 > 3)
  function getTodayReviews(records, todayStr) {
    const due = [];
    for (const record of records) {
      if (!record.study_date) continue;
      if (record.review_level === 0 || record.review_level === 4) continue; // not scheduled / mastered
      const daysSinceStudy = daysBetween(record.study_date, todayStr);
      if (record.review_level === 1 && daysSinceStudy >= 1) due.push(record);
      else if (record.review_level === 2 && daysSinceStudy >= 7) due.push(record);
      else if (record.review_level === 3 && daysSinceStudy >= 30) due.push(record);
    }
    due.sort((a, b) => a.review_level - b.review_level);
    return due;
  }

  function levelLabel(level) {
    switch (level) {
      case 0: return '未安排';
      case 1: return '待第1次复习';
      case 2: return '待第2次复习';
      case 3: return '待第3次复习';
      case 4: return '已掌握';
      default: return '';
    }
  }

  global.Scheduler = { getTodayReviews, levelLabel, daysBetween };
})(window);
