// 「我附近有哪些夥伴？」模式：公開協作的資源網絡（2026-10-28 第 2 版）。
// - 資料即時讀取 Apps Script 的公開匯出（APP_CONFIG.apiUrl?action=export）；讀不到時改用 data/nodes_verified.geojson。
// - 以 Google 帳號登入後，任何人都能在地圖上新增據點、編輯、評論、回報「還在／已經沒有了」、回應需求。
// - 每個供給與需求都屬於一個空間據點；超過 APP_CONFIG.staleDays 天沒人確認，標示「可能已過時」。
// 本機測試：網址加上 ?mock=1，改用存在瀏覽器裡的模擬後端（不會寫入試算表）。
// 依賴 app.js 的全域變數 map、fmt。

const CFG = window.APP_CONFIG || { apiUrl: "", googleClientId: "", staleDays: 90 };
const MOCK = new URLSearchParams(location.search).has("mock");
// 資源類別的顏色（地圖點、清單、篩選）
const CLASS_COLORS = {
  material: "#A16207", tool: "#185FA5", space: "#534AB7",
  skill: "#993556", knowledge: "#0F766E", transport: "#475569",
};
const NODE_TYPES = { shop: "店家", workshop: "工作室或工坊", community: "社區組織或社區據點", school: "學校或校內單位", public: "公部門或公共設施", individual: "個人", other: "其他" };
const WANT_STATUS = { missing: "缺", partial: "部分有", unknown: "待查", fulfilled: "已滿足" };
const OFFER_STATUS = { active: "提供中", paused: "暫停提供" };
const KIND_LABEL = { comment: "留言", response: "回應需求", still: "確認還在", gone: "回報已經沒有了" };

let nodes = null, vocab = null, networkLoading = null, selectedNodeId = null, placing = null, placeMarker = null;
const rf = { classes: new Set(), query: "", direction: "all" };
const auth = { token: null, exp: 0, name: "", admin: false };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const itemName = (id) => vocab.itemById[id]?.name_zh || id;
const daysAgo = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const isStale = (iso) => { const d = daysAgo(iso); return d === null || d > CFG.staleDays; };
const loggedIn = () => !!auth.token && Date.now() < auth.exp && !!auth.name;
const canEdit = () => MOCK || !!CFG.googleClientId;

// ---------- 資料：讀取與轉換 ----------

async function fetchExport() {
  if (MOCK) return mockApi.export();
  if (CFG.apiUrl) {
    try {
      const r = await fetch(`${CFG.apiUrl}?action=export`, { cache: "no-store" });
      if (r.ok) return { live: true, ...(await r.json()) };
    } catch (e) { console.warn("即時資料讀取失敗，改用網站內的資料", e); }
  }
  const gj = await fetch("data/nodes_verified.geojson").then((r) => r.json());
  return { live: false, ...geojsonToExport(gj) };
}

function geojsonToExport(gj) {
  const out = { nodes: [], offers: [], wants: [], comments: [] };
  gj.features.forEach((f) => {
    const p = f.properties;
    out.nodes.push({ node_id: p.id, name: p.name, node_type: p.node_type, classes: p.classes || [], address: p.address, description: p.description,
      contact: p.contact, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], last_confirmed_at: p.verified_at, updated_by: "" });
    p.resources.forEach((r, i) => out.offers.push({ offer_id: `${p.id}:o${i}`, node_id: p.id, item_id: r.item, access: r.access, conditions: r.note, last_confirmed_at: r.verified_at }));
    p.wants.forEach((w, i) => out.wants.push({ want_id: `${p.id}:w${i}`, node_id: p.id, item_id: w.item, status: w.status, note: w.note, last_confirmed_at: p.verified_at }));
  });
  return out;
}

// 別人能從這個據點獲得的資源類別：據點自己勾選的；沒勾選時用它登記的「提供」所屬的類別
function nodeClasses(n, offers) {
  const own = Array.isArray(n.classes) ? n.classes : String(n.classes || "").split(";");
  const list = own.filter(Boolean);
  const found = list.length ? list : offers.map((o) => vocab.itemById[o.item_id]?.class_id);
  return vocab.resource_classes.map((c) => c.class_id).filter((c) => found.includes(c));
}

function buildFeatures(data) {
  const by = (list, key) => list.reduce((m, x) => ((m[x[key]] ||= []).push(x), m), {});
  const offers = by(data.offers, "node_id"), wants = by(data.wants, "node_id"), comments = by(data.comments || [], "node_id");
  return data.nodes.map((n, i) => ({
    type: "Feature", id: i, geometry: { type: "Point", coordinates: [Number(n.lon), Number(n.lat)] },
    properties: {
      ...n, classes: nodeClasses(n, offers[n.node_id] || []), primary_class: nodeClasses(n, offers[n.node_id] || [])[0] || "",
      offers: offers[n.node_id] || [], wants: wants[n.node_id] || [],
      comments: (comments[n.node_id] || []).sort((a, b) => String(b.created_at).localeCompare(a.created_at)),
      stale: isStale(n.last_confirmed_at) ? 1 : 0,
    },
  }));
}

