# 都市資源地圖平台（Urban Resource Map）

## 專案目標
彙整並以地圖等視覺化方式呈現都市內可利用的**物質、空間、技術與知識資源**，並疊合人口資料（職業、年齡），作為回應實驗性治理、人與物質流、資源循環等都市治理議題的實作專案。

資源類型（初步）：
- **物質**：廢棄木棧板、有機資材、建材剩料等
- **器材**：木工、鐵工器材與工具
- **空間**：閒置空間、工坊
- **據點**：五金行、農具行、材料行、工廠
- **人**：技術人力（師傅、職人）、職業與年齡分布

## 核心論述（草稿）
以**都市代謝**為分析視角，以**資產為本（ABCD）與參與式製圖**為方法，把城市中分散的物質、空間、技能視為可再組合的**拼裝**；平台本身是一個**治理實驗**，探討資源循環如何在地方尺度被看見、被協商、被共有。

詳細框架與案例見 `docs/context.md`。

## 專案起點（2026-10-25）
使用者和社團夥伴在台大校園經營社區堆肥三年，最近遇到修繕困境：缺工具、缺就近的木材、缺運輸、缺作業場地。本專案要回應堆肥計畫的具體需求，並以堆肥站為核心，串起周遭社區，成為台北都市製造的試點。前言原文見 `docs/preface.md`，目前的規劃草案見 `docs/project-plan.md`。

## 文件結構
- `docs/preface.md`：使用者撰寫的專案前言（原文，勿改寫）
- `docs/project-plan.md`：以堆肥站為核心的專案規劃（2026-10-25 草案）
- `docs/research-question.md`：研究問題的收斂提案（2026-10-26）
- `docs/node-portal.md`：據點填報系統（Google Apps Script＋試算表）的設計與決定（2026-10-28）
- `docs/resource-database.md`：資源資料庫架構（2026-10-27 第 2 版）：依使用者需求的六類據點分類、含運輸的資源類別、各資料集的可靠性評估、資料表、KoboToolbox 運作方式
- `docs/platform-architecture.md`：網頁平台架構討論稿（2026-10-26）：資料模型、三層資料來源、技術選型、授權
- `docs/context.md`：學術框架與國內外案例（2026-10-21 初始討論）
- `docs/data-sources.md`：資料來源、授權、待查核事項
- `docs/decisions.md`：決策紀錄（日期／決定／理由），每次重要決定後更新
- `docs/direction-review.md`：參照 Fab City 與 Cities of Making 的方向評估（2026-10-23，待使用者決定）
- `docs/literature.md`：文獻資料庫（索引表＋每筆文獻的摘要、與本專案的關聯、限制）。新增文獻時沿用相同格式並更新索引表。

## 工作慣例
- 一律以**繁體中文**溝通與撰寫文件；程式碼、檔名、變數用英文。
- 重要討論或決定結束後，主動提議更新 `docs/decisions.md` 或相關文件。
- 學術引用標明作者與年份；不確定的資訊標註「待查核」，不要當成事實寫入。
- 個人技能資料涉及個資法：預設自願登錄、去識別化，公開地圖不顯示可識別個人的精確位置。

## 技術決策
- **資料處理用 Python**。虛擬環境在 `.venv/`，套件列在 `requirements.txt`。
- **資料管線**在 `pipeline/`：執行 `.venv/bin/python pipeline/run_all.py`（加 `--force` 會重新下載）。
  - `common.py`：data.gov.tw 資料集查詢、下載、解壓縮（處理 Big5 檔名）
  - `villages.py`：村里界；`population.py`：村里人口與指標；`education.py`：教育程度；`income.py`：綜所稅所得；`village_links.py`：各里在臺北市鄰里服務網的頁面與「里長簡介」連結（不收錄里長個資；里長簡介連結要逐頁讀取，約 8 分鐘，結果有快取）；`zoning.py`：使用分區與大類；`geocode.py`：用臺北市門牌資料做地址轉座標；`nodes.py`：公開資料據點管線（商業登記、登記工廠、特定工廠、OSM、據點範本 → nodes，依授權分開存放；不推論資源）
  - 輸出：`data/processed/ogdl/taipei_villages.geojson`（村里界加上所有指標）、`taipei_village_indicators.csv`、`taipei_zoning.geojson`（不進 git）
