(function (global) {
  global.Views = global.Views || {};

  const FIELD_OPTIONS = [
    { value: 'ignore', label: '忽略此列' },
    { value: 'word', label: '日语单词/短语' },
    { value: 'meaning', label: '中文释义' },
    { value: 'part_of_speech', label: '词性/备注' },
    { value: 'example', label: '日本語の定義' },
  ];

  function guessMapping(colIndex) {
    return ['word', 'meaning', 'part_of_speech', 'example'][colIndex] || 'ignore';
  }

  function fieldMapSectionHtml(rows) {
    const colCount = Math.max(...rows.map((r) => r.length), 1);
    const previewRows = rows.slice(0, 6);
    return `
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
    `;
  }

  function rowsToEntries(rows, hasHeader, mapping) {
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const entries = [];
    for (const row of dataRows) {
      const entry = { word: '', meaning: '', part_of_speech: '', example: '' };
      mapping.forEach((field, i) => {
        if (field !== 'ignore') entry[field] = (row[i] || '').trim();
      });
      if (entry.word && entry.meaning) entries.push(entry);
    }
    return entries;
  }

  async function render(root, { query }) {
    App.setHeader('导入词库', { showBack: true });
    const libraries = await DB.listLibraries();
    const presetLibId = query.get('lib');

    let workbook = null; // { sheets:[{name}], readSheet(i) }
    const rowsCache = new Map(); // sheet index -> rows
    let fileName = '';

    root.innerHTML = `
      <div class="card">
        <h3 style="margin-top:0">1. 选择文件</h3>
        <label class="upload-drop" id="upload-drop">
          <input type="file" id="file-input" accept=".xlsx,.csv,.xls">
          <div class="emoji">📄</div>
          <div id="upload-label">点击选择 .xlsx 或 .csv 文件</div>
        </label>
      </div>
      <div id="preview-section"></div>
    `;

    const fileInput = root.querySelector('#file-input');
    const uploadLabel = root.querySelector('#upload-label');
    const previewSection = root.querySelector('#preview-section');

    async function getRows(index) {
      if (!rowsCache.has(index)) rowsCache.set(index, await workbook.readSheet(index));
      return rowsCache.get(index);
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileName = file.name;
      rowsCache.clear();
      uploadLabel.textContent = `已选择：${fileName}（解析中…）`;
      try {
        workbook = await SpreadsheetIO.openSpreadsheet(file);
        const firstRows = await getRows(0);
        if (!firstRows || firstRows.length === 0) {
          uploadLabel.textContent = '未检测到有效单词数据，请检查文件内容';
          workbook = null;
          previewSection.innerHTML = '';
          return;
        }
        uploadLabel.textContent = `已选择：${fileName}（共 ${workbook.sheets.length} 个工作表）`;
        if (!presetLibId && workbook.sheets.length > 1) {
          renderMultiSheetFlow();
        } else {
          renderSingleTargetFlow();
        }
      } catch (err) {
        uploadLabel.textContent = '解析失败：' + err.message;
        workbook = null;
        previewSection.innerHTML = '';
      }
    });

    // ---------------- Single target library (existing behaviour) ----------------
    // Used for: CSV, a single-sheet .xlsx, or "追加导入" into one specific library.
    // If the file happens to have multiple sheets in this mode, a sheet picker
    // lets the user choose which one sheet to pull data from.
    function renderSingleTargetFlow() {
      const multiSheetPicker = workbook.sheets.length > 1 ? `
        <label class="field">选择要导入的工作表
          <select id="sheet-picker">
            ${workbook.sheets.map((s, i) => `<option value="${i}">${App.escapeHtml(s.name)}</option>`).join('')}
          </select>
        </label>
      ` : '';

      previewSection.innerHTML = `
        <div class="card">
          <h3 style="margin-top:0">2. 选择目标词库</h3>
          <label class="field">导入到
            <select id="target-lib">
              <option value="__new__">＋ 新建词库</option>
              ${libraries.map((l) => `<option value="${l.id}" ${String(l.id) === presetLibId ? 'selected' : ''}>${App.escapeHtml(l.name)}</option>`).join('')}
            </select>
          </label>
          <label class="field" id="new-lib-name-wrap">新词库名称
            <input id="new-lib-name" placeholder="例如：N5词汇">
          </label>
          ${multiSheetPicker}
        </div>
        <div class="card">
          <h3 style="margin-top:0">3. 预览与字段映射</h3>
          <label class="checkbox-row" style="margin-bottom:14px">
            <input type="checkbox" id="has-header">
            <span>首行是表头（不作为单词导入）</span>
          </label>
          <div id="field-map-root"></div>
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

      const targetLibSelect = previewSection.querySelector('#target-lib');
      const newLibWrap = previewSection.querySelector('#new-lib-name-wrap');
      function syncNewLibVisibility() {
        newLibWrap.style.display = targetLibSelect.value === '__new__' ? '' : 'none';
      }
      targetLibSelect.addEventListener('change', syncNewLibVisibility);
      syncNewLibVisibility();
      if (libraries.length === 0) newLibWrap.style.display = '';

      const fieldMapRoot = previewSection.querySelector('#field-map-root');
      const sheetPicker = previewSection.querySelector('#sheet-picker');

      async function drawFieldMap() {
        const sheetIndex = sheetPicker ? Number(sheetPicker.value) : 0;
        const rows = await getRows(sheetIndex);
        fieldMapRoot.innerHTML = fieldMapSectionHtml(rows);
      }
      if (sheetPicker) sheetPicker.addEventListener('change', drawFieldMap);
      drawFieldMap();

      previewSection.querySelector('#btn-do-import').addEventListener('click', async () => {
        const mapping = Array.from(previewSection.querySelectorAll('.col-map-select')).map((s) => s.value);
        if (!mapping.includes('word') || !mapping.includes('meaning')) {
          App.toast('请至少指定"日语单词"和"中文释义"两列');
          return;
        }
        const hasHeader = previewSection.querySelector('#has-header').checked;
        const mode = previewSection.querySelector('input[name="import-mode"]:checked').value;
        const sheetIndex = sheetPicker ? Number(sheetPicker.value) : 0;
        const rows = await getRows(sheetIndex);
        const entries = rowsToEntries(rows, hasHeader, mapping);

        if (entries.length === 0) {
          App.toast('未检测到有效单词数据（需同时包含日语单词与中文释义）');
          return;
        }

        let libId;
        if (targetLibSelect.value === '__new__') {
          const name = previewSection.querySelector('#new-lib-name').value.trim();
          if (!name) { App.toast('请输入新词库名称'); return; }
          libId = await DB.createLibrary(name);
        } else {
          libId = Number(targetLibSelect.value);
        }

        const btn = previewSection.querySelector('#btn-do-import');
        btn.disabled = true;
        btn.textContent = '导入中…';

        if (mode === 'overwrite') await DB.clearLibraryVocabulary(libId);
        await DB.bulkAddVocabulary(libId, entries);

        App.toast(`成功导入 ${entries.length} 个单词`);
        App.navigate('/library/words?lib=' + libId);
      });
    }

    // ---------------- Multi-sheet: one library per sheet ----------------
    // Used when the workbook has multiple sheets (e.g. one per vocabulary
    // category) and the user came from the main "导入词库" entry point rather
    // than "追加导入" on one specific library.
    function renderMultiSheetFlow() {
      previewSection.innerHTML = `
        <div class="card">
          <h3 style="margin-top:0">2. 每个工作表将作为独立词库导入</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">检测到 ${workbook.sheets.length} 个工作表，取消勾选可跳过某个工作表；词库名称默认使用工作表名，可自行修改</div>
          ${workbook.sheets.map((s, i) => `
            <div class="field-map-row" data-sheet-row="${i}">
              <label class="checkbox-row"><input type="checkbox" class="sheet-check" data-sheet="${i}" checked><span>${App.escapeHtml(s.name)}</span></label>
              <input class="sheet-lib-name" data-sheet="${i}" value="${App.escapeHtml(s.name)}">
            </div>
          `).join('')}
        </div>
        <div class="card">
          <h3 style="margin-top:0">3. 预览与字段映射</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">以下映射设置将应用于所有选中的工作表（假定各工作表列结构一致）</div>
          <label class="field">预览工作表
            <select id="preview-sheet-picker">
              ${workbook.sheets.map((s, i) => `<option value="${i}">${App.escapeHtml(s.name)}</option>`).join('')}
            </select>
          </label>
          <label class="checkbox-row" style="margin-bottom:14px">
            <input type="checkbox" id="has-header">
            <span>首行是表头（不作为单词导入）</span>
          </label>
          <div id="field-map-root"></div>
          <div class="section-title">导入方式</div>
          <label class="checkbox-row" style="margin-bottom:8px">
            <input type="radio" name="import-mode" value="append" checked> <span>追加导入（保留目标词库已有单词）</span>
          </label>
          <label class="checkbox-row" style="margin-bottom:16px">
            <input type="radio" name="import-mode" value="overwrite"> <span>覆盖导入（清空目标词库后重建）</span>
          </label>
          <button class="btn" id="btn-do-import">开始导入</button>
        </div>
      `;

      const fieldMapRoot = previewSection.querySelector('#field-map-root');
      const previewPicker = previewSection.querySelector('#preview-sheet-picker');
      async function drawFieldMap() {
        const rows = await getRows(Number(previewPicker.value));
        fieldMapRoot.innerHTML = fieldMapSectionHtml(rows);
      }
      previewPicker.addEventListener('change', drawFieldMap);
      drawFieldMap();

      previewSection.querySelector('#btn-do-import').addEventListener('click', async () => {
        const mapping = Array.from(previewSection.querySelectorAll('.col-map-select')).map((s) => s.value);
        if (!mapping.includes('word') || !mapping.includes('meaning')) {
          App.toast('请至少指定"日语单词"和"中文释义"两列');
          return;
        }
        const hasHeader = previewSection.querySelector('#has-header').checked;
        const mode = previewSection.querySelector('input[name="import-mode"]:checked').value;

        const checks = Array.from(previewSection.querySelectorAll('.sheet-check'));
        const selectedSheets = checks.filter((c) => c.checked).map((c) => Number(c.dataset.sheet));
        if (selectedSheets.length === 0) { App.toast('请至少选择一个工作表'); return; }

        const btn = previewSection.querySelector('#btn-do-import');
        btn.disabled = true;
        btn.textContent = '导入中…';

        const summary = [];
        for (const sheetIndex of selectedSheets) {
          const nameInput = previewSection.querySelector(`.sheet-lib-name[data-sheet="${sheetIndex}"]`);
          const libName = nameInput.value.trim() || workbook.sheets[sheetIndex].name;
          const rows = await getRows(sheetIndex);
          const entries = rowsToEntries(rows, hasHeader, mapping);
          if (entries.length === 0) { summary.push(`${libName}: 0 词（未检测到有效数据）`); continue; }
          const libId = await DB.getOrCreateLibraryByName(libName);
          if (mode === 'overwrite') await DB.clearLibraryVocabulary(libId);
          await DB.bulkAddVocabulary(libId, entries);
          summary.push(`${libName}: ${entries.length} 词`);
        }

        App.toast(`导入完成 — ${summary.join('，')}`);
        App.navigate('/library');
      });
    }
  }

  global.Views.import = { render };
})(window);
