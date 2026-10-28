/**
 * 資源網絡的公開協作後端（Google Apps Script，綁定在 Google 試算表上）— 第 2 版
 *
 * 2026-10-28 決定（docs/decisions.md）：
 * - 在網站地圖上直接新增、編輯、評論、回報「還在／已經沒有了」、回應需求；
 * - 以 Google 帳號登入才能寫入（網站用 Google Identity Services 取得 ID token，這裡驗證）；
 * - 任何人都能修改任何據點，每次修改寫入 log、可還原，建立者會收到 Email 通知；
 * - 3 個月沒有人確認的資料，網站標示「可能已過時」（由網站依 last_confirmed_at 判斷）。
 *
 * 部署方式見 apps-script/README.md。詞表在 Vocab.gs，由 pipeline/apps_script_vocab.py 產生。
 *
 * 指令碼屬性（專案設定 → 指令碼屬性）：
 *   GOOGLE_CLIENT_ID  Google Cloud 的 OAuth 用戶端 ID（網站登入用）
 *   SITE_URL          網站網址，例如 https://mohekang7-ux.github.io/urban-resource-map/
 *
 * 網址：
 *   GET  …/exec?action=export   匯出可公開的資料（JSON），網站與 pipeline/portal.py 讀取
 *   POST …/exec                 寫入動作，body 為 JSON：{ action, token, ... }
 *   GET  …/exec                 導向網站
 */

// 新增欄位一律加在陣列最後，setup() 會補上舊試算表缺少的欄位
const SHEETS = {
  nodes: ['node_id', 'name', 'node_type', 'needs', 'address', 'lon', 'lat', 'description',
          'contact_public', 'contact_text', 'email', 'consent', 'status', 'created_at', 'updated_at',
          'updated_by', 'last_confirmed_at', 'classes'],
  offers: ['offer_id', 'node_id', 'item_id', 'access', 'conditions', 'status', 'created_at', 'updated_at',
           'created_by', 'updated_by', 'last_confirmed_at'],
  wants: ['want_id', 'node_id', 'item_id', 'status', 'note', 'created_at', 'updated_at',
          'created_by', 'updated_by', 'last_confirmed_at'],
  comments: ['comment_id', 'node_id', 'target_type', 'target_id', 'kind', 'text', 'author_email', 'author_name',
             'created_at', 'status'],
  users: ['email', 'display_name', 'created_at', 'updated_at'],
  log: ['timestamp', 'email', 'action', 'table', 'record_id', 'before', 'after'],
};

const NODE_TYPES = {
  shop: '店家', workshop: '工作室或工坊', community: '社區組織或社區據點',
  school: '學校或校內單位', public: '公部門或公共設施', individual: '個人', other: '其他',
};
const OFFER_STATUS = ['active', 'paused'];
const WANT_STATUS = ['missing', 'partial', 'unknown', 'fulfilled'];
const COMMENT_KINDS = ['comment', 'response', 'still', 'gone'];  // response：回應需求「我可以提供」
const TAIPEI_BBOX = { lonMin: 121.4, lonMax: 121.7, latMin: 24.9, latMax: 25.3 };
const MAX_TEXT = 500;
const WRITES_PER_HOUR = 60;  // 每個帳號每小時的寫入上限，防止灌水

// ---------- 初次設定與升級 ----------

