// Local reminder notifications.
// Limitation: this is a fully offline, local-only app with no push server, so a
// reminder can only fire while the app/tab is open (foreground or backgrounded but
// not fully closed). We check on load and on a periodic timer against the user's
// configured reminder time and the last-notified date stored in Settings.
(function (global) {
  let timerId = null;

  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return Notification.requestPermission();
  }

  function fireNotification(count) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('今日复习提醒', {
        body: `你有 ${count} 个单词等待复习，坚持才能形成长期记忆～`,
        icon: 'icons/icon.svg',
        tag: 'daily-review-reminder',
      });
    } catch (e) { /* some browsers require SW-based notifications; ignore failures */ }
  }

  async function checkAndMaybeNotify() {
    const enabled = await DB.getSetting('reminderEnabled', false);
    if (!enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const reminderTime = await DB.getSetting('reminderTime', '20:00');
    const [h, m] = reminderTime.split(':').map(Number);
    const now = new Date();
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (now < target) return;
    const today = DB.todayStr();
    const lastNotified = await DB.getSetting('lastNotifiedDate', '');
    if (lastNotified === today) return;
    const records = await DB.getAllStudyRecords(null);
    const due = Scheduler.getTodayReviews(records, today);
    if (due.length === 0) return;
    fireNotification(due.length);
    await DB.setSetting('lastNotifiedDate', today);
  }

  function startWatcher() {
    if (timerId) clearInterval(timerId);
    checkAndMaybeNotify();
    timerId = setInterval(checkAndMaybeNotify, 60 * 1000);
  }

  global.Notify = { requestPermission, startWatcher, checkAndMaybeNotify };
})(window);
