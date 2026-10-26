"""把 data/processed 的成果轉成網站用的輕量檔案，輸出到 site/data/。

python pipeline/build_site.py（先跑過 run_all.py）

- 座標精度降到小數 5 位（約 1 公尺），使用分區再做輕度簡化，縮小檔案。
- meta.json 放各指標的全市中位數與資料年度，供網頁比較與標示。
"""

from __future__ import annotations

import json

import geopandas as gpd
import shapely

from common import PROCESSED, ROOT

SRC = PROCESSED / "ogdl"
OUT = ROOT / "site" / "data"

INDICATORS = [
    "pop_total", "pop_density", "share_65_plus", "share_0_14", "sex_ratio", "dependency_ratio", "aging_index",
    "share_tertiary", "share_tertiary_m", "share_tertiary_f", "share_graduate", "share_secondary", "share_basic",
    "income_median", "income_mean", "income_q1", "income_q3", "income_iqr",
]


def write_geojson(gdf: gpd.GeoDataFrame, path) -> None:
    gdf.to_file(path, driver="GeoJSON", layer_options={"COORDINATE_PRECISION": "5", "RFC7946": "YES"})
    print(f"  輸出：{path.relative_to(ROOT)}（{path.stat().st_size / 1e6:.1f} MB）")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    vil = gpd.read_file(SRC / "taipei_villages.geojson")
    pyramid_cols = [c for c in vil.columns if c.startswith("age_")]
    keep = ["village_code", "district", "village", "households", "pop_male", "pop_female", "area_km2"]
    vil = vil[keep + INDICATORS + pyramid_cols + ["geometry"]]
    write_geojson(vil, OUT / "villages.geojson")

    zon = gpd.read_file(SRC / "taipei_zoning.geojson")
    zon = zon.to_crs(3826)
    zon["geometry"] = shapely.make_valid(zon.geometry.values)
    zon["geometry"] = zon.geometry.simplify(0.5)  # 0.5 公尺
    zon = zon[~zon.geometry.is_empty].to_crs(4326)
    write_geojson(zon[["zone_name", "zone_category", "geometry"]], OUT / "zoning.geojson")

    periods = gpd.read_file(
        SRC / "taipei_villages.geojson", columns=["pop_period", "edu_year", "income_year"], ignore_geometry=True
    ).iloc[0]
    meta = {
        "periods": {
            "population": str(periods["pop_period"]),
            "education": str(periods["edu_year"]),
            "income": str(periods["income_year"]),
        },
        "taipei_median": {c: round(float(vil[c].median()), 1) for c in INDICATORS},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  輸出：{(OUT / 'meta.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
