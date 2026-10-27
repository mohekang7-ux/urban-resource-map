// 台北製造能力地圖（原型）：探索鄰里模式
// 資料由 pipeline/build_site.py 產生，放在 site/data/

const INDICATORS = [
  { group: "人口結構", key: "pop_density", label: "人口密度", unit: "人/km²", period: "population", ramp: "teal", digits: 0 },
  { group: "人口結構", key: "share_65_plus", label: "65 歲以上比例", unit: "%", period: "population", ramp: "teal", digits: 1 },
  { group: "人口結構", key: "share_0_14", label: "0–14 歲比例", unit: "%", period: "population", ramp: "teal", digits: 1 },
  { group: "人口結構", key: "dependency_ratio", label: "扶養比", unit: "", period: "population", ramp: "teal", digits: 1,
    note: "每 100 位 15–64 歲人口，對應的 0–14 歲與 65 歲以上人口數。" },
  { group: "性別", key: "sex_ratio", label: "性別比", unit: "", period: "population", ramp: "teal", digits: 1,
    note: "每 100 位女性對應的男性人數。" },
  { group: "教育程度", key: "share_tertiary", label: "大專以上比例（25 歲以上）", unit: "%", period: "education", ramp: "purple", digits: 1,
    note: "最高畢業學歷；在學大學生算高中畢業，學生戶籍多的村里會偏低。" },
  { group: "教育程度", key: "share_graduate", label: "研究所比例（25 歲以上）", unit: "%", period: "education", ramp: "purple", digits: 1 },
  { group: "收入", key: "income_median", label: "綜合所得中位數", unit: "千元", period: "income", ramp: "amber", digits: 0,
    note: "綜所稅申報戶，不含政府移轉、免稅與分離課稅所得；按戶籍地統計。" },
  { group: "收入", key: "income_iqr", label: "所得落差（第三減第一分位數）", unit: "千元", period: "income", ramp: "amber", digits: 0 },
];

const RAMPS = {
  teal: ["#E1F5EE", "#9FE1CB", "#5DCAA5", "#1D9E75", "#0F6E56"],
  purple: ["#EEEDFE", "#CECBF6", "#AFA9EC", "#7F77DD", "#534AB7"],
  amber: ["#FAEEDA", "#FAC775", "#EF9F27", "#BA7517", "#854F0B"],
};

const ZONING_COLORS = {
  住宅: "#F5C4B3", 商業: "#D85A30", 工業: "#534AB7", 公共設施: "#9FE1CB",
  特定專用區: "#FAC775", 農業與保護: "#97C459", 水域: "#85B7EB", 其他: "#D3D1C7",
};

const PERIOD_LABEL = {
  population: (p) => `民國 ${p.slice(0, 3)} 年 ${Number(p.slice(3))} 月`,
  education: (p) => `民國 ${p} 年`,
  income: (p) => `${p} 年度`,
};

// 示範點：台大社區堆肥站（座標取自使用者提供的 Google 地圖標記，2026-10-26）
const DEMO_SITE = { name: "台大社區堆肥站", lngLat: [121.5397753, 25.019594] };

let map, villages, meta, current = INDICATORS[1], hoveredId = null, selectedId = null;

const fmt = (v, digits = 0) => (v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("zh-TW", { maximumFractionDigits: digits, minimumFractionDigits: digits }));

function quantileBreaks(values, n = 5) {
  const sorted = values.filter((v) => v != null && !Number.isNaN(v)).sort((a, b) => a - b);
  return Array.from({ length: n - 1 }, (_, i) => sorted[Math.floor(((i + 1) / n) * sorted.length)]);
}

function buildIndicatorSelect() {
  const select = document.getElementById("indicator");
  const groups = {};
  INDICATORS.forEach((ind, i) => {
    if (!groups[ind.group]) {
      groups[ind.group] = document.createElement("optgroup");
      groups[ind.group].label = ind.group;
      select.appendChild(groups[ind.group]);
    }
    const opt = new Option(ind.label, i);
    groups[ind.group].appendChild(opt);
  });
  select.value = INDICATORS.indexOf(current);
  select.addEventListener("change", () => {
    current = INDICATORS[Number(select.value)];
    applyChoropleth();
  });
}

