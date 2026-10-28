"""據點填報系統的匯入：讀取 Apps Script 的公開匯出（JSON），轉成 nodes / resources / intents。

python pipeline/portal.py

匯出網址放在 .env 的 PORTAL_EXPORT_URL（Apps Script 網頁應用程式網址加上 ?action=export）。
本機測試可改設 PORTAL_EXPORT_FILE 指向一個 JSON 檔。兩者都沒有設定時，略過匯入。

資料性質：據點自行填報（verification = 3，source = portal），未經團隊確認。
個人據點：匯出時已降低座標精度，這裡再把位置移到所在村里的中心點（個資原則）。
"""

from __future__ import annotations

import json
import os

import geopandas as gpd
import pandas as pd
import requests
from dotenv import load_dotenv

import schema
from common import HEADERS, PROCESSED, ROOT

OUT = PROCESSED / "field"


def load_export() -> dict | None:
    load_dotenv(ROOT / ".env")
    if os.getenv("PORTAL_EXPORT_FILE"):
        return json.loads((ROOT / os.environ["PORTAL_EXPORT_FILE"]).read_text(encoding="utf-8"))
    if os.getenv("PORTAL_EXPORT_URL"):
        resp = requests.get(os.environ["PORTAL_EXPORT_URL"], headers=HEADERS, timeout=60)
        resp.raise_for_status()
        return resp.json()
    return None


def snap_individuals_to_village(nodes: pd.DataFrame) -> pd.DataFrame:
    """個人據點：位置改為所在村里的中心點，並記錄村里代碼。"""
    villages = gpd.read_file(PROCESSED / "ogdl" / "taipei_villages.geojson", columns=["village_code"])
    pts = gpd.GeoDataFrame(nodes, geometry=gpd.points_from_xy(nodes["lon"], nodes["lat"]), crs=4326)
    joined = gpd.sjoin(pts, villages, how="left", predicate="within")
    joined = joined[~joined.index.duplicated()]
    nodes["village_code"] = joined["village_code"].values
    centers = villages.set_index("village_code").to_crs(3826).geometry.centroid.to_crs(4326)
    ind = (nodes["node_type"] == "individual") & nodes["village_code"].notna()
    nodes.loc[ind, "lon"] = nodes.loc[ind, "village_code"].map(centers.x)
    nodes.loc[ind, "lat"] = nodes.loc[ind, "village_code"].map(centers.y)
    return nodes


def main() -> int:
    data = load_export()
    if data is None:
        print("  未設定 PORTAL_EXPORT_URL 或 PORTAL_EXPORT_FILE，略過填報資料匯入")
        return 0
    vocab = schema.load_vocab()
    raw = pd.DataFrame(data["nodes"])
    if raw.empty:
        print("  填報系統目前沒有據點")
        for name in ("nodes_portal", "resources_portal", "intents_portal"):
            (OUT / f"{name}.csv").unlink(missing_ok=True)
        return 0

    nodes = pd.DataFrame({
        "node_id": raw["node_id"], "name": raw["name"], "node_type": raw["node_type"],
        "address": raw["address"].replace("", None), "lon": raw["lon"].astype(float), "lat": raw["lat"].astype(float),
        "needs": raw["needs"].map(lambda v: ";".join(v)), "description": raw["description"].replace("", None),
        "contact": raw["contact"].replace("", None),
        "source_category": "portal", "category_label": None, "business_id": None, "since_year": None,
        "status": "open", "confidence": "high", "verification": 3,
        "verified_at": raw["updated_at"].str[:10], "visibility": "public", "source": "portal", "license": "CC-BY-4.0",
        "geocode_level": "source",
    })
    nodes = snap_individuals_to_village(nodes)

    offers = pd.DataFrame(data["offers"])
    resources = pd.DataFrame({
        "resource_id": offers.get("offer_id", pd.Series(dtype=str)),
        "node_id": offers.get("node_id", pd.Series(dtype=str)),
        "item_id": offers.get("item_id", pd.Series(dtype=str)),
        "access": offers.get("access", pd.Series(dtype=str)),
        "note": offers.get("conditions", pd.Series(dtype=str)),
        "confidence": "high", "verification": 3,
        "verified_at": offers.get("updated_at", pd.Series(dtype=str)).str[:10], "source": "portal",
    })
    resources["class_id"] = resources["item_id"].map(vocab.items)

    wants = pd.DataFrame(data["wants"])
    intents = pd.DataFrame({
        "intent_id": wants.get("want_id", pd.Series(dtype=str)), "node_id": wants.get("node_id", pd.Series(dtype=str)),
        "direction": "need", "item_id": wants.get("item_id", pd.Series(dtype=str)),
        "status": wants.get("status", pd.Series(dtype=str)), "note": wants.get("note", pd.Series(dtype=str)),
        "verification": 3, "verified_at": wants.get("updated_at", pd.Series(dtype=str)).str[:10], "source": "portal",
    })
    intents = intents[intents["status"] != "fulfilled"]  # 已滿足的需求不再顯示（保留在試算表中）

    errors = schema.validate_nodes(nodes, vocab) + schema.validate_resources(resources, vocab, set(nodes["node_id"]))
    if errors:
        print("填報資料驗證失敗：")
        for e in errors:
            print(f"  - {e}")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    nodes.to_csv(OUT / "nodes_portal.csv", index=False)
    resources.to_csv(OUT / "resources_portal.csv", index=False)
    intents.to_csv(OUT / "intents_portal.csv", index=False)
    print(f"  填報系統：據點 {len(nodes)} 個（個人 {(nodes['node_type'] == 'individual').sum()}）、"
          f"提供 {len(resources)} 項、需要 {len(intents)} 項")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
