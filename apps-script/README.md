# 資源網絡後端：部署說明（第 2 版，2026-10-28）

網站「我附近有哪些夥伴？」直接在地圖上新增、編輯、評論，並回報「還在」或「已經沒有了」。這些動作透過 Google Apps Script 寫進一份 Google 試算表；網站也即時讀取這份試算表的公開匯出。設計說明見 `docs/node-portal.md`。

## 檔案
| 檔案 | 用途 |
|---|---|
| `Code.gs` | 後端 API：驗證 Google 登入、檢查與寫入資料、修改紀錄、Email 通知、公開匯出 |
| `Vocab.gs` | 詞表，由 `pipeline/apps_script_vocab.py` 從 `data/schema/` 產生，請勿手動修改 |
| `appsscript.json` | 專案設定：存取這份試算表、驗證登入（對外連線）、寄送通知信 |

第 1 版的 `Index.html`（獨立填報網頁）已經停用；Apps Script 專案裡的 `Index` 檔案可以刪除。

## 從第 1 版升級（你目前的情況）

### 步驟一：在 Google Cloud 建立登入用的用戶端 ID（約 5 分鐘）
網站在 GitHub Pages、後端在 Apps Script，兩邊分開，所以網站要用「Google 登入」，需要一個屬於這個網站的用戶端 ID。這是免費的。
1. 打開 <https://console.cloud.google.com/>，用你的 Google 帳號登入，同意服務條款。
2. 左上角專案選單 →「新增專案」，名稱例如 `urban-resource-map` →「建立」，再切換到這個專案。
3. 左側選單「API 和服務」→「OAuth 同意畫面」（新版介面叫「Google Auth Platform」→「品牌」），按「開始」：
   - 應用程式名稱：`台北製造能力地圖`；使用者支援電子郵件：你的 Gmail；
   - 目標對象選「**外部**」；聯絡資訊填你的 Gmail；同意政策 →「建立」。
   - 到「目標對象」頁面，把發布狀態從「測試中」改成「**發布應用程式**（實際運作中）」。只用到基本的登入資訊（Email、名字），不需要 Google 審查；如果停在「測試中」，只有你手動加入的測試使用者能登入。
4. 左側「用戶端」（舊版介面是「憑證」→「建立憑證」→「OAuth 用戶端 ID」）→「建立用戶端」：
   - 應用程式類型：**網頁應用程式**；名稱隨意；
   - 已授權的 JavaScript 來源，新增兩個：
     - `https://mohekang7-ux.github.io`
     - `http://localhost:8765`（本機測試用）
   - 「已授權的重新導向 URI」留空 →「建立」。
5. 複製畫面上的「**用戶端 ID**」（結尾是 `.apps.googleusercontent.com`）。用戶端 ID 是公開資訊，不是密碼，可以直接貼給 Claude；**用戶端密碼不需要，也不要貼出來**。

### 步驟二：更新 Apps Script
1. 打開試算表 →「擴充功能」→「Apps Script」。
2. `Code.gs`：全部內容換成這個資料夾裡的 `Code.gs`。
3. `appsscript.json`：全部內容換成這個資料夾裡的 `appsscript.json`（多了對外連線與寄信的權限）。
4. `Vocab.gs`：不用改，除非詞表有更新。
5. 左側的 `Index` 檔案：點「⋮」→「刪除」。
6. 左側齒輪「專案設定」→ 最下方「指令碼屬性」→「新增指令碼屬性」，加兩個：
   | 屬性 | 值 |
   |---|---|
   | `GOOGLE_CLIENT_ID` | 步驟一複製的用戶端 ID |
   | `SITE_URL` | `https://mohekang7-ux.github.io/urban-resource-map/` |
7. 回到編輯器，儲存，函式選單選 `setup` →「執行」。因為權限增加了，會再要求授權一次（同樣按「進階」→「前往」→「允許」）。`setup` 會替舊工作表補上新欄位，並新增 `comments`、`users` 工作表，**不會動到既有資料**。
8. 「部署」→「管理部署作業」→ 編輯（鉛筆）→ 版本選「**新版本**」→「部署」。網址不變。

### 步驟三：網站設定
把用戶端 ID 填進 `site/config.js` 的 `googleClientId`，推送到 GitHub 後網站就能登入編輯（Claude 可以代勞）。

## 更新 Code.gs（之後每次改版）
把 `Code.gs` 全部內容換掉 → 儲存 →「部署」→「管理部署作業」→ 編輯（鉛筆）→ 版本選「新版本」→「部署」。網址不變。

如果這次改版新增了欄位（例如 2026-10-28 的 `classes`），更新 `Code.gs` 後要先在編輯器選 `setup` →「執行」一次，替試算表補上新欄位，再部署新版本。沒有補欄位時，新欄位的資料會被忽略、不會寫入。

## 日常管理（在試算表裡）
- **隱藏不當的據點**：`nodes` 工作表該列的 `status` 改成 `hidden`。
- **隱藏不當的留言**：`comments` 工作表該列的 `status` 改成 `hidden`。
- **刪除測試留言**：留言者本人可以在網站上按留言旁的「刪除」（2026-10-28 起，需要部署新版 `Code.gs`）。管理者也可以在 `comments` 工作表把 `status` 改成 `deleted`，或直接刪除整列（留言沒有其他資料依賴它）。注意：「還在」的回報也會更新該筆資料的最後確認時間，刪除留言不會改回來。
- **還原被誤改的資料**：`log` 工作表記錄每次新增、修改、刪除、留言的前後內容與操作者的 Email。
- **不要直接刪除列或改欄位標題**，程式靠標題對應欄位。
- 通知信每天有寄送上限（一般 Google 帳號約 100 封），超過時當天不再通知，但寫入不受影響。

## 備份到 GitHub
網站已即時讀取試算表；`pipeline/portal.py` 改為定期把公開資料備份進 git：
```bash
.venv/bin/python pipeline/portal.py && .venv/bin/python pipeline/build_site.py
```

## 本機測試
- 網站加上 `?mock=1`（例如 `http://localhost:8765/?mock=1`）會改用存在瀏覽器裡的模擬後端，可以測試所有編輯功能，不會寫入試算表。
