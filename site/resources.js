// 「我附近有哪些夥伴？」模式：只呈現經過現地確認或由據點本身提供的資料（verification ≥ 2）。
// 每個供給（resources）與需求（wants）都掛在一個空間據點上；公開資料不推論資源（2026-10-27 決定）。
// 資料：site/data/nodes_verified.geojson 與 vocab.json，由 pipeline/build_site.py 產生。
// 依賴 app.js 的全域變數 map、fmt。

const NEED_COLORS = {
  buy_materials: "#BA7517", make_repair: "#D85A30", borrow: "#0F6E56",
  transport: "#185FA5", reuse: "#3B6D11", community: "#534AB7",
};
const VERIFICATION_LABEL = ["未驗證", "開放資料", "現地確認", "當事人確認"];
const WANT_STATUS = { missing: "缺", partial: "部分有", unknown: "待查" };

let nodes = null, vocab = null, nodesLoading = null;
const rf = { needs: new Set(), item: "", query: "", direction: "all" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const itemName = (id) => vocab.itemById[id]?.name_zh || id;

function loadNodes() {
  if (!nodesLoading) {
    nodesLoading = Promise.all([
      fetch("data/vocab.json").then((r) => r.json()),
      fetch("data/nodes_verified.geojson").then((r) => (r.ok ? r.json() : { type: "FeatureCollection", features: [] })),
    ]).then(([v, collection]) => {
      vocab = v;
      vocab.itemById = Object.fromEntries(vocab.resource_items.map((i) => [i.item_id, i]));
      vocab.needById = Object.fromEntries(vocab.needs.map((n) => [n.need_id, n]));
      vocab.accessById = Object.fromEntries(vocab.access_modes.map((a) => [a.access_id, a]));
      vocab.classById = Object.fromEntries(vocab.resource_classes.map((c) => [c.class_id, c]));
      // 只列出至少有一項確認的供給或需求的據點
      const features = collection.features.filter((f) => f.properties.resources.length || f.properties.wants.length);
      features.forEach((f, i) => {
        f.id = i;
        f.properties.primary_need = f.properties.needs[0];
      });
      nodes = { type: "FeatureCollection", features };
      return nodes;
    });
  }
  return nodesLoading;
}

function itemsOf(p) {
  const offers = rf.direction === "need" ? [] : p.resources.map((r) => r.item);
  const wants = rf.direction === "offer" ? [] : p.wants.map((w) => w.item);
  return [...offers, ...wants];
}

function matches(p) {
  if (rf.needs.size && !p.needs.some((n) => rf.needs.has(n))) return false;
  const items = itemsOf(p);
  if (rf.direction !== "all" && !items.length) return false;
  if (rf.item && !items.includes(rf.item)) return false;
  if (rf.query && !String(p.name).includes(rf.query) && !items.some((i) => itemName(i).includes(rf.query))) return false;
  return true;
}

function ensureNodeLayers() {
  if (map.getSource("nodes")) return;
  map.addSource("nodes", { type: "geojson", data: nodes });
  const color = ["match", ["get", "primary_need"]];
  Object.entries(NEED_COLORS).forEach(([k, c]) => color.push(k, c));
  color.push("#888780");
  map.addLayer({
    id: "nodes-circle", type: "circle", source: "nodes", layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 6, 15, 10],
      "circle-color": color, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
      "circle-opacity": ["case", ["boolean", ["feature-state", "dim"], false], 0.15, 1],
    },
  });
  map.addLayer({
    id: "nodes-label", type: "symbol", source: "nodes", layout: {
      visibility: "none", "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.3],
      "text-anchor": "top", "text-font": ["Noto Sans Regular"],
    },
    paint: { "text-color": "#2C2C2A", "text-halo-color": "#fff", "text-halo-width": 1.5 },
  });
  map.on("mouseenter", "nodes-circle", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "nodes-circle", () => (map.getCanvas().style.cursor = ""));
  map.on("click", "nodes-circle", (e) => showNode(nodes.features[e.features[0].id]));
}