function applyChoropleth() {
  const values = villages.features.map((f) => f.properties[current.key]);
  const breaks = quantileBreaks(values);
  const colors = RAMPS[current.ramp];
  const step = ["step", ["coalesce", ["get", current.key], -1], "#eeeeee", 0, colors[0]];
  breaks.forEach((b, i) => step.push(b, colors[i + 1]));
  map.setPaintProperty("villages-fill", "fill-color", step);

  const period = PERIOD_LABEL[current.period](meta.periods[current.period]);
  const median = meta.taipei_median[current.key];
  document.getElementById("indicator-note").innerHTML =
    `${current.note ? current.note + "<br>" : ""}資料：${period}・全市各里中位數 ${fmt(median, current.digits)}${current.unit ? " " + current.unit : ""}`;

  const edges = [Math.min(...values.filter((v) => v != null)), ...breaks, Math.max(...values.filter((v) => v != null))];
  document.getElementById("legend").innerHTML = colors
    .map((c, i) => `<div class="legend-row"><span class="swatch" style="background:${c}"></span>${fmt(edges[i], current.digits)} – ${fmt(edges[i + 1], current.digits)}</div>`)
    .join("") + `<div class="note">五等分位：每個顏色約各占 1/5 的村里</div>`;

  if (selectedId != null) showVillage(villages.features.find((f) => f.id === selectedId));
}

function pyramidSvg(p) {
  const bands = [];
  for (let a = 0; a <= 100; a += 5) {
    const k = String(a).padStart(3, "0");
    bands.push({ label: a === 100 ? "100+" : `${a}–${a + 4}`, m: p[`age_${k}_m`] || 0, f: p[`age_${k}_f`] || 0 });
  }
  const max = Math.max(...bands.map((b) => Math.max(b.m, b.f)), 1);
  const w = 300, rowH = 9, mid = w / 2, half = mid - 24;
  const rows = bands.slice().reverse().map((b, i) => {
    const y = i * rowH;
    const mw = (b.m / max) * half, fw = (b.f / max) * half;
    const label = i % 2 === 0 ? `<text x="${mid}" y="${y + 7.5}" font-size="8" text-anchor="middle" fill="#5f5e5a">${b.label}</text>` : "";
    return `<rect x="${mid - 22 - mw}" y="${y}" width="${mw}" height="${rowH - 1.5}" fill="#378ADD"/>` +
      `<rect x="${mid + 22}" y="${y}" width="${fw}" height="${rowH - 1.5}" fill="#D4537E"/>` + label;
  }).join("");
  const h = bands.length * rowH;
  return `<svg viewBox="0 0 ${w} ${h + 14}" width="100%" role="img" aria-label="人口金字塔">${rows}` +
    `<text x="4" y="${h + 11}" font-size="9" fill="#185FA5">男 ${fmt(p.pop_male)}</text>` +
    `<text x="${w - 4}" y="${h + 11}" font-size="9" text-anchor="end" fill="#993556">女 ${fmt(p.pop_female)}</text></svg>`;
}

function metric(label, value, unit, key, digits) {
  const med = meta.taipei_median[key];
  return `<div class="metric"><div class="label">${label}</div><div class="value">${fmt(value, digits)}${unit}</div>` +
    `<div class="cmp">全市各里中位數 ${fmt(med, digits)}${unit}</div></div>`;
}

function bar(label, value) {
  return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${value || 0}%"></div></div><span>${fmt(value, 1)}%</span></div>`;
}

