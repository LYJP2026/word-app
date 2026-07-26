// Minimal dependency-free XLSX / CSV reader & writer.
// Reads real .xlsx (zip+deflate) files using native browser Compression Streams,
// and writes .xlsx files using the uncompressed (STORED) zip method.
(function (global) {

  // ---------------- CRC32 ----------------
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------------- ZIP reader ----------------
  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;

  function findEOCD(view) {
    const maxCommentScan = Math.min(view.byteLength, 65557);
    for (let i = view.byteLength - 22; i >= view.byteLength - maxCommentScan && i >= 0; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) return i;
    }
    throw new Error('不是有效的 .xlsx 文件（未找到 ZIP 目录结构）');
  }

  function readCentralDirectory(buffer) {
    const view = new DataView(buffer);
    const eocdOffset = findEOCD(view);
    const cdCount = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    const entries = [];
    let ptr = cdOffset;
    for (let i = 0; i < cdCount; i++) {
      if (view.getUint32(ptr, true) !== SIG_CENTRAL) break;
      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const uncompressedSize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const nameBytes = new Uint8Array(buffer, ptr + 46, nameLen);
      const name = new TextDecoder('utf-8').decode(nameBytes);
      entries.push({ name, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压缩（DecompressionStream），请更新浏览器版本');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function extractEntry(buffer, entry) {
    const view = new DataView(buffer);
    const lh = entry.localHeaderOffset;
    if (view.getUint32(lh, true) !== SIG_LOCAL) {
      throw new Error('ZIP 本地文件头损坏: ' + entry.name);
    }
    const nameLen = view.getUint16(lh + 26, true);
    const extraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const compressed = new Uint8Array(buffer, dataStart, entry.compressedSize);
    if (entry.compressionMethod === 0) {
      return compressed.slice();
    } else if (entry.compressionMethod === 8) {
      return inflateRaw(compressed);
    }
    throw new Error('不支持的压缩方式: ' + entry.compressionMethod);
  }

  async function readZipTextEntry(buffer, entries, name) {
    const entry = entries.find((e) => e.name === name);
    if (!entry) return null;
    const bytes = await extractEntry(buffer, entry);
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ---------------- XLSX parse ----------------
  function colLettersToIndex(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) {
      n = n * 26 + (letters.charCodeAt(i) - 64);
    }
    return n - 1;
  }

  function parseSharedStrings(xmlText) {
    if (!xmlText) return [];
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const items = Array.from(doc.getElementsByTagName('si'));
    return items.map((si) => {
      const tNodes = si.getElementsByTagName('t');
      let text = '';
      for (const t of tNodes) text += t.textContent;
      return text;
    });
  }

  function parseSheetXml(xmlText, sharedStrings) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const rowNodes = Array.from(doc.getElementsByTagName('row'));
    const rows = [];
    for (const rowNode of rowNodes) {
      const cells = Array.from(rowNode.getElementsByTagName('c'));
      const rowArr = [];
      for (const c of cells) {
        const ref = c.getAttribute('r') || '';
        const m = ref.match(/^([A-Z]+)(\d+)$/);
        const colIdx = m ? colLettersToIndex(m[1]) : rowArr.length;
        const type = c.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          const isNode = c.getElementsByTagName('is')[0];
          if (isNode) {
            const tNodes = isNode.getElementsByTagName('t');
            for (const t of tNodes) value += t.textContent;
          }
        } else {
          const vNode = c.getElementsByTagName('v')[0];
          const raw = vNode ? vNode.textContent : '';
          if (type === 's') {
            const idx = parseInt(raw, 10);
            value = sharedStrings[idx] != null ? sharedStrings[idx] : '';
          } else {
            value = raw;
          }
        }
        while (rowArr.length < colIdx) rowArr.push('');
        rowArr[colIdx] = value;
      }
      rows.push(rowArr);
    }
    return rows;
  }

  function resolveFirstSheetPath(workbookXml, relsXml) {
    const wDoc = new DOMParser().parseFromString(workbookXml, 'application/xml');
    const sheetNode = wDoc.getElementsByTagName('sheet')[0];
    if (!sheetNode) throw new Error('工作簿中没有找到任何工作表');
    const rId = sheetNode.getAttribute('r:id') ||
      sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let target = 'worksheets/sheet1.xml';
    if (relsXml && rId) {
      const rDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
      const rels = Array.from(rDoc.getElementsByTagName('Relationship'));
      const rel = rels.find((r) => r.getAttribute('Id') === rId);
      if (rel) target = rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
    }
    return 'xl/' + target;
  }

  async function parseXlsxArrayBuffer(buffer) {
    const entries = readCentralDirectory(buffer);
    const workbookXml = await readZipTextEntry(buffer, entries, 'xl/workbook.xml');
    if (!workbookXml) throw new Error('未找到 xl/workbook.xml，文件可能已损坏');
    const relsXml = await readZipTextEntry(buffer, entries, 'xl/_rels/workbook.xml.rels');
    const sheetPath = resolveFirstSheetPath(workbookXml, relsXml);
    const sharedStringsXml = await readZipTextEntry(buffer, entries, 'xl/sharedStrings.xml');
    const sharedStrings = parseSharedStrings(sharedStringsXml);
    const sheetXml = await readZipTextEntry(buffer, entries, sheetPath);
    if (!sheetXml) throw new Error('未找到工作表数据: ' + sheetPath);
    return parseSheetXml(sheetXml, sharedStrings);
  }

  // ---------------- CSV ----------------
  function parseCsvText(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\r') { /* skip */ }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows.filter((r) => !(r.length === 1 && r[0] === ''));
  }

  function csvEscapeField(v) {
    v = v == null ? '' : String(v);
    if (/[",\n]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  function buildCsvText(rows) {
    const body = rows.map((r) => r.map(csvEscapeField).join(',')).join('\r\n');
    return '﻿' + body;
  }

  // ---------------- XLSX writer (STORED zip) ----------------
  function xmlEscape(v) {
    v = v == null ? '' : String(v);
    return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function buildSheetXml(rows) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach((row, rIdx) => {
      xml += `<row r="${rIdx + 1}">`;
      row.forEach((val, cIdx) => {
        const colLetter = indexToColLetters(cIdx);
        const ref = `${colLetter}${rIdx + 1}`;
        xml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`;
      });
      xml += '</row>';
    });
    xml += '</sheetData></worksheet>';
    return xml;
  }

  function indexToColLetters(idx) {
    let n = idx + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>';

  const ROOT_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const WORKBOOK_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';

  const WORKBOOK_RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>';

  function buildZip(files) {
    // files: [{name, data(Uint8Array)}]
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);
      const localHeader = new ArrayBuffer(30);
      const lv = new DataView(localHeader);
      lv.setUint32(0, SIG_LOCAL, true);
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0, true); // flags
      lv.setUint16(8, 0, true); // stored
      lv.setUint16(10, 0, true); // mod time
      lv.setUint16(12, 0, true); // mod date
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);

      localParts.push(new Uint8Array(localHeader), nameBytes, data);
      const localHeaderOffset = offset;
      offset += 30 + nameBytes.length + data.length;

      const centralHeader = new ArrayBuffer(46);
      const cv = new DataView(centralHeader);
      cv.setUint32(0, SIG_CENTRAL, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, localHeaderOffset, true);
      centralParts.push(new Uint8Array(centralHeader), nameBytes);
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const p of centralParts) centralSize += p.length;

    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, SIG_EOCD, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, new Uint8Array(eocd)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  function buildXlsxBlob(rows) {
    const encoder = new TextEncoder();
    const files = [
      { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES_XML) },
      { name: '_rels/.rels', data: encoder.encode(ROOT_RELS_XML) },
      { name: 'xl/workbook.xml', data: encoder.encode(WORKBOOK_XML) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(WORKBOOK_RELS_XML) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(buildSheetXml(rows)) },
    ];
    return buildZip(files);
  }

  // ---------------- Public API ----------------
  async function parseSpreadsheetFile(file) {
    const name = file.name || '';
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    if (ext === '.csv') {
      const text = await file.text();
      return parseCsvText(text);
    } else if (ext === '.xlsx') {
      const buf = await file.arrayBuffer();
      return parseXlsxArrayBuffer(buf);
    } else if (ext === '.xls') {
      throw new Error('暂不支持旧版 .xls 格式，请在 Excel/WPS 中"另存为" .xlsx 或 .csv 后再导入');
    }
    throw new Error('不支持的文件格式：' + ext + '，请使用 .xlsx 或 .csv');
  }

  global.SpreadsheetIO = {
    parseSpreadsheetFile,
    parseCsvText,
    buildCsvText,
    buildXlsxBlob,
  };
})(window);
