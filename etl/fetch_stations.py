"""전철·철도 역을 수집해 station 테이블에 적재한다.

2차까지는 web/lib/stations.ts에 경의중앙선 9개가 상수로 박혀 있었다.
서비스 범위를 경기도 전역으로 넓힌 뒤에도 그대로여서 양평군 밖 필지에는
'가까운 역'이 아예 뜨지 않았다(성남시 복정동 필지 → 빈 배열, 복정역이 코앞인데도).

출처는 OpenStreetMap이다 (Overpass API).
  공공데이터포털 '전국도시철도역사정보표준데이터'(15013205)에 노선명이 컬럼으로
  들어 있어 그쪽이 더 깔끔하지만, 데이터셋별 활용신청이 필요해 키가 없으면 못 받는다.
  키를 받으면 이 파일만 갈아끼우면 된다 — 아래 to_rows()가 내놓는 모양만 맞추면
  나머지 파이프라인은 그대로다.

  **OSM은 ODbL이다.** 화면에 출처를 반드시 표기한다(web/components/Legend.tsx).

노선명이 붙는 방식이 함정이다.
  역 노드에는 노선 정보가 없다. route 관계에만 있고, 그 관계의 멤버는 역 노드가
  아니라 승강장·정차위치 노드다. 그래서 세 번 질의해서 좌표로 이어 붙인다.

  **이름으로 잇지 말 것.** 동명이역이 섞인다 —
  양평역은 경의중앙선(양평군)과 5호선(영등포구) 두 곳이고,
  이름으로 매칭하면 양평군 필지에 5호선이 붙는다. 좌표 근접(250m)으로 잇는다.

실행:
    source venv/bin/activate && python fetch_stations.py
    python fetch_stations.py --bbox 36.9,126.4,38.0,127.9   # 남,서,북,동
    python fetch_stations.py --dry-run                       # 적재 없이 집계만
"""

import argparse
import json
import math
import os
import re
import sys
import time
from pathlib import Path

import psycopg
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent

"""
Overpass 인스턴스.

공용 서버는 동시 슬롯이 2개뿐이라 짧은 간격으로 여러 번 쏘면 429가 난다.
그래서 질의를 하나로 합쳤지만, 그래도 막히면 --endpoint로 미러를 쓴다.
kumi.systems 미러가 한도가 더 넉넉하다.
"""
ENDPOINTS = {
    "main": "https://overpass-api.de/api/interpreter",
    "kumi": "https://overpass.kumi.systems/api/interpreter",
}
OVERPASS = ENDPOINTS["main"]

# 수도권 + 경기도 전역이 들어가는 상자. 남,서,북,동
# 지역명을 코드에 박지 않는다는 규칙에 따라 인자로 덮어쓸 수 있게 둔다
DEFAULT_BBOX = (36.9, 126.4, 38.0, 127.9)

# 역 노드와 정차위치 노드를 같은 역으로 볼 최대 거리(m).
# 250m면 큰 환승역의 승강장까지 닿으면서 옆 역과 섞이지 않는다
MATCH_M = 250

# 급행·특급만 다니는 역이면 접을 본선이 없다. 이름에서 직접 떼어낸다
LINE_SUFFIXES = (" 급행", " 특급", " 완행", " 직통", " 일반열차")

# '수도권 전철 1호선 경원·경부 계통' 같은 운행계통 꼬리
SUFFIX_RE = re.compile(r"\s+\S+\s*계통$")

"""
역이 아닌 것.

OSM은 레일바이크 종점·나루터도 railway=station/halt로 찍어 둔다.
그대로 두면 양평 필지에 '가장 가까운 역: 양평레일바이크 종점'이 뜬다 —
땅을 보러 온 사람에게 교통 정보가 아니다.
"""
NOT_STATION_RE = re.compile(r"레일바이크|선착장|나루터|모노레일 종점")

RETRIES = 5
SLEEP = 3.0