function showVillage(f) {
  const p = f.properties;
  document.getElementById("panel").innerHTML = `
    <h2>${p.village}</h2>
    <p class="sub">臺北市${p.district}・面積 ${fmt(p.area_km2, 2)} km²・${fmt(p.households)} 戶</p>
    <div class="metrics">
      ${metric("人口", p.pop_total, "", "pop_total", 0)}
      ${metric("65 歲以上", p.share_65_plus, "%", "share_65_plus", 1)}
      ${metric("大專以上（25+）", p.share_tertiary, "%", "share_tertiary", 1)}
      ${metric("所得中位數", p.income_median, " 千元", "income_median", 0)}
    </div>

    <h3>人口金字塔</h3>
    ${pyramidSvg(p)}
    <p class="sub">性別比 ${fmt(p.sex_ratio, 1)}・扶養比 ${fmt(p.dependency_ratio, 1)}・老化指數 ${fmt(p.aging_index, 0)}</p>

    <h3>教育程度（25 歲以上）</h3>
    ${bar("研究所", p.share_graduate)}
    ${bar("大學專科", p.share_tertiary - p.share_graduate)}
    ${bar("高中職", p.share_secondary)}
    ${bar("國中以下", p.share_basic)}
    <p class="sub">大專以上比例：男 ${fmt(p.share_tertiary_m, 1)}%・女 ${fmt(p.share_tertiary_f, 1)}%</p>

    <h3>所得（千元）</h3>
    <p class="sub">中位數 ${fmt(p.income_median)}・平均數 ${fmt(p.income_mean)}・第一分位數 ${fmt(p.income_q1)}・第三分位數 ${fmt(p.income_q3)}</p>

    <h3>里長與里辦公處</h3>
    ${p.li_url
      ? `<a class="link-button" href="${p.li_url}" target="_blank" rel="noopener">在臺北市鄰里服務網查看${p.village}的里長簡介 ↗</a>`
      : `<p class="sub">找不到這個里的官方頁面。</p>`}
    <p class="sub">里長姓名與聯絡方式以官方頁面為準，本平台不另外收錄。115 年 11 月 28 日里長改選後，示範點周邊的里會補上經確認的里辦公處聯絡方式。</p>

    <h3>製造與供應據點</h3>
    <div class="placeholder">據點資料（五金行、工廠、維修中心等）還沒接入。下一步會先加入商業登記、工廠清冊與 OpenStreetMap。</div>

    <div class="source">
      人口：內政部戶政司 ${PERIOD_LABEL.population(meta.periods.population)}；教育：內政部戶政司 ${PERIOD_LABEL.education(meta.periods.education)}；
      所得：財政部財政資訊中心 ${PERIOD_LABEL.income(meta.periods.income)}；村里界：內政部國土測繪中心；里頁面連結：臺北市鄰里服務網。
      皆依政府資料開放授權條款第 1 版。戶籍資料不含未遷入戶籍的居民；村里統計不代表個人。
    </div>`;
}

function showIntro() {
  document.getElementById("panel").innerHTML = `
    <h2>探索鄰里</h2>
    <p>點選地圖上的村里，查看人口、性別、年齡、教育程度與所得。左上角可以切換著色的指標，或疊上都市計畫使用分區。</p>
    <div class="metrics">
      <div class="metric"><div class="label">村里數</div><div class="value">${villages.features.length}</div></div>
      <div class="metric"><div class="label">戶籍人口</div><div class="value">${fmt(villages.features.reduce((s, f) => s + (f.properties.pop_total || 0), 0))}</div></div>
    </div>
    <h3>示範點</h3>
    <p class="sub">紫色圓點是台大社區堆肥站，本計畫的第一個示範點。</p>
    <div class="source">這是原型，資料與介面都還在調整。</div>`;
}

function showModePlaceholder(mode) {
  const text = {
    resources: "「找資源」模式要等據點資料接入後才能使用：搜尋一項資源（例如木材、電鑽），地圖會亮出擁有它的據點。",
    demo: "「示範點」模式會呈現堆肥站的需求清單、可得性與缺口，以及試點的物質流。需求清單完成後加入。",
  };
  document.getElementById("panel").innerHTML = `<h2>${mode === "resources" ? "找資源" : "示範點"}</h2><div class="placeholder">${text[mode]}</div>`;
}

function setupModes() {
  document.querySelectorAll(".mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("active", b === btn));
      if (btn.dataset.mode === "explore") {
        selectedId != null ? showVillage(villages.features.find((f) => f.id === selectedId)) : showIntro();
      } else {
        showModePlaceholder(btn.dataset.mode);
      }
    });
  });
}

function setupToggles() {
  const zoningBox = document.getElementById("toggle-zoning");
  const zoningLegend = document.getElementById("zoning-legend");
  zoningLegend.innerHTML = Object.entries(ZONING_COLORS)
    .map(([k, c]) => `<div class="legend-row"><span class="swatch" style="background:${c}"></span>${k}</div>`)
    .join("");

  zoningBox.addEventListener("change", async () => {
    const on = zoningBox.checked;
    if (on && !map.getSource("zoning")) {
      zoningBox.disabled = true;
      const data = await fetch("data/zoning.geojson").then((r) => r.json());
      map.addSource("zoning", { type: "geojson", data });
      const match = ["match", ["get", "zone_category"]];
      Object.entries(ZONING_COLORS).forEach(([k, c]) => match.push(k, c));
      match.push("#D3D1C7");
      map.addLayer({ id: "zoning-fill", type: "fill", source: "zoning", paint: { "fill-color": match, "fill-opacity": 0.75 } }, "villages-line");
      zoningBox.disabled = false;
    }
    if (map.getLayer("zoning-fill")) map.setLayoutProperty("zoning-fill", "visibility", on ? "visible" : "none");
    // 一次只顯示一種著色：開啟使用分區時，村里著色改為透明
    map.setPaintProperty("villages-fill", "fill-opacity", on ? 0 : 0.78);
    zoningLegend.hidden = !on;
    document.getElementById("legend").style.opacity = on ? 0.4 : 1;
  });

  document.getElementById("toggle-demo").addEventListener("change", (e) => {
    const vis = e.target.checked ? "visible" : "none";
    ["demo-point", "demo-label"].forEach((id) => map.setLayoutProperty(id, "visibility", vis));
  });
}

