"""개별공시지가 필지를 PostGIS에 적재한다.

원본 SHP는 **시도 단위**로 배포된다(AL_D150_41_* = 경기도 전체).
따라서 시군구를 고르는 것은 필터일 뿐이며, 기본 동작은 폴더에 있는 전부를 넣는 것이다.

원본 특성(Task 1에서 확인):
  - 컬럼명이 A0~A19로 익명화되어 있다 (매핑은 COLUMNS 참고)
  - 면적(A13)이 1.14%에만 있어 geometry에서 계산한다
  - 지목(A12)도 1.14%뿐이라 A6 마지막 글자(지목부호)로 파싱한다
  - Polygon과 MultiPolygon이 섞여 있어 MultiPolygon으로 통일한다

실행:
    docker compose up -d
    source venv/bin/activate
    python load_parcels.py                     # 폴더 전체 (경기도 521만 건)
    python load_parcels.py --sigungu 41830     # 특정 시군구만
    python load_parcels.py --truncate          # 기존 데이터를 지우고 다시
"""

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

import psycopg
import pyogrio
from dotenv import load_dotenv
from shapely.geometry import MultiPolygon

ROOT = Path(__file__).parent.parent
OUT_DIR = Path(__file__).parent / "out"
SRC_CRS = 5186        # 원본. m 단위 투영좌표계라 면적 계산이 유효하다

"""
한 번에 읽을 행 수.

파일 하나가 87만 행이라 통째로 읽으면 GeoDataFrame이 수 GB로 부푼다.
시군구별 where 필터로 나누는 방법도 있으나 그러면 620MB dbf를 시군구 수만큼
다시 훑어 훨씬 느리다. 순차 청크가 읽기 비용과 메모리를 동시에 잡는다.
"""
CHUNK = 200_000

# 지목부호 → 지목명. A6의 마지막 글자가 이 부호다
JIMOK = {
    "전": "전", "답": "답", "과": "과수원", "목": "목장용지", "임": "임야",
    "광": "광천지", "염": "염전", "대": "대", "장": "공장용지", "학": "학교용지",
    "차": "주차장", "주": "주유소용지", "창": "창고용지", "도": "도로",
    "철": "철도용지", "제": "제방", "천": "하천", "구": "구거", "유": "유지",
    "양": "양어장", "수": "수도용지", "공": "공원", "체": "체육용지",
    "원": "유원지", "종": "종교용지", "사": "사적지", "묘": "묘지", "잡": "잡종지",
}

"""
읽을 컬럼.

시군구코드 A15는 일부러 쓰지 않는다. 원본이 수원시 4개 구를 모두 41110(시 단위)로
넣어두어 구 단위 구분이 사라지고, 실거래 API의 LAWD_CD 체계와도 어긋난다.
시군구코드는 PNU 앞 5자리에서 얻는다 — 그쪽이 법정동코드 원본이다.
"""
COLUMNS = "A0 A2 A3 A5 A6 A7 A9 A16 A17 A18 A19".split()

"""
연도별 공시지가가 담긴 컬럼.

원본은 한 행에 당해와 과거 4개년을 나란히 들고 있다. 컬럼명만으로는 어느 해인지
알 수 없어 값으로 판정했다 — 인접 연도를 비교하면 A16>A17>A18 순으로 과거이고,
A18(2023)이 A19(2022)보다 낮은 필지가 95.8%다. 2023년은 전국적으로 공시지가가
하락한 해이므로 이 배열이 맞다.

기준연도(A7)는 2026 하나뿐이라 A9가 당해다.
과거 자료를 더 받아 10년치가 되면 여기에 항목만 추가하면 된다.
"""
PRICE_YEAR_COLUMNS = {
    "A9": 2026,
    "A16": 2025,
    "A17": 2024,
    "A18": 2023,
    "A19": 2022,
}


def find_data_dirs() -> list[Path]:
    """AL_D150_<시도코드>_<배포일> 폴더를 찾는다.

    여러 개면(전국으로 넓힌 경우) 전부 돌려주고 순서대로 적재한다.
    """
    dirs = sorted(ROOT.glob("AL_D150_*"))
    dirs = [d for d in dirs if d.is_dir()]
    if not dirs:
        raise SystemExit(f"원본 폴더를 찾지 못했다: {ROOT}/AL_D150_*")
    return dirs


