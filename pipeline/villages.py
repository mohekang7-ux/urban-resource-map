"""村里界圖：下載全國村里界，篩出臺北市。

來源：內政部國土測繪中心「村里界圖(TWD97經緯度)」，data.gov.tw 資料集 7438
授權：政府資料開放授權條款第1版
"""

from __future__ import annotations

from urllib.parse import quote

import geopandas as gpd

from common import RAW, TAIPEI_CODE, datagov_distributions, download, unzip

DATASET_ID = 7438


def fetch(force: bool = False) -> gpd.GeoDataFrame:
    dist = datagov_distributions(DATASET_ID)[0]
    # 網址最後一段是中文檔名，要先編碼
    base, _, filename = dist["resourceDownloadUrl"].rpartition("/")
    url = f"{base}/{quote(filename)}"

    zip_path = download(url, RAW / "villages" / "villages.zip", force=force)
    out_dir = unzip(zip_path, RAW / "villages" / "extracted")

    # 壓縮檔裡另有其他圖檔，只取 VILLAGE_NLSC_*.shp
    shp = sorted(out_dir.glob("VILLAGE_NLSC_*.shp"))[-1]
    gdf = gpd.read_file(shp)
    gdf = gdf[gdf["COUNTYCODE"] == TAIPEI_CODE].copy()
    gdf = gdf.to_crs(4326)
    gdf = gdf[["VILLCODE", "TOWNNAME", "VILLNAME", "geometry"]].rename(
        columns={"VILLCODE": "village_code", "TOWNNAME": "district", "VILLNAME": "village"}
    )
    gdf["boundary_source"] = shp.stem
    print(f"  臺北市村里：{len(gdf)} 個（{shp.name}）")
    return gdf
