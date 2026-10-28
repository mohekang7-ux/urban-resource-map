"""把 data/processed 的成果轉成網站用的輕量檔案，輸出到 site/data/。

python pipeline/build_site.py（先跑過 run_all.py）

- 座標精度降到小數 5 位（約 1 公尺），使用分區再做輕度簡化，縮小檔案。
- meta.json 放各指標的全市中位數與資料年度，供網頁比較與標示。
"""

from __future__ import annotations

import json

import geopandas as gpd
import pandas as pd
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
    keep = ["village_code", "district", "village", "li_url", "li_chief_url", "households", "pop_male", "pop_female", "area_km2"]
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

    export_nodes()
    export_vocab()


def _clean(v):
    return None if pd.isna(v) else v


def _display_category(label: str) -> str:
    """地圖與清單用的簡短類別；完整的登記項目另外保留在 category。"""
    if "特定工廠" in label:
        return "工廠：" + label.split("（")[0]
    has_hw, has_bm = "五金" in label, "建材" in label
    return "五金建材行" if has_hw and has_bm else "五金行" if has_hw else "建材行" if has_bm else label


def _write_features(dest, features) -> None:
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  輸出：{dest.relative_to(ROOT)}（{len(features)} 個據點，{dest.stat().st_size / 1e6:.2f} MB）")


def export_nodes() -> None:
    """網站用的據點，分兩種（2026-10-27 決定）：

    - nodes_reference.geojson：「公開資料（參考）」模式用。只放商業登記與工廠中**高可信**的據點，
      只有名稱、地址、登記類別等事實，不附任何推論的資源。
    - nodes_verified.geojson：「我附近有哪些夥伴？」模式用。只放現地確認或據點自行填報（verification ≥ 2）且公開的據點，
      附上供給 resources 與需求 wants；來源是 data/processed/field/ 下的 *_field.csv（據點範本）
      與 *_portal.csv（據點填報系統）。
    """
    for old in ("nodes_ogdl.geojson", "nodes_osm.geojson", "nodes_field.geojson"):
        (OUT / old).unlink(missing_ok=True)  # 舊版含推論資源的檔案

    ref = pd.read_csv(PROCESSED / "ogdl" / "nodes.csv", dtype={"village_code": str, "business_id": str})
    ref = ref[(ref["visibility"] == "public") & (ref["confidence"] == "high")]
    _write_features(OUT / "nodes_reference.geojson", [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(r.lon, 6), round(r.lat, 6)]},
         "properties": {"id": r.node_id, "name": r.name, "address": _clean(r.address), "category": r.category_label,
                        "display_category": _display_category(r.category_label),
                        "since_year": None if pd.isna(r.since_year) else int(r.since_year),
                        "geocode_level": r.geocode_level, "source": r.source, "village_code": _clean(r.village_code)}}
        for r in ref.itertuples()
    ])

    # 確認資料有兩個來源：據點範本（nodes/*.yaml → *_field.csv）與據點填報系統（pipeline/portal.py → *_portal.csv）
    def read_all(kind: str, columns: list[str]) -> pd.DataFrame:
        frames = [pd.read_csv(p, dtype={"village_code": str}) for p in sorted((PROCESSED / "field").glob(f"{kind}_*.csv"))]
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=columns)

    field = read_all("nodes", ["node_id"])
    field = field[(field["visibility"] == "public") & (field["verification"] >= 2)]
    res = read_all("resources", ["node_id", "item_id", "access", "note", "verified_at", "verification"])
    res = res[res["verification"] >= 2]
    res_by_node = {k: [{"item": r.item_id, "access": r.access, "note": _clean(r.note), "verified_at": _clean(r.verified_at)}
                       for r in g.itertuples()] for k, g in res.groupby("node_id")}
    intents = read_all("intents", ["node_id", "direction", "verification"])
    intents = intents[(intents["direction"] == "need") & (intents["verification"] >= 2)]
    needs_by_node = {k: [{"item": r.item_id, "status": r.status, "note": _clean(r.note)} for r in g.itertuples()]
                     for k, g in intents.groupby("node_id")}
    _write_features(OUT / "nodes_verified.geojson", [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(r.lon, 6), round(r.lat, 6)]},
         "properties": {"id": r.node_id, "name": r.name, "address": _clean(r.address), "needs": str(r.needs).split(";"),
                        "node_type": _clean(getattr(r, "node_type", None)), "description": _clean(getattr(r, "description", None)),
                        "contact": _clean(getattr(r, "contact", None)),
                        "verification": int(r.verification), "verified_at": _clean(r.verified_at), "source": r.source,
                        "village_code": _clean(r.village_code), "resources": res_by_node.get(r.node_id, []),
                        "wants": needs_by_node.get(r.node_id, [])}}
        for r in field.itertuples()
    ])


def export_vocab() -> None:
    """網站用的詞表：需求分類、資源類別、項目、取得方式。"""
    schema_dir = ROOT / "data" / "schema"
    vocab = {
        name: pd.read_csv(schema_dir / f"{name}.csv", dtype=str).fillna("").to_dict(orient="records")
        for name in ("needs", "resource_classes", "resource_items", "access_modes")
    }
    (OUT / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  輸出：{(OUT / 'vocab.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