function needBadges(needs) {
  return needs.map((n) => `<span class="need-badge" style="--c:${NEED_COLORS[n] || "#888"}">${esc(vocab.needById[n]?.name_zh || n)}</span>`).join("");
}

function applyResourceFilter() {
  const hits = nodes.features.filter((f) => matches(f.properties));
  nodes.features.forEach((f) => map.setFeatureState({ source: "nodes", id: f.id }, { dim: !hits.includes(f) }));
  const results = document.getElementById("resource-results");
  if (!nodes.features.length) {
    results.innerHTML = `<div class="placeholder"><b>目前還沒有確認過的資料。</b><br>
      這裡只放經過現地走讀確認，或由據點本身提供的供給與需求，所以在資料填入之前會是空的。</div>`;
    return;
  }
  hits.sort((a, b) => String(a.properties.name).localeCompare(b.properties.name, "zh-Hant"));
  results.innerHTML = `<p class="sub">符合 ${fmt(hits.length)} 個據點</p>` +
    (hits.map((f) => {
      const p = f.properties;
      return `<button class="result" data-id="${f.id}">
        <span class="result-name">${esc(p.name)}</span>
        <span class="result-meta">提供 ${p.resources.length}・需要 ${p.wants.length}</span>
        <span class="result-needs">${needBadges(p.needs)}</span>
      </button>`;
    }).join("") || `<div class="placeholder">沒有符合的據點，可以放寬篩選。</div>`);
  results.querySelectorAll(".result").forEach((btn) => btn.addEventListener("click", () => {
    const f = nodes.features[Number(btn.dataset.id)];
    map.flyTo({ center: f.geometry.coordinates, zoom: Math.max(map.getZoom(), 15) });
    showNode(f);
  }));
}

function groupByClass(list) {
  const groups = {};
  list.forEach((x) => (groups[vocab.itemById[x.item]?.class_id || "other"] ||= []).push(x));
  return Object.entries(groups);
}

function showNode(f) {
  const p = f.properties;
  const offers = groupByClass(p.resources).map(([cls, rs]) => `
    <div class="lbl">${esc(vocab.classById[cls]?.name_zh || cls)}</div>
    ${rs.map((r) => `<span class="chip">${esc(itemName(r.item))}${String(r.access).split(";").map((a) =>
      `<span class="tag">${esc(vocab.accessById[a]?.name_zh || a)}</span>`).join("")}</span>`).join("")}`).join("");
  const wants = groupByClass(p.wants).map(([cls, ws]) => `
    <div class="lbl">${esc(vocab.classById[cls]?.name_zh || cls)}</div>
    ${ws.map((w) => `<span class="chip want" title="${esc(w.note || "")}">${esc(itemName(w.item))}<span class="tag">${WANT_STATUS[w.status] || w.status}</span></span>`).join("")}`).join("");
  document.getElementById("node-detail").innerHTML = `
    <div class="node-card">
      <div class="node-head">
        <div><div class="node-name">${esc(p.name)}</div><div class="sub">${esc(p.address || "")}</div></div>
        <button class="close" aria-label="關閉" data-close>×</button>
      </div>
      <div class="node-needs">${needBadges(p.needs)}</div>
      <div class="node-status">
        <span class="tag ${p.source === "portal" ? "" : "ok"}">${p.source === "portal" ? "據點自行填報，未經團隊確認" : VERIFICATION_LABEL[p.verification]}${p.verified_at ? `・${esc(p.verified_at)}` : ""}</span>
        ${p.node_type === "individual" ? `<span class="tag">個人據點：位置只標到村里中心</span>` : ""}
      </div>
      ${p.description ? `<p class="sub">${esc(p.description)}</p>` : ""}
      <p class="sub">聯絡方式：${p.contact ? esc(p.contact) : "請透過團隊轉介"}</p>
      <h3>提供</h3>
      ${offers || `<p class="sub">還沒有確認的供給。</p>`}
      <h3>需要</h3>
      ${wants || `<p class="sub">還沒有確認的需求。</p>`}
      ${p.wants.some((w) => w.note) ? `<p class="note">滑鼠移到需求項目上可以看到說明。</p>` : ""}
    </div>`;
  document.querySelector("#node-detail [data-close]").addEventListener("click", () => (document.getElementById("node-detail").innerHTML = ""));
}

