"""公開資料據點：把各來源轉成 nodes（欄位定義見 data/schema/fields.csv）。

python pipeline/nodes.py [--force]

2026-10-27 決定：公開資料只記錄登記或標註上的事實（名稱、地址、登記類別），
**不推論據點有哪些資源**。資源（resources）只來自現地確認或使用者填寫。

來源（不含公司登記）：
- 商業登記：五金零售（41456）、五金批發（41449）、建材零售（82611）→ 依名稱與樓層標可信度
- 臺北市登記工廠（121252）：有座標，沒有產業類別
- 臺北市特定工廠清冊（140075）：有產業類別 → 地址轉座標
- OpenStreetMap：五金、工匠、創客空間、二手店、咖啡店（ODbL，另外存放；用來交叉比對）
- 據點範本 nodes/*.yaml（現地或使用者提供）

輸出（依授權分開）：
- data/processed/ogdl/nodes.csv
- data/processed/odbl/nodes_osm.csv
- data/processed/field/nodes_field.csv
"""

from __future__ import annotations

import json
import re
import sys
import time

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from pyproj import Transformer

import schema
from common import HEADERS, PROCESSED, RAW, datagov_distributions, download
from geocode import build_index, geocode

TWD97_TO_WGS84 = Transformer.from_crs(3826, 4326, always_xy=True)

GCIS_DATASETS = {41456: "gcis_f206010", 41449: "gcis_f106010", 82611: "gcis_building_retail"}
FACTORY_DATASET = 121252
SPECIAL_FACTORY_DATASET = 140075

# 可信度規則（見 docs/resource-database.md 第四節）
RELEVANT_NAME = r"五金|工具|建材|水電|油漆|螺絲|鐵|金屬|木|塑膠|電料|機械|鋼|鋁|材料|門窗|衛浴|磁磚|玻璃|器材|配件|零件"
OFFICE_NAME = r"貿易|國際|投資|顧問|管理|行銷|科技|資訊|地產|開發|娛樂|餐飲|生技|租賃|旅"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = """[out:json][timeout:180];
area["name"="臺北市"]["boundary"="administrative"]->.a;
(
  nwr["shop"~"^(hardware|doityourself|trade|tools|second_hand)$"](area.a);
  nwr["craft"~"^(carpenter|metal_construction|blacksmith|welder|electronics_repair|electrician|plumber|glaziery|upholsterer)$"](area.a);
  nwr["leisure"="hackerspace"](area.a);
  nwr["amenity"="cafe"](area.a);
);
out center tags meta;"""


def is_ground_floor(addr: str) -> bool:
    """地址沒寫樓層或在一樓。"""
    m = re.search(r"([0-9０-９]+|[一二三四五六七八九十]+)樓", str(addr).translate(str.maketrans("０１２３４５６７８９", "0123456789")))
    return m is None or m.group(1) in ("1", "一")


def crosswalk_lookup(vocab: schema.Vocab, source_type: str) -> dict[str, pd.Series]:
    rows = vocab.crosswalk[vocab.crosswalk["source_type"] == source_type]
    return {r["source_code"]: r for _, r in rows.iterrows()}


def base_node(**kw) -> dict:
    node = dict(address=None, village_code=None, business_id=None, since_year=None, verified_at=None,
                visibility="public", status="open", verification=1, category_label=None)
    node.update(kw)
    return node


# ---------- 各來源 ----------