- **網頁原型**在 `site/`：靜態網站，用 MapLibre GL JS 4.7.1 加上 OpenFreeMap positron 底圖（免金鑰）。
  - 先跑 `run_all.py` 和 `nodes.py`，再跑 `.venv/bin/python pipeline/build_site.py`，產生 `site/data/`（villages、zoning、meta、nodes_reference、nodes_verified、vocab）。
  - 本機預覽：`.claude/launch.json` 的 `site` 設定（`python -m http.server 8765 --directory site`）。
  - **資料真實性原則（2026-10-27）**：公開資料不推論據點有哪些資源。「我在一個怎樣的地方？」模式（公開資料，僅供參考）只顯示高可信度的公開登記店家與工廠，只呈現事實；「我附近有哪些夥伴？」模式只放現地確認或據點本身填寫的供給與需求，資料填入前為空。
  - 只有兩個模式：「我在一個怎樣的地方？」（內部代碼 `explore`，原「探索鄰里」「公開資料（參考）」）與「我附近有哪些夥伴？」（內部代碼 `resources`，原「找資源」「資源網絡（已確認）」，程式在 `site/resources.js`）；2026-10-28 改為問句名稱。「示範點」分頁已刪除。
  - 資源網絡以**空間據點**為單位，每個據點可以有「提供」（resources）與「需要」（wants，來自 `data/processed/field/intents_field.csv`）。沒有固定地點的資源與個人，依 `docs/resource-database.md` 第十四節的例外規則處理。
  - 堆肥站**只用據點填報系統管理**（2026-10-28 起）：網站上的「臺大根與芽堆肥據點」來自填報系統，舊的 `nodes/ntu-compost.yaml` 已刪除。堆肥站不出現在公開資料版面。
- **發布（2026-10-28）**：公開 repository <https://github.com/mohekang7-ux/urban-resource-map>（整個專案公開），網站 <https://mohekang7-ux.github.io/urban-resource-map/>。`.github/workflows/pages.yml` 在 `site/` 有變動並推送到 main 時自動發布。更新網站：跑完管線後 commit 並 `git push`。GitHub CLI 安裝在 `~/.local/bin/gh`（帳號 mohekang7-ux）。推送是對外公開的動作，推送前確認沒有 `.env` 或測試資料。
- **資源網絡的協作編輯（第 2 版，2026-10-28）**：在網站「我附近有哪些夥伴？」直接新增據點、編輯、評論、回報「還在／已經沒有了」、回應需求；Google 帳號登入、任何人都能改、建立者收到通知、3 個月沒確認標示「可能已過時」。後端在 `apps-script/`（Code.gs、Vocab.gs、appsscript.json；部署與升級說明在 `apps-script/README.md`，設計在 `docs/node-portal.md` 第 2 版）。網站設定在 `site/config.js`（apiUrl、googleClientId、staleDays）；網站即時讀取 Apps Script 匯出。`pipeline/portal.py` 改為定期備份到 `data/processed/field/*_portal.csv`。詞表改了要跑 `pipeline/apps_script_vocab.py` 重新產生 `Vocab.gs`。本機測試網站編輯功能用 `?mock=1`。**測試資料不要留在 `data/processed/field/`。**
- **資源資料架構**：詞表、欄位定義、來源對照表在 `data/schema/`；據點範本 `nodes/*.yaml` 的機制保留（目前沒有任何範本，據點一律用填報系統管理）；`.venv/bin/python pipeline/schema.py` 檢查一致性。新增資源項目或來源分類時，改 CSV 即可，再跑一次檢查。
- **資料夾**：`data/raw/` 放原始下載（不進 git）；`data/processed/ogdl|odbl|field/` 依授權分開存放衍生資料。
- **金鑰**：放在本機 `.env`（範本是 `.env.example`），不進 git、不貼進對話。
- 其他技術決策見 `docs/decisions.md` 和 `docs/platform-architecture.md`。
