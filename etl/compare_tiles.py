"""같은 화면을 '지금 API'와 '정적 타일'로 각각 받아보고 비교한다.

타일 하나가 작아도 화면 하나가 타일 수십 개를 덮으면 의미가 없다.
그래서 타일 크기가 아니라 **화면 한 번에 오가는 총 바이트**를 잰다.

실행:
    python compare_tiles.py 41830
"""

import argparse
import gzip
import json
import math
import sqlite3
from pathlib import Path

from build_tiles import lat_to_tile_y, lng_to_tile_x

DB = Path(__file__).parent / "out" / "ddotoro-small.db"
TILES = Path(__file__).parent / "out" / "tiles"

# 데스크톱 지도 크기(CSS px)와 래스터 타일 한 변. web/components/ParcelMap.tsx 기준
VIEWPORT_PX = (1400, 900)
TILE_PX = 256

# web/app/api/parcels/route.ts에서 그대로 옮긴 값
MAX_FEATURES = 3000
BBOX_MARGIN_LNG = 0.09
BBOX_MARGIN_LAT = 0.13


def viewport_bbox(lng: float, lat: float, z: int):
    """중심 좌표와 줌으로 화면 경계상자를 만든다."""
    deg_per_tile_lng = 360.0 / (1 << z)
    w = VIEWPORT_PX[0] / TILE_PX * deg_per_tile_lng
    # 메르카토르에서 같은 픽셀이 덮는 위도폭은 cos(위도)만큼 좁다
    h = VIEWPORT_PX[1] / TILE_PX * deg_per_tile_lng * math.cos(math.radians(lat))
    return (lng - w / 2, lat - h / 2, lng + w / 2, lat + h / 2)


def measure_api(con, bbox, z: int) -> tuple[int, int]:
    """지금 API가 내려보내는 바이트. (필지 수, gzip 바이트)"""
    min_lng, min_lat, max_lng, max_lat = bbox
    rows = con.execute(
        """SELECT pnu, emd, ri, jibun, jimok, area_sqm, price_per_sqm, price_year,
                  geojson
             FROM parcel
            WHERE minx BETWEEN ? AND ? AND maxx >= ?
              AND miny BETWEEN ? AND ? AND maxy >= ?
            ORDER BY area_sqm DESC
            LIMIT ?""",
        (
            min_lng - BBOX_MARGIN_LNG, max_lng, min_lng,
            min_lat - BBOX_MARGIN_LAT, max_lat, min_lat,
            MAX_FEATURES,
        ),
    ).fetchall()

    feats = [
        '{"type":"Feature","geometry":' + r[8] + ',"properties":'
        + json.dumps(
            {
                "pnu": r[0], "emd": r[1], "ri": r[2], "jibun": r[3], "jimok": r[4],
                "area_sqm": r[5], "price_per_sqm": r[6], "price_year": r[7],
            },
            ensure_ascii=False, separators=(",", ":"),
        )
        + "}"
        for r in rows
    ]
    body = (
        '{"type":"FeatureCollection","features":[' + ",".join(feats) + "]}"
    ).encode("utf-8")
    return len(rows), len(gzip.compress(body, compresslevel=6))


def measure_tiles(prefix: str, bbox, z: int, tile_z: int):
    """화면을 덮는 타일들. (타일 수, gzip 바이트, 중복 제거 후 필지 수)"""
    min_lng, min_lat, max_lng, max_lat = bbox
    x0 = lng_to_tile_x(min_lng, tile_z)
    x1 = lng_to_tile_x(max_lng, tile_z)
    y0 = lat_to_tile_y(max_lat, tile_z)
    y1 = lat_to_tile_y(min_lat, tile_z)

    root = TILES / prefix / str(tile_z)
    total = 0
    n_tiles = 0
    pnus = set()

    for tx in range(x0, x1 + 1):
        for ty in range(y0, y1 + 1):
            path = root / str(tx) / f"{ty}.json.gz"
            if not path.exists():
                continue  # 필지가 없는 칸은 파일이 없다 (404 → 빈 결과)
            n_tiles += 1
            total += path.stat().st_size
            fc = json.loads(gzip.decompress(path.read_bytes()))
            for f in fc["features"]:
                pnus.add(f["properties"]["pnu"])

    return n_tiles, total, len(pnus)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sigungu_cd")
    ap.add_argument(
        "--max-tile-zoom",
        type=int,
        default=17,
        help="구워둔 가장 깊은 줌. 이보다 더 확대하면 이 단계 타일을 재사용한다",
    )
    ap.add_argument(
        "--zoom-offset",
        type=int,
        default=0,
        help="화면 줌보다 몇 단계 굵은 타일을 받을지. 2면 z15 화면에 z13 타일",
    )
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

    # 가장 붐비는 곳과 한산한 곳을 각각 골라 양쪽 끝을 본다
    spots = con.execute(
        f"""SELECT emd, COUNT(*) n, AVG(lng), AVG(lat)
              FROM parcel WHERE substr(pnu,1,{len(args.sigungu_cd)}) = ?
             GROUP BY emd ORDER BY n DESC""",
        (args.sigungu_cd,),
    ).fetchall()
    picks = [("가장 붐빔", spots[0]), ("중간", spots[len(spots) // 2]),
             ("한산함", spots[-1])]

    kb = lambda b: b / 1024

    for label, (emd, n, lng, lat) in picks:
        print(f"\n{'─' * 62}")
        print(f"{label} · {emd} (필지 {n:,}건) 중심에서 1400×900 화면")
        print(f"{'─' * 62}")
        print(f"{'줌':>4}  {'':>10}  {'필지':>7}  {'전송(gzip)':>11}  {'요청':>5}")

        for z in (15, 16, 17):
            bbox = viewport_bbox(lng, lat, z)
            n_api, api_bytes = measure_api(con, bbox, z)
            # 화면 줌에 맞는 단계를 받는다. 더 깊이 확대하면 가장 깊은 단계를 재사용
            n_tile, tile_bytes, n_uniq = measure_tiles(
                args.sigungu_cd, bbox, z, min(z - args.zoom_offset, args.max_tile_zoom)
            )
            capped = " (상한)" if n_api >= MAX_FEATURES else ""
            print(f"  z{z}  {'지금 API':>10}  {n_api:>7,}  "
                  f"{kb(api_bytes):>8,.0f} KB{capped:>7}  {1:>5}")
            print(f"      {'타일':>10}  {n_uniq:>7,}  "
                  f"{kb(tile_bytes):>8,.0f} KB{'':>7}  {n_tile:>5}")

    con.close()


if __name__ == "__main__":
    main()