def from_gcis(vocab: schema.Vocab, index: pd.DataFrame, force: bool) -> pd.DataFrame:
    xw = crosswalk_lookup(vocab, "gcis_dataset")
    frames = []
    for dataset_id, source in GCIS_DATASETS.items():
        url = datagov_distributions(dataset_id)[0]["resourceDownloadUrl"]
        df = pd.read_csv(download(url, RAW / "resources" / f"{source}.csv", force=force), dtype=str, encoding="utf-8-sig")
        df = df[df["商業地址"].fillna("").str.match(r"^(臺北市|台北市)") & (df["登記狀態"] == "核准設立")]
        df["source"], df["dataset_id"] = source, str(dataset_id)
        frames.append(df)
    df = pd.concat(frames)

    # 同一家商號可能出現在多個營業項目清單：依統一編號合併
    grouped = df.groupby("統一編號").agg(
        name=("商業名稱", "first"), address=("商業地址", "first"),
        source=("source", lambda s: ";".join(sorted(set(s)))),
        dataset_ids=("dataset_id", lambda s: sorted(set(s))),
    ).reset_index()
    # 同名同址但統一編號不同（多半是重新登記）：視為同一家，保留第一筆
    before = len(grouped)
    grouped = grouped.drop_duplicates(["name", "address"]).reset_index(drop=True)
    if before > len(grouped):
        print(f"  同名同址合併：{before - len(grouped)} 筆")

    relevant = grouped["name"].str.contains(RELEVANT_NAME)
    office = grouped["name"].str.contains(OFFICE_NAME)
    ground = grouped["address"].map(is_ground_floor)
    grouped["confidence"] = np.select([relevant & ground & ~office, (relevant | ground) & ~office], ["high", "medium"], "low")

    grouped = grouped.join(geocode(grouped["address"], index))

    nodes = []
    for _, r in grouped.iterrows():
        rows = [xw[d] for d in r["dataset_ids"]]
        nodes.append(base_node(
            node_id=f"gcis-{r['統一編號']}", name=r["name"], address=r["address"], lon=r["lon"], lat=r["lat"],
            geocode_level=r["geocode_level"], business_id=r["統一編號"],
            needs=";".join(sorted({n for x in rows for n in schema.split_list(x["needs"])})),
            source_category=";".join(f"gcis_dataset:{d}" for d in r["dataset_ids"]),
            category_label="、".join(x["label_zh"].replace("商業登記－", "") for x in rows) + "（商業登記）",
            confidence=r["confidence"], source=r["source"], license="OGDL-1.0",
        ))
    print(f"  商業登記：{len(nodes)} 家（高 {sum(n['confidence'] == 'high' for n in nodes)}、"
          f"中 {sum(n['confidence'] == 'medium' for n in nodes)}、低 {sum(n['confidence'] == 'low' for n in nodes)}）")
    return pd.DataFrame(nodes)


def from_factories(vocab: schema.Vocab, force: bool) -> pd.DataFrame:
    url = datagov_distributions(FACTORY_DATASET)[0]["resourceDownloadUrl"]
    df = pd.read_csv(download(url, RAW / "resources" / "tp_factories.csv", force=force), dtype=str, encoding="utf-8-sig")
    keywords = vocab.crosswalk[vocab.crosswalk["source_type"] == "factory_name_keyword"]
    lon, lat = TWD97_TO_WGS84.transform(df["ADDR_X"].astype(float).values, df["ADDR_Y"].astype(float).values)

    nodes = []
    for i, r in df.iterrows():
        # 這份資料沒有產業類別；需求分類依名稱推測，介面上只顯示「登記工廠」這個事實
        rule = next(k for _, k in keywords.iterrows() if re.search(k["source_code"], r["FACT_NAME"]))
        nodes.append(base_node(
            node_id=f"fac-{r['REGI_ID']}", name=r["FACT_NAME"], address=r["FACT_ADDR"], lon=lon[i], lat=lat[i],
            geocode_level="source", needs=rule["needs"],
            source_category=f"factory_name_keyword:{rule['label_zh']}", category_label="登記工廠（臺北市產業發展局）",
            status="unknown", confidence="medium", source="tp_factories", license="OGDL-1.0",
        ))
    print(f"  登記工廠：{len(nodes)} 家")
    return pd.DataFrame(nodes)


def from_special_factories(vocab: schema.Vocab, index: pd.DataFrame, force: bool) -> pd.DataFrame:
    url = datagov_distributions(SPECIAL_FACTORY_DATASET)[0]["resourceDownloadUrl"]
    df = pd.read_csv(download(url, RAW / "resources" / "tp_special_factories.csv", force=force), dtype=str, encoding="cp950")
    xw = crosswalk_lookup(vocab, "factory_industry")
    nodes = []
    for _, r in df.join(geocode(df["廠址"], index)).iterrows():
        industry = str(r["產業類別/2碼＿中類"]).split(",")[0]
        rule = xw.get(industry[:2])
        nodes.append(base_node(
            node_id=f"spf-{r['登記編號']}", name=r["工廠名稱"], address=r["廠址"], lon=r["lon"], lat=r["lat"],
            geocode_level=r["geocode_level"], needs=rule["needs"] if rule is not None else "make_repair",
            source_category=f"factory_industry:{industry[:2]}", category_label=f"{industry[2:]}（特定工廠登記）",
            since_year=1911 + int(r["登記核准日期"].split("/")[0]),
            status="open" if r["工廠現況"] == "生產中" else "unknown",
            confidence="high", source="tp_special_factories", license="OGDL-1.0",
        ))
    print(f"  特定工廠：{len(nodes)} 家")
    return pd.DataFrame(nodes)