/** 在 Apps Script 編輯器手動執行：建立工作表，並替舊工作表補上新欄位（不動既有資料）。 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(SHEETS).forEach(([name, header]) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].filter(String);
    const missing = header.filter((h) => !existing.includes(h));
    if (missing.length) sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
    sheet.getRange(1, 1, 1, existing.length + missing.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
  ['工作表1', 'Sheet1'].forEach((n) => { const s = ss.getSheetByName(n); if (s && ss.getSheets().length > 1) ss.deleteSheet(s); });
}

// ---------- 進入點 ----------

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'export') return json(exportPublic());
  const site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  return HtmlService.createHtmlOutput(
    `<p>據點資料請在網站地圖上新增與編輯：<a href="${site}" target="_top">${site}</a></p>`);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const user = verifyToken(body.token);
    const handler = ACTIONS[body.action];
    if (!handler) throw new Error('不支援的動作。');
    if (body.action !== 'me') rateLimit(user.email);
    return json({ ok: true, data: handler(user, body) });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 身分驗證（Google ID token） ----------

function verifyToken(token) {
  if (!token) throw new Error('請先用 Google 帳號登入。');
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('登入已過期，請重新登入。');
  const info = JSON.parse(resp.getContentText());
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId || info.aud !== clientId) throw new Error('登入憑證不屬於這個網站。');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw new Error('登入憑證無效。');
  if (String(info.email_verified) !== 'true') throw new Error('這個 Google 帳號的 Email 尚未驗證。');
  const user = { email: String(info.email).toLowerCase(), google_name: info.given_name || info.name || '' };
  const ttl = Math.max(60, Math.min(3000, Number(info.exp) - Math.floor(Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function rateLimit(email) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + email;
  const count = Number(cache.get(key) || 0) + 1;
  if (count > WRITES_PER_HOUR) throw new Error('這一小時的編輯次數已達上限，請稍後再試。');
  cache.put(key, String(count), 3600);
}

function displayName(email) {
  const u = readRows('users').find((r) => r.email === email);
  if (!u || !u.display_name) throw new Error('請先設定你的公開暱稱。');
  return u.display_name;
}

// ---------- 寫入動作 ----------

const ACTIONS = {
  /** 登入後取得自己的暱稱（沒有設定時回傳 Google 名字作為建議）。 */
  me(user) {
    const u = readRows('users').find((r) => r.email === user.email);
    return { display_name: u ? u.display_name : '', suggested_name: user.google_name };
  },

  setName(user, body) {
    const name = requireText(body.display_name, '公開暱稱', 30);
    return withLock(() => {
      const now = new Date().toISOString();
      const existing = readRows('users').find((r) => r.email === user.email);
      if (existing) updateRow('users', 'email', user.email, { display_name: name, updated_at: now });
      else appendRow('users', { email: user.email, display_name: name, created_at: now, updated_at: now });
      return { display_name: name };
    });
  },

  /** 新增或修改據點。任何登入者都能修改；只有在 position_changed 時才更新位置（避免個人據點的精確位置被模糊座標覆蓋）。 */
  saveNode(user, body) {
    const p = body.node || {};
    const name = displayName(user.email);
    return withLock(() => {
      const now = new Date().toISOString();
      const vocab = getVocab();
      const record = {
        name: requireText(p.name, '據點名稱', 60),
        node_type: requireEnum(p.node_type, Object.keys(NODE_TYPES), '據點類型'),
        // 2026-10-28 起：別人能從這裡獲得哪些類別的資源（資源類別，可不選）；舊的 needs 欄位保留不再寫入
        classes: optionalList(p.classes, vocab.resource_classes.map((c) => c.class_id), '資源類別').join(';'),
        address: cleanText(p.address, 120),
        description: cleanText(p.description, MAX_TEXT),
        contact_public: p.contact_public === true,
        contact_text: cleanText(p.contact_text, 200),
        updated_at: now, updated_by: name, last_confirmed_at: now,
      };
      if (record.contact_public && !record.contact_text) throw new Error('選擇公開聯絡方式時，請填寫要公開的聯絡方式。');
      if (!p.node_id || p.position_changed) {
        record.lon = requireNumber(p.lon, TAIPEI_BBOX.lonMin, TAIPEI_BBOX.lonMax, '位置（經度）');
        record.lat = requireNumber(p.lat, TAIPEI_BBOX.latMin, TAIPEI_BBOX.latMax, '位置（緯度）');
      }

      if (p.node_id) {
        const before = activeNode(p.node_id);
        updateRow('nodes', 'node_id', p.node_id, record);
        writeLog(user.email, 'update', 'nodes', p.node_id, before, record);
        notifyCreator(before, user, `${name} 修改了據點「${record.name}」的資料。`);
        return { node_id: p.node_id };
      }
      if (p.consent !== true) throw new Error('請先勾選同意公開說明。');
      const nodeId = 'portal-' + Utilities.getUuid().slice(0, 8);
      appendRow('nodes', { ...record, node_id: nodeId, email: user.email, consent: true, status: 'active', created_at: now });
      writeLog(user.email, 'create', 'nodes', nodeId, null, record);
      return { node_id: nodeId };
    });
  },

  saveOffer(user, body) {
    const o = body.offer || {};
    const name = displayName(user.email);
    return withLock(() => {
      const node = activeNode(body.node_id);
      const vocab = getVocab();
      const now = new Date().toISOString();
      const record = {
        node_id: body.node_id,
        item_id: requireEnum(o.item_id, vocab.resource_items.map((i) => i.item_id), '資源項目'),
        access: requireList(o.access, vocab.access_modes.map((a) => a.access_id), '取得方式').join(';'),
        conditions: cleanText(o.conditions, MAX_TEXT),
        status: requireEnum(o.status || 'active', OFFER_STATUS, '狀態'),
        updated_at: now, updated_by: name, last_confirmed_at: now,
      };
      const id = upsertChild('offers', 'offer_id', o.offer_id, record, user, name);
      notifyCreator(node, user, `${name} ${o.offer_id ? '修改' : '新增'}了「${node.name}」提供的資源：${itemName(record.item_id)}。`);
      return { offer_id: id };
    });
  },

  saveWant(user, body) {
    const w = body.want || {};
    const name = displayName(user.email);
    return withLock(() => {
      const node = activeNode(body.node_id);
      const vocab = getVocab();
      const now = new Date().toISOString();
      const record = {
        node_id: body.node_id,
        item_id: requireEnum(w.item_id, vocab.resource_items.map((i) => i.item_id), '資源項目'),
        status: requireEnum(w.status || 'missing', WANT_STATUS, '狀態'),
        note: cleanText(w.note, MAX_TEXT),
        updated_at: now, updated_by: name, last_confirmed_at: now,
      };
      const id = upsertChild('wants', 'want_id', w.want_id, record, user, name);
      notifyCreator(node, user, `${name} ${w.want_id ? '修改' : '新增'}了「${node.name}」需要的資源：${itemName(record.item_id)}。`);
      return { want_id: id };
    });
  },

  /** 刪除供給或需求（軟刪除，保留紀錄）。 */
  deleteItem(user, body) {
    const name = displayName(user.email);
    return withLock(() => {
      const key = { offers: 'offer_id', wants: 'want_id' }[body.table];
      if (!key) throw new Error('不支援的資料表。');
      const before = readRows(body.table).find((r) => r[key] === body.id);
      if (!before) throw new Error('找不到這筆資料。');
      const node = activeNode(before.node_id);
      updateRow(body.table, key, body.id, { status: 'deleted', updated_at: new Date().toISOString(), updated_by: name });
      writeLog(user.email, 'delete', body.table, body.id, before, null);
      notifyCreator(node, user, `${name} 刪除了「${node.name}」的一筆資料：${itemName(before.item_id)}。`);
      return true;
    });
  },

  /** 刪除自己的留言（軟刪除，status 改為 deleted，不再匯出）。只有留言者本人可以刪除。 */
  deleteComment(user, body) {
    return withLock(() => {
      const before = readRows('comments').find((c) => c.comment_id === body.comment_id && c.status === 'visible');
      if (!before) throw new Error('找不到這則留言。');
      if (before.author_email !== user.email) throw new Error('只能刪除自己的留言。');
      updateRow('comments', 'comment_id', body.comment_id, { status: 'deleted' });
      writeLog(user.email, 'deleteComment', 'comments', body.comment_id, before, null);
      return true;
    });
  },

  /** 評論、回應需求、回報「還在」或「已經沒有了」。 */
  comment(user, body) {
    const name = displayName(user.email);
    return withLock(() => {
      const kind = requireEnum(body.kind || 'comment', COMMENT_KINDS, '評論類型');
      const targetType = requireEnum(body.target_type || 'node', ['node', 'offer', 'want'], '評論對象');
      const node = activeNode(body.node_id);
      const target = targetType === 'node' ? node : findChild(targetType, body.target_id, body.node_id);
      const text = cleanText(body.text, MAX_TEXT);
      if (['comment', 'response'].includes(kind) && !text) throw new Error('請輸入內容。');
      const now = new Date().toISOString();
      const commentId = 'c-' + Utilities.getUuid().slice(0, 10);
      appendRow('comments', {
        comment_id: commentId, node_id: body.node_id, target_type: targetType,
        target_id: targetType === 'node' ? body.node_id : body.target_id, kind, text,
        author_email: user.email, author_name: name, created_at: now, status: 'visible',
      });
      if (kind === 'still') {
        // 有人確認還在：更新最後確認時間
        const table = { node: 'nodes', offer: 'offers', want: 'wants' }[targetType];
        const key = { node: 'node_id', offer: 'offer_id', want: 'want_id' }[targetType];
        updateRow(table, key, targetType === 'node' ? body.node_id : body.target_id, { last_confirmed_at: now });
      }
      const what = targetType === 'node' ? `據點「${node.name}」` : `「${node.name}」的${itemName(target.item_id)}`;
      const message = {
        comment: `${name} 在${what}留言：${text}`,
        response: `${name} 回應了${what}的需求：${text}`,
        still: `${name} 確認${what}還在。`,
        gone: `${name} 回報${what}已經沒有了${text ? '：' + text : '。'}請確認是否需要更新。`,
      }[kind];
      if (kind !== 'still') notifyCreator(node, user, message);
      writeLog(user.email, 'comment:' + kind, targetType, commentId, null, { text });
      return { comment_id: commentId };
    });
  },
};

