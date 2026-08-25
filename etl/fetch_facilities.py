"""주변 생활시설을 수집해 poi 테이블에 적재한다.

Task 12에서 상세 패널에 자리만 만들어 두고 값은 전부 `—`였다
('공공데이터 연동 전' 배지가 붙어 있었다). 그 자리를 채운다.

출처는 OpenStreetMap이다(Overpass). 역(fetch_stations.py)과 같은 출처를 쓴다 —
카테고리마다 다른 공공데이터를 붙이면 출처가 다섯 개가 되고 갱신 주기도 제각각이 된다.
**ODbL이라 화면에 출처를 표기한다**(web/components/ParcelPanel.tsx 주변 탭).

보여주는 것은 **개수가 아니라 가장 가까운 하나까지의 거리**다.
시골 땅에서 '반경 500m 내 30개'는 의미가 없고, '가장 가까운 초등학교 4.2km'가
사려는 사람이 실제로 묻는 것이다.

학교·병원·마트는 노드가 아니라 **건물 폴리곤(way/relation)**으로 찍힌 것이 많다.
`out center`로 중심점을 함께 받아 좌표를 얻는다 — 이걸 빼면 절반이 사라진다.

실행:
    source venv/bin/activate && python fetch_facilities.py
    python fetch_facilities.py --dry-run
    python fetch_facilities.py --raw-in out/poi-raw.json   # 변환만 다시
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

import overpass

ROOT = Path(__file__).parent.parent

ENDPOINT = "main"

# 수도권 + 경기도 전역이 들어가는 상자. 남,서,북,동
DEFAULT_BBOX = (36.9, 126.4, 38.0, 127.9)

"""
카테고리 정의.

키는 web/components/ParcelPanel.tsx의 CategoryIcon이 쓰는 이름과 같아야 한다.
값의 `q`는 Overpass 필터이고, `label`은 화면에 뜨는 이름이다.

nwr을 쓴다 — node/way/relation을 모두 받는다.
학교·병원·마트는 건물 폴리곤으로 찍힌 것이 많아 node만 받으면 크게 빈다.
"""
CATEGORIES = {
    "school": {
        "label": "초등학교",
        "q": ['nwr["amenity"="school"]'],
    },
    "hospital": {
        "label": "병원·의원",
        "q": ['nwr["amenity"~"^(clinic|doctors|hospital)$"]'],
    },
    "store": {
        "label": "마트·편의점",
        "q": ['nwr["shop"~"^(supermarket|convenience)$"]'],
    },
    "office": {
        "label": "관공서",
        "q": ['nwr["amenity"="townhall"]', 'nwr["office"="government"]'],
    },
    "bus": {
        # 버스정류장은 노드로만 찍힌다. nwr로 받으면 정류장 주변 도로까지 딸려온다
        "label": "버스정류장",
        "q": ['node["highway"="bus_stop"]'],
    },
}

"""
초등학교만 남긴다.