def fetch_osm(force: bool) -> list[dict] | None:
    path = RAW / "resources" / "osm_taipei.json"
    if path.exists() and not force:
        try:
            return json.loads(path.read_text(encoding="utf-8"))["elements"]
        except (ValueError, KeyError):
            print("  OSM 快取損壞，重新抓取")
    for wait in (30, 60, 120):
        try:
            resp = requests.post(OVERPASS_URL, data={"data": OVERPASS_QUERY},
                                 headers={**HEADERS, "Accept": "application/json"}, timeout=240)
            resp.raise_for_status()
            elements = resp.json()["elements"]  # 確認是正確的 JSON 才寫入快取
            path.write_text(resp.text, encoding="utf-8")
            return elements
        except (requests.RequestException, ValueError) as e:
            print(f"  Overpass 失敗（{e.__class__.__name__}），{wait} 秒後重試", flush=True)
            time.sleep(wait)
    return None


def from_osm(vocab: schema.Vocab, force: bool) -> pd.DataFrame:
    elements = fetch_osm(force)
    if elements is None:
        print("  警告：OpenStreetMap 抓不到，本次略過（之後重跑會再試）")
        return pd.DataFrame()
    xw = crosswalk_lookup(vocab, "osm_tag")
    nodes = []
    for e in elements:
        tags = e.get("tags", {})
        tag = next((f"{k}={tags[k]}" for k in ("shop", "craft", "leisure", "amenity") if f"{k}={tags.get(k)}" in xw), None)
        if tag is None:
            continue
        rule = xw[tag]
        lon, lat = (e["lon"], e["lat"]) if "lon" in e else (e["center"]["lon"], e["center"]["lat"])
        addr = " ".join(tags.get(k, "") for k in ("addr:city", "addr:district", "addr:street", "addr:housenumber")).strip()
        nodes.append(base_node(
            node_id=f"osm-{e['type'][0]}{e['id']}", name=tags.get("name") or tags.get("name:zh") or rule["label_zh"],
            address=addr or None, lon=lon, lat=lat, geocode_level="source", needs=rule["needs"],
            source_category=f"osm_tag:{tag}", category_label=f"{rule['label_zh']}（OpenStreetMap）",
            confidence="low" if tag == "amenity=cafe" else "medium", source="osm", license="ODbL-1.0",
            verified_at=e.get("timestamp", "")[:10] or None,
        ))
    print(f"  OpenStreetMap：{len(nodes)} 筆")
    return pd.DataFrame(nodes)


INTENT_STATUS = {"missing": "缺", "partial": "部分有", "unknown": "待查"}


def from_templates() -> tuple[pd.DataFrame, pd.DataFrame]:
    """據點範本：據點本身，以及需求清單中還沒滿足的項目（缺、部分有、待查）作為需求（intents）。"""
    nodes, intents = [], []
    for path in sorted(schema.NODES_DIR.glob("*.yaml")):
        tpl = schema.load_node_template(path)
        n = dict(tpl["node"])
        n["needs"], n["source"] = ";".join(n["needs"]), ";".join(n["source"])
        n["verified_at"] = str(n.get("verified_at") or "")
        nodes.append(base_node(geocode_level="source", **n))
        for need in tpl.get("bill_of_needs", []):
            if need["status"] in INTENT_STATUS:
                intents.append(dict(intent_id=f"{n['node_id']}:need:{need['item_id']}", node_id=n["node_id"],
                                    direction="need", item_id=need["item_id"], status=need["status"],
                                    note=need.get("note"), verification=n["verification"], verified_at=n["verified_at"],
                                    source=n["source"]))
    print(f"  據點範本：{len(nodes)} 個，需求 {len(intents)} 項")
    return pd.DataFrame(nodes), pd.DataFrame(intents)


# ---------- 整合 ----------

def normalize_name(name: str) -> str:
    return re.sub(r"(股份)?有限公司|企業社|實業社|商行|工作室|行|號|社|\s|\(.*?\)|（.*?）", "", str(name))


