"""共用工具：查詢 data.gov.tw 資料集、下載與解壓縮。"""

from __future__ import annotations

import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

DATAGOV_API = "https://data.gov.tw/api/v2/rest/dataset/{id}"
HEADERS = {"User-Agent": "urban-resource-map/0.1 (open data research pipeline)"}

# 臺北市的縣市代碼（村里界圖 COUNTYCODE、戶政區域別代碼的前 5 碼）
TAIPEI_CODE = "63000"


def datagov_distributions(dataset_id: int) -> list[dict]:
    """回傳 data.gov.tw 資料集的所有下載資源（含描述、格式、網址）。"""
    resp = requests.get(DATAGOV_API.format(id=dataset_id), headers=HEADERS, timeout=60)
    resp.raise_for_status()
    return resp.json()["result"]["distribution"]


def download(url: str, dest: Path, force: bool = False) -> Path:
    """下載檔案到 dest；已存在就略過，除非 force=True。"""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        print(f"  已存在，略過下載：{dest.relative_to(ROOT)}")
        return dest
    print(f"  下載：{url}")
    with requests.get(url, headers=HEADERS, timeout=300, stream=True) as resp:
        resp.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    print(f"  完成：{dest.relative_to(ROOT)}（{dest.stat().st_size / 1e6:.1f} MB）")
    return dest


def unzip(path: Path, dest_dir: Path) -> Path:
    """解壓縮到 dest_dir，回傳 dest_dir。處理 Big5 編碼的中文檔名。"""
    dest_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as zf:
        for info in zf.infolist():
            name = info.filename
            if not info.flag_bits & 0x800:  # 檔名不是 UTF-8
                try:
                    name = name.encode("cp437").decode("big5")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            target = dest_dir / name
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(target, "wb") as out:
                out.write(src.read())
    return dest_dir
