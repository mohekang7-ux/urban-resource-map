"""各里的行業組成：財政部財政資訊中心「全國營業(稅籍)登記資料集」。

來源：data.gov.tw 資料集 9400（只含營業中的營業人，每日更新）
授權：政府資料開放授權條款第1版

- 每家只算「主行業」（行業代號，6 碼稅務行業分類，前 2 碼即行業標準分類的中類），歸成 12 類；
  和本專案相關的 5 類（製造、修理、營建工程、建材五金、回收與環境）單獨列出（2026-10-31 使用者決定）。
- 「街面」：地址是 1 樓、地下室或沒寫樓層。辦公大樓樓上的登記多半是投資、貿易、顧問公司，網站提供切換。
- 歸到村里：地址寫的里名若和官方村里界相符就直接採用；否則用門牌地址轉座標（只採用門牌、
  鄰近門牌或巷弄層級，不採用只對到路段的結果），再和村里界套疊。都對不到的不計入。
- 家數不代表規模（沒有員工數與營業額），登記地址也不一定是實際作業地點。
"""

from __future__ import annotations

import re
import zipfile

import geopandas as gpd
import pandas as pd

from common import RAW, download
from geocode import FULLWIDTH, build_index, geocode

URL = "https://eip.fia.gov.tw/data/BGMOPEN1.zip"

# (代碼, 名稱)；順序就是網站圓餅圖的順序
CATEGORIES = [
    ("manufacturing", "製造"),
    ("repair", "修理"),
    ("construction", "營建工程"),
    ("building_materials", "建材五金"),
    ("recycling", "回收與環境"),
    ("wholesale", "批發"),
    ("retail", "零售"),
    ("food_lodging", "餐飲住宿"),
    ("transport", "運輸倉儲"),
    ("office", "辦公室服務"),
    ("personal", "個人與社區服務"),
    ("other", "其他"),
]

BUILDING_MATERIALS = {"4611", "4612", "4613", "4614", "4615", "4619", "4810"}  # 木材、砂石水泥、衛浴瓷磚、塗料、五金、其他建材批發；居家修繕用品零售


def classify(code: str) -> str:
    code = str(code or "")
    if code[:4] in BUILDING_MATERIALS:
        return "building_materials"
    d = int(code[:2]) if code[:2].isdigit() else -1
    if 8 <= d <= 33:
        return "manufacturing"
    if d in (34, 95):  # 產業用機械設備維修及安裝；個人及家庭用品維修（含汽機車）
        return "repair"
    if 41 <= d <= 43:
        return "construction"
    if 37 <= d <= 39:
        return "recycling"
    if d in (45, 46):
        return "wholesale"
    if d in (47, 48):
        return "retail"
    if d in (55, 56):
        return "food_lodging"
    if 49 <= d <= 54:
        return "transport"
    if 58 <= d <= 82:  # 資訊通訊、金融保險、不動產、專業科學技術、支援服務
        return "office"
    if 85 <= d <= 96:  # 教育、醫療社工、藝術娛樂、其他服務（不含 95 維修）
        return "personal"
    return "other"


FLOOR = re.compile(r"([0-9]+|[一二三四五六七八九十]+)樓")
ZH = {c: i for i, c in enumerate("零一二三四五六七八九")}


def _floor_value(s: str) -> int:
    if s.isdigit():
        return int(s)
    if s.startswith("十"):
        return 10 + ZH.get(s[1:], 0) if len(s) > 1 else 10
    if "十" in s:
        a, _, b = s.partition("十")
        return ZH.get(a, 0) * 10 + ZH.get(b, 0)
    return ZH.get(s, 0)


def is_street(address: str) -> bool:
    """1 樓、地下室或沒寫樓層；同一筆寫了多個樓層時取最低樓層。"""
    floors = [_floor_value(m) for m in FLOOR.findall(address.translate(FULLWIDTH))]
    return not floors or min(floors) <= 1