"""
User-Agent를 반드시 보낸다.

requests 기본값(python-requests/x.y)으로 보내면 Overpass가 **406**을 돌려준다.
익명 스크립트를 막는 정책이고, 이용 정책 자체가 식별 가능한 UA를 요구한다.
빼면 재시도를 아무리 늘려도 통과하지 못한다.
"""
HEADERS = {
    "User-Agent": "DDoToRo-ETL/1.0 (+https://github.com/kimjw2003/DDoToRo)"
}


def overpass(query: str) -> dict:
    """Overpass 질의.

    서버가 바쁘면 200이 아닌 XML/HTML 오류(504, 'too busy')를 돌려준다.
    공용 인스턴스라 흔한 일이므로 넉넉히 재시도한다.
    """
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.post(
                OVERPASS, data={"data": query}, headers=HEADERS, timeout=240
            )
            # 오류일 때는 JSON이 아니라 XML/HTML이 온다
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                return r.json()
            if r.status_code == 406:
                raise SystemExit(
                    "Overpass가 406을 돌려줬다. User-Agent가 빠졌는지 확인할 것"
                )
            reason = "서버 혼잡" if "too busy" in r.text or r.status_code == 504 else f"HTTP {r.status_code}"
        except requests.RequestException as e:
            reason = str(e)[:80]
        if attempt < RETRIES:
            wait = SLEEP * attempt
            print(f"  재시도 {attempt}/{RETRIES - 1} ({reason}) — {wait:.0f}초 대기")
            time.sleep(wait)
    raise SystemExit("Overpass 응답을 받지 못했다. 잠시 뒤 다시 시도할 것")


def query_all(bbox: tuple) -> str:
    """역 노드 · route 관계 · 관계 멤버 노드를 **한 번에** 받는다.

    셋으로 나눠 쏘면 공용 인스턴스에서 429(쿼터 초과)에 걸린다.
    한 응답 안에 다 담아 요청 수를 1로 줄인다.

    멤버 노드가 필요한 이유: route 관계의 멤버는 역 노드가 아니라
    승강장·정차위치 노드이고, 그 좌표로 역과 이어 붙여야 하기 때문이다.
    """
    s, w, n, e = bbox
    return f"""[out:json][timeout:300];
node["railway"~"^(station|halt)$"]({s},{w},{n},{e});
out body;
rel["type"="route"]["route"~"^(subway|train|light_rail|monorail)$"]({s},{w},{n},{e});
out body;
node(r);
out body;"""


def line_name(rel: dict) -> str:
    """'수도권 전철 3호선: 대화 - 오금' -> '수도권 전철 3호선'"""
    tags = rel.get("tags") or {}
    name = (tags.get("name:ko") or tags.get("name") or "").strip()
    # 관계 이름은 '노선: 기점 - 종점' 형태다
    name = name.split(":")[0].split("：")[0].strip()
    name = SUFFIX_RE.sub("", name).strip()
    for suf in LINE_SUFFIXES:
        if name.endswith(suf):
            name = name[: -len(suf)].strip()
    return name


def line_key(name: str) -> str:
    """표기 차이를 무시한 비교용 키.

    OSM에는 '수인·분당선'과 '수인분당선'이 함께 있다. 가운뎃점과 공백만 다르고
    같은 노선이라 그대로 두면 한 역에 둘 다 붙는다.
    """
    return re.sub(r"[\s·・‧]", "", name)


def collapse(lines: set[str]) -> list[str]:
    """운행계통·지선을 본선 하나로 접고, 표기만 다른 중복을 없앤다.

    한 역에 붙은 이름들 중 **다른 이름을 접두어로 갖는 것**을 버린다.
      {1호선, 1호선 경원·경부 계통, 1호선 경원·경부·장항 계통} -> {1호선}
      {2호선, 2호선 성수지선}                                  -> {2호선}

    계통 이름 목록을 따로 관리하지 않아도 되는 것이 이 방식의 이점이다.
    접두어 뒤에 공백을 요구해 '1호선'이 '11호선'을 잡아먹지 않게 한다.
    """
    kept = [
        a for a in lines if not any(a != b and a.startswith(b + " ") for b in lines)
    ]
    # 표기만 다른 것끼리 묶어 하나만 남긴다. 가운뎃점이 있는 쪽이 정식 표기다
    best: dict[str, str] = {}
    for name in sorted(kept):
        k = line_key(name)
        if k not in best or ("·" in name and "·" not in best[k]):
            best[k] = name
    return sorted(best.values())