function loadNetwork(force = false) {
  if (!networkLoading || force) {
    networkLoading = Promise.all([
      vocab ? Promise.resolve(vocab) : fetch("data/vocab.json").then((r) => r.json()),
      fetchExport(),
    ]).then(([v, data]) => {
      if (!v.itemById) {
        v.itemById = Object.fromEntries(v.resource_items.map((i) => [i.item_id, i]));
        v.needById = Object.fromEntries(v.needs.map((n) => [n.need_id, n]));
        v.accessById = Object.fromEntries(v.access_modes.map((a) => [a.access_id, a]));
        v.classById = Object.fromEntries(v.resource_classes.map((c) => [c.class_id, c]));
      }
      vocab = v;
      nodes = { type: "FeatureCollection", features: buildFeatures(data), live: data.live };
      if (map.getSource("nodes")) map.getSource("nodes").setData(nodes);
      return nodes;
    });
  }
  return networkLoading;
}

async function refresh(keepNodeId) {
  await loadNetwork(true);
  applyResourceFilter();
  const f = keepNodeId && nodes.features.find((x) => x.properties.node_id === keepNodeId);
  if (f) showNode(f);
}

// ---------- 寫入（Apps Script API 或模擬後端） ----------

async function api(action, payload = {}) {
  if (MOCK) return mockApi.post(action, payload);
  if (!loggedIn() && action !== "me" && action !== "setName") throw new Error("請先登入。");
  // text/plain 可避免瀏覽器的跨網域預檢，Apps Script 照樣能讀取內容
  const r = await fetch(CFG.apiUrl, { method: "POST", body: JSON.stringify({ action, token: auth.token, ...payload }) });
  const res = await r.json();
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ---------- Google 登入 ----------

function initGoogleSignIn(container) {
  if (MOCK) {
    container.innerHTML = `<button class="primary-btn" data-mock-login>模擬登入（本機測試）</button>`;
    container.querySelector("[data-mock-login]").addEventListener("click", () => onCredential({ credential: "mock" }));
    return;
  }
  if (!CFG.googleClientId) {
    container.innerHTML = `<p class="note">登入功能尚未設定，目前只能瀏覽。</p>`;
    return;
  }
  const render = () => {
    google.accounts.id.initialize({ client_id: CFG.googleClientId, callback: onCredential });
    google.accounts.id.renderButton(container, { theme: "outline", size: "medium", text: "signin_with", locale: "zh-TW" });
  };
  if (window.google?.accounts?.id) return render();
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.onload = render;
  document.head.appendChild(s);
}

async function onCredential(resp) {
  auth.token = resp.credential;
  auth.exp = MOCK ? Date.now() + 3600e3 : JSON.parse(atob(resp.credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000 - 60e3;
  try {
    const me = await api("me");
    auth.name = me.display_name;
    auth.admin = me.is_admin === true;
    if (!auth.name) return askDisplayName(me.suggested_name);
    renderAuthBar();
    if (selectedNodeId) showNode(nodes.features.find((f) => f.properties.node_id === selectedNodeId));
  } catch (e) { alert(e.message); }
}

function askDisplayName(suggested) {
  document.getElementById("auth-bar").innerHTML = `
    <div class="editor">
      <label class="field-label" for="display-name">你的公開暱稱（會顯示在你的編輯與留言旁）</label>
      <input type="text" id="display-name" maxlength="30" value="${esc(suggested || "")}">
      <p class="note">Email 不會公開。暱稱之後可以修改。</p>
      <div class="msg-box"></div>
      <button class="primary-btn" data-save-name>確定</button>
    </div>`;
  document.querySelector("[data-save-name]").addEventListener("click", async (e) => {
    const name = document.getElementById("display-name").value.trim();
    if (!name) return showMsg(e.target.closest(".editor"), "請填寫暱稱。");
    await busy(e.target, async () => {
      auth.name = (await api("setName", { display_name: name })).display_name;
      renderAuthBar();
    }, e.target.closest(".editor"));
  });
}

function renderAuthBar() {
  const bar = document.getElementById("auth-bar");
  if (!bar) return;
  if (loggedIn()) {
    bar.innerHTML = `<div class="auth-row"><button class="primary-btn" data-new-node>＋ 新增據點</button><span class="sub">${esc(auth.name)}${auth.admin ? "（管理者）" : ""}</span></div>`;
    bar.querySelector("[data-new-node]").addEventListener("click", startPlacing);
  } else {
    bar.innerHTML = `<div class="auth-row"><span class="sub">登入後可以新增、回應與留言</span><div id="gsi-button"></div></div>`;
    initGoogleSignIn(document.getElementById("gsi-button"));
  }
}

// ---------- 小工具 ----------

function showMsg(box, text, kind = "error") {
  let m = box.querySelector(".msg-box");
  if (!m) { m = document.createElement("div"); m.className = "msg-box"; box.appendChild(m); }
  m.innerHTML = text ? `<div class="msg ${kind}">${esc(text)}</div>` : "";
}

async function busy(button, fn, box) {
  button.disabled = true;
  try { await fn(); } catch (e) { if (box) showMsg(box, e.message); else alert(e.message); } finally { button.disabled = false; }
}

function classBadges(classes) {
  return classes.map((c) => `<span class="need-badge" style="--c:${CLASS_COLORS[c] || "#888"}">${esc(vocab.classById[c]?.name_zh || c)}</span>`).join("");
}

function itemSelect(selected) {
  return `<select data-f="item_id"><option value="">請選擇</option>${vocab.resource_classes.map((c) =>
    `<optgroup label="${esc(c.name_zh)}">${vocab.resource_items.filter((i) => i.class_id === c.class_id).map((i) =>
      `<option value="${i.item_id}" ${i.item_id === selected ? "selected" : ""}>${esc(i.name_zh)}</option>`).join("")}</optgroup>`).join("")}</select>`;
}

// ---------- 地圖圖層 ----------

function ensureNodeLayers() {
  if (map.getSource("nodes")) return;
  map.addSource("nodes", { type: "geojson", data: nodes });
  const color = ["match", ["get", "primary_class"]];
  Object.entries(CLASS_COLORS).forEach(([k, c]) => color.push(k, c));
  color.push("#888780");
  map.addLayer({
    id: "nodes-circle", type: "circle", source: "nodes", layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 15, 10],
      "circle-color": color, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
      "circle-opacity": ["case", ["boolean", ["feature-state", "dim"], false], 0.15, ["==", ["get", "stale"], 1], 0.45, 1],
    },
  });
  map.addLayer({
    id: "nodes-label", type: "symbol", source: "nodes",
    layout: { visibility: "none", "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": "#2C2C2A", "text-halo-color": "#fff", "text-halo-width": 1.5 },
  });
  map.on("mouseenter", "nodes-circle", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "nodes-circle", () => (map.getCanvas().style.cursor = placing ? "crosshair" : ""));
  map.on("click", "nodes-circle", (e) => { if (!placing) showNode(nodes.features[e.features[0].id]); });
  map.on("click", (e) => { if (placing) placeAt([e.lngLat.lng, e.lngLat.lat]); });
}

// ---------- 篩選與清單 ----------

function itemsOf(p) {
  const offers = rf.direction === "need" ? [] : p.offers.map((o) => o.item_id);
  const wants = rf.direction === "offer" ? [] : p.wants.map((w) => w.item_id);
  return [...offers, ...wants];
}

function matches(p) {
  if (rf.classes.size && !p.classes.some((c) => rf.classes.has(c))) return false;
  const items = itemsOf(p);
  if (rf.direction !== "all" && !items.length) return false;
  if (rf.query && !String(p.name).includes(rf.query) && !items.some((i) => itemName(i).includes(rf.query))) return false;
  return true;
}

function applyResourceFilter() {
  const results = document.getElementById("resource-results");
  if (!results) return;
  const hits = nodes.features.filter((f) => matches(f.properties));
  nodes.features.forEach((f) => map.setFeatureState({ source: "nodes", id: f.id }, { dim: !hits.includes(f) }));
  if (!nodes.features.length) {
    results.innerHTML = `<div class="placeholder"><b>還沒有任何據點。</b><br>登入後按「新增據點」，就能成為第一個。</div>`;
    return;
  }
  hits.sort((a, b) => String(a.properties.name).localeCompare(b.properties.name, "zh-Hant"));
  results.innerHTML = `<p class="count">${fmt(hits.length)} 個據點${nodes.live === false ? "（離線資料，可能不是最新）" : ""}</p>` +
    (hits.map((f) => {
      const p = f.properties;
      const counts = [p.wants.length && `<span class="cnt-want">需要 ${p.wants.length}</span>`, p.offers.length && `<span class="cnt-offer">提供 ${p.offers.length}</span>`].filter(Boolean).join(" ");
      return `<button class="result ${p.stale ? "is-stale" : ""}" data-id="${f.id}">
        <span class="result-name"><span class="node-dot" style="background:${CLASS_COLORS[p.primary_class] || "#888780"}"></span>${esc(p.name)}</span>
        <span class="result-meta">${counts}</span>
        <span class="result-sub">${esc(NODE_TYPES[p.node_type] || "")}${p.classes.length ? `・可獲得：${p.classes.map((c) => esc(vocab.classById[c]?.name_zh || c)).join("、")}` : ""}${p.stale ? "・可能已過時" : ""}</span>
      </button>`;
    }).join("") || `<div class="placeholder">沒有符合的據點，可以換個關鍵字。</div>`);
  results.querySelectorAll(".result").forEach((btn) => btn.addEventListener("click", () => {
    const f = nodes.features[Number(btn.dataset.id)];
    map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15) });
    showNode(f);
  }));
}