// ---------- 匯出（公開） ----------

/** 只匯出可公開的欄位：不含任何 Email；聯絡方式只在據點選擇公開時輸出；個人據點不含地址、位置降低精度。 */
function exportPublic() {
  const nodes = readRows('nodes').filter((n) => n.status === 'active' && n.consent === true);
  const ids = new Set(nodes.map((n) => n.node_id));
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v || ''));
  return {
    generated_at: new Date().toISOString(),
    vocab_node_types: NODE_TYPES,
    nodes: nodes.map((n) => {
      const individual = n.node_type === 'individual';
      const round = (v) => (individual ? Math.round(Number(v) * 100) / 100 : Number(v));
      return {
        node_id: n.node_id, name: n.name, node_type: n.node_type, classes: String(n.classes || '').split(';').filter(String),
        address: individual ? '' : n.address, lon: round(n.lon), lat: round(n.lat), description: n.description,
        contact: n.contact_public === true ? n.contact_text : '', created_at: iso(n.created_at), updated_at: iso(n.updated_at),
        updated_by: n.updated_by || '', last_confirmed_at: iso(n.last_confirmed_at || n.updated_at),
      };
    }),
    offers: readRows('offers').filter((o) => ids.has(o.node_id) && o.status === 'active').map((o) => ({
      offer_id: o.offer_id, node_id: o.node_id, item_id: o.item_id, access: o.access, conditions: o.conditions,
      updated_at: iso(o.updated_at), updated_by: o.updated_by || '', last_confirmed_at: iso(o.last_confirmed_at || o.updated_at),
    })),
    wants: readRows('wants').filter((w) => ids.has(w.node_id) && !['deleted', 'fulfilled'].includes(w.status)).map((w) => ({
      want_id: w.want_id, node_id: w.node_id, item_id: w.item_id, status: w.status, note: w.note,
      updated_at: iso(w.updated_at), updated_by: w.updated_by || '', last_confirmed_at: iso(w.last_confirmed_at || w.updated_at),
    })),
    comments: readRows('comments').filter((c) => ids.has(c.node_id) && c.status === 'visible').map((c) => ({
      comment_id: c.comment_id, node_id: c.node_id, target_type: c.target_type, target_id: c.target_id,
      kind: c.kind, text: c.text, author_name: c.author_name, created_at: iso(c.created_at),
    })),
  };
}

