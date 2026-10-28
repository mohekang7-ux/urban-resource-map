/**
 * 據點填報系統（Google Apps Script，綁定在 Google 試算表上）
 *
 * 據點透過網頁自行管理「我們提供的」與「我們需要的」資源，資料存在這份試算表。
 * 2026-10-28 決定：第一階段不做身分驗證，但必須提供 Gmail；填報後直接公開；
 * 聯絡方式由據點自行決定是否公開；Gmail 一律不公開。每次修改都寫入「log」工作表。
 *
 * 部署方式見 apps-script/README.md。詞表在 Vocab.gs，由 pipeline/apps_script_vocab.py 產生。
 *
 * 網址：
 *   …/exec                 填報網頁
 *   …/exec?action=export   匯出可公開的資料（JSON），供 pipeline/portal.py 讀取
 */

const SHEETS = {
  nodes: ['node_id', 'name', 'node_type', 'needs', 'address', 'lon', 'lat', 'description',
          'contact_public', 'contact_text', 'email', 'consent', 'status', 'created_at', 'updated_at'],
  offers: ['offer_id', 'node_id', 'item_id', 'access', 'conditions', 'status', 'created_at', 'updated_at'],
  wants: ['want_id', 'node_id', 'item_id', 'status', 'note', 'created_at', 'updated_at'],
  log: ['timestamp', 'email', 'action', 'table', 'record_id', 'before', 'after'],
};

const NODE_TYPES = {
  shop: '店家', workshop: '工作室或工坊', community: '社區組織或社區據點',
  school: '學校或校內單位', public: '公部門或公共設施', individual: '個人', other: '其他',
};
const OFFER_STATUS = ['active', 'paused'];
const WANT_STATUS = ['missing', 'partial', 'unknown', 'fulfilled'];
const TAIPEI_BBOX = { lonMin: 121.4, lonMax: 121.7, latMin: 24.9, latMax: 25.3 };
const MAX_TEXT = 500;

// ---------- 初次設定 ----------

/** 在 Apps Script 編輯器手動執行一次：建立工作表與標題列。 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(SHEETS).forEach(([name, header]) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
  const first = ss.getSheets()[0];
  if (first.getName() === '工作表1' || first.getName() === 'Sheet1') ss.deleteSheet(first);
}

// ---------- 網頁進入點 ----------

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'export') {
    return ContentService.createTextOutput(JSON.stringify(exportPublic()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('據點資源庫：填報你的供給與需求')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- 給網頁呼叫的函式（google.script.run） ----------

function getVocab() {
  return { ...VOCAB, node_types: NODE_TYPES };
}

/** 依 Gmail 列出該信箱建立的據點（不含已刪除的）。 */
function findNodes(email) {
  email = checkEmail(email);
  return readRows('nodes')
    .filter((n) => n.email === email && n.status !== 'deleted')
    .map((n) => ({ node_id: n.node_id, name: n.name, updated_at: n.updated_at }));
}

/** 讀取一個據點及其供給與需求；Gmail 必須和建立者相同。 */
function getNode(nodeId, email) {
  const node = ownedNode(nodeId, checkEmail(email));
  return {
    node: publicNodeFields(node, true),
    offers: readRows('offers').filter((o) => o.node_id === nodeId && o.status !== 'deleted'),
    wants: readRows('wants').filter((w) => w.node_id === nodeId && w.status !== 'deleted'),
  };
}

