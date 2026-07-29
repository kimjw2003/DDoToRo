"""Task 1: 분할된 경기도 개별공시지가 SHP 6개에서 양평군(41830)만 스캔해 리포트한다.

원본은 컬럼명이 A0~A19로 익명화되어 있다. 의미는 COLUMNS 참고.
면적(A13)이 1%대 행에만 있으므로 geometry 계산 면적과의 오차도 함께 리포트한다.

실행:
    source venv/bin/activate
    python scan_yangpyeong.py
"""

import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

DATA_DIR = Path("/Users/kimjw/Documents/Project/DDoToRo/AL_D150_41_20260526")
OUT_DIR = Path(__file__).parent / "out"
SIGUNGU_CD = "41830"  # 양평군

# A0~A19 컬럼 의미 (샘플 검증으로 확정)
COLUMNS = {
    "A0": "pnu",             # 19자리 필지고유번호
    "A1": "bjd_cd",          # 법정동코드 10자리
    "A2": "addr",            # 경기도 양평군 서종면 문호리
    "A3": "san_yn",          # 1=일반, 2=산
    "A4": "san_nm",          # 일반 / 산 / 블럭지번 / 가지번
    "A5": "jibun",           # 245-7
    "A6": "jibun_jimok",     # 245-7전  (마지막 글자가 지목부호)
    "A7": "price_year",      # 2026
    "A8": "price_month",     # 01
    "A9": "price_per_sqm",   # 개별공시지가 원/㎡
    "A10": "has_detail",     # '1'이면 A11~A13 존재
    "A11": "jimok_cd",       # 01=전, 02=답, 05=임야, 08=대 ...
    "A12": "jimok_nm",       # 전 / 답 / 임야 / 대 ...
    "A13": "area_sqm",       # 면적 ㎡ (극히 일부 행만 보유)
    "A14": "base_date",      # 데이터 기준일 2026-05-21
    "A15": "sigungu_cd",     # 41830
    "A16": "price_y1",       # 직전 연도 공시지가
    "A17": "price_y2",
    "A18": "price_y3",
    "A19": "price_y4",
}


def shp_files() -> list[Path]:
    """AL_D150_41_20260526.shp, ...(2).shp ... (6).shp 순서로 반환."""
    files = [DATA_DIR / "AL_D150_41_20260526.shp"]
    files += [DATA_DIR / f"AL_D150_41_20260526({i}).shp" for i in range(2, 7)]
    missing = [f for f in files if not f.exists()]
    if missing:
        raise SystemExit(f"파일 없음: {missing}")
    return files


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)
    parts = []

    for path in shp_files():
        gdf = gpd.read_file(
            path,
            encoding="cp949",
            engine="pyogrio",
            where=f"A15 = '{SIGUNGU_CD}'",
        )
        print(f"{path.name:35s} 양평군 {len(gdf):>7,}건", flush=True)
        parts.append(gdf)

    g = pd.concat(parts, ignore_index=True)
    g = gpd.GeoDataFrame(g, geometry="geometry", crs=parts[0].crs)
    print("=" * 70)
    print(f"양평군 합계(중복 포함): {len(g):,}건")

    # 분할 파일 간 PNU 중복 확인 — dbf 크기가 모두 같아 중복 배포 가능성이 있다
    dup = g["A0"].duplicated().sum()
    print(f"PNU 중복: {dup:,}건")
    g_unique = g.drop_duplicates(subset="A0", keep="first").copy()
    print(f"고유 PNU: {len(g_unique):,}건")

    # 지가 결측
    null_price = g_unique["A9"].isna()
    print(f"공시지가 NULL: {null_price.sum():,}건 ({null_price.mean() * 100:.2f}%)")

    # 면적: 제공값 vs geometry 계산값 (EPSG:5186 = m 단위 투영좌표계)
    g_unique["area_calc"] = g_unique.geometry.area
    has_area = g_unique["A13"].notna()
    print(f"면적 제공: {has_area.sum():,}건 ({has_area.mean() * 100:.2f}%)")
    if has_area.any():
        sub = g_unique[has_area]
        err = (sub["area_calc"] - sub["A13"]).abs() / sub["A13"] * 100
        print(f"  면적 오차 중앙값: {err.median():.2f}%")
        print(f"  오차 5% 이내: {(err < 5).mean() * 100:.2f}%")

    # geometry 타입
    print(f"geometry 타입: {g_unique.geometry.geom_type.value_counts().to_dict()}")

    # 지목: A6 마지막 글자가 지목부호
    jimok = g_unique["A6"].dropna().str.strip().str[-1]
    print(f"지목 종류: {jimok.nunique()}종")

    # 읍면동 분해 — '경기도 양평군 서종면 문호리'
    addr_parts = g_unique["A2"].str.split()
    g_unique["emd"] = addr_parts.str[2]
    print(f"읍면동: {g_unique['emd'].nunique()}개 — {sorted(g_unique['emd'].dropna().unique())}")

    # 검증용 샘플 20건을 WGS84 GeoJSON으로 저장
    sample = g_unique.dropna(subset=["A9"]).sample(20, random_state=42).to_crs(4326)
    sample_path = OUT_DIR / "sample.geojson"
    sample[["A0", "A2", "A5", "A6", "A9", "area_calc", "geometry"]].to_file(
        sample_path, driver="GeoJSON"
    )
    print(f"샘플 저장: {sample_path}")

    # 리포트 저장
    report = {
        "sigungu_cd": SIGUNGU_CD,
        "total_rows": int(len(g)),
        "duplicate_pnu": int(dup),
        "unique_pnu": int(len(g_unique)),
        "null_price_pct": round(float(null_price.mean() * 100), 4),
        "area_provided_pct": round(float(has_area.mean() * 100), 4),
        "geom_types": {k: int(v) for k, v in g_unique.geometry.geom_type.value_counts().items()},
        "emd_list": sorted(g_unique["emd"].dropna().unique().tolist()),
        "jimok_counts": jimok.value_counts().to_dict(),
        "columns": COLUMNS,
    }
    report_path = OUT_DIR / "task1_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"리포트 저장: {report_path}")


if __name__ == "__main__":
    main()
