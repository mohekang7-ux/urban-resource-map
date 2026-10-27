"""資源資料架構：載入受控詞表，並驗證 nodes / resources 資料與據點範本。

python pipeline/schema.py  檢查詞表、對照表與 nodes/*.yaml 彼此是否一致

詞表與欄位定義放在 data/schema/：
- needs.csv：據點的六類需求分類
- resource_classes.csv、resource_items.csv、access_modes.csv：資源類別、項目、取得方式
- category_crosswalk.csv：來源分類 → 需求分類與推論資源
- fields.csv：nodes / resources 的欄位定義
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

from common import ROOT

SCHEMA = ROOT / "data" / "schema"
NODES_DIR = ROOT / "nodes"
TAIPEI_BBOX = (121.4, 24.9, 121.7, 25.3)  # 經度、緯度範圍，用來抓明顯錯誤的座標


@dataclass
class Vocab:
    needs: set[str]
    classes: set[str]
    items: dict[str, str]  # item_id → class_id
    access: set[str]
    fields: pd.DataFrame
    crosswalk: pd.DataFrame


def load_vocab() -> Vocab:
    items = pd.read_csv(SCHEMA / "resource_items.csv", dtype=str)
    return Vocab(
        needs=set(pd.read_csv(SCHEMA / "needs.csv", dtype=str)["need_id"]),
        classes=set(pd.read_csv(SCHEMA / "resource_classes.csv", dtype=str)["class_id"]),
        items=dict(zip(items["item_id"], items["class_id"])),
        access=set(pd.read_csv(SCHEMA / "access_modes.csv", dtype=str)["access_id"]),
        fields=pd.read_csv(SCHEMA / "fields.csv", dtype=str),
        crosswalk=pd.read_csv(SCHEMA / "category_crosswalk.csv", dtype=str),
    )


def split_list(value) -> list[str]:
    """多值欄位以分號分隔；也接受 Python list（YAML 讀進來的）。"""
    if isinstance(value, list):
        return [str(v) for v in value]
    if value is None or (isinstance(value, float) and pd.isna(value)) or value == "":
        return []
    return [v.strip() for v in str(value).split(";") if v.strip()]


def parse_implied(spec) -> list[tuple[str, str]]:
    """把對照表的 implied_resources（item:access;item:access）拆成 (item_id, access)。"""
    return [tuple(part.split(":", 1)) for part in split_list(spec)]


def _enum_values(vocab: Vocab, table: str, field: str) -> set[str] | None:
    """fields.csv 的 allowed 欄若是以分號分隔的值，回傳允許值集合；否則（詞表檔名、範圍）回傳 None。"""
    allowed = vocab.fields.query("table == @table and field == @field")["allowed"].iloc[0]
    if isinstance(allowed, str) and ";" in allowed:
        return set(allowed.split(";"))
    return None


def validate_nodes(df: pd.DataFrame, vocab: Vocab) -> list[str]:
    errors = []
    required = vocab.fields.query("table == 'nodes' and required == 'yes'")["field"]
    for col in required:
        if col not in df.columns:
            errors.append(f"nodes 缺少欄位 {col}")
        elif df[col].isna().any():
            errors.append(f"nodes.{col} 有 {df[col].isna().sum()} 筆空值")
    if errors:
        return errors

    dup = df["node_id"][df["node_id"].duplicated()]
    if len(dup):
        errors.append(f"nodes.node_id 重複：{dup.head(5).tolist()}")
    for col in ("status", "confidence", "visibility", "license"):
        allowed = _enum_values(vocab, "nodes", col)
        bad = df.loc[~df[col].astype(str).isin(allowed), col] if allowed else []
        if len(bad):
            errors.append(f"nodes.{col} 有不在允許值內的值：{sorted(set(bad))[:5]}")
    bad_v = df.loc[~df["verification"].astype(str).isin({"0", "1", "2", "3"}), "verification"]
    if len(bad_v):
        errors.append(f"nodes.verification 有不合法的值：{sorted(set(bad_v))[:5]}")
    bad_needs = {n for v in df["needs"] for n in split_list(v)} - vocab.needs
    if bad_needs:
        errors.append(f"nodes.needs 有未定義的分類：{sorted(bad_needs)}")
    lon0, lat0, lon1, lat1 = TAIPEI_BBOX
    outside = df[~df["lon"].astype(float).between(lon0, lon1) | ~df["lat"].astype(float).between(lat0, lat1)]
    if len(outside):
        errors.append(f"nodes 有 {len(outside)} 筆座標超出臺北市範圍：{outside['node_id'].head(5).tolist()}")
    return errors


def validate_resources(df: pd.DataFrame, vocab: Vocab, node_ids: set[str] | None = None) -> list[str]:
    errors = []
    for col in vocab.fields.query("table == 'resources' and required == 'yes'")["field"]:
        if col not in df.columns:
            errors.append(f"resources 缺少欄位 {col}")
    if errors:
        return errors

    bad_items = set(df["item_id"]) - set(vocab.items)
    if bad_items:
        errors.append(f"resources.item_id 有未定義的項目：{sorted(bad_items)}")
    mismatch = df[df["item_id"].map(vocab.items).notna() & (df["item_id"].map(vocab.items) != df["class_id"])]
    if len(mismatch):
        errors.append(f"resources 有 {len(mismatch)} 筆 class_id 和項目的類別不符")
    bad_access = {a for v in df["access"] for a in split_list(v)} - vocab.access
    if bad_access:
        errors.append(f"resources.access 有未定義的取得方式：{sorted(bad_access)}")
    if node_ids is not None:
        orphan = set(df["node_id"]) - node_ids
        if orphan:
            errors.append(f"resources 有 {len(orphan)} 筆指向不存在的據點：{sorted(orphan)[:5]}")
    return errors


def check_vocab(vocab: Vocab) -> list[str]:
    """詞表彼此一致：項目的類別存在、對照表引用的分類與項目都存在。"""
    errors = []
    bad_class = {c for c in vocab.items.values()} - vocab.classes
    if bad_class:
        errors.append(f"resource_items.csv 引用了未定義的類別：{sorted(bad_class)}")
    for _, row in vocab.crosswalk.iterrows():
        where = f"category_crosswalk.csv（{row['source_type']} {row['source_code']}）"
        bad_needs = set(split_list(row["needs"])) - vocab.needs
        if bad_needs:
            errors.append(f"{where} 的 needs 未定義：{sorted(bad_needs)}")
        for item, access in parse_implied(row["implied_resources"]):
            if item not in vocab.items:
                errors.append(f"{where} 引用了未定義的項目：{item}")
            if access not in vocab.access:
                errors.append(f"{where} 引用了未定義的取得方式：{access}")
    return errors


def load_node_template(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def check_node_template(path: Path, vocab: Vocab) -> list[str]:
    tpl = load_node_template(path)
    node = pd.DataFrame([{**tpl["node"], "needs": ";".join(tpl["node"]["needs"]), "source": ";".join(tpl["node"]["source"])}])
    errors = [f"{path.name}：{e}" for e in validate_nodes(node, vocab)]
    statuses = {"have", "missing", "partial", "unknown"}
    for need in tpl.get("bill_of_needs", []):
        if need["item_id"] not in vocab.items:
            errors.append(f"{path.name}：需求清單的 {need['item_id']} 不在 resource_items.csv")
        if need.get("status") not in statuses:
            errors.append(f"{path.name}：{need['item_id']} 的 status 必須是 {sorted(statuses)}")
    return errors


def main() -> int:
    vocab = load_vocab()
    errors = check_vocab(vocab)
    for path in sorted(NODES_DIR.glob("*.yaml")):
        errors += check_node_template(path, vocab)

    print(f"需求分類 {len(vocab.needs)}、資源類別 {len(vocab.classes)}、資源項目 {len(vocab.items)}、"
          f"取得方式 {len(vocab.access)}、對照表 {len(vocab.crosswalk)} 列、據點範本 {len(list(NODES_DIR.glob('*.yaml')))} 個")
    for path in sorted(NODES_DIR.glob("*.yaml")):
        tpl = load_node_template(path)
        counts = pd.Series([n["status"] for n in tpl.get("bill_of_needs", [])]).value_counts().to_dict()
        print(f"  {tpl['node']['name']}：需求 {len(tpl['bill_of_needs'])} 項，狀態 {counts}")
    if errors:
        print("發現問題：")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("檢查通過")
    return 0


if __name__ == "__main__":
    sys.exit(main())