/** 新增或更新據點。payload.node_id 為空時新增。回傳 node_id。 */
function saveNode(payload) {
  return withLock(() => {
    const email = checkEmail(payload.email);
    const now = new Date().toISOString();
    const vocab = getVocab();
    const record = {
      name: requireText(payload.name, '據點名稱', 60),
      node_type: requireEnum(payload.node_type, Object.keys(NODE_TYPES), '據點類型'),
      needs: requireList(payload.needs, vocab.needs.map((n) => n.need_id), '據點屬性').join(';'),
      address: cleanText(payload.address, 120),
      lon: requireNumber(payload.lon, TAIPEI_BBOX.lonMin, TAIPEI_BBOX.lonMax, '位置（經度）'),
      lat: requireNumber(payload.lat, TAIPEI_BBOX.latMin, TAIPEI_BBOX.latMax, '位置（緯度）'),
      description: cleanText(payload.description, MAX_TEXT),
      contact_public: payload.contact_public === true,
      contact_text: cleanText(payload.contact_text, 200),
      consent: payload.consent === true,
      updated_at: now,
    };
    if (!record.consent) throw new Error('請先勾選同意公開說明。');
    if (record.contact_public && !record.contact_text) throw new Error('選擇公開聯絡方式時，請填寫要公開的聯絡方式。');

    if (payload.node_id) {
      const before = ownedNode(payload.node_id, email);
      updateRow('nodes', 'node_id', payload.node_id, record);
      writeLog(email, 'update', 'nodes', payload.node_id, before, record);
      return payload.node_id;
    }
    const nodeId = 'portal-' + Utilities.getUuid().slice(0, 8);
    appendRow('nodes', { ...record, node_id: nodeId, email, status: 'active', created_at: now });
    writeLog(email, 'create', 'nodes', nodeId, null, record);
    return nodeId;
  });
}

function saveOffer(nodeId, email, offer) {
  return withLock(() => {
    email = checkEmail(email);
    ownedNode(nodeId, email);
    const vocab = getVocab();
    const record = {
      node_id: nodeId,
      item_id: requireEnum(offer.item_id, vocab.resource_items.map((i) => i.item_id), '資源項目'),
      access: requireList(offer.access, vocab.access_modes.map((a) => a.access_id), '取得方式').join(';'),
      conditions: cleanText(offer.conditions, MAX_TEXT),
      status: requireEnum(offer.status || 'active', OFFER_STATUS, '狀態'),
      updated_at: new Date().toISOString(),
    };
    return upsertChild('offers', 'offer_id', offer.offer_id, record, email, nodeId);
  });
}

function saveWant(nodeId, email, want) {
  return withLock(() => {
    email = checkEmail(email);
    ownedNode(nodeId, email);
    const vocab = getVocab();
    const record = {
      node_id: nodeId,
      item_id: requireEnum(want.item_id, vocab.resource_items.map((i) => i.item_id), '資源項目'),
      status: requireEnum(want.status || 'missing', WANT_STATUS, '狀態'),
      note: cleanText(want.note, MAX_TEXT),
      updated_at: new Date().toISOString(),
    };
    return upsertChild('wants', 'want_id', want.want_id, record, email, nodeId);
  });
}

/** 刪除供給或需求（軟刪除：狀態改為 deleted，保留紀錄）。 */
function deleteItem(table, id, nodeId, email) {
  return withLock(() => {
    email = checkEmail(email);
    ownedNode(nodeId, email);
    const key = { offers: 'offer_id', wants: 'want_id' }[table];
    if (!key) throw new Error('不支援的資料表。');
    const before = readRows(table).find((r) => r[key] === id && r.node_id === nodeId);
    if (!before) throw new Error('找不到這筆資料。');
    updateRow(table, key, id, { status: 'deleted', updated_at: new Date().toISOString() });
    writeLog(email, 'delete', table, id, before, null);
    return true;
  });
}

// ---------- 匯出（公開） ----------

/** 只匯出可公開的欄位：不含 Gmail；聯絡方式只在據點選擇公開時輸出；個人據點的位置降低精度、不含地址。 */
function exportPublic() {
  const nodes = readRows('nodes').filter((n) => n.status === 'active' && n.consent === true);
  const ids = new Set(nodes.map((n) => n.node_id));
  return {
    generated_at: new Date().toISOString(),
    nodes: nodes.map((n) => publicNodeFields(n, false)),
    offers: readRows('offers').filter((o) => ids.has(o.node_id) && o.status === 'active')
      .map(({ offer_id, node_id, item_id, access, conditions, updated_at }) => ({ offer_id, node_id, item_id, access, conditions, updated_at })),
    wants: readRows('wants').filter((w) => ids.has(w.node_id) && w.status !== 'deleted')
      .map(({ want_id, node_id, item_id, status, note, updated_at }) => ({ want_id, node_id, item_id, status, note, updated_at })),
  };
}