// ---------- 據點卡 ----------

// 清單與據點卡輪流顯示，面板一次只呈現一件事
function showDetail(on) {
  document.getElementById("list-view").hidden = on;
  if (!on) { document.getElementById("node-detail").innerHTML = ""; selectedNodeId = null; }
}

function showNode(f) {
  if (!f) return;
  const p = f.properties;
  selectedNodeId = p.node_id;
  const editable = loggedIn();
  // 次要動作收進「⋯」選單
  const more = (type, id, extra = "") => editable ? `<details class="more"><summary aria-label="更多動作">⋯</summary><div class="more-menu">
      <button data-act="still" data-type="${type}" data-id="${esc(id)}">還在</button>
      <button data-act="gone" data-type="${type}" data-id="${esc(id)}">已經沒有了</button>${extra}</div></details>` : "";
  const staleTag = (iso) => (isStale(iso) ? `<span class="tag warn">可能已過時</span>` : "");
  const accessText = (o) => String(o.access).split(";").map((a) => vocab.accessById[a]?.name_zh || a).join("、");

  const wantsHtml = p.wants.map((w) => `<div class="entry">
      <div class="entry-main"><b>${esc(itemName(w.item_id))}</b>
        ${w.status !== "missing" ? `<span class="tag">${esc(WANT_STATUS[w.status] || w.status)}</span>` : ""}${staleTag(w.last_confirmed_at)}
        ${w.note ? `<div class="sub">${esc(w.note)}</div>` : ""}${responseCount(p, w.want_id)}</div>
      <div class="entry-actions"><button class="small-btn" data-respond="${esc(w.want_id)}">我可以提供</button>
        ${more("want", w.want_id, `<button data-edit-want="${esc(w.want_id)}">編輯</button><button class="danger" data-del="wants" data-id="${esc(w.want_id)}">刪除</button>`)}</div>
    </div>`).join("");

  const offersHtml = p.offers.map((o) => `<div class="entry">
      <div class="entry-main"><b>${esc(itemName(o.item_id))}</b> ${staleTag(o.last_confirmed_at)}
        <div class="sub">${esc(accessText(o))}${o.conditions ? `・${esc(o.conditions)}` : ""}</div>${goneCount(p, "offer", o.offer_id)}</div>
      <div class="entry-actions">
        ${more("offer", o.offer_id, `<button data-edit-offer="${esc(o.offer_id)}">編輯</button><button class="danger" data-del="offers" data-id="${esc(o.offer_id)}">刪除</button>`)}</div>
    </div>`).join("");

  // 「確認還在」只更新時間，不列在留言裡
  const shown = p.comments.filter((c) => c.kind !== "still");
  const commentHtml = (c) => `<div class="comment kind-${esc(c.kind)}">
      <span class="comment-meta">${esc(c.author_name)}${c.kind !== "comment" ? `・${esc(KIND_LABEL[c.kind] || c.kind)}` : ""}・${esc(String(c.created_at).slice(0, 10))}
        ${editable && (auth.admin || c.author_name === auth.name) && c.comment_id ? `<button class="link danger" data-del-comment="${esc(c.comment_id)}">刪除</button>` : ""}</span>
      ${c.text ? `<div>${esc(c.text)}</div>` : ""}</div>`;

  const d = daysAgo(p.last_confirmed_at);
  showDetail(true);
  document.getElementById("node-detail").innerHTML = `
    <div class="node-card">
      <button class="back" data-close>← 回到清單</button>
      <div class="node-name">${esc(p.name)}</div>
      <div class="sub">${esc(NODE_TYPES[p.node_type] || "")}${p.address ? `・${esc(p.address)}` : ""}${p.node_type === "individual" ? "・位置只標到村里中心" : ""}</div>
      ${p.stale ? `<div class="stale-banner">超過 ${Math.round(CFG.staleDays / 30)} 個月沒有人確認，資料可能已過時。
        ${editable ? `<button class="link strong" data-act="still" data-type="node" data-id="${esc(p.node_id)}">我確認還在</button>` : ""}</div>` : ""}
      ${p.classes.length ? `<div class="node-classes"><span class="sub">可以獲得：</span>${classBadges(p.classes)}</div>` : ""}
      ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
      <p class="contact">聯絡：${p.contact ? esc(p.contact) : "在下方留言，或請團隊轉介"}</p>
      <div id="node-editor"></div>

      ${wantsHtml ? `<section class="sec sec-want"><h3><span class="sec-label">需要</span><span class="n">${p.wants.length} 項・這個據點在找的</span></h3>${wantsHtml}</section>` : ""}
      ${offersHtml ? `<section class="sec sec-offer"><h3><span class="sec-label">提供</span><span class="n">${p.offers.length} 項・這個據點可以給的</span></h3>${offersHtml}</section>` : ""}
      ${!wantsHtml && !offersHtml ? `<p class="sub empty">還沒有登記提供或需要的資源。</p>` : ""}
      ${editable ? `<div class="row-actions"><button class="add-btn add-want" data-add-want>＋ 需要</button><button class="add-btn add-offer" data-add-offer>＋ 提供</button></div>` : ""}
      <div id="item-editor"></div>

      <h3>留言 ${shown.length ? `<span class="n">${shown.length}</span>` : ""}</h3>
      ${editable ? `<div class="comment-form"><textarea id="comment-text" maxlength="500" placeholder="分享經驗、補充資訊或提出問題"></textarea>
        <button class="primary-btn" data-comment>送出</button></div>` : ""}
      ${shown.slice(0, 5).map(commentHtml).join("")}
      ${shown.length > 5 ? `<button class="link" data-all-comments>顯示全部 ${shown.length} 則</button><div id="more-comments" hidden>${shown.slice(5).map(commentHtml).join("")}</div>` : ""}
      ${!shown.length && !editable ? `<p class="sub">還沒有留言。</p>` : ""}

      <div class="card-foot">
        <span>最後確認 ${d === null ? "—" : d === 0 ? "今天" : `${d} 天前`}${p.updated_by ? `・${esc(p.updated_by)}` : ""}</span>
        ${editable ? `<span class="foot-actions"><button class="link" data-edit-node>編輯據點</button>${more("node", p.node_id)}</span>` : ""}
      </div>
      ${editable ? "" : `<p class="note">登入後可以回應需求、編輯與留言。</p>`}
    </div>`;
  bindCard(p);
  document.getElementById("panel").scrollTop = 0;
}

