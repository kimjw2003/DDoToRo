"""필지 상세를 정적 파일로 굽는다. 상세 페이지가 DB 대신 이걸 읽는다.

지도는 타일(build_tiles.py)로 옮겼지만 상세 페이지는 아직 parcel 테이블을
조회한다. 전국으로 넓히면 그 테이블이 26GB라 무료 한도 5GB에 들어가지 않으므로
상세도 파일로 내보낸다.

  경로:  details/{법정동코드10}/{본번 끝자리}.json.gz
  예:    4111112900 / 1   ← PNU 4111112900 1 0100 0001 (파장동 100-1)

**색인 파일을 두지 않는 것이 요점이다.** 경로가 PNU에서 그대로 계산되므로
'어느 파일에 있는지' 묻는 왕복이 없다 — 상세 페이지는 파일 하나만 받으면 된다.

나누는 기준이 본번 '끝'자리인 이유. 첫자리로 나누면 0000~0999가 한 덩어리라
버킷당 평균 2,082 · 최대 11,376건으로 쏠린다. 끝자리는 평균 259 · 최대 2,258로
고르다 (경기도 실측).

읍면 실거래 집계(emd_trade_avg)는 여기 넣지 않는다. 필지가 아니라 지역 단위라
행이 몇천 개뿐이고, DB에 남겨도 용량 문제가 없다.

메모리는 법정동 하나씩만 들고 있으면 되므로 샤딩이 필요 없다 —
PNU 순으로 읽으면 같은 법정동이 붙어서 나온다.

실행:
    python build_details.py 41830        # 양평군
    python build_details.py 41           # 경기도 전체
    python build_details.py 41 --dry-run
"""

import argparse
import gzip
import json
import shutil
import sqlite3
import statistics
import time
from collections import defaultdict
from pathlib import Path

DB = Path(__file__).parent / "out" / "ddotoro-small.db"
OUT = Path(__file__).parent / "out" / "assets" / "details"


def bucket_of(pnu: str) -> str:
    """본번 끝자리. PNU = 법정동(10) + 산여부(1) + 본번(4) + 부번(4)"""
    return pnu[14]


def flush(
    out_dir: Path,
    dong: str,
    header: dict,
    buckets: dict[str, dict],
    dry_run: bool,
    sizes: list[int],
    counts: list[int],
) -> None:
    """법정동 하나를 버킷별 파일로 쓴다"""
    for b, parcels in buckets.items():
        body = json.dumps(
            {**header, "parcels": parcels},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        # mtime 고정 — 이유는 build_tiles.py 참고 (CDN 캐시)
        blob = gzip.compress(body, compresslevel=6, mtime=0)

        sizes.append(len(blob))
        counts.append(len(parcels))

        if not dry_run:
            path = out_dir / dong / f"{b}.json.gz"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)


def main() -> None:
    ap = argparse.ArgumentParser()
    # 지역은 인자로 받는다. 코드에 박지 않는다 (CLAUDE.md)
    ap.add_argument("prefix", help="PNU 앞자리. 41=경기도, 41830=양평군")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--clean", action="store_true", help="출력을 통째로 지우고 새로 굽는다")
    ap.add_argument("--db", default=str(DB))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    out_dir = Path(args.out)
    print(f"DB      {args.db}")
    print(f"대상    PNU '{args.prefix}%'")
    print(f"출력    {out_dir}{'  (dry-run)' if args.dry_run else ''}")
    print()

    if args.clean and not args.dry_run and out_dir.exists():
        shutil.rmtree(out_dir)

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    """
    PNU 순으로 읽는다.

    같은 법정동이 붙어서 나오므로 법정동이 바뀌는 순간 직전 것을 쓰고 버리면
    된다 — 메모리에 올라오는 건 항상 법정동 하나뿐이다(최대 13,827건, 6MB).
    idx_parcel_pnu가 있어 정렬 비용도 들지 않는다.
    """
    rows = con.execute(
        f"""SELECT pnu, sido, sigungu, emd, ri, jibun, jimok,
                   area_sqm, price_per_sqm, price_year, lng, lat,
                   geojson, price_history
              FROM parcel
             WHERE substr(pnu,1,{len(args.prefix)}) = ? AND geojson IS NOT NULL
             ORDER BY pnu""",
        (args.prefix,),
    )

    sizes: list[int] = []
    counts: list[int] = []
    n_parcels = 0
    n_dongs = 0

    cur_dong: str | None = None
    header: dict = {}
    buckets: dict[str, dict] = defaultdict(dict)

    t0 = time.time()
    for r in rows:
        pnu = r["pnu"]
        dong = pnu[:10]

        if dong != cur_dong:
            if cur_dong is not None:
                flush(out_dir, cur_dong, header, buckets, args.dry_run, sizes, counts)
                n_dongs += 1
                buckets = defaultdict(dict)
            cur_dong = dong
            # 지역명은 법정동 안에서 같다. 필지마다 반복하지 않고 위로 올린다
            header = {
                "sigungu_cd": pnu[:5],
                "sido": r["sido"],
                "sigungu": r["sigungu"],
                "emd": r["emd"],
                "ri": r["ri"],
            }

        n_parcels += 1
        buckets[bucket_of(pnu)][pnu[10:]] = {
            "jibun": r["jibun"],
            "jimok": r["jimok"],
            "area_sqm": r["area_sqm"],
            "price_per_sqm": r["price_per_sqm"],
            "price_year": r["price_year"],
            "lng": r["lng"],
            "lat": r["lat"],
            # 문자열 그대로 넘긴다. 파싱했다 다시 찍을 이유가 없다
            "geometry": json.loads(r["geojson"]),
            "price_history": json.loads(r["price_history"]) if r["price_history"] else [],
        }

    if cur_dong is not None:
        flush(out_dir, cur_dong, header, buckets, args.dry_run, sizes, counts)
        n_dongs += 1

    con.close()
    elapsed = time.time() - t0

    kb = lambda b: b / 1024
    print(f"필지 {n_parcels:,}건 · 법정동 {n_dongs:,}개 · "
          f"파일 {len(sizes):,}개 ({elapsed:.1f}s)")
    print()
    print(f"  gzip 총합         {sum(sizes) / 1024 / 1024:,.0f} MB")
    print(f"  파일 하나 (gzip)  평균 {kb(statistics.mean(sizes)):.0f} KB · "
          f"중앙 {kb(statistics.median(sizes)):.0f} KB · "
          f"최대 {kb(max(sizes)):,.0f} KB")
    srt = sorted(sizes)
    print(f"                    p95 {kb(srt[int(len(srt) * 0.95)]):.0f} KB · "
          f"p99 {kb(srt[int(len(srt) * 0.99)]):.0f} KB")
    print(f"  파일당 필지       평균 {statistics.mean(counts):.0f} · "
          f"최대 {max(counts):,}")


if __name__ == "__main__":
    main()
