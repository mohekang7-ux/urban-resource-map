"""臺北市都市計畫使用分區圖（細部計畫），並歸成大類。

來源：臺北市都市發展局「臺北市都市計畫使用分區圖」，data.gov.tw 資料集 156197
授權：政府資料開放授權條款第1版
注意：
- SHP 沒有附 .prj。以台大、台北 101、台北車站、大安森林公園、松山機場比對，
  判定為 TWD97 TM2（EPSG:3826）。待向提供機關確認。
- 屬性表是 Big5（cp950）編碼。
- 使用分區是「規劃上允許的用途」，不等於實際用途。
"""

from __future__ import annotations

import geopandas as gpd

from common import RAW, datagov_distributions, download, unzip

DATASET_ID = 156197
SOURCE_CRS = 3826

# 依「使用分區」名稱歸類，依序比對，先符合者優先
CATEGORIES = [
    ("工業", ["工業", "產業專用"]),  # 含科技、資訊產業專用區
    ("住宅", ["住宅", "住"]),
    ("商業", ["商業", "商"]),
    ("特定專用區", ["特定專用區", "業務設施", "特定"]),
    ("農業與保護", ["農業", "保護", "風景"]),
    ("水域", ["河川", "行水", "水道"]),
    ("公共設施", ["用地", "公園綠地"]),
]


def categorize(zone: str | None) -> str:
    if not zone:
        return "其他"
    for name, keywords in CATEGORIES:
        if any(k in zone for k in keywords):
            return name
    return "其他"


def fetch(force: bool = False) -> gpd.GeoDataFrame:
    dist = next(d for d in datagov_distributions(DATASET_ID) if "細計" in d["resourceDescription"])
    zip_path = download(dist["resourceDownloadUrl"], RAW / "zoning" / "zoning_detail.zip", force=force)
    out_dir = unzip(zip_path, RAW / "zoning" / "detail")

    gdf = gpd.read_file(next(out_dir.glob("*面.shp")), encoding="cp950")
    gdf = gdf[gdf["使用分區"].notna()].set_crs(SOURCE_CRS).to_crs(4326)
    gdf = gdf[["分區代碼", "分區簡稱", "使用分區", "geometry"]].rename(
        columns={"分區代碼": "zone_code", "分區簡稱": "zone_short", "使用分區": "zone_name"}
    )
    gdf["zone_name"] = gdf["zone_name"].str.strip()  # 部分名稱帶有換行字元
    gdf["zone_category"] = gdf["zone_name"].map(categorize)
    print(f"  使用分區：{len(gdf)} 個多邊形")
    print("  大類統計：" + "、".join(f"{k} {v}" for k, v in gdf["zone_category"].value_counts().items()))
    return gdf