def link_osm_duplicates(official: pd.DataFrame, osm: pd.DataFrame) -> pd.DataFrame:
    """OSM 和登記資料都有的據點：在 30 公尺內且名稱相近。
    OSM 那筆記下 duplicate_of，不重複顯示；登記那筆可信度提高為 high（兩個獨立來源都指出存在）。"""
    if osm.empty:
        return official
    to_m = Transformer.from_crs(4326, 3826, always_xy=True)
    ox, oy = to_m.transform(official["lon"].values, official["lat"].values)
    official_names = official["name"].map(normalize_name).values
    osm["duplicate_of"] = None
    for i, r in osm.iterrows():
        x, y = to_m.transform(r["lon"], r["lat"])
        n = normalize_name(r["name"])
        for j in np.where(np.hypot(ox - x, oy - y) < 30)[0]:
            if n and official_names[j] and (n in official_names[j] or official_names[j] in n):
                osm.at[i, "duplicate_of"] = official.iloc[j]["node_id"]
                official.iloc[j, official.columns.get_loc("confidence")] = "high"
                break
    print(f"  OSM 與登記資料重複：{osm['duplicate_of'].notna().sum()} 筆")
    return official


def assign_villages(nodes: pd.DataFrame) -> pd.DataFrame:
    villages = gpd.read_file(PROCESSED / "ogdl" / "taipei_villages.geojson", columns=["village_code"])
    has = nodes["lon"].notna()
    pts = gpd.GeoDataFrame(nodes[has], geometry=gpd.points_from_xy(nodes.loc[has, "lon"], nodes.loc[has, "lat"]), crs=4326)
    joined = gpd.sjoin(pts, villages, how="left", predicate="within")
    joined = joined[~joined.index.duplicated()]
    nodes.loc[has, "village_code"] = joined["village_code_right"] if "village_code_right" in joined else joined["village_code"]
    return nodes


def main(force: bool = False) -> int:
    vocab = schema.load_vocab()
    index = build_index()

    print("[1/5] 商業登記")
    gcis_nodes = from_gcis(vocab, index, force)
    print("[2/5] 登記工廠")
    fac_nodes = from_factories(vocab, force)
    print("[3/5] 特定工廠")
    spf_nodes = from_special_factories(vocab, index, force)
    print("[4/5] OpenStreetMap")
    osm_nodes = from_osm(vocab, force)
    print("[5/5] 據點範本")
    field_nodes, field_intents = from_templates()

    official = pd.concat([gcis_nodes, fac_nodes, spf_nodes], ignore_index=True)
    missing = official["lon"].isna().sum()
    if missing:
        print(f"  警告：{missing} 筆地址無法轉座標，不放上地圖")
    official = official[official["lon"].notna()].reset_index(drop=True)
    if not osm_nodes.empty:
        official = link_osm_duplicates(official, osm_nodes)
        osm_nodes = assign_villages(osm_nodes)
    official = assign_villages(official)
    if not field_nodes.empty:
        field_nodes = assign_villages(field_nodes)

    errors = schema.validate_nodes(official, vocab)
    if not field_nodes.empty:
        errors += schema.validate_nodes(field_nodes, vocab)
    if not osm_nodes.empty:
        errors += schema.validate_nodes(osm_nodes, vocab)
    if errors:
        print("驗證失敗：")
        for e in errors:
            print(f"  - {e}")
        return 1

    official.to_csv(PROCESSED / "ogdl" / "nodes.csv", index=False)
    (PROCESSED / "field").mkdir(exist_ok=True)
    for name, df in (("nodes_field.csv", field_nodes), ("intents_field.csv", field_intents)):
        if df.empty:
            (PROCESSED / "field" / name).unlink(missing_ok=True)  # 沒有據點範本時，不留舊檔
        else:
            df.to_csv(PROCESSED / "field" / name, index=False)
    if not osm_nodes.empty:
        (PROCESSED / "odbl").mkdir(exist_ok=True)
        osm_nodes.to_csv(PROCESSED / "odbl" / "nodes_osm.csv", index=False)
    print(f"完成：公開資料據點 {len(official)} 個（高可信 {(official['confidence'] == 'high').sum()}），"
          f"OSM {len(osm_nodes)} 筆，現地與使用者提供 {len(field_nodes)} 個；驗證通過")
    return 0


if __name__ == "__main__":
    sys.exit(main(force="--force" in sys.argv))
