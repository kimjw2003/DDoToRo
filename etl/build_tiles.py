"""필지를 웹메르카토르 격자로 잘라 정적 GeoJSON 파일로 굽는다.

지도 조회를 'DB에서 찾기'에서 '파일 가져오기'로 바꾸기 위한 실측용 스크립트다.
파일 이름이 화면 좌표에서 그대로 계산되므로 조회에 DB가 필요 없고,
필지가 몇 개든 브라우저가 받는 파일 수는 화면 크기에만 달린다.

  지금                              타일
  ────────────────────────────────  ──────────────────────────────
  WHERE minx BETWEEN ? AND ? ...    GET /15/27834/12683.json
  ORDER BY area_sqm DESC LIMIT      굽는 시점에 잘라둠
  521만 행 중에서 찾기              화면당 파일 4~8개

타일 배정은 중심점이 아니라 **경계상자 교차**로 한다. 중심점으로 넣으면
옆 칸까지 뻗은 큰 임야가 그 옆 칸을 볼 때 사라진다. 대신 경계에 걸친 필지가
여러 파일에 중복되므로 브라우저가 PNU로 중복을 제거해야 한다.

출력 경로는 `out/tiles/{z}/{x}/{y}.json.gz`로 **시군구를 끼워넣지 않는다.**
경로가 화면 좌표만으로 계산되어야 조회에 DB가 필요 없어지기 때문이다.
대신 시군구를 나눠 여러 번 돌리면 경계에 걸친 타일이 마지막 실행 것으로
덮어써져 옆 시군구 필지가 빠진다 — **배포용은 반드시 한 번에 굽는다.**

단계별 설정은 web/lib/tiles.ts와 짝이다. 한쪽만 바꾸면 화면이 빈다.

    python build_tiles.py <코드> --zoom 13 --max-per-tile 3000
    python build_tiles.py <코드> --zoom 14 --max-per-tile 3000
    python build_tiles.py <코드> --zoom 15                      # 상한 없음

상한을 3,000으로 둔 이유. 타일은 화면 줌보다 두 단계 굵은 것을 받으므로
z13 타일 하나가 z15 화면에서 1024px, 곧 화면 하나와 거의 같다 — 타일당 상한이
그대로 화면당 필지 수가 된다. 3,000은 예전 API의 MAX_FEATURES를 옮겨온 값이다.
800으로 잡아봤더니 z15 화면이 눈에 띄게 성겼다.

가장 깊은 z15만 상한이 없다. 여기에까지 걸면 아무리 확대해도 볼 수 없는
필지가 생기는데, 깊은 단계는 화면에 타일이 1~2개만 들어와 상한을 빼도
전송량이 늘지 않는다 (양평 실측: 상한 있으나 없으나 28MB로 같았다).

실행:
    python build_tiles.py 41830              # 양평군, z15
    python build_tiles.py 41830 --zoom 14
    python build_tiles.py 41830 --max-per-tile 1500
    python build_tiles.py 41 --dry-run       # 경기도 전체, 굽지 않고 크기만 계산
"""

import argparse
import gzip
import json
import math
import shutil
import sqlite3
import statistics
import time
from collections import defaultdict
from pathlib import Path

DB = Path(__file__).parent / "out" / "ddotoro-small.db"
# out/assets 아래가 통째로 S3/Blob 한 버킷이 된다. 상세(build_details.py)도 여기 쓴다
OUT = Path(__file__).parent / "out" / "assets" / "tiles"

# 지도가 필지를 그리기 시작하는 줌. web/app/api/parcels/route.ts의 MIN_ZOOM과 같다
DEFAULT_ZOOM = 15


def lng_to_tile_x(lng: float, z: int) -> int:
    n = 1 << z
    return max(0, min(n - 1, int((lng + 180.0) / 360.0 * n)))


def tile_x_to_lng(x: int, z: int) -> float:
    """타일 x의 서쪽 경계 경도. 샤드 경계를 SQL 조건으로 옮길 때 쓴다"""
    return x / (1 << z) * 360.0 - 180.0


def lat_to_tile_y(lat: float, z: int) -> int:
    """위도 → 타일 y. 위도가 올라갈수록 y는 작아진다 (타일 원점이 북서쪽)."""
    n = 1 << z
    # 웹메르카토르. asinh(tan(φ)) 는 gudermannian 역함수와 같다
    rad = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = (1.0 - math.asinh(math.tan(rad)) / math.pi) / 2.0 * n
    return max(0, min(n - 1, int(y)))


