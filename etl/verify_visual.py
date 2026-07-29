"""Task 2 시각 검증: 적재된 필지가 실제 양평군 위치에 놓이는지 눈으로 확인한다.

좌표계 변환 오류는 예외 없이 조용히 통과하므로 반드시 눈으로 봐야 한다.
바다나 엉뚱한 나라에 찍히면 CRS 처리가 틀린 것이다.

산출물 (out/):
  parcels_overview.png   전체 필지 중심점 — 양평군 윤곽이 나와야 한다
  parcels_on_map.png     VWorld 배경지도 위에 필지를 겹쳐 그린 것
  sample.geojson         무작위 20건 (DoD)

실행:
    source venv/bin/activate && python verify_visual.py
"""

import io
import json
import math
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import psycopg
import requests
from dotenv import load_dotenv
from PIL import Image

OUT_DIR = Path(__file__).parent / "out"
ROOT = Path(__file__).parent.parent

# DESIGN.md 가격 램프 5단계
RAMP = ["#E9F0EB", "#BCD5C6", "#86B29A", "#4E866D", "#234F3D"]
NO_PRICE = "#F0EEE8"


def dsn() -> str:
    return (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'ddotoro')} user={os.getenv('PGUSER', 'ddotoro')} "
        f"password={os.getenv('PGPASSWORD', 'ddotoro_local')}"
    )


def deg2xy(lat: float, lng: float, z: int) -> tuple[float, float]:
    """위경도 -> Web Mercator 타일 좌표(소수)."""
    n = 2 ** z
    x = (lng + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def overview(conn) -> None:
    """전체 필지의 중심점을 찍어 양평군 윤곽이 나오는지 본다."""
    with conn.cursor() as cur:
        cur.execute("SELECT ST_X(ST_Centroid(geom)), ST_Y(ST_Centroid(geom)) FROM parcel")
        pts = cur.fetchall()
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]

    fig, ax = plt.subplots(figsize=(9, 9))
    ax.scatter(xs, ys, s=0.12, c="#4E866D", alpha=0.5, linewidths=0)
    ax.set_aspect(1 / math.cos(math.radians(sum(ys) / len(ys))))
    ax.set_title(f"양평군 필지 중심점 {len(pts):,}건", fontsize=11)
    ax.set_xlabel("경도"); ax.set_ylabel("위도")
    ax.grid(alpha=0.25, linewidth=0.4)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "parcels_overview.png", dpi=110)
    print(f"  경도 {min(xs):.5f} ~ {max(xs):.5f}")
    print(f"  위도 {min(ys):.5f} ~ {max(ys):.5f}")


def on_basemap(conn, key: str, zoom: int = 16) -> None:
    """VWorld 타일을 받아 그 위에 필지를 겹쳐 그린다. 위치가 틀리면 즉시 보인다."""
    # 양평읍 시가지만 확대해서 본다. 넓게 잡으면 필지가 뭉개져 검증이 되지 않는다
    west, south, east, north = 127.487, 37.487, 127.507, 37.497
    with conn.cursor() as cur:
        cur.execute(
            "SELECT ST_AsGeoJSON(geom), price_per_sqm FROM parcel "
            "WHERE geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)",
            (west, south, east, north),
        )
        rows = cur.fetchall()
        cur.execute("""
            SELECT percentile_cont(ARRAY[0.2,0.4,0.6,0.8]) WITHIN GROUP (ORDER BY price_per_sqm)
            FROM parcel WHERE price_per_sqm IS NOT NULL
        """)
        cuts = cur.fetchone()[0]
    print(f"  오버레이 대상 필지: {len(rows):,}건")
    print(f"  가격 5분위 경계(원/㎡): {[int(c) for c in cuts]}")

    x0, y1 = deg2xy(north, west, zoom)   # 좌상단
    x1, y0 = deg2xy(south, east, zoom)   # 우하단
    tx0, tx1 = int(math.floor(x0)), int(math.floor(x1))
    ty0, ty1 = int(math.floor(y1)), int(math.floor(y0))

    W = (tx1 - tx0 + 1) * 256
    H = (ty1 - ty0 + 1) * 256
    canvas = Image.new("RGB", (W, H), "white")
    sess = requests.Session()
    sess.headers["Referer"] = "http://localhost:3000"
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            url = f"https://api.vworld.kr/req/wmts/1.0.0/{key}/white/{zoom}/{ty}/{tx}.png"
            r = sess.get(url, timeout=30)
            if r.headers.get("content-type", "").startswith("image"):
                canvas.paste(Image.open(io.BytesIO(r.content)), ((tx - tx0) * 256, (ty - ty0) * 256))

    fig, ax = plt.subplots(figsize=(11, 11 * H / W))
    ax.imshow(canvas, extent=[0, W, H, 0])

    def to_px(lng: float, lat: float) -> tuple[float, float]:
        x, y = deg2xy(lat, lng, zoom)
        return (x - tx0) * 256, (y - ty0) * 256

    for gj, price in rows:
        g = json.loads(gj)
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        if price is None:
            color = NO_PRICE
        else:
            color = RAMP[sum(price > c for c in cuts)]
        for poly in polys:
            ring = poly[0]
            pxy = [to_px(c[0], c[1]) for c in ring]
            ax.fill([p[0] for p in pxy], [p[1] for p in pxy],
                    facecolor=color, edgecolor="white", linewidth=0.3, alpha=0.72)

    ax.set_xlim(0, W); ax.set_ylim(H, 0); ax.axis("off")
    ax.set_title("VWorld 배경지도 + 적재된 필지 (양평읍 일대, 가격 5단계)", fontsize=11)
    fig.tight_layout()
    fig.savefig(OUT_DIR / "parcels_on_map.png", dpi=110, bbox_inches="tight")


def dump_sample(conn) -> None:
    """DoD: 무작위 20건을 GeoJSON으로 저장한다."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT json_build_object(
              'type', 'FeatureCollection',
              'features', json_agg(json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(geom)::json,
                'properties', json_build_object(
                  'pnu', pnu, 'addr', sigungu||' '||emd||' '||coalesce(ri,'')||' '||jibun,
                  'jimok', jimok, 'area_sqm', area_sqm,
                  'price_per_sqm', price_per_sqm, 'price_year', price_year)))
            )
            FROM (SELECT * FROM parcel ORDER BY random() LIMIT 20) t
        """)
        (OUT_DIR / "sample.geojson").write_text(
            json.dumps(cur.fetchone()[0], ensure_ascii=False, indent=1)
        )


def main() -> None:
    load_dotenv(ROOT / ".env")
    OUT_DIR.mkdir(exist_ok=True)
    key = os.environ["NEXT_PUBLIC_VWORLD_KEY"]

    with psycopg.connect(dsn()) as conn:
        print("[1] 전체 중심점 산점도")
        overview(conn)
        print("[2] VWorld 배경지도 오버레이")
        on_basemap(conn, key)
        print("[3] sample.geojson")
        dump_sample(conn)
    print(f"완료 → {OUT_DIR}")


if __name__ == "__main__":
    main()
