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
  - `villages.py`：村里界；`population.py`：村里人口與指標；`education.py`：教育程度；`income.py`：綜所稅所得；`zoning.py`：使用分區與大類
  - 輸出：`data/processed/ogdl/taipei_villages.geojson`（村里界加上所有指標）、`taipei_village_indicators.csv`、`taipei_zoning.geojson`（不進 git）
- **資料夾**：`data/raw/` 放原始下載（不進 git）；`data/processed/ogdl|odbl|field/` 依授權分開存放衍生資料。
- **金鑰**：放在本機 `.env`（範本是 `.env.example`），不進 git、不貼進對話。
- 其他技術決策見 `docs/decisions.md` 和 `docs/platform-architecture.md`。
