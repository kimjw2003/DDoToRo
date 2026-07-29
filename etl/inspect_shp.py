"""Task 1: /etl/data 안의 개별공시지가 SHP 구조를 확인한다.

실행:
    source venv/bin/activate
    python inspect_shp.py <shp 파일명 또는 전체 경로>

인코딩은 cp949 -> euc-kr -> utf-8 순으로 시도한다.
"""

import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

DATA_DIR = Path(__file__).parent / "data"
ENCODINGS = ["cp949", "euc-kr", "utf-8"]


def find_shp(name: str | None) -> Path:
    if name:
        path = Path(name)
        if not path.is_absolute():
            path = DATA_DIR / name
        if not path.exists():
            sys.exit(f"파일을 찾을 수 없습니다: {path}")
        return path

    candidates = sorted(DATA_DIR.glob("*.shp"))
    if not candidates:
        sys.exit(f"{DATA_DIR} 안에 .shp 파일이 없습니다. SHP를 이 폴더에 넣고 다시 실행하세요.")
    if len(candidates) > 1:
        names = "\n  ".join(p.name for p in candidates)
        sys.exit(f"{DATA_DIR} 안에 .shp가 여러 개 있습니다. 파일명을 인자로 지정하세요:\n  {names}")
    return candidates[0]


def load_with_fallback(path: Path) -> gpd.GeoDataFrame:
    last_error = None
    for encoding in ENCODINGS:
        try:
            gdf = gpd.read_file(path, encoding=encoding)
            print(f"인코딩: {encoding} (성공)")
            return gdf
        except UnicodeDecodeError as e:
            last_error = e
            print(f"인코딩: {encoding} (실패, 다음 시도)")
    raise last_error


def main():
    shp_path = find_shp(sys.argv[1] if len(sys.argv) > 1 else None)
    print(f"파일: {shp_path}")
    print("=" * 60)

    gdf = load_with_fallback(shp_path)

    print("=" * 60)
    print(f"CRS: {gdf.crs}")
    print(f"전체 피처 수: {len(gdf)}")
    print(f"geometry 타입: {gdf.geometry.geom_type.unique().tolist()}")

    print("-" * 60)
    print("컬럼명과 dtype:")
    print(gdf.dtypes)

    print("-" * 60)
    print("상위 5행 샘플:")
    with pd.option_context("display.max_columns", None, "display.width", 200):
        print(gdf.head(5))


if __name__ == "__main__":
    main()
