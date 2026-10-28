# 台北製造能力地圖（Urban Resource Map）

以台大社區堆肥站為起點，彙整並以地圖呈現台北鄰里尺度的物質、空間、技能與知識資源，作為回應都市製造（urban manufacturing）、資源循環與實驗性治理的實作專案。

網站有兩個模式：
- **我在一個怎樣的地方？**：政府公開資料（村里人口、性別、年齡、教育、所得、都市計畫使用分區，以及高可信度的公開登記店家與工廠），僅供參考，不推論任何資源。
- **我附近有哪些夥伴？**：據點自行填報或現地確認的「提供」與「需要」，每一筆都屬於一個空間據點。

## 專案結構
| 資料夾 | 內容 |
|---|---|
| `site/` | 靜態網站（MapLibre GL JS），由 GitHub Pages 發布 |
| `pipeline/` | Python 資料管線：下載、清理、地址轉座標、產生網站資料 |
| `apps-script/` | 據點填報系統（Google Apps Script＋試算表），部署說明見 `apps-script/README.md` |
| `data/schema/` | 資源詞表、欄位定義、來源對照表 |
| `data/processed/` | 依授權分開存放的衍生資料（`ogdl` 政府資料開放授權、`odbl` OpenStreetMap、`field` 現地與填報資料） |
| `docs/` | 研究文件：前言、研究問題、專案規劃、決策紀錄、文獻資料庫等 |

## 重新產生資料
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python pipeline/run_all.py
.venv/bin/python pipeline/nodes.py
.venv/bin/python pipeline/portal.py     # 需要 .env 的 PORTAL_EXPORT_URL
.venv/bin/python pipeline/build_site.py
```

## 資料來源與授權
- 政府開放資料依「政府資料開放授權條款第 1 版」，來源與限制見 `docs/data-sources.md`。
- OpenStreetMap 資料 © OpenStreetMap contributors，依 ODbL 授權；底圖由 OpenFreeMap 提供。
- 據點填報資料由各據點自行提供並同意公開。