def dedupe_stations(rows: list[tuple]) -> list[tuple]:
    """같은 역이 노드 여러 개로 들어온 것을 하나로 합친다.

    OSM은 복정역처럼 환승역을 운영기관별로 따로 찍어 두기도 한다
    (실측: 3m 떨어진 노드 2개). 그대로 두면 '가까운 역' 세 칸이
    같은 역 이름으로 채워진다.

    이름이 같고 500m 안이면 같은 역으로 보고 노선명을 합친다.
    이름이 같아도 먼 것은 동명이역이므로 건드리지 않는다(양평역 두 곳은 42km 떨어져 있다).
    """
    merged: list[dict] = []
    for osm_id, name, line, lng, lat, kind in rows:
        lines = set((line or "").split(" · ")) - {""}
        for m in merged:
            if m["name"] == name and dist_m(lat, lng, m["lat"], m["lng"]) <= 500:
                m["lines"] |= lines
                # 대표 노드는 id가 작은 쪽으로 고정해 재수집해도 흔들리지 않게 한다
                if osm_id < m["osm_id"]:
                    m.update(osm_id=osm_id, lng=lng, lat=lat, kind=kind)
                break
        else:
            merged.append(
                dict(osm_id=osm_id, name=name, lines=lines, lng=lng, lat=lat, kind=kind)
            )

    dropped = len(rows) - len(merged)
    if dropped:
        print(f"  중복 노드 {dropped:,}개 병합")
    return [
        (
            m["osm_id"],
            m["name"],
            " · ".join(collapse(m["lines"])) or None,
            m["lng"],
            m["lat"],
            m["kind"],
        )
        for m in merged
    ]


def dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """하버사인. 수 km 범위에서 오차 0.5% 미만이라 근접 매칭에 충분하다."""
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def to_rows(bbox: tuple, raw_in: str | None = None, raw_out: str | None = None) -> list[tuple]:
    """(osm_id, name, line, lng, lat, kind) 목록을 만든다.

    출처를 바꾸더라도 이 함수가 내놓는 모양만 맞추면 나머지는 그대로 돌아간다.

    raw_in을 주면 Overpass를 부르지 않고 저장해 둔 응답으로 변환만 다시 돌린다.
    공용 인스턴스는 한도가 빡빡해 변환 규칙을 손볼 때마다 다시 받을 수 없다.
    """
    if raw_in:
        print(f"원본 재사용 {raw_in}")
        els = json.loads(Path(raw_in).read_text(encoding="utf-8"))["elements"]
    else:
        print(f"Overpass 질의 (bbox {bbox})")
        els = overpass(query_all(bbox))["elements"]
        if raw_out:
            Path(raw_out).write_text(
                json.dumps({"elements": els}, ensure_ascii=False), encoding="utf-8"
            )
            print(f"  원본 저장 {raw_out}")

    # 한 응답에 역 노드와 멤버 노드가 섞여 온다.
    # 좌표는 전부 필요하고(pos), 역은 railway 태그로 가려낸다
    pos = {e["id"]: e for e in els if e["type"] == "node"}
    rels = [e for e in els if e["type"] == "relation"]
    nodes = [
        e
        for e in pos.values()
        if (e.get("tags") or {}).get("railway") in ("station", "halt")
    ]
    print(f"  역 {len(nodes):,}개 · 노선 {len(rels):,}개 · 노드 전체 {len(pos):,}개")

    # 멤버 노드 -> 그 노드가 속한 노선들
    node_lines: dict[int, set[str]] = {}
    for rel in rels:
        ln = line_name(rel)
        if not ln:
            continue
        for m in rel.get("members") or []:
            if m.get("type") != "node" or m["ref"] not in pos:
                continue
            node_lines.setdefault(m["ref"], set()).add(ln)

    cands = [pos[i] for i in node_lines]

    rows, matched = [], 0
    for nd in nodes:
        tags = nd.get("tags") or {}
        name = (tags.get("name:ko") or tags.get("name") or "").strip()
        if not name or NOT_STATION_RE.search(name):
            continue

        lines: set[str] = set()
        for c in cands:
            # 도 단위로 먼저 걸러 거리 계산 횟수를 줄인다 (약 0.005도 ≈ 550m)
            if abs(c["lat"] - nd["lat"]) > 0.005 or abs(c["lon"] - nd["lon"]) > 0.006:
                continue
            if dist_m(nd["lat"], nd["lon"], c["lat"], c["lon"]) <= MATCH_M:
                lines |= node_lines[c["id"]]

        if lines:
            matched += 1
        rows.append(
            (
                nd["id"],
                name,
                " · ".join(collapse(lines)) or None,
                nd["lon"],
                nd["lat"],
                tags.get("station") or tags.get("railway"),
            )
        )

    rows = dedupe_stations(rows)
    matched = sum(1 for r in rows if r[2])
    pct = matched / len(rows) * 100 if rows else 0
    print(f"\n역 {len(rows):,}개 · 노선명 {matched:,}개 ({pct:.0f}%)")
    # 노선명이 없는 역도 버리지 않는다. 이름과 거리만으로도 쓸모가 있고,
    # 화면은 line이 비면 그 줄을 감춘다
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
    ddl = (ROOT / "etl" / "sql" / "07_station.sql").read_text(encoding="utf-8")
    with psycopg.connect(dsn()) as pg:
        with pg.cursor() as cur:
            cur.execute(ddl)
            # 통째로 다시 넣는다. 수백 건이라 증분 갱신을 만들 이유가 없다
            cur.execute("TRUNCATE station")
            cur.executemany(
                "INSERT INTO station (osm_id, name, line, lng, lat, kind) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                rows,
            )
        pg.commit()
    print(f"station 적재 {len(rows):,}건")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--bbox",
        default=",".join(str(v) for v in DEFAULT_BBOX),
        help="남,서,북,동 (기본: 수도권 전역)",
    )
    ap.add_argument("--dry-run", action="store_true", help="적재하지 않고 집계만 낸다")
    ap.add_argument("--out", help="정리된 역 목록을 남길 경로 (검증용)")
    ap.add_argument("--raw-out", help="Overpass 원본 응답을 남길 경로")
    ap.add_argument(
        "--raw-in",
        help="저장해 둔 원본으로 변환만 다시 돌린다 (Overpass를 부르지 않는다)",
    )
    ap.add_argument(
        "--endpoint",
        default="main",
        help="Overpass 인스턴스. main | kumi | 전체 URL. 429가 나면 kumi로",
    )
    args = ap.parse_args()

    global OVERPASS
    OVERPASS = ENDPOINTS.get(args.endpoint, args.endpoint)

    load_dotenv(ROOT / ".env")

    try:
        bbox = tuple(float(v) for v in args.bbox.split(","))
        if len(bbox) != 4:
            raise ValueError
    except ValueError:
        raise SystemExit("--bbox 는 '남,서,북,동' 네 숫자다")

    rows = to_rows(bbox, args.raw_in, args.raw_out)
    if not rows:
        raise SystemExit("역을 하나도 받지 못했다. bbox를 확인할 것")

    if args.out:
        Path(args.out).write_text(
            json.dumps(
                [dict(zip(("osm_id", "name", "line", "lng", "lat", "kind"), r)) for r in rows],
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
        print(f"원본 저장 {args.out}")

    if args.dry_run:
        print("--dry-run 이라 적재하지 않았다")
        for r in rows[:5]:
            print(f"  {r[1]} · {r[2] or '노선명 없음'}")
        return

    load(rows)


if __name__ == "__main__":
    sys.exit(main())
