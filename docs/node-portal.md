# 據點填報系統（2026-10-28）

> 使用者決定見 `docs/decisions.md` 2026-10-28。部署說明見 `apps-script/README.md`。

## 目的
每個行動者（店家、工坊、社區組織、學校單位、個人）都有自己的「資源庫」，自行管理：
- **我們提供的**：資源項目、取得方式（售、借、贈、服務、交換）、條件、狀態（提供中、暫停）；
- **我們需要的**：資源項目、狀態（缺、部分有、待查、已滿足）、說明。

資料以「需求與供給」為基本架構，每一筆都屬於一個空間據點（`docs/resource-database.md` 第十四節）。

## 架構
```
填報網頁（Apps Script 網頁應用程式，apps-script/Index.html）
  │ google.script.run
  ▼
Code.gs：檢查資料（詞表、臺北市範圍、Gmail 格式、公式注入）→ 寫入試算表 → 寫修改紀錄
  ▼
Google 試算表：nodes、offers、wants、log
  │ …/exec?action=export（只輸出可公開的欄位）
  ▼
pipeline/portal.py → data/processed/field/*_portal.csv → pipeline/build_site.py → 網站
```

## 決定與對應的設計
| 決定 | 設計 |
|---|---|
| 不做身分驗證，但必須提供 Gmail | 只接受 `@gmail.com`；用 Gmail 找回自己建立的據點；只有建立時的 Gmail 能修改該據點。**風險**：知道別人 Gmail 的人可以冒用，所以每次修改都寫入 `log`，可以還原 |
| 填報後直接公開 | 匯出不經審核；網站上標示「據點自行填報，未經團隊確認」，與現地確認區分；團隊可以在試算表把 `status` 改成 `hidden` 隱藏 |
| 聯絡方式由據點決定 | 表單有「公開聯絡方式」勾選；沒勾選時網站顯示「請透過團隊轉介」；**Gmail 一律不公開、不匯出** |
| 個人據點的個資保護 | 匯出時不含地址、座標降到小數兩位（約 1 公里）；匯入時再移到所在村里的中心點 |
| 資料真實可靠 | 下拉選單只用 `data/schema/` 的詞表（`Vocab.gs` 自動產生）；伺服器端再檢查一次；位置必須在臺北市範圍內；必須勾選同意公開 |

## 試算表欄位
| 工作表 | 欄位 |
|---|---|
| `nodes` | node_id、name、node_type、needs、address、lon、lat、description、contact_public、contact_text、email（不公開）、consent、status（active／hidden／deleted）、created_at、updated_at |
| `offers` | offer_id、node_id、item_id、access、conditions、status（active／paused／deleted）、created_at、updated_at |
| `wants` | want_id、node_id、item_id、status（missing／partial／unknown／fulfilled／deleted）、note、created_at、updated_at |
| `log` | timestamp、email、action、table、record_id、before、after |

刪除都是「軟刪除」（狀態改為 deleted），資料保留在試算表中。

## 匯入規則（`pipeline/portal.py`）
- 只匯入 `status = active` 且同意公開的據點；供給只取「提供中」；需求不含「已滿足」。
- `verification = 3`、`source = portal`、授權 CC BY 4.0。
- 通過 `pipeline/schema.py` 的驗證才會寫出。

## 已知限制與之後可以加強的地方
- 沒有身分驗證：之後可以改成寄送確認信，或改用 Google 帳號登入。
- 沒有防灌水機制：如果出現大量垃圾資料，可以加上每個 Gmail 的填報次數限制。
- 「已滿足」的需求目前只是隱藏；之後可以記錄是誰提供的，形成據點之間的交換紀錄。
- 堆肥站的需求目前仍來自 `nodes/ntu-compost.yaml`；之後可以改由社團在填報網頁上管理。