`amenity=school`에는 중·고등학교와 학원·특수학교가 함께 들어 있다.
화면 라벨이 '초등학교'이므로 이름으로 거른다 — OSM 한국 데이터는
학교 이름이 '○○초등학교'로 들어와 있어 이 방법이 통한다.
`isced:level=1` 태그는 채워진 곳이 드물어 기준으로 쓸 수 없다.
"""
ELEMENTARY_RE = re.compile(r"초등학교|초등|Elementary", re.I)


def build_query(bbox: tuple) -> str:
    """다섯 카테고리를 **한 질의**에 담는다.

    나눠 쏘면 공용 인스턴스에서 429가 난다(overpass.py 참고).
    out center를 붙여 way/relation의 중심점을 함께 받는다.
    """
    s, w, n, e = bbox
    parts = []
    for spec in CATEGORIES.values():
        for q in spec["q"]:
            parts.append(f"  {q}({s},{w},{n},{e});")
    body = "\n".join(parts)
    return f"[out:json][timeout:600];\n(\n{body}\n);\nout tags center;"


def classify(tags: dict) -> str | None:
    """태그를 보고 카테고리 하나를 고른다.

    한 요소가 여러 조건에 걸릴 수 있다(관공서 건물이 amenity=townhall이면서
    office=government인 식). CATEGORIES 순서대로 먼저 맞는 것을 쓴다.
    """
    amenity = tags.get("amenity")
    if amenity == "school":
        return "school"
    if amenity in ("clinic", "doctors", "hospital"):
        return "hospital"
    if tags.get("shop") in ("supermarket", "convenience"):
        return "store"
    if amenity == "townhall" or tags.get("office") == "government":
        return "office"
    if tags.get("highway") == "bus_stop":
        return "bus"
    return None


def coords(el: dict) -> tuple[float, float] | None:
    """노드는 lat/lon, way·relation은 center를 쓴다."""
    if el["type"] == "node":
        return el.get("lat"), el.get("lon")
    c = el.get("center")
    return (c["lat"], c["lon"]) if c else None


def to_rows(bbox: tuple, raw_in: str | None = None, raw_out: str | None = None) -> list[tuple]:
    """(osm_type, osm_id, kind, name, lng, lat) 목록.

    출처를 바꾸더라도 이 함수의 출력 모양만 맞추면 나머지 파이프라인은 그대로다.
    """
    if raw_in:
        print(f"원본 재사용 {raw_in}")
        els = json.loads(Path(raw_in).read_text(encoding="utf-8"))["elements"]
    else:
        print(f"Overpass 질의 (bbox {bbox}) — 7만 건 규모라 몇 분 걸린다")
        els = overpass.fetch(build_query(bbox), ENDPOINT, timeout=600)["elements"]
        if raw_out:
            Path(raw_out).parent.mkdir(parents=True, exist_ok=True)
            Path(raw_out).write_text(
                json.dumps({"elements": els}, ensure_ascii=False), encoding="utf-8"
            )
            print(f"  원본 저장 {raw_out}")

    print(f"  받은 요소 {len(els):,}개")

    rows, skipped = [], {"좌표없음": 0, "분류실패": 0, "초등학교아님": 0}
    for el in els:
        tags = el.get("tags") or {}
        kind = classify(tags)
        if not kind:
            skipped["분류실패"] += 1
            continue

        name = (tags.get("name:ko") or tags.get("name") or "").strip()

        if kind == "school" and not ELEMENTARY_RE.search(name):
            skipped["초등학교아님"] += 1
            continue

        pos = coords(el)
        if not pos or pos[0] is None:
            skipped["좌표없음"] += 1
            continue

        rows.append((el["type"], el["id"], kind, name or None, pos[1], pos[0]))

    by_kind: dict[str, int] = {}
    for r in rows:
        by_kind[r[2]] = by_kind.get(r[2], 0) + 1

    print(f"\n시설 {len(rows):,}개")
    for k, spec in CATEGORIES.items():
        print(f"  {spec['label']:<12} {by_kind.get(k, 0):>7,}")
    dropped = ", ".join(f"{k} {v:,}" for k, v in skipped.items() if v)
    if dropped:
        print(f"  (제외: {dropped})")
    return rows


def dsn() -> str:
    return (
        f"host={os.environ.get('PGHOST', 'localhost')} "
        f"port={os.environ.get('PGPORT', '5432')} "
        f"dbname={os.environ.get('PGDATABASE', 'ddotoro')} "
        f"user={os.environ.get('PGUSER', 'ddotoro')} "
        f"password={os.environ.get('PGPASSWORD', '')}"
    )


def load(rows: list[tuple]) -> None:
    ddl = (ROOT / "etl" / "sql" / "08_poi.sql").read_text(encoding="utf-8")
    with psycopg.connect(dsn()) as pg:
        with pg.cursor() as cur:
            cur.execute(ddl)
            # 통째로 다시 넣는다. 증분 갱신을 만들 만큼 자주 바뀌지 않는다
            cur.execute("TRUNCATE poi")
            with cur.copy(
                "COPY poi (osm_type, osm_id, kind, name, lng, lat) FROM STDIN"
            ) as cp:
                for r in rows:
                    cp.write_row(r)
        pg.commit()
    print(f"poi 적재 {len(rows):,}건")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--bbox",
        default=",".join(str(v) for v in DEFAULT_BBOX),
        help="남,서,북,동 (기본: 수도권 전역)",
    )
    ap.add_argument("--dry-run", action="store_true", help="적재하지 않고 집계만 낸다")
    ap.add_argument("--raw-out", help="Overpass 원본 응답을 남길 경로")
    ap.add_argument("--raw-in", help="저장해 둔 원본으로 변환만 다시 돌린다")
    ap.add_argument("--endpoint", default="main", help="main | kumi | 전체 URL")
    args = ap.parse_args()

    global ENDPOINT
    ENDPOINT = args.endpoint

    load_dotenv(ROOT / ".env")

    try:
        bbox = tuple(float(v) for v in args.bbox.split(","))
        if len(bbox) != 4:
            raise ValueError
    except ValueError:
        raise SystemExit("--bbox 는 '남,서,북,동' 네 숫자다")

    rows = to_rows(bbox, args.raw_in, args.raw_out)
    if not rows:
        raise SystemExit("시설을 하나도 받지 못했다. bbox를 확인할 것")

    if args.dry_run:
        print("--dry-run 이라 적재하지 않았다")
        return

    load(rows)


if __name__ == "__main__":
    sys.exit(main())
