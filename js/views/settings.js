(function (global) {
  global.Views = global.Views || {};

  async function render(root) {
    App.setHeader('设置');
    const dailyGoal = await DB.getSetting('dailyGoal', 20);
    const reminderEnabled = await DB.getSetting('reminderEnabled', false);
    const reminderTime = await DB.getSetting('reminderTime', '20:00');
    const theme = await DB.getSetting('theme', 'system');

    root.innerHTML = `
      <div class="section-title">学习设置</div>
      <div class="card">
        <label class="field">每日学习目标（新单词数）
          <input type="number" id="s-daily-goal" min="1" value="${dailyGoal}">
        </label>
      </div>

      <div class="section-title">复习提醒</div>
      <div class="card">
        <label class="checkbox-row" style="margin-bottom:14px">
          <input type="checkbox" id="s-reminder-enabled" ${reminderEnabled ? 'checked' : ''}>
          <span>开启每日复习提醒</span>
        </label>
        <label class="field">提醒时间
          <input type="time" id="s-reminder-time" value="${reminderTime}">
        </label>
        <div style="font-size:12px;color:var(--text-muted)">提示：本应用完全离线运行，没有后台推送服务器，提醒仅在本应用保持打开（含后台标签页）时生效。</div>
      </div>

      <div class="section-title">外观</div>
      <div class="card">
        <label class="field">主题
          <select id="s-theme">
            <option value="system" ${theme === 'system' ? 'selected' : ''}>跟随系统</option>
            <option value="light" ${theme === 'light' ? 'selected' : ''}>浅色</option>
            <option value="dark" ${theme === 'dark' ? 'selected' : ''}>深色</option>
          </select>
        </label>
      </div>

      <div class="section-title">数据管理</div>
      <div class="card">
        <button class="btn secondary block" id="btn-backup">导出全部数据备份（.json）</button>
        <label class="upload-drop" id="restore-drop" style="margin-bottom:10px">
          <input type="file" id="restore-input" accept=".json">
          <div>点击选择备份文件恢复数据</div>
        </label>
        <button class="btn danger block" id="btn-clear">清空所有数据</button>
      </div>

      <div class="section-title">关于</div>
      <div class="card" style="font-size:13px;color:var(--text-muted)">
        小百合の単語帳 v1.0<br>
        基于艾宾浩斯遗忘曲线的 1-7-30 日间隔复习法<br>
        所有数据仅保存在本机浏览器中，不上传云端
      </div>
    `;

    root.querySelector('#s-daily-goal').addEventListener('change', async (e) => {
      const val = Math.max(1, Number(e.target.value) || 20);
      await DB.setSetting('dailyGoal', val);
      App.toast('已保存');
    });

    root.querySelector('#s-reminder-enabled').addEventListener('change', async (e) => {
      if (e.target.checked) {
        const perm = await Notify.requestPermission();
        if (perm !== 'granted') {
          App.toast('需要通知权限才能提醒');
          e.target.checked = false;
          return;
        }
      }
      await DB.setSetting('reminderEnabled', e.target.checked);
      App.toast('已保存');
    });

    root.querySelector('#s-reminder-time').addEventListener('change', async (e) => {
      await DB.setSetting('reminderTime', e.target.value);
      App.toast('已保存');
    });

    root.querySelector('#s-theme').addEventListener('change', async (e) => {
      await DB.setSetting('theme', e.target.value);
      App.applyTheme(e.target.value);
      App.toast('已保存');
    });

    root.querySelector('#btn-backup').addEventListener('click', async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `word-app-backup-${DB.todayStr()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      App.toast('已导出备份文件');
    });

    root.querySelector('#restore-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        confirmRestore(data);
      } catch (err) {
        App.toast('备份文件无效：' + err.message);
      }
    });

    root.querySelector('#btn-clear').addEventListener('click', confirmClearAll);
  }

  function confirmRestore(data) {
    const modal = App.openModal(`
      <h3>恢复数据</h3>
      <p style="color:var(--text-muted)">恢复备份将清空当前所有词库和学习记录，并替换为备份文件中的数据，此操作不可撤销。确定继续吗？</p>
      <div class="btn-row">
        <button class="btn secondary" id="c-cancel">取消</button>
        <button class="btn danger" id="c-confirm">确定恢复</button>
      </div>
    `);
    modal.querySelector('#c-cancel').addEventListener('click', () => App.closeModal());
    modal.querySelector('#c-confirm').addEventListener('click', async () => {
      await DB.importAllReplace(data);
      App.closeModal();
      App.toast('数据已恢复');
      App.navigate('/dashboard');
    });
  }

  function confirmClearAll() {
    const modal = App.openModal(`
      <h3>清空所有数据</h3>
      <p style="color:var(--text-muted)">将永久删除所有词库、单词和学习记录，且无法恢复（建议先导出备份）。确定要清空吗？</p>
      <div class="btn-row">
        <button class="btn secondary" id="c-cancel">取消</button>
        <button class="btn danger" id="c-confirm">确定清空</button>
      </div>
    `);
    modal.querySelector('#c-cancel').addEventListener('click', () => App.closeModal());
    modal.querySelector('#c-confirm').addEventListener('click', async () => {
      await DB.clearAllData();
      App.closeModal();
      App.toast('已清空所有数据');
      App.navigate('/dashboard');
    });
  }

  global.Views.settings = { render };
})(window);
