"""臺北市地址轉座標：用臺北市門牌位置數值資料自建比對。

來源：臺北市政府民政局「臺北市門牌位置數值資料」，data.gov.tw 資料集 155472（約 115 萬筆，TWD97）
授權：政府資料開放授權條款第1版

比對層級（geocode_level）：
- exact：區＋路段＋巷＋弄＋號完全相同
- nearby_number：同一條巷弄找不到該號，取號碼最接近的門牌（同單雙號優先）
- lane：只對到巷弄，取該巷弄所有門牌的中心
- road：只對到路段，取該路段所有門牌的中心（誤差可能達數百公尺）
- 無法比對：lon / lat 為空
"""

from __future__ import annotations

import re

import numpy as np
import pandas as pd
from pyproj import Transformer

from common import RAW, datagov_distributions, download

DATASET_ID = 155472
INDEX_PATH = RAW / "geocode" / "doorplate_index.pkl"
TO_WGS84 = Transformer.from_crs(3826, 4326, always_xy=True)

FULLWIDTH = str.maketrans("０１２３４５６７８９－", "0123456789-")
ZH_DIGIT = {"零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
DISTRICTS = {
    "63000010": "松山區", "63000020": "信義區", "63000030": "大安區", "63000040": "中山區",
    "63000050": "中正區", "63000060": "大同區", "63000070": "萬華區", "63000080": "文山區",
    "63000090": "南港區", "63000100": "內湖區", "63000110": "士林區", "63000120": "北投區",
}


def zh_to_int(s: str) -> int | None:
    """中文數字轉整數：支援「二三」（逐字）與「二十三」「四十一」（十進位）兩種寫法。"""
    s = s.translate(FULLWIDTH)
    if s.isdigit():
        return int(s)
    if not s or any(c not in ZH_DIGIT and c not in "十百" for c in s):
        return None
    if "十" not in s and "百" not in s:
        return int("".join(str(ZH_DIGIT[c]) for c in s))
    total, num = 0, 0
    for c in s:
        if c in ZH_DIGIT:
            num = ZH_DIGIT[c]
        elif c == "十":
            total += (num or 1) * 10
            num = 0
        elif c == "百":
            total += (num or 1) * 100
            num = 0
    return total + num


NUM = r"[0-9０-９零〇一二三四五六七八九十百]+"
ADDRESS = re.compile(
    rf"(?:臺北市|台北市)?(?P<district>..區)?"
    rf"(?:[^\s路街道]{{1,4}}里(?!路|街))?(?:{NUM}鄰)?"
    rf"(?P<road>[^\s巷弄號]+?(?:路|街|大道)(?:{NUM}段)?)"
    rf"(?:(?P<lane>{NUM})巷)?(?:(?P<alley>{NUM})弄)?"
    # 號碼前可能有「臨」；多個號碼（5、7號；23、25及29號；11號至17號）取第一個
    rf"(?:臨?(?P<number>{NUM})(?:[、,，及和至~\-]{NUM})*(?:之(?P<sub>{NUM}))?號)?"
)
ZH_NUMERAL = "零一二三四五六七八九"


def normalize_road(road: str) -> str:
    """路段名稱統一：段號改阿拉伯數字；路名中的數字改中文（新湖1路 → 新湖一路）；臺／台統一為臺。"""
    road = road.replace("台", "臺").translate(FULLWIDTH)
    road = re.sub(r"^.{2}區", "", road)  # 地址重複寫區名時（「葫洲里內湖區永保街」）
    m = re.match(rf"^(.+?(?:路|街|大道))({NUM}段)?$", road)
    if not m:
        return road
    # 路名中的阿拉伯數字一律改中文（8德路 → 八德路、新湖1路 → 新湖一路），段號改阿拉伯數字
    name = re.sub(r"\d", lambda d: ZH_NUMERAL[int(d.group())], m.group(1))
    section = f"{zh_to_int(m.group(2)[:-1])}段" if m.group(2) else ""
    return name + section


def parse_address(addr: str) -> dict | None:
    if not isinstance(addr, str):
        return None
    addr = addr.replace(" ", "").replace("　", "")
    # 少數地址重複寫了「臺北市某某區」，取最後一次出現之後的部分
    last = max(addr.rfind("臺北市"), addr.rfind("台北市"))
    if last > 0:
        addr = addr[last:]
    m = ADDRESS.search(addr)
    if not m:
        return None
    to_int = lambda v: zh_to_int(v) if v else 0
    return {
        "district": m.group("district"),
        "road": normalize_road(m.group("road")),
        "lane": to_int(m.group("lane")),
        "alley": to_int(m.group("alley")),
        "number": to_int(m.group("number")),
        "sub": to_int(m.group("sub")),
    }


def build_index(force: bool = False) -> pd.DataFrame:
    """門牌索引快取在 doorplate_index.pkl；force=True 時重新下載門牌資料並重建。"""
    if INDEX_PATH.exists() and not force:
        return pd.read_pickle(INDEX_PATH)
    dist = datagov_distributions(DATASET_ID)[0]
    path = download(dist["resourceDownloadUrl"], RAW / "geocode" / "taipei_doorplates.csv", force=force)
    df = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    df = df[~df["號"].fillna("").str.contains("樓")]  # 同一門牌的各樓層座標相同，只留一筆
    num = df["號"].fillna("").str.translate(FULLWIDTH).str.extract(rf"^({NUM})(?:之({NUM}))?號")
    idx = pd.DataFrame(
        {
            "district": df["鄉鎮市區代碼"].map(DISTRICTS),
            "road": df["街路段"].fillna("").map(normalize_road),
            "lane": df["巷"].fillna("").str.translate(FULLWIDTH).str.extract(rf"({NUM})")[0].map(lambda v: zh_to_int(v) if isinstance(v, str) else 0),
            "alley": df["弄"].fillna("").str.translate(FULLWIDTH).str.extract(rf"({NUM})")[0].map(lambda v: zh_to_int(v) if isinstance(v, str) else 0),
            "number": num[0].map(lambda v: zh_to_int(v) if isinstance(v, str) else None),
            "sub": num[1].map(lambda v: zh_to_int(v) if isinstance(v, str) else 0),
            "x": df["橫座標"].astype(float),
            "y": df["縱座標"].astype(float),
        }
    )
    idx = idx.dropna(subset=["number"]).drop_duplicates(["district", "road", "lane", "alley", "number", "sub"])
    idx["number"] = idx["number"].astype(int)
    idx.to_pickle(INDEX_PATH)
    print(f"  門牌索引：{len(idx):,} 個門牌（不含樓層）")
    return idx


def geocode(addresses: pd.Series, index: pd.DataFrame | None = None) -> pd.DataFrame:
    """回傳與輸入同索引的 DataFrame：lon、lat、geocode_level。"""
    index = build_index() if index is None else index
    exact = index.set_index(["district", "road", "lane", "alley", "number", "sub"])[["x", "y"]]
    exact = exact[~exact.index.duplicated()]
    by_lane = {k: g for k, g in index.groupby(["district", "road", "lane", "alley"])}
    road_center = index.groupby(["district", "road"])[["x", "y"]].mean()

    out = []
    for addr in addresses:
        p = parse_address(addr)
        x = y = None
        level = None
        if p and p["district"] and p["road"]:
            key = (p["district"], p["road"], p["lane"], p["alley"], p["number"], p["sub"])
            lane_key = key[:4]
            if p["number"] and key in exact.index:
                x, y = exact.loc[key]
                level = "exact"
            elif lane_key in by_lane:
                g = by_lane[lane_key]
                if p["number"]:
                    same_parity = g[g["number"] % 2 == p["number"] % 2]
                    g2 = same_parity if len(same_parity) else g
                    row = g2.iloc[(g2["number"] - p["number"]).abs().argmin()]
                    x, y, level = row["x"], row["y"], "nearby_number"
                else:
                    x, y, level = g["x"].mean(), g["y"].mean(), "lane"
            elif (p["district"], p["road"]) in road_center.index:
                x, y = road_center.loc[(p["district"], p["road"])]
                level = "road"
        out.append((x, y, level))

    res = pd.DataFrame(out, columns=["x", "y", "geocode_level"], index=addresses.index)
    ok = res["x"].notna()
    lon, lat = TO_WGS84.transform(res.loc[ok, "x"].values, res.loc[ok, "y"].values)
    res["lon"] = np.nan
    res["lat"] = np.nan
    res.loc[ok, "lon"] = lon
    res.loc[ok, "lat"] = lat
    return res[["lon", "lat", "geocode_level"]]