function publicNodeFields(n, forOwner) {
  const individual = n.node_type === 'individual';
  const round = (v) => (individual && !forOwner ? Math.round(Number(v) * 100) / 100 : Number(v)); // 約 1 公里
  const out = {
    node_id: n.node_id, name: n.name, node_type: n.node_type, needs: String(n.needs).split(';').filter(String),
    address: individual && !forOwner ? '' : n.address, lon: round(n.lon), lat: round(n.lat),
    description: n.description, contact: n.contact_public === true ? n.contact_text : '',
    created_at: n.created_at, updated_at: n.updated_at,
  };
  if (forOwner) Object.assign(out, { contact_public: n.contact_public === true, contact_text: n.contact_text, consent: n.consent === true });
  return out;
}

// ---------- 試算表讀寫 ----------

function sheet(name) {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!s) throw new Error(`找不到工作表 ${name}，請先執行 setup()。`);
  return s;
}

function readRows(name) {
  const values = sheet(name).getDataRange().getValues();
  const header = values.shift();
  return values.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
}

function appendRow(name, record) {
  sheet(name).appendRow(SHEETS[name].map((h) => safeCell(record[h])));
}

function updateRow(name, keyField, keyValue, changes) {
  const s = sheet(name);
  const values = s.getDataRange().getValues();
  const header = values[0];
  const keyCol = header.indexOf(keyField);
  const rowIndex = values.findIndex((r, i) => i > 0 && r[keyCol] === keyValue);
  if (rowIndex < 1) throw new Error('找不到要更新的資料。');
  const row = values[rowIndex].slice();
  Object.entries(changes).forEach(([k, v]) => {
    const col = header.indexOf(k);
    if (col >= 0) row[col] = safeCell(v);
  });
  s.getRange(rowIndex + 1, 1, 1, row.length).setValues([row]);
}

function upsertChild(table, key, id, record, email, nodeId) {
  if (id) {
    const before = readRows(table).find((r) => r[key] === id && r.node_id === nodeId);
    if (!before) throw new Error('找不到這筆資料。');
    updateRow(table, key, id, record);
    writeLog(email, 'update', table, id, before, record);
    return id;
  }
  const newId = `${nodeId}:${table === 'offers' ? 'offer' : 'need'}:${Utilities.getUuid().slice(0, 6)}`;
  appendRow(table, { ...record, [key]: newId, created_at: record.updated_at });
  writeLog(email, 'create', table, newId, null, record);
  return newId;
}

function writeLog(email, action, table, id, before, after) {
  appendRow('log', {
    timestamp: new Date().toISOString(), email, action, table, record_id: id,
    before: before ? JSON.stringify(before) : '', after: after ? JSON.stringify(after) : '',
  });
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- 檢查與清理 ----------

function ownedNode(nodeId, email) {
  const node = readRows('nodes').find((n) => n.node_id === nodeId && n.status !== 'deleted');
  if (!node) throw new Error('找不到這個據點。');
  if (node.email !== email) throw new Error('這個 Gmail 不是此據點的建立者。');
  return node;
}

function checkEmail(email) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@(gmail|googlemail)\.com$/.test(email)) throw new Error('請填寫有效的 Gmail 信箱（@gmail.com）。');
  return email;
}

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function requireText(v, label, max) {
  const t = cleanText(v, max);
  if (!t) throw new Error(`請填寫${label}。`);
  return t;
}

function requireEnum(v, allowed, label) {
  if (!allowed.includes(v)) throw new Error(`${label}的選項不正確。`);
  return v;
}

function requireList(v, allowed, label) {
  const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
  if (!list.length) throw new Error(`請至少選擇一個${label}。`);
  list.forEach((x) => requireEnum(x, allowed, label));
  return list;
}

function requireNumber(v, min, max, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${label}不在臺北市範圍內，請在地圖上點選據點位置。`);
  return Math.round(n * 1e6) / 1e6;
}

/** 防止試算表公式注入：以 = + - @ 開頭的文字前面加上單引號。 */
function safeCell(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v == null ? '' : v;
}
