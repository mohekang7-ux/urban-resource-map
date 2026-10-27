"""各里在「臺北市鄰里服務網」的官方頁面連結。

來源：臺北市政府民政局 臺北市鄰里服務網 https://li.taipei/
每個里的頁面有里公布欄、里長簡介、里基本資料等分頁。平台只連結過去，不複製里長個資，
資訊以官方頁面為準（里長每四年改選，115 年 11 月 28 日選舉）。
"""

from __future__ import annotations

import re

import pandas as pd
import requests

from common import HEADERS, RAW

INDEX_URL = "https://li.taipei/Default.aspx"
BASE_URL = "https://li.taipei/"
DISTRICT_BLOCK = re.compile(r'href="Default\.aspx#([^"]+?區)".*?<ul[^>]*>(.*?)</ul>', re.S)
VILLAGE_LINK = re.compile(r'href="cp\.aspx\?n=([0-9A-F]+)"\s+title="([^"]+?)"')


def _village_name(title: str) -> str | None:
    """連結標題通常是「莊敬里」，少數寫成「康樂里公布欄」。"""
    m = re.match(r"(.+?里)(公布欄)?$", title)
    return m.group(1) if m else None


def fetch(force: bool = False) -> pd.DataFrame:
    """回傳每個里頁面的 n 代碼、里名，以及能判定時的區別（判定不了的 district 為空）。"""
    path = RAW / "village_links" / "li_taipei_index.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    if force or not path.exists():
        print(f"  下載：{INDEX_URL}")
        resp = requests.get(INDEX_URL, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        path.write_text(resp.text, encoding="utf-8")
    else:
        print(f"  已存在，略過下載：{path.name}")
    html = path.read_text(encoding="utf-8")

    # 導覽選單中，區標題後面緊接的 <ul> 列出該區各里，可以確定區別
    district_of = {}
    for block in DISTRICT_BLOCK.finditer(html):
        for n, _ in VILLAGE_LINK.findall(block.group(2)):
            district_of.setdefault(n, block.group(1))

    # 有些里只出現在其他區塊（沒有區標題），先記下里名，之後用里名對應
    rows = {}
    for n, title in VILLAGE_LINK.findall(html):
        name = _village_name(title)
        if name and n not in rows:
            rows[n] = {"village": name, "district": district_of.get(n), "li_url": f"{BASE_URL}cp.aspx?n={n}"}
    out = pd.DataFrame(rows.values())
    print(f"  臺北市鄰里服務網：{len(out)} 個里的頁面連結（{out['district'].isna().sum()} 個需用里名對應）")
    return out


def attach(vil: pd.DataFrame, links: pd.DataFrame) -> pd.DataFrame:
    """先用「區＋里名」對應；沒有區別的連結，若里名在全市唯一，再用里名對應。"""
    known = links.dropna(subset=["district"])
    vil = vil.merge(known[["district", "village", "li_url"]], on=["district", "village"], how="left")

    unique_names = vil["village"].value_counts()
    unique_names = set(unique_names[unique_names == 1].index)
    fallback = links[links["district"].isna() & links["village"].isin(unique_names)].set_index("village")["li_url"]
    missing = vil["li_url"].isna()
    vil.loc[missing, "li_url"] = vil.loc[missing, "village"].map(fallback)
    return vil