def main() -> None:
    ap = argparse.ArgumentParser()
    # 지역은 인자로 받는다. 코드에 박지 않는다 (CLAUDE.md)
    ap.add_argument(
        "sigungu_cd",
        help="PNU 앞자리 접두사. 5자리면 시군구(41830=양평군), 2자리면 시도(41=경기도)",
    )
    ap.add_argument("--zoom", type=int, default=DEFAULT_ZOOM)
    ap.add_argument(
        "--max-per-tile",
        type=int,
        default=0,
        help="타일당 필지 상한. 넘으면 면적 큰 것부터 남긴다. 0이면 무제한",
    )
    ap.add_argument(
        "--with-history",
        action="store_true",
        help="price_history까지 넣는다 (상세 페이지도 타일에서 읽는 경우)",
    )
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 크기만 잰다")
    ap.add_argument(
        "--clean",
        action="store_true",
        help="이 줌 단계를 통째로 지우고 새로 굽는다. 시군구를 나눠 돌릴 때는 켜지 말 것",
    )
    ap.add_argument(
        "--shards",
        type=int,
        default=1,
        help=(
            "경도 방향으로 몇 개 띠로 나눠 처리할지. 메모리를 그만큼 나눠 쓴다. "
            "경기도 521만 건이 6GB였으므로 전국(약 3,900만)은 반드시 나눠야 한다"
        ),
    )
    ap.add_argument("--db", default=str(DB))
    ap.add_argument("--out", default=str(OUT), help="타일 루트. 검증용으로만 바꾼다")
    args = ap.parse_args()

    z = args.zoom
    prefix = args.sigungu_cd
    out_dir = Path(args.out) / str(z)

    print(f"DB      {args.db}")
    print(f"대상    PNU '{prefix}%'  줌 z{z}")
    print(f"출력    {out_dir}{'  (dry-run)' if args.dry_run else ''}")
    print()

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    cols = (
        "pnu, emd, ri, jibun, jimok, area_sqm, price_per_sqm, price_year, "
        "minx, maxx, miny, maxy, geojson"
    )
    if args.with_history:
        cols += ", price_history"

    where = f"substr(pnu,1,{len(prefix)}) = ? AND geojson IS NOT NULL"

    # 샤드 경계를 잡으려면 대상의 경도 범위를 먼저 알아야 한다
    bounds = con.execute(
        f"SELECT MIN(minx), MAX(maxx) FROM parcel WHERE {where}", (prefix,)
    ).fetchone()
    if bounds[0] is None:
        print("대상 필지가 없다. PNU 접두사를 확인할 것")
        return

    x_lo = lng_to_tile_x(bounds[0], z)
    x_hi = lng_to_tile_x(bounds[1], z)
    n_shards = max(1, args.shards)
    span_x = x_hi - x_lo + 1

    bands: list[tuple[int, int]] = []
    for i in range(n_shards):
        b0 = x_lo + span_x * i // n_shards
        b1 = x_lo + span_x * (i + 1) // n_shards - 1
        if b1 >= b0:
            bands.append((b0, b1))
    if n_shards > 1:
        print(f"샤드 {len(bands)}개 (타일 x {x_lo}~{x_hi})")

    # ── 굽기 ──────────────────────────────────────────────────────
    if args.clean and not args.dry_run and out_dir.exists():
        shutil.rmtree(out_dir)

    raw_sizes: list[int] = []
    gz_sizes: list[int] = []
    counts: list[int] = []
    n_parcels = 0
    n_placements = 0
    n_tiles = 0
    n_truncated = 0
    n_dropped = 0
    span_hist: dict[int, int] = defaultdict(int)

    t0 = time.time()
    for bi, (bx0, bx1) in enumerate(bands):
        """
        이 띠의 타일에 닿는 필지만 읽는다.

        띠 경계에 걸친 필지는 양옆 샤드에서 모두 읽히지만, 각 샤드가 자기
        x 범위의 타일만 쓰므로 결과는 한 번에 구운 것과 같다. 통계는 필지의
        가장 왼쪽 타일을 가진 샤드에서만 세어 중복을 피한다.
        """
        rows = con.execute(
            f"SELECT {cols} FROM parcel WHERE {where} AND maxx >= ? AND minx < ?",
            (prefix, tile_x_to_lng(bx0, z), tile_x_to_lng(bx1 + 1, z)),
        )

        # 타일키 → [(면적, Feature 문자열)]
        tiles: dict[tuple[int, int], list[tuple[float, str]]] = defaultdict(list)

        for r in rows:
            props = {
                "pnu": r["pnu"],
                "emd": r["emd"],
                "ri": r["ri"],
                "jibun": r["jibun"],
                "jimok": r["jimok"],
                "area_sqm": r["area_sqm"],
                "price_per_sqm": r["price_per_sqm"],
                "price_year": r["price_year"],
            }
            if args.with_history and r["price_history"]:
                props["price_history"] = json.loads(r["price_history"])

            # geometry는 이미 문자열이다. 파싱했다 다시 찍으면 느리기만 하다
            feature = (
                '{"type":"Feature","geometry":'
                + r["geojson"]
                + ',"properties":'
                + json.dumps(props, ensure_ascii=False, separators=(",", ":"))
                + "}"
            )

            x0 = lng_to_tile_x(r["minx"], z)
            x1 = lng_to_tile_x(r["maxx"], z)
            # 위도는 뒤집힌다 — 큰 위도가 작은 y
            y0 = lat_to_tile_y(r["maxy"], z)
            y1 = lat_to_tile_y(r["miny"], z)

            if bx0 <= x0 <= bx1:
                n_parcels += 1
                span_hist[min((x1 - x0 + 1) * (y1 - y0 + 1), 16)] += 1

            area = r["area_sqm"] or 0.0
            for tx in range(max(x0, bx0), min(x1, bx1) + 1):
                for ty in range(y0, y1 + 1):
                    tiles[(tx, ty)].append((area, feature))
                    n_placements += 1

        for (tx, ty), feats in tiles.items():
            capped = bool(args.max_per_tile) and len(feats) > args.max_per_tile
            if capped:
                # 상한에 걸리면 면적 큰 것부터 남긴다.
                # 지금 API의 ORDER BY area_sqm DESC를 굽는 시점으로 옮긴 것이다
                feats.sort(key=lambda f: f[0], reverse=True)
                n_dropped += len(feats) - args.max_per_tile
                feats = feats[: args.max_per_tile]
                n_truncated += 1

            # 잘렸다는 사실을 파일에 적어둔다. 화면의 '일부만 표시' 안내가 이걸 읽는다
            body = (
                '{"type":"FeatureCollection"'
                + (',"truncated":true' if capped else "")
                + ',"features":['
                + ",".join(f[1] for f in feats)
                + "]}"
            ).encode("utf-8")
            # mtime을 0으로 고정한다. 기본값은 '지금'이라 내용이 같아도 다시 구울
            # 때마다 바이트가 달라지고, 그러면 CDN이 ETag가 바뀐 줄 알고 캐시를
            # 통째로 버린다. 샤드 수를 바꿔도 바이트가 같아지는 이점도 있다
            blob = gzip.compress(body, compresslevel=6, mtime=0)

            raw_sizes.append(len(body))
            gz_sizes.append(len(blob))
            counts.append(len(feats))
            n_tiles += 1

            if not args.dry_run:
                path = out_dir / str(tx) / f"{ty}.json.gz"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(blob)

        # 다음 샤드를 읽기 전에 이 띠의 Feature를 놓아준다. 이게 샤딩의 요점이다
        tiles.clear()
        if len(bands) > 1:
            print(f"  샤드 {bi + 1}/{len(bands)}  누적 필지 {n_parcels:,} · "
                  f"타일 {n_tiles:,}")

    con.close()
    build_s = time.time() - t0
    print(f"필지 {n_parcels:,}건 읽음")

    # ── 리포트 ────────────────────────────────────────────────────
    mb = lambda b: b / 1024 / 1024
    kb = lambda b: b / 1024

    print(f"타일 {n_tiles:,}개 생성 ({build_s:.1f}s)")
    print()
    print(f"  필지 배치 수      {n_placements:,}  "
          f"(중복률 {n_placements / n_parcels:.2f}배)")
    print(f"  타일당 필지       평균 {statistics.mean(counts):.0f} · "
          f"중앙 {statistics.median(counts):.0f} · 최대 {max(counts):,}")
    print()
    print(f"  원본 총합         {mb(sum(raw_sizes)):,.0f} MB")
    print(f"  gzip 총합         {mb(sum(gz_sizes)):,.0f} MB  "
          f"({sum(gz_sizes) / sum(raw_sizes) * 100:.0f}%)")
    print(f"  타일 하나 (gzip)  평균 {kb(statistics.mean(gz_sizes)):.0f} KB · "
          f"중앙 {kb(statistics.median(gz_sizes)):.0f} KB · "
          f"최대 {kb(max(gz_sizes)):,.0f} KB")

    gz_sorted = sorted(gz_sizes)
    p95 = gz_sorted[int(len(gz_sorted) * 0.95)]
    p99 = gz_sorted[int(len(gz_sorted) * 0.99)]
    print(f"                    p95 {kb(p95):.0f} KB · p99 {kb(p99):.0f} KB")

    if args.max_per_tile:
        print()
        print(f"  상한에 걸린 타일  {n_truncated:,}개 "
              f"({n_truncated / n_tiles * 100:.1f}%)  "
              f"버려진 배치 {n_dropped:,}건")

    print()
    print("  필지가 걸치는 타일 수")
    for span in sorted(span_hist):
        label = f"{span}+" if span == 16 else str(span)
        n = span_hist[span]
        print(f"    {label:>3}칸  {n:>9,}  ({n / n_parcels * 100:5.2f}%)")


if __name__ == "__main__":
    main()
