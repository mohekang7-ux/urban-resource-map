"""村里所得：綜稅綜合所得總額全國各縣市鄉鎮村里統計分析表。

來源：財政部財政資訊中心，data.gov.tw 資料集 103066（每年一個檔案）
授權：政府資料開放授權條款第1版
注意：
- 單位是千元，以「納稅單位（戶）」為單位統計。
- 只涵蓋綜合所得稅申報戶，不含政府移轉、免稅所得、分離課稅所得；按戶籍地統計。
- 呈現時以中位數為主，平均數容易被極高所得戶拉高。
- 檔案只有區名和村里名，沒有村里代碼，用「區＋村里名」和村里界對應。
"""

from __future__ import annotations

import re

import pandas as pd

from common import RAW, datagov_distributions, download

DATASET_ID = 103066


def latest_distribution() -> tuple[str, dict]:
    candidates = []
    for dist in datagov_distributions(DATASET_ID):
        m = re.match(r"(\d{3})年度", dist["resourceDescription"])
        if m and dist["resourceFormat"].upper() == "CSV":
            candidates.append((m.group(1), dist))
    return max(candidates, key=lambda c: c[0])


def fetch(force: bool = False) -> pd.DataFrame:
    year, dist = latest_distribution()
    path = download(dist["resourceDownloadUrl"], RAW / "income" / f"income_{year}.csv", force=force)
    df = pd.read_csv(path, encoding="utf-8-sig")
    df = df.rename(columns={df.columns[0]: "縣市別"})
    df = df[df["縣市別"].str.startswith("臺北市") & ~df["村里"].isin(["其他", "合計"])].copy()

    out = pd.DataFrame(
        {
            "district": df["縣市別"].str.replace("臺北市", "", regex=False),
            "village": df["村里"],
            "income_units": df["納稅單位(戶)"],
            "income_mean": df["平均數"],
            "income_median": df["中位數"],
            "income_q1": df["第一分位數"],
            "income_q3": df["第三分位數"],
        }
    )
    out["income_iqr"] = out["income_q3"] - out["income_q1"]  # 所得分散程度
    out["income_year"] = year
    print(f"  臺北市村里所得：{len(out)} 個村里，{year} 年度，中位數的中位數 {out['income_median'].median():.0f} 千元")
    return out