function renderResourcePanel() {
  const itemOptions = vocab.resource_classes.map((c) => `<optgroup label="${esc(c.name_zh)}">${
    vocab.resource_items.filter((i) => i.class_id === c.class_id).map((i) => `<option value="${i.item_id}">${esc(i.name_zh)}</option>`).join("")}</optgroup>`).join("");
  document.getElementById("panel").innerHTML = `
    <h2>我附近有哪些夥伴？</h2>
    <p class="sub">每個供給和需求都屬於一個實際的據點，只列出經過現地確認或由據點本身提供的資料。</p>
    <div class="segmented" role="group" aria-label="供給或需求">
      ${[["all", "全部"], ["offer", "提供"], ["need", "需要"]].map(([k, l]) =>
        `<button data-direction="${k}" class="${rf.direction === k ? "on" : ""}">${l}</button>`).join("")}
    </div>
    <div class="need-filters">${vocab.needs.map((n) => `
      <button class="need-toggle ${rf.needs.has(n.need_id) ? "on" : ""}" data-need="${n.need_id}" style="--c:${NEED_COLORS[n.need_id]}" title="${esc(n.question)}">${esc(n.name_zh)}</button>`).join("")}
    </div>
    <label class="field-label" for="resource-item">資源項目</label>
    <select id="resource-item"><option value="">全部</option>${itemOptions}</select>
    <label class="field-label" for="resource-query" style="margin-top:8px">搜尋名稱或資源</label>
    <input id="resource-query" type="search" placeholder="例如：電鑽、木材" value="${esc(rf.query)}">
    <div id="node-detail"></div>
    <div id="resource-results"></div>`;

  document.getElementById("resource-item").value = rf.item;
  document.querySelectorAll("[data-direction]").forEach((btn) => btn.addEventListener("click", () => {
    rf.direction = btn.dataset.direction;
    document.querySelectorAll("[data-direction]").forEach((b) => b.classList.toggle("on", b === btn));
    applyResourceFilter();
  }));
  document.querySelectorAll(".need-toggle").forEach((btn) => btn.addEventListener("click", () => {
    const n = btn.dataset.need;
    rf.needs.has(n) ? rf.needs.delete(n) : rf.needs.add(n);
    btn.classList.toggle("on");
    applyResourceFilter();
  }));
  document.getElementById("resource-item").addEventListener("change", (e) => { rf.item = e.target.value; applyResourceFilter(); });
  let timer;
  document.getElementById("resource-query").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { rf.query = e.target.value.trim(); applyResourceFilter(); }, 250);
  });
}

async function enterResourceMode() {
  document.getElementById("panel").innerHTML = `<h2>我附近有哪些夥伴？</h2><p class="sub">載入中…</p>`;
  await loadNodes();
  ensureNodeLayers();
  ["nodes-circle", "nodes-label"].forEach((id) => map.setLayoutProperty(id, "visibility", "visible"));
  map.setPaintProperty("villages-fill", "fill-opacity", 0.18); // 村里著色淡化
  document.getElementById("controls").classList.add("muted");
  renderResourcePanel();
  applyResourceFilter();
}

function exitResourceMode() {
  if (!map.getLayer("nodes-circle")) return;
  ["nodes-circle", "nodes-label"].forEach((id) => map.setLayoutProperty(id, "visibility", "none"));
  const zoningOn = document.getElementById("toggle-zoning").checked;
  map.setPaintProperty("villages-fill", "fill-opacity", zoningOn ? 0 : 0.78);
  document.getElementById("controls").classList.remove("muted");
}
