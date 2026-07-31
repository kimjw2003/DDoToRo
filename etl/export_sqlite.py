"""PostGIS 데이터를 SQLite 한 파일로 내보낸다 (Turso 배포용).

Turso는 SQLite라 PostGIS가 없다. 그래서 공간 연산을 '적재 시점'으로 옮긴다 —
중심점·bbox·분위수를 미리 계산해 컬럼으로 굳히고, 웹에서는 단순 조회만 한다.
ST_MakeValid 같은 정제는 여전히 PostGIS(로컬)가 맡으므로 ETL은 그대로 둔다.

  PostGIS                        SQLite
  ─────────────────────────────  ──────────────────────────────
  geom && ST_MakeEnvelope(...)   R-tree(minx,maxx,miny,maxy)
  ST_AsGeoJSON(geom)             geojson 컬럼에 미리 문자열로
  ST_Centroid / ST_X / ST_Y      lng·lat 컬럼
  percentile_cont                region_summary에 구워서
  ILIKE + pg_trgm                FTS5

실행:
    python export_sqlite.py --limit 100000   # 표본으로 크기만 재본다
    python export_sqlite.py                  # 전체
"""

import argparse
import json
import pathlib
import os
import sqlite3
import time
from decimal import Decimal
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
OUT = Path(__file__).parent / "out" / "ddotoro.db"

# 좌표 소수점 자릿수. 6자리면 약 10cm이며 필지 경계 표시에 충분하다.
# 텍스트로 저장하므로 자릿수가 곧 용량이다 — 7자리로 올리면 파일이 그만큼 커진다
COORD_PRECISION = 6

BATCH = 20_000

SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE parcel (
  -- R-tree는 정수 키로만 조인된다. PNU는 19자리 문자열이라 rowid를 따로 둔다
  id            INTEGER PRIMARY KEY,
  pnu           TEXT NOT NULL,
  sigungu_cd    TEXT,
  sido          TEXT,
  sigungu       TEXT,
  emd           TEXT,
  ri            TEXT,
  jibun         TEXT,
  jimok         TEXT,
  area_sqm      REAL,
  price_per_sqm INTEGER,
  price_year    INTEGER,
  -- 중심점. PostGIS ST_Centroid를 대신한다
  lng           REAL,
  lat           REAL,
  /*
    경계상자.

    R-tree 가상 테이블이 더 빠르지만 쓸 수 없다 — sqlite3의 .dump가 가상 테이블을
    `INSERT INTO sqlite_schema(...)`로 내보내는데, 이는 방어 모드를 꺼야 실행되는
    구문이라 Turso가 거부한다. Turso는 SQLite 파일이 아니라 덤프만 받으므로
    일반 컬럼 + B-tree 인덱스로 대신한다.
  */
  minx          REAL,
  maxx          REAL,
  miny          REAL,
  maxy          REAL,
  -- 지도·상세가 그대로 내려보내는 값이라 문자열로 굳혀 둔다
  geojson       TEXT,
  -- [[연도, 원/㎡], ...] 2,600만 행짜리 이력 테이블을 필지당 한 칸으로 접은 것
  price_history TEXT
);

CREATE TABLE land_trade (
  sigungu_cd  TEXT,
  emd         TEXT,
  ri          TEXT,
  deal_ym     TEXT,
  deal_day    INTEGER,
  deal_amount INTEGER,
  area_sqm    REAL,
  jimok       TEXT,
  share_type  TEXT,
  cancel_type TEXT
);

-- PostGIS 뷰(emd_trade_avg)를 테이블로 구운 것. SQLite에는 percentile_cont가 없다
CREATE TABLE emd_trade_avg (
  sigungu_cd           TEXT,
  emd                  TEXT,
  deal_count           INTEGER,
  avg_price_per_sqm    INTEGER,
  median_price_per_sqm INTEGER,
  from_ym              TEXT,
  to_ym                TEXT
);

-- 시군구 단위 실거래 집계.
-- 읍면동 중앙값의 평균이 아니라 거래 전체에서 다시 구한 값이다 —
-- 읍면동마다 표본 수가 크게 달라 평균을 내면 거래가 드문 동네가 같은 무게를 갖는다
CREATE TABLE sigungu_trade_avg (
  sigungu_cd           TEXT,
  deal_count           INTEGER,
  median_price_per_sqm INTEGER
);