function goneCount(p, type, id) {
  const n = p.comments.filter((c) => c.kind === "gone" && c.target_type === type && c.target_id === id).length;
  return n ? `<div><span class="tag warn">${n} 人回報已經沒有了</span></div>` : "";
}

function responseCount(p, wantId) {
  const n = p.comments.filter((c) => c.kind === "response" && c.target_id === wantId).length;
  return n ? `<div><span class="tag ok">${n} 人回應可以提供</span></div>` : "";
}

function requireLogin() {
  if (loggedIn()) return true;
  const bar = document.getElementById("auth-bar");
  bar.scrollIntoView({ block: "nearest" });
  bar.classList.remove("flash"); void bar.offsetWidth; bar.classList.add("flash");
  return false;
}

function bindCard(p) {
  const card = document.querySelector("#node-detail .node-card");
  const on = (sel, fn) => card.querySelectorAll(sel).forEach((b) => b.addEventListener("click", (e) => fn(b, e)));
  on("[data-close]", () => showDetail(false));
  on("[data-all-comments]", (b) => { b.hidden = true; card.querySelector("#more-comments").hidden = false; });
  on("[data-act]", (b) => {
    const kind = b.dataset.act;
    const text = kind === "gone" ? (prompt("可以補充說明嗎？（選填）") ?? null) : "";
    if (text === null) return;
    busy(b, async () => {
      await api("comment", { node_id: p.node_id, target_type: b.dataset.type, target_id: b.dataset.id, kind, text });
      await refresh(p.node_id);
    });
  });
  on("[data-respond]", (b) => {
    if (!requireLogin()) return;
    const text = prompt("你可以怎麼提供？（例如：我有 5 片棧板，週末可以送過去）");
    if (!text) return;
    busy(b, async () => {
      await api("comment", { node_id: p.node_id, target_type: "want", target_id: b.dataset.respond, kind: "response", text });
      await refresh(p.node_id);
    });
  });
  on("[data-comment]", (b) => {
    const text = document.getElementById("comment-text").value.trim();
    if (!text) return;
    busy(b, async () => {
      await api("comment", { node_id: p.node_id, target_type: "node", kind: "comment", text });
      await refresh(p.node_id);
    });
  });
  on("[data-del]", (b) => {
    if (!confirm("確定要刪除這筆資料嗎？（會留下紀錄，可以還原）")) return;
    busy(b, async () => { await api("deleteItem", { table: b.dataset.del, id: b.dataset.id }); await refresh(p.node_id); });
  });
  on("[data-del-comment]", (b) => {
    if (!confirm("確定要刪除這則留言嗎？")) return;
    busy(b, async () => { await api("deleteComment", { comment_id: b.dataset.delComment }); await refresh(p.node_id); });
  });
  on("[data-edit-node]", () => openNodeForm(p));
  on("[data-add-offer]", () => openItemEditor("offer", p));
  on("[data-add-want]", () => openItemEditor("want", p));
  on("[data-edit-offer]", (b) => openItemEditor("offer", p, p.offers.find((o) => o.offer_id === b.dataset.editOffer)));
  on("[data-edit-want]", (b) => openItemEditor("want", p, p.wants.find((w) => w.want_id === b.dataset.editWant)));
}

