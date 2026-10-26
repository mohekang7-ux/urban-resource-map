"""村里教育程度：15 歲以上現住人口按性別、年齡、婚姻狀況及教育程度分。

來源：內政部戶政司，data.gov.tw 資料集 117988（108 年起，每年一個檔案）
授權：政府資料開放授權條款第1版
注意：
- 按戶籍統計。
- 全國原始檔約 1.2 GB，分批讀取，只留臺北市。
- 指標以 25 歲以上計算，避免把還在學的 15–24 歲算進「學歷」。
"""

from __future__ import annotations

import re

import pandas as pd

from common import RAW, TAIPEI_CODE, datagov_distributions, download, unzip

DATASET_ID = 117988
TERTIARY = {"博畢", "碩畢", "大畢", "專畢"}
SECONDARY = {"高中畢"}
BASIC = {"國中畢", "國小畢以下"}


def latest_distribution() -> tuple[str, dict]:
    """每年一個 CSV 壓縮檔，描述以民國年開頭（例如 114-）。"""
    candidates = []
    for dist in datagov_distributions(DATASET_ID):
        m = re.match(r"(\d{3})-", dist["resourceDescription"])
        if m and dist["resourceFormat"].upper() == "CSV":
            candidates.append((m.group(1), dist))
    return max(candidates, key=lambda c: c[0])


def fetch(force: bool = False) -> pd.DataFrame:
    year, dist = latest_distribution()
    zip_path = download(dist["resourceDownloadUrl"], RAW / "education" / f"education_{year}.zip", force=force)
    csv_path = RAW / "education" / f"opendata{year}Y051.csv"
    if force or not csv_path.exists():
        unzip(zip_path, RAW / "education")

    parts = []
    reader = pd.read_csv(
        csv_path,
        usecols=["district_code", "sex", "age", "edu", "population"],
        dtype={"district_code": str},
        skiprows=[1],  # 第二列是中文欄名
        chunksize=500_000,
    )
    for chunk in reader:
        parts.append(chunk[chunk["district_code"].str.startswith(TAIPEI_CODE)])
    df = pd.concat(parts)
    df["population"] = pd.to_numeric(df["population"], errors="coerce").fillna(0)
    df["age_lo"] = df["age"].str.extract(r"^(\d+)").astype(int)
    df = df[df["age_lo"] >= 25]

    def share(mask: pd.Series, by: list[str]) -> pd.Series:
        total = df.groupby(by)["population"].sum()
        part = df[mask].groupby(by)["population"].sum()
        return (part / total * 100).round(1)

    key = ["district_code"]
    out = pd.DataFrame(
        {
            "edu_pop_25_plus": df.groupby(key)["population"].sum(),
            "share_tertiary": share(df["edu"].isin(TERTIARY), key),
            "share_secondary": share(df["edu"].isin(SECONDARY), key),
            "share_basic": share(df["edu"].isin(BASIC), key),
            "share_graduate": share(df["edu"].isin({"博畢", "碩畢"}), key),
        }
    )
    by_sex = share(df["edu"].isin(TERTIARY), key + ["sex"]).unstack("sex")
    out["share_tertiary_m"] = by_sex["男"]
    out["share_tertiary_f"] = by_sex["女"]
    out["edu_year"] = year

    out = out.reset_index().rename(columns={"district_code": "village_code"})
    print(f"  臺北市村里教育程度：{len(out)} 個村里，{year} 年，25 歲以上大專以上比例中位數 {out['share_tertiary'].median():.1f}%")
    return out
