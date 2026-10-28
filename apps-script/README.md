# 據點填報系統：部署說明

據點用這個網頁自行管理「我們提供的」與「我們需要的」資源；資料存在一份 Google 試算表，再由 `pipeline/portal.py` 匯入網站。設計說明見 `docs/node-portal.md`。

## 檔案
| 檔案 | 用途 |
|---|---|
| `Code.gs` | 後端：建立工作表、檢查與寫入資料、修改紀錄、公開匯出 |
| `Vocab.gs` | 詞表（需求分類、資源項目、取得方式），由 `pipeline/apps_script_vocab.py` 從 `data/schema/` 產生，請勿手動修改 |
| `Index.html` | 填報網頁 |
| `appsscript.json` | 專案設定：台北時區、網頁應用程式以部署者身分執行、任何人都能開啟 |

## 第一次部署（約 10 分鐘，用你的 Google 帳號）
1. 在 Google 雲端硬碟新增一份試算表，例如「台北製造能力地圖－據點資源庫」。
2. 在試算表選單點「擴充功能」→「Apps Script」，開啟綁定這份試算表的專案。
3. 建立四個檔案，內容分別貼上這個資料夾裡的檔案：
   - 預設的 `程式碼.gs`（或 `Code.gs`）→ 貼上 `Code.gs`；
   - 左側「＋」→「指令碼」，命名 `Vocab` → 貼上 `Vocab.gs`；
   - 左側「＋」→「HTML」，命名 `Index` → 貼上 `Index.html`；
   - 左側「專案設定」（齒輪）勾選「在編輯器中顯示『appsscript.json』資訊清單檔案」，回到編輯器打開 `appsscript.json` → 貼上。
4. 在編輯器上方的函式選單選 `setup`，按「執行」。第一次會要求授權：
   - 選你的帳號；
   - 看到「Google 尚未驗證這個應用程式」時，點「進階」→「前往（專案名稱）」。這是你自己的程式，只要求存取**這一份**試算表（`spreadsheets.currentonly`）。
   - 執行完，試算表會多出 `nodes`、`offers`、`wants`、`log` 四個工作表。
5. 右上角「部署」→「新增部署作業」→ 類型選「網頁應用程式」：
   - 執行身分：**我**；
   - 誰可以存取：**所有人**（不需登入）；
   - 按「部署」，複製「網頁應用程式網址」（結尾是 `/exec`）。
6. 這個網址就是據點填報網頁，可以分享給據點。
7. 在專案根目錄的 `.env` 加上一行（網址後面加 `?action=export`）：
   ```
   PORTAL_EXPORT_URL=https://script.google.com/macros/s/……/exec?action=export
   ```

## 更新程式後重新部署
修改 `Code.gs`、`Index.html`，或重新產生 `Vocab.gs` 之後：
1. 把新內容貼到 Apps Script 編輯器；
2. 「部署」→「管理部署作業」→ 選目前的部署 → 編輯（鉛筆）→ 版本選「新版本」→「部署」。

這樣網址不會改變。

## 日常管理（在試算表裡）
- **隱藏不當的據點**：把 `nodes` 工作表該列的 `status` 改成 `hidden`，下次匯入就不會出現在網站上。
- **還原被誤改的資料**：`log` 工作表記錄了每次新增、修改、刪除的前後內容（`before`、`after`）與填寫者的 Gmail。
- **不要直接刪除列或改欄位標題**，程式靠標題對應欄位。

## 更新網站
```bash
.venv/bin/python pipeline/portal.py && .venv/bin/python pipeline/build_site.py
```

## 本機測試填報網頁
不需要部署。用預覽設定 `portal-dev` 開啟 `http://localhost:8766/apps-script/Index.html`：偵測不到 Google 後端時，網頁會改用模擬後端，資料只存在瀏覽器裡，不會寫進試算表。