// ---------- 編輯表單 ----------

function openItemEditor(kind, p, record = {}) {
  const box = document.getElementById("item-editor");
  const offerFields = `
    <label class="field-label">取得方式（可複選）</label>
    <div class="checks">${vocab.access_modes.map((a) => `<label><input type="checkbox" data-access value="${a.access_id}" ${String(record.access || "").split(";").includes(a.access_id) ? "checked" : ""}> ${esc(a.name_zh)}</label>`).join("")}</div>
    <label class="field-label">條件（選填）</label>
    <textarea data-f="conditions" maxlength="500" placeholder="例如：每週六 9–12 點，現場借用">${esc(record.conditions || "")}</textarea>
    <label class="field-label" ${record.offer_id ? "" : "hidden"}>狀態</label>
    <select data-f="status" ${record.offer_id ? "" : "hidden"}>${Object.entries(OFFER_STATUS).map(([k, v]) => `<option value="${k}" ${record.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  const wantFields = `
    <label class="field-label">狀態</label>
    <select data-f="status">${Object.entries(WANT_STATUS).map(([k, v]) => `<option value="${k}" ${(record.status || "missing") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <label class="field-label">說明（選填）</label>
    <textarea data-f="note" maxlength="500" placeholder="例如：需要約 2 公尺長的木料修補箱體">${esc(record.note || "")}</textarea>`;
  box.innerHTML = `<div class="editor"><h3>${record.item_id ? "編輯" : "新增"}${kind === "offer" ? "提供" : "需要"}的資源</h3><label class="field-label">資源項目</label>${itemSelect(record.item_id)}
    ${kind === "offer" ? offerFields : wantFields}
    <div class="row-actions"><button class="primary-btn" data-save>儲存</button><button class="link" data-cancel>取消</button></div></div>`;
  const ed = box.querySelector(".editor");
  ed.scrollIntoView({ block: "nearest" });
  const get = (f) => ed.querySelector(`[data-f="${f}"]`)?.value;
  ed.querySelector("[data-cancel]").addEventListener("click", () => (box.innerHTML = ""));
  ed.querySelector("[data-save]").addEventListener("click", (e) => {
    const data = { item_id: get("item_id"), status: get("status") };
    if (kind === "offer") Object.assign(data, { offer_id: record.offer_id, conditions: get("conditions"), access: [...ed.querySelectorAll("[data-access]:checked")].map((c) => c.value) });
    else Object.assign(data, { want_id: record.want_id, note: get("note") });
    const problem = !data.item_id ? "請選擇資源項目。" : kind === "offer" && !data.access.length ? "請至少選擇一種取得方式。" : "";
    if (problem) return showMsg(ed, problem);
    busy(e.target, async () => {
      await api(kind === "offer" ? "saveOffer" : "saveWant", { node_id: p.node_id, [kind]: data });
      await refresh(p.node_id);
    }, ed);
  });
}

function startPlacing() {
  placing = { node: null };
  map.getCanvas().style.cursor = "crosshair";
  showDetail(true);
  document.getElementById("node-detail").innerHTML = `<div class="placeholder"><b>在地圖上點一下據點的位置。</b><br><button class="link" data-cancel-place>取消</button></div>`;
  document.querySelector("[data-cancel-place]").addEventListener("click", () => { stopPlacing(); showDetail(false); });
}

function stopPlacing() {
  placing = null;
  map.getCanvas().style.cursor = "";
  if (placeMarker) { placeMarker.remove(); placeMarker = null; }
}

function placeAt(lngLat) {
  const editingNode = placing.node;
  if (!placeMarker) placeMarker = new maplibregl.Marker({ color: "#185fa5" }).setLngLat(lngLat).addTo(map);
  else placeMarker.setLngLat(lngLat);
  placing.lngLat = lngLat;
  if (editingNode) {
    document.getElementById("pos-text").textContent = `新位置：${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}`;
    return;
  }
  placing.node = "new";
  openNodeForm(null, lngLat);
}

function openNodeForm(p, lngLat) {
  const isNew = !p;
  const target = isNew ? document.getElementById("node-detail") : document.getElementById("node-editor");
  p = p || { classes: [], node_type: "" };
  const ownClasses = Array.isArray(p.classes) ? p.classes : [];
  target.innerHTML = `<div class="editor">
    <h3>${isNew ? "新增據點" : "編輯據點資料"}</h3>
    <label class="field-label">據點名稱</label><input type="text" data-f="name" maxlength="60" value="${esc(p.name || "")}">
    <label class="field-label">據點類型</label>
    <select data-f="node_type"><option value="">請選擇</option>${Object.entries(NODE_TYPES).map(([k, v]) => `<option value="${k}" ${p.node_type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    <p class="note">選「個人」時不公開地址，位置只標到村里中心。</p>
    <label class="field-label">別人能從你這裡獲得什麼？（可複選）</label>
    <div class="checks">${vocab.resource_classes.map((c) => `<label title="${esc(c.description)}"><input type="checkbox" data-class value="${c.class_id}" ${ownClasses.includes(c.class_id) ? "checked" : ""}> ${esc(c.name_zh)}</label>`).join("")}</div>
    <label class="field-label">位置</label>
    <p class="note" id="pos-text">${isNew ? `已選擇：${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}（可以再點地圖調整）` : `<button class="link" data-move>在地圖上重新選擇位置</button>`}</p>
    <details class="optional" ${isNew ? "" : "open"}><summary>地址、簡介、聯絡方式（選填）</summary>
      <label class="field-label">地址</label><input type="text" data-f="address" maxlength="120" value="${esc(p.address || "")}">
      <label class="field-label">簡介</label><textarea data-f="description" maxlength="500">${esc(p.description || "")}</textarea>
      <label class="field-label">聯絡方式</label>
      <input type="text" data-f="contact_text" maxlength="200" value="${esc(p.contact || "")}" placeholder="電話、網站、粉專">
      <div class="checks"><label><input type="checkbox" data-f-check="contact_public" ${p.contact ? "checked" : ""}> 公開聯絡方式</label></div>
    </details>
    ${isNew ? `<div class="checks"><label><input type="checkbox" data-f-check="consent"> 我同意將這個據點的資料公開在網站上，並由使用者共同編輯</label></div>` : ""}
    <div class="row-actions"><button class="primary-btn" data-save>儲存</button><button class="link" data-cancel>取消</button></div></div>`;
  const ed = target.querySelector(".editor");
  const get = (f) => ed.querySelector(`[data-f="${f}"]`).value;
  const check = (f) => ed.querySelector(`[data-f-check="${f}"]`)?.checked === true;
  ed.querySelector("[data-move]")?.addEventListener("click", () => {
    placing = { node: p.node_id };
    map.getCanvas().style.cursor = "crosshair";
    document.getElementById("pos-text").textContent = "請在地圖上點選新位置";
  });
  ed.querySelector("[data-cancel]").addEventListener("click", () => {
    stopPlacing();
    if (isNew) showDetail(false); else target.innerHTML = "";
  });
  ed.querySelector("[data-save]").addEventListener("click", (e) => {
    const lngLatNew = placing?.lngLat;
    const node = {
      node_id: isNew ? null : p.node_id, name: get("name"), node_type: get("node_type"),
      classes: [...ed.querySelectorAll("[data-class]:checked")].map((c) => c.value),
      address: get("address"), description: get("description"),
      contact_public: check("contact_public"), contact_text: get("contact_text"), consent: isNew ? check("consent") : true,
      position_changed: !!lngLatNew, lon: lngLatNew?.[0], lat: lngLatNew?.[1],
    };
    const problem = !node.name.trim() ? "請填寫據點名稱。" : !node.node_type ? "請選擇據點類型。"
      : isNew && !node.consent ? "請勾選同意公開。"
      : node.contact_public && !node.contact_text.trim() ? "選擇公開聯絡方式時，請填寫聯絡方式。" : "";
    if (problem) return showMsg(ed, problem);
    busy(e.target, async () => {
      const res = await api("saveNode", { node });
      stopPlacing();
      await refresh(res.node_id);
    }, ed);
  });
}

// ---------- 面板 ----------

function renderResourcePanel() {
  document.getElementById("panel").innerHTML = `
    <h2>我附近有哪些夥伴？</h2>
    <p class="sub">看看附近誰有你需要的東西，誰又需要你手上的資源。</p>
    <div id="auth-bar"></div>
    <div id="list-view">
      <input id="resource-query" type="search" placeholder="找什麼？例如：電鑽、棧板、木工" value="${esc(rf.query)}" aria-label="搜尋據點或資源">
      <div class="filter-row">
        <div class="segmented" role="group" aria-label="供給或需求">
          ${[["all", "全部"], ["offer", "有提供"], ["need", "有需要"]].map(([k, l]) => `<button data-direction="${k}" class="dir-${k} ${rf.direction === k ? "on" : ""}">${l}</button>`).join("")}
        </div>
        <details class="more-filters" ${rf.classes.size ? "open" : ""}><summary>依資源類別篩選${rf.classes.size ? `（${rf.classes.size}）` : ""}</summary>
          <div class="need-filters">${vocab.resource_classes.map((c) => `
            <button class="need-toggle ${rf.classes.has(c.class_id) ? "on" : ""}" data-filter-class="${c.class_id}" style="--c:${CLASS_COLORS[c.class_id]}" title="${esc(c.description)}">${esc(c.name_zh)}</button>`).join("")}
          </div>
        </details>
      </div>
      <div id="resource-results"></div>
    </div>
    <div id="node-detail"></div>`;
  renderAuthBar();
  document.querySelectorAll("[data-direction]").forEach((btn) => btn.addEventListener("click", () => {
    rf.direction = btn.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach((b) => b.classList.toggle("on", b === btn));
    applyResourceFilter();
  }));
  document.querySelectorAll(".need-toggle").forEach((btn) => btn.addEventListener("click", () => {
    const c = btn.dataset.filterClass;
    rf.classes.has(c) ? rf.classes.delete(c) : rf.classes.add(c);
    btn.classList.toggle("on");
    document.querySelector(".more-filters summary").textContent = `依資源類別篩選${rf.classes.size ? `（${rf.classes.size}）` : ""}`;
    applyResourceFilter();
  }));
  let timer;
  document.getElementById("resource-query").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { rf.query = e.target.value.trim(); applyResourceFilter(); }, 250);
  });
}

async function enterResourceMode() {
  document.getElementById("panel").innerHTML = `<h2>我附近有哪些夥伴？</h2><p class="sub">載入中…</p>`;
  await loadNetwork();
  ensureNodeLayers();
  ["nodes-circle", "nodes-label"].forEach((id) => map.setLayoutProperty(id, "visibility", "visible"));
  map.setPaintProperty("villages-fill", "fill-opacity", 0.18); // 村里著色淡化
  document.getElementById("controls").hidden = true;
  renderResourcePanel();
  applyResourceFilter();
}

function exitResourceMode() {
  stopPlacing();
  if (!map.getLayer("nodes-circle")) return;
  ["nodes-circle", "nodes-label"].forEach((id) => map.setLayoutProperty(id, "visibility", "none"));
  const zoningOn = document.getElementById("toggle-zoning").checked;
  map.setPaintProperty("villages-fill", "fill-opacity", zoningOn ? 0 : 0.78);
  document.getElementById("controls").hidden = false;
}

// ---------- 本機測試用的模擬後端（?mock=1，資料只存在這個瀏覽器） ----------

const mockApi = (() => {
  const KEY = "network-mock";
  const load = () => JSON.parse(localStorage.getItem(KEY) || "null");
  const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
  const now = () => new Date().toISOString();
  const uid = () => Math.random().toString(16).slice(2, 10);
  async function db() {
    let d = load();
    if (!d) {
      const gj = await fetch("data/nodes_verified.geojson").then((r) => r.json());
      d = { ...geojsonToExport(gj), name: "" };
      save(d);
    }
    return d;
  }
  return {
    async export() { const d = await db(); return { live: true, nodes: d.nodes, offers: d.offers, wants: d.wants, comments: d.comments }; },
    async post(action, p) {
      await new Promise((r) => setTimeout(r, 120));
      const d = await db();
      const t = now();
      if (action === "me") return { display_name: d.name, suggested_name: "測試使用者", is_admin: new URLSearchParams(location.search).has("admin") };
      if (!d.name && action !== "setName") throw new Error("請先設定你的公開暱稱。");
      if (action === "setName") { d.name = p.display_name; save(d); return { display_name: d.name }; }
      if (action === "saveNode") {
        const n = p.node;
        if (n.node_id) {
          const x = d.nodes.find((y) => y.node_id === n.node_id);
          Object.assign(x, { ...n, contact: n.contact_public ? n.contact_text : "", updated_by: d.name, last_confirmed_at: t });
          if (!n.position_changed) { delete x.position_changed; }
          save(d); return { node_id: n.node_id };
        }
        const id = "portal-" + uid();
        d.nodes.push({ ...n, node_id: id, contact: n.contact_public ? n.contact_text : "", updated_by: d.name, last_confirmed_at: t });
        save(d); return { node_id: id };
      }
      if (action === "saveOffer" || action === "saveWant") {
        const [table, key, rec] = action === "saveOffer" ? ["offers", "offer_id", { ...p.offer, access: p.offer.access.join(";") }] : ["wants", "want_id", p.want];
        Object.assign(rec, { node_id: p.node_id, updated_by: d.name, last_confirmed_at: t });
        if (rec[key]) Object.assign(d[table].find((x) => x[key] === rec[key]), rec);
        else { rec[key] = `${p.node_id}:${uid()}`; d[table].push(rec); }
        save(d); return { [key]: rec[key] };
      }
      if (action === "deleteItem") { d[p.table] = d[p.table].filter((x) => (x.offer_id || x.want_id) !== p.id); save(d); return true; }
      if (action === "deleteComment") { d.comments = d.comments.filter((c) => c.comment_id !== p.comment_id); save(d); return true; }
      if (action === "comment") {
        d.comments.push({ comment_id: "c-" + uid(), node_id: p.node_id, target_type: p.target_type, target_id: p.target_type === "node" ? p.node_id : p.target_id, kind: p.kind, text: p.text, author_name: d.name, created_at: t });
        if (p.kind === "still") {
          const list = p.target_type === "node" ? d.nodes : d[p.target_type + "s"];
          const key = p.target_type + "_id";
          const x = list.find((y) => y[key] === (p.target_type === "node" ? p.node_id : p.target_id));
          if (x) x.last_confirmed_at = t;
        }
        save(d); return true;
      }
      throw new Error("不支援的動作");
    },
  };
})();
