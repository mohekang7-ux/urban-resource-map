"""從 data/schema/ 的詞表產生 apps-script/Vocab.gs，讓填報網頁與網站使用同一套分類。

python pipeline/apps_script_vocab.py
修改 data/schema/*.csv 之後執行，再把 Vocab.gs 更新到 Apps Script 專案。
"""

from __future__ import annotations

import json

import pandas as pd

from common import ROOT

SCHEMA = ROOT / "data" / "schema"
OUT = ROOT / "apps-script" / "Vocab.gs"


def main() -> None:
    vocab = {
        name: pd.read_csv(SCHEMA / f"{name}.csv", dtype=str).fillna("").to_dict(orient="records")
        for name in ("needs", "resource_classes", "resource_items", "access_modes")
    }
    body = json.dumps(vocab, ensure_ascii=False, indent=2)
    OUT.write_text(
        "/** 由 pipeline/apps_script_vocab.py 從 data/schema/ 產生，請勿手動修改。 */\n"
        f"const VOCAB = {body};\n",
        encoding="utf-8",
    )
    print(f"  輸出：{OUT.relative_to(ROOT)}（資源項目 {len(vocab['resource_items'])} 個）")


if __name__ == "__main__":
    main()
