"""村里人口：戶數、性別、單一年齡人口，計算人口結構指標。

來源：內政部戶政司「村里戶數、單一年齡人口（新增區域代碼）」，data.gov.tw 資料集 77132
授權：政府資料開放授權條款第1版
注意：按戶籍統計，不含沒有遷入戶籍的居民（例如許多學生與租屋族）。
"""

from __future__ import annotations

import re

import pandas as pd

from common import RAW, TAIPEI_CODE, datagov_distributions, download

DATASET_ID = 77132
AGE_COL = re.compile(r"^(\d+)歲(?:以上)?-(男|女)$")


def latest_distribution() -> tuple[str, dict]:
    """資料集每月新增一個資源，描述以民國年月開頭（例如 11509），取最新的一個。"""
    candidates = []
    for dist in datagov_distributions(DATASET_ID):
        m = re.match(r"(\d{5})", dist["resourceDescription"])
        if m and dist["resourceFormat"].upper() == "CSV":
            candidates.append((m.group(1), dist))
    return max(candidates, key=lambda c: c[0])


def fetch(force: bool = False) -> pd.DataFrame:
    yyymm, dist = latest_distribution()
    path = download(dist["resourceDownloadUrl"], RAW / "population" / f"village_age_sex_{yyymm}.csv", force=force)
    df = pd.read_csv(path, dtype={"區域別代碼": str, "統計年月": str})
    df = df[df["區域別代碼"].str.startswith(TAIPEI_CODE)].copy()

    age_cols = {c: AGE_COL.match(c) for c in df.columns}
    age_cols = {c: (int(m.group(1)), m.group(2)) for c, m in age_cols.items() if m}

    def age_sum(lo: int, hi: int | None = None) -> pd.Series:
        cols = [c for c, (age, _) in age_cols.items() if age >= lo and (hi is None or age <= hi)]
        return df[cols].sum(axis=1)

    out = pd.DataFrame(
        {
            "village_code": df["區域別代碼"],
            "pop_period": df["統計年月"],
            "households": df["戶數"],
            "pop_total": df["人口數"],
            "pop_male": df["人口數-男"],
            "pop_female": df["人口數-女"],
            "pop_0_14": age_sum(0, 14),
            "pop_15_64": age_sum(15, 64),
            "pop_65_plus": age_sum(65),
        }
    )
    out["sex_ratio"] = (out["pop_male"] / out["pop_female"] * 100).round(1)  # 每 100 位女性對應的男性數
    out["share_65_plus"] = (out["pop_65_plus"] / out["pop_total"] * 100).round(1)
    out["share_0_14"] = (out["pop_0_14"] / out["pop_total"] * 100).round(1)
    out["dependency_ratio"] = ((out["pop_0_14"] + out["pop_65_plus"]) / out["pop_15_64"] * 100).round(1)
    out["aging_index"] = (out["pop_65_plus"] / out["pop_0_14"] * 100).round(1)

    # 單一年齡分男女，供人口金字塔使用（5 歲一組）
    pyramid = {}
    for c, (age, sex) in age_cols.items():
        band = min(age // 5 * 5, 100)
        key = f"age_{band:03d}_{'m' if sex == '男' else 'f'}"
        pyramid.setdefault(key, []).append(c)
    for key in sorted(pyramid):
        out[key] = df[pyramid[key]].sum(axis=1).values

    print(f"  臺北市村里人口：{len(out)} 個村里，統計年月 {yyymm}，總人口 {out['pop_total'].sum():,}")
    return out
