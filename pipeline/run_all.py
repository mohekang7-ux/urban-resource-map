"""執行所有資料管線：python pipeline/run_all.py [--force]

--force：重新下載原始資料（預設沿用 data/raw 裡已下載的檔案）
"""

from __future__ import annotations

import sys

import education
import income
import industry
import population
import village_links
import villages
import zoning
from common import PROCESSED

OUT = PROCESSED / "ogdl"  # 政府資料開放授權條款第1版的衍生資料


def report_missing(df, column: str, label: str) -> None:
    missing = df[column].isna()
    if missing.any():
        names = (df.loc[missing, "district"] + df.loc[missing, "village"]).tolist()
        print(f"  警告：{missing.sum()} 個村里沒有對到{label}：{names}")


def main(force: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    print("[1/6] 村里界")
    vil = villages.fetch(force)

    print("[2/6] 村里人口")
    pop = population.fetch(force)
    vil = vil.merge(pop, on="village_code", how="left")
    report_missing(vil, "pop_total", "人口資料")

    print("[3/6] 村里教育程度")
    edu = education.fetch(force)
    vil = vil.merge(edu, on="village_code", how="left")
    report_missing(vil, "share_tertiary", "教育程度資料")

    print("[4/6] 村里所得")
    inc = income.fetch(force)
    vil = vil.merge(inc, on=["district", "village"], how="left")
    report_missing(vil, "income_median", "所得資料")

    vil = village_links.attach(vil, village_links.fetch(force))
    vil = vil.merge(village_links.fetch_chief_links(vil[["li_url"]].dropna(), force), on="li_url", how="left")
    report_missing(vil, "li_chief_url", "里長簡介連結")
    report_missing(vil, "li_url", "鄰里服務網連結")

    print("[5/6] 各里行業組成（稅籍登記）")
    ind = industry.fetch(vil, force)
    vil = vil.merge(ind, on="village_code", how="left")

    vil["area_km2"] =(vil.to_crs(3826).area / 1e6).round(3)
    vil["pop_density"] = (vil["pop_total"] / vil["area_km2"]).round(0)  # 每平方公里人數

    vil.to_file(OUT / "taipei_villages.geojson", driver="GeoJSON")
    vil.drop(columns="geometry").to_csv(OUT / "taipei_village_indicators.csv", index=False)
    print(f"  輸出：{OUT / 'taipei_villages.geojson'}、taipei_village_indicators.csv")

    print("[6/6] 使用分區")
    zon = zoning.fetch(force)
    zon.to_file(OUT / "taipei_zoning.geojson", driver="GeoJSON")
    print(f"  輸出：{OUT / 'taipei_zoning.geojson'}")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