CREATE TABLE region_summary (
  level           TEXT,
  sigungu_cd      TEXT,
  name            TEXT,
  sido            TEXT,
  sigungu         TEXT,
  lng             REAL,
  lat             REAL,
  parcel_count    INTEGER,
  median_official INTEGER
);
"""

INDEXES = """
CREATE UNIQUE INDEX idx_parcel_pnu ON parcel(pnu);
CREATE INDEX idx_parcel_jibun      ON parcel(jibun);
CREATE INDEX idx_trade_emd         ON land_trade(sigungu_cd, emd, deal_ym);
CREATE INDEX idx_emd_trade_key     ON emd_trade_avg(sigungu_cd, emd);
CREATE INDEX idx_region_level      ON region_summary(level);

/*
  bbox 조회.

  선두 컬럼을 minx로 둔다. 지도 화면은 경도 폭이 좁아 `minx <= 화면동단`으로
  범위를 먼저 자르는 것이 가장 크게 줄인다. 나머지 세 조건은 인덱스에 실려 있어
  테이블을 읽지 않고 걸러진다(커버링).
*/
CREATE INDEX idx_parcel_bbox ON parcel(minx, maxx, miny, maxy, id);

/*
  지역명 검색.

  FTS5도 가상 테이블이라 쓸 수 없다. 대신 이름 컬럼마다 인덱스를 두고
  완전일치·앞자리일치로 찾는다. '%서종%'처럼 가운데를 여는 검색은 포기하지만,
  실제 입력은 '서종면 245-7'처럼 이름 앞부터 치므로 앞자리 일치로 충분하다.
*/
CREATE INDEX idx_parcel_emd     ON parcel(emd);
CREATE INDEX idx_parcel_ri      ON parcel(ri);
CREATE INDEX idx_parcel_sigungu ON parcel(sigungu);
"""


def dsn() -> str:
    return (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'ddotoro')} user={os.getenv('PGUSER', 'ddotoro')} "
        f"password={os.getenv('PGPASSWORD', 'ddotoro_local')}"
    )


def export_parcels(pg, db, limit: int | None, precision: int, simplify: float) -> int:
    """필지 + 이력 + bbox를 한 번에 읽어 옮긴다.

    precision을 낮추거나 simplify를 켜면 파일이 작아진다. 파일 크기는 곧
    Turso 업로드·복원 시간이므로, 3.5GB가 버거울 때 줄이는 손잡이다.
    경계상자(minx…maxy)는 반드시 '원본' geometry에서 뽑는다 —
    단순화한 도형에서 재면 상자가 원본보다 작아져 조회에서 필지가 누락된다.
    """
    geom = "p.geom"
    if simplify > 0:
        geom = f"ST_SimplifyPreserveTopology(p.geom, {simplify})"

    sql = f"""
        SELECT p.pnu, p.sigungu_cd, p.sido, p.sigungu, p.emd, p.ri,
               p.jibun, p.jimok, p.area_sqm, p.price_per_sqm, p.price_year,
               ST_X(ST_Centroid(p.geom)) AS lng,
               ST_Y(ST_Centroid(p.geom)) AS lat,
               ST_XMin(p.geom) AS minx, ST_XMax(p.geom) AS maxx,
               ST_YMin(p.geom) AS miny, ST_YMax(p.geom) AS maxy,
               ST_AsGeoJSON({geom}, {precision}) AS geojson,
               (SELECT json_agg(json_build_array(h.price_year, h.price_per_sqm)
                                ORDER BY h.price_year)
                  FROM parcel_price_history h WHERE h.pnu = p.pnu) AS hist
          FROM parcel p
         ORDER BY p.pnu
    """
    if limit:
        sql += f" LIMIT {limit}"

    n = 0
    rows = []
    with pg.cursor(name="export") as cur:   # 서버 커서 — 521만 행을 메모리에 올리지 않는다
        cur.itersize = BATCH
        cur.execute(sql)
        for r in cur:
            n += 1
            (pnu, sgg, sido, sigungu, emd, ri, jibun, jimok, area, price, year,
             lng, lat, minx, maxx, miny, maxy, gj, hist) = r

            rows.append((
                n, pnu.strip() if pnu else None,
                sgg.strip() if sgg else None,
                sido, sigungu, emd, ri, jibun, jimok,
                float(area) if area is not None else None,
                price, year, lng, lat,
                minx, maxx, miny, maxy, gj,
                json.dumps(hist, separators=(",", ":")) if hist else None,
            ))

            if len(rows) >= BATCH:
                flush(db, rows)
                rows = []
                print(f"  {n:,}건", end="\r", flush=True)

    flush(db, rows)
    print(f"  필지 {n:,}건 완료      ")
    return n


def flush(db, rows) -> None:
    if not rows:
        return
    db.executemany(
        "INSERT INTO parcel (id,pnu,sigungu_cd,sido,sigungu,emd,ri,jibun,jimok,"
        "area_sqm,price_per_sqm,price_year,lng,lat,minx,maxx,miny,maxy,"
        "geojson,price_history) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    db.commit()


def copy_table(pg, db, select: str, insert: str, label: str) -> None:
    with pg.cursor() as cur:
        cur.execute(select)
        rows = cur.fetchall()
    if rows:
        # psycopg는 NUMERIC을 Decimal로 준다. sqlite3는 Decimal을 바인딩하지 못한다
        rows = [tuple(float(v) if isinstance(v, Decimal) else v for v in r) for r in rows]
        db.executemany(insert, rows)
        db.commit()
    print(f"  {label} {len(rows):,}건")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="표본 크기 측정용")
    ap.add_argument("--out", default=str(OUT), help="출력 파일 경로")
    ap.add_argument("--precision", type=int, default=COORD_PRECISION,
                    help="좌표 소수 자릿수. 6=약 10cm, 5=약 1m")
    ap.add_argument("--simplify", type=float, default=0.0,
                    help="도형 단순화 허용오차(도). 0.000005면 약 0.5m")
    args = ap.parse_args()
    out = pathlib.Path(args.out)

    load_dotenv(ROOT / ".env")
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    t0 = time.time()
    db = sqlite3.connect(out)
    db.executescript(SCHEMA)

    with psycopg.connect(dsn()) as pg:
        n = export_parcels(pg, db, args.limit or None, args.precision, args.simplify)

        copy_table(
            pg, db,
            "SELECT sigungu_cd, emd, ri, deal_ym, deal_day, deal_amount, "
            "area_sqm, jimok, share_type, cancel_type FROM land_trade",
            "INSERT INTO land_trade VALUES (?,?,?,?,?,?,?,?,?,?)",
            "실거래",
        )
        copy_table(
            pg, db,
            "SELECT sigungu_cd, emd, deal_count, avg_price_per_sqm, "
            "median_price_per_sqm, from_ym, to_ym FROM emd_trade_avg",
            "INSERT INTO emd_trade_avg VALUES (?,?,?,?,?,?,?)",
            "읍면동 실거래 집계",
        )
        copy_table(
            pg, db,
            "SELECT level, sigungu_cd, name, sido, sigungu, lng, lat, "
            "parcel_count, median_official FROM region_summary",
            "INSERT INTO region_summary VALUES (?,?,?,?,?,?,?,?,?)",
            "지역 집계",
        )
        # SQLite에는 percentile_cont가 없다. 중앙값은 여기서 구해 굳힌다
        copy_table(
            pg, db,
            "SELECT sigungu_cd, count(*), "
            "  round(percentile_cont(0.5) WITHIN GROUP ("
            "    ORDER BY deal_amount / NULLIF(area_sqm, 0))::numeric) "
            "  FROM land_trade "
            " WHERE area_sqm > 0 AND coalesce(cancel_type, '') = '' "
            " GROUP BY sigungu_cd",
            "INSERT INTO sigungu_trade_avg VALUES (?,?,?)",
            "시군구 실거래 집계",
        )

    print("인덱스 생성 중...")
    db.executescript(INDEXES)
    db.execute("VACUUM")
    db.close()

    mb = out.stat().st_size / 1048576
    print("=" * 60)
    print(f"{out}  {mb:,.0f} MB  ({time.time()-t0:.0f}초)")
    if args.limit:
        full = mb * (5_210_960 / n)
        print(f"전체 {5_210_960:,}건 환산 추정: {full:,.0f} MB "
              f"({'5GB 이내' if full < 5000 else '5GB 초과!'})")


if __name__ == "__main__":
    main()
