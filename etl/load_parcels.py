"""Task 2: 양평군(41830) 필지를 PostGIS에 적재한다.

Task 1에서 확인한 원본 특성을 반영한다.
  - 컬럼명이 A0~A19로 익명화되어 있다 (매핑은 COLUMNS 참고)
  - 면적(A13)이 1.14%에만 있어 geometry에서 계산한다
  - 지목(A12)도 1.14%뿐이라 A6 마지막 글자(지목부호)로 파싱한다
  - Polygon과 MultiPolygon이 섞여 있어 MultiPolygon으로 통일한다

실행:
    docker compose up -d
    source venv/bin/activate && python load_parcels.py
"""

import os
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import psycopg
from dotenv import load_dotenv
from shapely.geometry import MultiPolygon

DATA_DIR = Path("/Users/kimjw/Documents/Project/DDoToRo/AL_D150_41_20260526")
OUT_DIR = Path(__file__).parent / "out"
SIGUNGU_CD = "41830"  # 양평군
SRC_CRS = 5186        # 원본. m 단위 투영좌표계라 면적 계산이 유효하다

# 지목부호 → 지목명. A6의 마지막 글자가 이 부호다
JIMOK = {
    "전": "전", "답": "답", "과": "과수원", "목": "목장용지", "임": "임야",
    "광": "광천지", "염": "염전", "대": "대", "장": "공장용지", "학": "학교용지",
    "차": "주차장", "주": "주유소용지", "창": "창고용지", "도": "도로",
    "철": "철도용지", "제": "제방", "천": "하천", "구": "구거", "유": "유지",
    "양": "양어장", "수": "수도용지", "공": "공원", "체": "체육용지",
    "원": "유원지", "종": "종교용지", "사": "사적지", "묘": "묘지", "잡": "잡종지",
}

COLUMNS = "A0 A2 A3 A5 A6 A7 A9 A15".split()


def shp_files() -> list[Path]:
    files = [DATA_DIR / "AL_D150_41_20260526.shp"]
    files += [DATA_DIR / f"AL_D150_41_20260526({i}).shp" for i in range(2, 7)]
    missing = [f for f in files if not f.exists()]
    if missing:
        raise SystemExit(f"파일 없음: {missing}")
    return files


def clean_str(v) -> str | None:
    """pandas 결측(NaN)은 float이라 `not v`가 False다.

    이 검사를 빼면 f-string에서 'nan' / '산nan' 같은 문자열이 그대로 저장된다.
    문자열 컬럼에 쓰기 전에 반드시 통과시킬 것.
    """
    if v is None:
        return None
    if isinstance(v, float) and v != v:  # NaN
        return None
    s = str(v).strip()
    return s if s and s.lower() != "nan" else None


def parse_addr(addr: str | None) -> tuple[str | None, str | None, str | None, str | None]:
    """'경기도 양평군 서종면 문호리' -> (경기도, 양평군, 서종면, 문호리)

    리가 없는 동 지역은 ri가 None이 된다.
    """
    addr = clean_str(addr)
    if not addr:
        return None, None, None, None
    t = addr.split()
    if len(t) >= 4:
        return t[0], t[1], t[2], " ".join(t[3:])
    if len(t) == 3:
        return t[0], t[1], t[2], None
    return (t + [None] * 4)[:4]


def make_jibun(san_yn, jibun) -> str | None:
    """산 필지는 '산22'처럼 표시한다. 지번이 결측이면 NULL."""
    jibun = clean_str(jibun)
    if not jibun:
        return None
    return f"산{jibun}" if clean_str(san_yn) == "2" else jibun


