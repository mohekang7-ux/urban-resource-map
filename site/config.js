// 網站設定。部署方式見 apps-script/README.md。
window.APP_CONFIG = {
  // Apps Script 網頁應用程式網址（結尾 /exec）：讀取即時資料與寫入
  apiUrl: "https://script.google.com/macros/s/AKfycbyytoBLBgAYqEAVwUaRKv-MIxotpEwatsxttReO_OsdJwQ0AQzDp1R-UIVRxqBUT51S/exec",
  // Google Cloud 的 OAuth 用戶端 ID（「網頁應用程式」類型）；空白時網站維持唯讀
  googleClientId: "61432785443-5e3oncde6pimdltp73pd8nfid5msm0q9.apps.googleusercontent.com",
  // 超過幾天沒有人確認，就標示「可能已過時」（2026-10-28 決定：3 個月）
  staleDays: 90,
};
