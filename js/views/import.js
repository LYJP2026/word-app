(function (global) {
  global.Views = global.Views || {};

  const FIELD_OPTIONS = [
    { value: 'ignore', label: '忽略此列' },
    { value: 'word', label: '日语单词/短语' },
    { value: 'meaning', label: '中文释义' },
    { value: 'part_of_speech', label: '词性/备注' },
    { value: 'example', label: '例句' },
  ];

  function guessMapping(colIndex) {
    return ['word', 'meaning', 'part_of_speech', 'example'][colIndex] || 'ignore';
  }

  async function render(root, { query }) {
    App.setHeader('导入词库', { showBack: true });
    const libraries = await DB.listLibraries();
    const presetLibId = query.get('lib');

    let parsedRows = null;
    let fileName = '';

    root.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">1. 选择目标词库</h3>
        <label class="field">导入到
          <select id="target-lib">
            <option value="__new__">＋ 新建词库</option>
            ${libraries.map((l) => `<option value="${l.id}" ${String(l.id) === presetLibId ? 'selected' : ''}>${App.escapeHtml(l.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field" id="new-lib-name-wrap">新词库名称
          <input id="new-lib-name" placeholder="例如：N5词汇">
        </label>
      </div>

      <div class="card">
        <h3 style="margin-top:0">2. 选择文件</h3>
        <label class="upload-drop" id="upload-drop">
          <input type="file" id="file-input" accept=".xlsx,.csv,.xls">
          <div class="emoji">📄</div>
          <div id="upload-label">点击选择 .xlsx 或 .csv 文件</div>
        </label>
      </div>

      <div id="preview-section"></div>
    `;

    const targetLibSelect = root.querySelector('#target-lib');
    const newLibWrap = root.querySelector('#new-lib-name-wrap');
    function syncNewLibVisibility() {
      newLibWrap.style.display = targetLibSelect.value === '__new__' ? '' : 'none';
    }
    targetLibSelect.addEventListener('change', syncNewLibVisibility);
    syncNewLibVisibility();

    const fileInput = root.querySelector('#file-input');
    const uploadLabel = root.querySelector('#upload-label');
    const previewSection = root.querySelector('#preview-section');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileName = file.name;
      uploadLabel.textContent = `已选择：${fileName}（解析中…）`;
      try {
        parsedRows = await SpreadsheetIO.parseSpreadsheetFile(file);
        if (!parsedRows || parsedRows.length === 0) {
          uploadLabel.textContent = '未检测到有效单词数据，请检查文件内容';
          parsedRows = null;
          previewSection.innerHTML = '';
          return;
        }
        uploadLabel.textContent = `已选择：${fileName}（共 ${parsedRows.length} 行）`;
        renderPreview();
      } catch (err) {
        uploadLabel.textContent = '解析失败：' + err.message;
        parsedRows = null;
        previewSection.innerHTML = '';
      }
    });

    function renderPreview() {
      const colCount = Math.max(...parsedRows.map((r) => r.length), 1);
      const previewRows = parsedRows.slice(0, 6);

      previewSection.innerHTML = `
        <div class="card">
          <h3 style="margin-top:0">3. 预览与字段映射</h3>
          <label class="checkbox-row" style="margin-bottom:14px">
            <input type="checkbox" id="has-header">
            <span>首行是表头（不作为单词导入）</span>
          </label>
          <div class="table-scroll">
            <table class="preview-table">
              <thead><tr>${Array.from({ length: colCount }).map((_, i) => `<th>列 ${String.fromCharCode(65 + i)}</th>`).join('')}</tr></thead>
              <tbody>
                ${previewRows.map((r) => `<tr>${Array.from({ length: colCount }).map((_, i) => `<td>${App.escapeHtml(r[i] || '')}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="section-title">字段映射</div>
          ${Array.from({ length: colCount }).map((_, i) => `
            <div class="field-map-row">
              <span class="col-label">列 ${String.fromCharCode(65 + i)}</span>
              <select data-col="${i}" class="col-map-select">
                ${FIELD_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === guessMapping(i) ? 'selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </div>
          `).join('')}
          <div class="section-title">导入方式</div>
          <label class="checkbox-row" style="margin-bottom:8px">
            <input type="radio" name="import-mode" value="append" checked> <span>追加导入（保留已有单词）</span>
          </label>
          <label class="checkbox-row" style="margin-bottom:16px">
            <input type="radio" name="import-mode" value="overwrite"> <span>覆盖导入（清空该词库后重建）</span>
          </label>
          <button class="btn" id="btn-do-import">开始导入</button>
        </div>
      `;

      root.querySelector('#btn-do-import').addEventListener('click', doImport);
    }

    async function doImport() {
      const mapSelects = Array.from(root.querySelectorAll('.col-map-select'));
      const mapping = mapSelects.map((s) => s.value);
      if (!mapping.includes('word') || !mapping.includes('meaning')) {
        App.toast('请至少指定"日语单词"和"中文释义"两列');
        return;
      }
      const hasHeader = root.querySelector('#has-header').checked;
      const mode = root.querySelector('input[name="import-mode"]:checked').value;

      let libId;
      if (targetLibSelect.value === '__new__') {
        const name = root.querySelector('#new-lib-name').value.trim();
        if (!name) { App.toast('请输入新词库名称'); return; }
        libId = await DB.createLibrary(name);
      } else {
        libId = Number(targetLibSelect.value);
      }

      const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
      const entries = [];
      for (const row of dataRows) {
        const entry = { word: '', meaning: '', part_of_speech: '', example: '' };
        mapping.forEach((field, i) => {
          if (field !== 'ignore') entry[field] = (row[i] || '').trim();
        });
        if (entry.word && entry.meaning) entries.push(entry);
      }

      if (entries.length === 0) {
        App.toast('未检测到有效单词数据（需同时包含日语单词与中文释义）');
        return;
      }

      const btn = root.querySelector('#btn-do-import');
      btn.disabled = true;
      btn.textContent = '导入中…';

      if (mode === 'overwrite') {
        await DB.clearLibraryVocabulary(libId);
      }
      await DB.bulkAddVocabulary(libId, entries);

      App.toast(`成功导入 ${entries.length} 个单词`);
      App.navigate('/library/words?lib=' + libId);
    }

    if (libraries.length === 0) {
      root.querySelector('#new-lib-name-wrap').style.display = '';
    }
  }

  global.Views.import = { render };
})(window);