def shp_files(data_dir: Path) -> list[Path]:
    """폴더 안의 SHP 전부.

    원본은 용량 때문에 `이름.shp`, `이름(2).shp` ... 로 쪼개져 배포된다.
    파일 간 순서는 의미가 없으므로 이름순이면 충분하다.
    """
    files = sorted(data_dir.glob("*.shp"))
    if not files:
        raise SystemExit(f"SHP 없음: {data_dir}")
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

    주의: 수원시 장안구처럼 자치구가 있는 시는 토큰이 하나 더 붙어
    '경기도 수원시 장안구 파장동'이 된다. 이때 t[2]는 '장안구'라 읍면동이 아니다.
    구는 시군구 이름에 붙여 '수원시 장안구'로 두고 t[3]을 읍면동으로 본다 —
    그래야 화면의 행정구역 표기가 실제 주소와 같아진다.
    """
    addr = clean_str(addr)
    if not addr:
        return None, None, None, None
    t = addr.split()
    if len(t) >= 4 and t[2].endswith("구"):
        return t[0], f"{t[1]} {t[2]}", t[3], " ".join(t[4:]) or None
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


def dsn() -> str:
    return (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'ddotoro')} user={os.getenv('PGUSER', 'ddotoro')} "
        f"password={os.getenv('PGPASSWORD', 'ddotoro_local')}"
    )


def build_rows(gdf, only: set[str] | None, stats: Counter, unknown_jimok: Counter):
    """청크 하나를 DB 행으로 바꾼다. (parcel 행, 이력 행)을 돌려준다."""
    rows = []
    history: list[tuple[str, int, int | None]] = []

    for r in gdf.itertuples(index=False):
        pnu = clean_str(getattr(r, "A0", None))
        if not pnu:
            stats["pnu_없음"] += 1
            continue

        # 앞자리 일치로 거른다. '41830'은 양평군 하나, '4111'은 수원시 4개 구가 걸린다
        sigungu_cd = pnu[:5]
        if only is not None and not any(pnu.startswith(p) for p in only):
            continue

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
            pnu,
            sigungu_cd,
            sido, sigungu, emd, ri,
            make_jibun(getattr(r, "A3", None), getattr(r, "A5", None)),
            jimok,
            round(float(r.area_calc), 2),
            price,
            to_int(getattr(r, "A7", None)),
            geom.wkb_hex,
        ))

        # 한 행에 나란히 있는 연도별 지가를 연도마다 한 행으로 펼친다
        for col, year in PRICE_YEAR_COLUMNS.items():
            v = to_int(getattr(r, col, None))
            if v is None:
                stats[f"이력_결측_{year}"] += 1
            history.append((pnu, year, v))

    return rows, history


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sigungu", nargs="*", metavar="코드",
                    help="적재할 시군구 코드 5자리. 생략하면 원본 전체")
    ap.add_argument("--truncate", action="store_true",
                    help="기존 parcel 데이터를 지우고 시작한다")
    args = ap.parse_args()

    only = set(args.sigungu) if args.sigungu else None

    load_dotenv(ROOT / ".env")
    stats = Counter()
    unknown_jimok = Counter()

    with psycopg.connect(dsn()) as conn:
        with conn.cursor() as cur:
            # 이력 테이블은 컨테이너 최초 기동 이후에 추가된 것이라 여기서 만든다
            cur.execute((Path(__file__).parent / "sql" / "03_price_history.sql").read_text())
            conn.commit()

            if args.truncate:
                cur.execute("TRUNCATE parcel, parcel_price_history")
                conn.commit()
                print("기존 데이터 삭제 완료")

            cur.execute("SELECT count(*) FROM parcel")
            if cur.fetchone()[0] > 0:
                sys.exit("parcel 테이블이 비어있지 않다. 다시 적재하려면 --truncate를 붙일 것.")

        for data_dir in find_data_dirs():
            print(f"\n원본: {data_dir.name}")
            for path in shp_files(data_dir):
                total = pyogrio.read_info(path)["features"]
                done = 0

                while done < total:
                    gdf = pyogrio.read_dataframe(
                        path,
                        encoding="cp949",
                        columns=COLUMNS,
                        skip_features=done,
                        max_features=CHUNK,
                    )
                    done += len(gdf)
                    if len(gdf) == 0:
                        break

                    # 면적은 반드시 변환 '전'에 계산한다.
                    # 4326(경위도)에서 area를 재면 도(degree) 단위가 나와 값이 무의미해진다.
                    assert gdf.crs.to_epsg() == SRC_CRS, f"예상과 다른 CRS: {gdf.crs}"
                    # itertuples는 언더스코어로 시작하는 컬럼명을 위치 기반 이름으로 바꾼다.
                    # 컬럼명이 _area면 r._area로 접근할 수 없으므로 area_calc를 쓴다
                    gdf["area_calc"] = gdf.geometry.area
                    gdf = gdf.to_crs(4326)

                    rows, history = build_rows(gdf, only, stats, unknown_jimok)
                    del gdf

                    if rows:
                        with conn.cursor() as cur:
                            with cur.copy(
                                "COPY parcel (pnu, sigungu_cd, sido, sigungu, emd, ri, "
                                "jibun, jimok, area_sqm, price_per_sqm, price_year, geom) "
                                "FROM STDIN"
                            ) as copy:
                                for row in rows:
                                    copy.write_row(row)

                            # 이력은 parcel을 참조하므로 반드시 필지를 먼저 넣은 뒤에 넣는다
                            with cur.copy(
                                "COPY parcel_price_history (pnu, price_year, price_per_sqm) "
                                "FROM STDIN"
                            ) as copy:
                                for row in history:
                                    copy.write_row(row)
                        conn.commit()

                    stats["적재"] += len(rows)
                    stats["이력_적재"] += len(history)
                    print(f"  {path.name:35s} {done:>8,}/{total:,}"
                          f"  (누적 적재 {stats['적재']:,})", flush=True)

        create_indexes(conn)
        cleanup(conn)
        build_region_summary(conn)

    print("=" * 70)
    if stats:
        for k, v in sorted(stats.items()):
            print(f"  {k}: {v:,}")
    if unknown_jimok:
        print(f"  매핑 안 된 지목부호(저장 안 함): {dict(unknown_jimok)}")


def create_indexes(conn) -> None:
    """적재를 마친 뒤 인덱스를 만든다.

    COPY 도중에 GIST 인덱스를 유지하면 행마다 트리를 갱신해 몇 배 느려진다.
    521만 건에서는 이 순서가 전체 소요를 좌우한다.
    """
    stmts = [
        # 지도 bbox 조회용
        "CREATE INDEX IF NOT EXISTS idx_parcel_geom ON parcel USING GIST (geom)",
        # 시군구 단위 집계·필터용
        "CREATE INDEX IF NOT EXISTS idx_parcel_sigungu ON parcel (sigungu_cd)",
        # 읍면동 단위 집계용. 시도를 넘기면 읍면동 이름이 겹치므로 코드를 앞에 둔다
        "CREATE INDEX IF NOT EXISTS idx_parcel_emd ON parcel (sigungu_cd, emd)",
        # 검색용 ('서종면 245-7' 형태로 들어온다)
        "CREATE INDEX IF NOT EXISTS idx_parcel_search ON parcel (emd, jibun)",
    ]
    with conn.cursor() as cur:
        for s in stmts:
            print(f"  인덱스: {s.split()[5]} ...", flush=True)
            cur.execute(s)
            conn.commit()

        # 지역명 부분일치 검색용 trigram. 없으면 검색이 521만 건 Seq Scan이 된다
        print("  인덱스: 검색(trigram) ...", flush=True)
        cur.execute((Path(__file__).parent / "sql" / "06_search_index.sql").read_text())
        conn.commit()


def build_region_summary(conn) -> None:
    """지도 칩이 쓰는 지역 집계를 다시 굽는다.

    cleanup()으로 이상치를 지운 뒤에 실행해야 좌표 평균이 오염되지 않는다.
    """
    with conn.cursor() as cur:
        cur.execute((Path(__file__).parent / "sql" / "05_region_summary.sql").read_text())
        cur.execute("SELECT level, count(*) FROM region_summary GROUP BY level ORDER BY 1")
        for level, n in cur.fetchall():
            print(f"  region_summary {level}: {n:,}개")
    conn.commit()


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
        conn.commit()

        """
        좌표 이상치.

        시도별 bbox를 적어두면 지역을 넓힐 때마다 상수를 고쳐야 하므로,
        기준을 데이터 자신에게서 얻는다 — 같은 시군구 필지들의 중심점 중앙값에서
        경위도 1도(약 90~110km) 넘게 떨어진 필지는 원본 좌표 오류로 본다.
        가장 넓은 시군구(화성시)도 한 변이 50km를 넘지 않아 정상 필지가 걸리지 않는다.
        """
        cur.execute("""
            WITH c AS (
              SELECT sigungu_cd,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_X(ST_Centroid(geom))) AS mx,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY ST_Y(ST_Centroid(geom))) AS my
                FROM parcel
               GROUP BY sigungu_cd
            )
            DELETE FROM parcel p
             USING c
             WHERE p.sigungu_cd = c.sigungu_cd
               AND (abs(ST_X(ST_Centroid(p.geom)) - c.mx) > 1.0
                 OR abs(ST_Y(ST_Centroid(p.geom)) - c.my) > 1.0)
        """)
        print(f"  좌표 이상치 제거: {cur.rowcount:,}건")

        cur.execute("ANALYZE parcel")
    conn.commit()


if __name__ == "__main__":
    main()