async function init() {
  document.getElementById("panel").innerHTML = `<p class="sub">載入資料中…</p>`;
  [villages, meta] = await Promise.all([
    fetch("data/villages.geojson").then((r) => r.json()),
    fetch("data/meta.json").then((r) => r.json()),
  ]);
  villages.features.forEach((f, i) => (f.id = i));

  map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: [121.55, 25.06],
    zoom: 11,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  // 版面變動（視窗縮放、手機版切換）時重新計算地圖大小
  new ResizeObserver(() => map.resize()).observe(document.getElementById("map"));

  map.once("style.load", () => {
    map.addSource("villages", { type: "geojson", data: villages });
    map.addLayer({ id: "villages-fill", type: "fill", source: "villages", paint: { "fill-color": "#ccc", "fill-opacity": 0.78 } });
    map.addLayer({
      id: "villages-line", type: "line", source: "villages",
      paint: { "line-color": "#ffffff", "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0.6] },
    });
    map.addLayer({
      id: "villages-selected", type: "line", source: "villages",
      paint: { "line-color": "#185FA5", "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0] },
    });

    map.addSource("demo-point", { type: "geojson", data: { type: "Feature", geometry: { type: "Point", coordinates: DEMO_SITE.lngLat }, properties: { name: DEMO_SITE.name } } });
    map.addLayer({ id: "demo-point", type: "circle", source: "demo-point", paint: { "circle-radius": 7, "circle-color": "#534AB7", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    map.addLayer({
      id: "demo-label", type: "symbol", source: "demo-point",
      layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top", "text-font": ["Noto Sans Regular"] },
      paint: { "text-color": "#3C3489", "text-halo-color": "#fff", "text-halo-width": 1.5 },
    });

    // 讓全市剛好落在左上控制面板以外的可視範圍
    const bounds = new maplibregl.LngLatBounds();
    villages.features.forEach((f) => {
      const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat(1);
      rings.forEach((ring) => ring.forEach((c) => bounds.extend(c)));
    });
    const wide = window.innerWidth > 760;
    map.resize(); // 先確定容器大小，否則手機版會縮放錯誤
    map.fitBounds(bounds, { padding: wide ? { top: 20, bottom: 20, left: 290, right: 20 } : 16, duration: 0 });

    buildIndicatorSelect();
    applyChoropleth();
    setupModes();
    setupToggles();
    showIntro();

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
    map.on("mousemove", "villages-fill", (e) => {
      const f = e.features[0];
      if (hoveredId !== null) map.setFeatureState({ source: "villages", id: hoveredId }, { hover: false });
      hoveredId = f.id;
      map.setFeatureState({ source: "villages", id: hoveredId }, { hover: true });
      map.getCanvas().style.cursor = "pointer";
      const v = f.properties[current.key];
      popup.setLngLat(e.lngLat).setHTML(`<b>${f.properties.district} ${f.properties.village}</b><br>${current.label}：${fmt(v, current.digits)}${current.unit ? " " + current.unit : ""}`).addTo(map);
    });
    map.on("mouseleave", "villages-fill", () => {
      if (hoveredId !== null) map.setFeatureState({ source: "villages", id: hoveredId }, { hover: false });
      hoveredId = null;
      map.getCanvas().style.cursor = "";
      popup.remove();
    });
    map.on("click", "villages-fill", (e) => {
      if (selectedId !== null) map.setFeatureState({ source: "villages", id: selectedId }, { selected: false });
      selectedId = e.features[0].id;
      map.setFeatureState({ source: "villages", id: selectedId }, { selected: true });
      document.querySelector('.mode[data-mode="explore"]').click();
    });
  });
}

init();
