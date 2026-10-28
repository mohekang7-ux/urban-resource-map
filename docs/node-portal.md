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

---

# 第 2 版：在地圖上公開協作編輯（2026-10-28）

> 取代第 1 版的獨立填報網頁與「只有建立者能修改」的規則。決定見 `docs/decisions.md` 2026-10-28。

## 為什麼改
城市修理站、淨零小白屋等類似地圖，常見的問題是：填資料的人得不到回饋、資料沒有過期的概念、維護全靠一小群人、地圖和實際活動脫節，最後停擺或資料過時。

## 設計原則
| 問題 | 設計 |
|---|---|
| 填的人沒有回饋 | 「需要」是主角：看到需求可以按「我可以提供」，提出需求的據點建立者會收到 Email 通知 |
| 資料過期 | 每筆供給、需求、據點都顯示「最後確認時間」；超過 3 個月沒人確認，地圖上變淡並標示「可能已過時」 |
| 維護負擔集中 | 任何人都能順手按「還在」或「已經沒有了」，維護分散給每個使用者 |
| 開放與可靠的拉扯 | 用透明取代把關：修改者暱稱、確認時間、回報次數都公開；所有修改留紀錄、可還原 |
| 結構與自由 | 據點類型、資源項目、取得方式、狀態仍用詞表；評論與使用心得是自由文字 |

## 身分與權限
- **Google 帳號登入**才能寫入（網站用 Google Identity Services 取得 ID token，Apps Script 向 Google 驗證）。瀏覽不需登入。
- 第一次登入要設定**公開暱稱**；Email 不公開，只用來通知與留紀錄。
- **任何登入者都能修改任何據點**（類似維基）；每次修改、刪除、留言都寫入 `log`，據點建立者收到 Email 通知（自己改自己的不通知）。
- 每個帳號每小時最多 60 次寫入，防止灌水。

## 資料
新增欄位：`nodes.updated_by`、`nodes.last_confirmed_at`；`offers`／`wants` 的 `created_by`、`updated_by`、`last_confirmed_at`。新增工作表：
| 工作表 | 欄位 |
|---|---|
| `comments` | comment_id、node_id、target_type（node／offer／want）、target_id、kind（comment 留言／response 回應需求／still 確認還在／gone 回報已經沒有了）、text、author_email（不公開）、author_name、created_at、status（visible／hidden） |
| `users` | email（不公開）、display_name、created_at、updated_at |

「確認還在」會更新對象的 `last_confirmed_at`；新增或修改也會更新。

## 網站
- 「我附近有哪些夥伴？」即時讀取 `…/exec?action=export`；讀不到時改用 `site/data/nodes_verified.geojson`（由 `pipeline/portal.py` 備份產生）。
- 登入後：「在地圖上新增據點」（在地圖上點選位置）；據點卡上可以編輯據點、新增或編輯提供與需要、回報「還在」或「已經沒有了」、回應需求、留言。
- 介面精簡（2026-10-28）：清單與據點卡輪流顯示；搜尋框取代資源項目下拉選單；用途篩選收進「依用途篩選」；每筆資源只留一個主要按鈕（需要：「我可以提供」），「還在／已經沒有了／編輯／刪除」收進「⋯」選單；只有過時的資料才標示時間；「確認還在」不列在留言中；選填欄位收合。留言者可以刪除自己的留言（`deleteComment`，軟刪除）。
- 設定在 `site/config.js`：`apiUrl`、`googleClientId`、`staleDays`（90 天）。`googleClientId` 空白時網站維持唯讀。

## 測試
- 網站編輯介面：本機 `?mock=1` 模擬後端，測過登入與暱稱、新增據點、新增提供與需要、回應需求、確認還在、回報已經沒有了、留言、編輯據點、刪除、過時標示。
- `Code.gs`：在瀏覽器以模擬的 Apps Script 環境（假的試算表、登入驗證、寄信）實際執行每個動作，測過：未登入與未設定暱稱會擋下、位置超出臺北市會擋下、他人修改會通知建立者、未移動位置時保留原位置、匯出不含 Email、刪除的需求不匯出。**尚未在真正的 Google 環境測試**，部署後要實際操作一次確認。