def load(force: bool = False) -> tuple[pd.DataFrame, str]:
    """回傳臺北市營業中的營業人（地址、主行業代號）與資料日期。"""
    path = download(URL, RAW / "industry" / "BGMOPEN1.zip", force=force)
    with zipfile.ZipFile(path) as zf:
        name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(name) as f:
            df = pd.read_csv(f, dtype=str, usecols=["營業地址", "統一編號", "行業代號"], keep_default_na=False)
    # 第一列資料是檔案日期（例如 31-OCT-26），其餘欄位空白
    date_row = df[df["統一編號"] == ""]
    date = pd.to_datetime(date_row["營業地址"].iloc[0], format="%d-%b-%y").strftime("%Y-%m-%d") if len(date_row) else ""
    df = df[(df["統一編號"] != "") & df["營業地址"].str.match(r"^[臺台]北市")].copy()
    df["營業地址"] = df["營業地址"].str.replace("台北市", "臺北市", regex=False)
    return df, date


def assign_villages(df: pd.DataFrame, villages: gpd.GeoDataFrame) -> pd.Series:
    official = set(zip(villages["district"], villages["village"]))
    code_of = dict(zip(zip(villages["district"], villages["village"]), villages["village_code"]))
    m = df["營業地址"].str.extract(r"^臺北市(..區)([^0-9０-９路街段巷弄號]{1,4}?里)")
    keys = list(zip(m[0], m[1]))
    codes = pd.Series([code_of.get(k) if k in official else None for k in keys], index=df.index, dtype=object)
    print(f"  地址寫有官方里名：{codes.notna().sum():,} 筆")

    rest = df.loc[codes.isna(), "營業地址"]
    unique = pd.Series(rest.unique())
    geo = geocode(unique, build_index())
    geo = geo[geo["geocode_level"].isin(["exact", "nearby_number", "lane"])]
    pts = gpd.GeoDataFrame(geo, geometry=gpd.points_from_xy(geo["lon"], geo["lat"]), crs=4326)
    joined = gpd.sjoin(pts, villages[["village_code", "geometry"]].to_crs(4326), how="inner", predicate="within")
    joined = joined[~joined.index.duplicated()]
    by_addr = dict(zip(unique.loc[joined.index], joined["village_code"]))
    codes.loc[rest.index] = rest.map(by_addr)
    print(f"  以門牌座標歸到里：{rest.map(by_addr).notna().sum():,} 筆；無法歸到里：{codes.isna().sum():,} 筆")
    return codes


def fetch(villages: gpd.GeoDataFrame, force: bool = False) -> pd.DataFrame:
    """回傳每個里各類的家數（ind_<類別>、ind_<類別>_street）與資料日期、涵蓋率。"""
    df, date = load(force)
    print(f"  臺北市營業中：{len(df):,} 筆（資料日期 {date}）")
    df["category"] = df["行業代號"].map(classify)
    df["street"] = df["營業地址"].map(is_street)
    df["village_code"] = assign_villages(df, villages)
    assigned = df.dropna(subset=["village_code"])

    cats = [c for c, _ in CATEGORIES]
    all_ = assigned.pivot_table(index="village_code", columns="category", values="street", aggfunc="size", fill_value=0)
    street = assigned[assigned["street"]].pivot_table(index="village_code", columns="category", values="street", aggfunc="size", fill_value=0)
    out = pd.concat(
        [all_.reindex(columns=cats, fill_value=0).add_prefix("ind_"),
         street.reindex(columns=cats, fill_value=0).add_prefix("ind_").add_suffix("_street")],
        axis=1,
    )
    out = out.reindex(villages["village_code"]).fillna(0).astype(int)
    out["ind_date"] = date
    out["ind_coverage"] = round(len(assigned) / len(df) * 100, 1)  # 歸到里的比例（%）
    return out.rename_axis("village_code").reset_index()