// ---------- 通知 ----------

/** 有人修改或留言時，通知據點建立者（自己改自己的不通知）。每日寄信量有上限，失敗時不影響寫入。 */
function notifyCreator(node, user, message) {
  if (!node.email || node.email === user.email) return;
  const site = PropertiesService.getScriptProperties().getProperty('SITE_URL') || '';
  try {
    MailApp.sendEmail({
      to: node.email,
      subject: `【台北製造能力地圖】你的據點「${node.name}」有新動態`,
      body: `${message}\n\n到地圖上查看：${site}\n\n你收到這封信，是因為你在台北製造能力地圖建立了這個據點。`,
    });
  } catch (err) {
    console.warn('通知寄送失敗：' + err);
  }
}

// ---------- 試算表讀寫 ----------

function getVocab() {
  return { ...VOCAB, node_types: NODE_TYPES };
}

function itemName(id) {
  const item = VOCAB.resource_items.find((i) => i.item_id === id);
  return item ? item.name_zh : id;
}

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

/** 依工作表實際的標題列順序寫入（舊試算表補欄位後順序可能不同）。 */
function appendRow(name, record) {
  const s = sheet(name);
  const header = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  s.appendRow(header.map((h) => safeCell(record[h])));
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

function activeNode(nodeId) {
  const node = readRows('nodes').find((n) => n.node_id === nodeId && n.status === 'active');
  if (!node) throw new Error('找不到這個據點。');
  return node;
}

function findChild(targetType, id, nodeId) {
  const [table, key] = targetType === 'offer' ? ['offers', 'offer_id'] : ['wants', 'want_id'];
  const row = readRows(table).find((r) => r[key] === id && r.node_id === nodeId && r.status !== 'deleted');
  if (!row) throw new Error('找不到這筆資料。');
  return row;
}

function upsertChild(table, key, id, record, user, name) {
  if (id) {
    const before = readRows(table).find((r) => r[key] === id && r.node_id === record.node_id);
    if (!before) throw new Error('找不到這筆資料。');
    updateRow(table, key, id, record);
    writeLog(user.email, 'update', table, id, before, record);
    return id;
  }
  const newId = `${record.node_id}:${table === 'offers' ? 'offer' : 'need'}:${Utilities.getUuid().slice(0, 6)}`;
  appendRow(table, { ...record, [key]: newId, created_at: record.updated_at, created_by: name });
  writeLog(user.email, 'create', table, newId, null, record);
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

function optionalList(v, allowed, label) {
  const list = (Array.isArray(v) ? v : [v]).filter(Boolean);
  list.forEach((x) => requireEnum(x, allowed, label));
  return list;
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