def to_int(v) -> int | None:
    """공시지가는 원 단위 정수로 저장한다. 결측은 NULL."""
    if v is None or (isinstance(v, float) and v != v):
        return None
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def main() -> None:
    load_dotenv(Path(__file__).parent.parent / ".env")
    dsn = (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'ddotoro')} user={os.getenv('PGUSER', 'ddotoro')} "
        f"password={os.getenv('PGPASSWORD', 'ddotoro_local')}"
    )

    stats = Counter()
    unknown_jimok = Counter()

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM parcel")
            if cur.fetchone()[0] > 0:
                sys.exit("parcel 테이블이 비어있지 않다. 재적재하려면 TRUNCATE 후 실행할 것.")

        for path in shp_files():
            gdf = gpd.read_file(
                path, encoding="cp949", engine="pyogrio", where=f"A15 = '{SIGUNGU_CD}'"
            )
            if len(gdf) == 0:
                print(f"{path.name:35s}      0건 (건너뜀)", flush=True)
                continue

            # 면적은 반드시 변환 '전'에 계산한다.
            # 4326(경위도)에서 area를 재면 도(degree) 단위가 나와 값이 무의미해진다.
            assert gdf.crs.to_epsg() == SRC_CRS, f"예상과 다른 CRS: {gdf.crs}"
            # itertuples는 언더스코어로 시작하는 컬럼명을 위치 기반 이름으로 바꾼다.
            # 컬럼명이 _area면 r._area로 접근할 수 없으므로 area_calc를 쓴다
            gdf["area_calc"] = gdf.geometry.area
            gdf = gdf.to_crs(4326)

            rows = []
            for r in gdf.itertuples(index=False):
                geom = r.geometry
                if geom is None or geom.is_empty:
                    stats["geom_없음"] += 1
                    continue
                # 스키마가 MultiPolygon이므로 Polygon을 감싸 통일한다
                if geom.geom_type == "Polygon":
                    geom = MultiPolygon([geom])
                elif geom.geom_type != "MultiPolygon":
                    stats[f"geom_타입_{geom.geom_type}"] += 1
                    continue

                sido, sigungu, emd, ri = parse_addr(getattr(r, "A2", None))

                jimok = None
                a6 = clean_str(getattr(r, "A6", None))
                if a6:
                    code = a6[-1:]
                    jimok = JIMOK.get(code)
                    if jimok is None and code:
                        # 매핑에 없는 부호는 집계만 하고 저장하지 않는다.
                        # 화면에 '가' 같은 값이 지목으로 노출되면 안 된다
                        unknown_jimok[code] += 1

                price = to_int(getattr(r, "A9", None))
                if price is None:
                    stats["지가_없음"] += 1

                rows.append((
                    getattr(r, "A0", None),
                    sido, sigungu, emd, ri,
                    make_jibun(getattr(r, "A3", None), getattr(r, "A5", None)),
                    jimok,
                    round(float(r.area_calc), 2),
                    price,
                    to_int(getattr(r, "A7", None)),
                    geom.wkb_hex,
                ))

            with conn.cursor() as cur:
                with cur.copy(
                    "COPY parcel (pnu, sido, sigungu, emd, ri, jibun, jimok, "
                    "area_sqm, price_per_sqm, price_year, geom) FROM STDIN"
                ) as copy:
                    for row in rows:
                        copy.write_row(row)
            conn.commit()

            stats["적재"] += len(rows)
            print(f"{path.name:35s} {len(rows):>7,}건 적재 (누적 {stats['적재']:,})", flush=True)

        cleanup(conn)

    print("=" * 70)
    if stats:
        for k, v in sorted(stats.items()):
            print(f"  {k}: {v:,}")
    if unknown_jimok:
        print(f"  매핑 안 된 지목부호(저장 안 함): {dict(unknown_jimok)}")


def cleanup(conn) -> None:
    """적재 후 원본 품질 문제를 정리한다."""
    with conn.cursor() as cur:
        # 자기교차 폴리곤. 두면 ST_Intersects 등 공간연산이 조용히 틀린 답을 낸다.
        # ST_MakeValid는 폴리곤과 선분 조각이 섞인 GeometryCollection을 돌려줄 수 있어
        # ST_CollectionExtract(..., 3)으로 폴리곤만 뽑아야 MultiPolygon 컬럼에 들어간다.
        cur.execute("SET client_min_messages TO WARNING")
        cur.execute("""
            UPDATE parcel
            SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
            WHERE NOT ST_IsValid(geom)
              AND NOT ST_IsEmpty(ST_CollectionExtract(ST_MakeValid(geom), 3))
        """)
        print(f"  geometry 보정(ST_MakeValid): {cur.rowcount:,}건")

        # 양평군 경계(위도 37.36~37.66, 경도 127.30~127.85)를 크게 벗어난 원본 오류.
        # 지도에 엉뚱한 위치로 찍히고 초기 bbox 계산까지 망가뜨리므로 제거한다
        cur.execute("""
            DELETE FROM parcel
            WHERE ST_YMax(geom) > 37.8 OR ST_YMin(geom) < 37.2
               OR ST_XMax(geom) > 128.0 OR ST_XMin(geom) < 127.1
        """)
        print(f"  좌표 이상치 제거: {cur.rowcount:,}건")

        cur.execute("ANALYZE parcel")
    conn.commit()


if __name__ == "__main__":
    main()
