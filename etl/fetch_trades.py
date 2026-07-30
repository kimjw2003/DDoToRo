"""토지 매매 실거래가를 수집해 적재한다.

지번이 마스킹(`4**`)되어 제공되므로 개별 필지에 매칭할 수 없다.
읍면동 단위 집계로만 쓴다.

대상 시군구는 적재된 parcel 테이블에서 얻는다 — 코드에 목록을 적어두지 않는다.
지역을 넓히려면 필지를 먼저 적재하고 이 스크립트를 다시 돌리면 된다.

Task 1 부록에서 확인한 함정을 반영한다.
  - 응답이 XML이다 (JSON 아님)
  - dealAmount는 만원 단위 콤마 문자열이다 ('2,833' -> 28,330,000원)
  - 거래가 드문 시군구는 특정 월 0건이 정상이다

실행:
    source venv/bin/activate && python fetch_trades.py
    python fetch_trades.py --limit 900       # 하루 호출 한도를 넘기지 않게
    python fetch_trades.py --months 12
"""

import argparse
import os
import sys
import time
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

import psycopg
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
API = "http://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade"
MONTHS = 36
SLEEP = 0.3
RETRIES = 3
PAGE_SIZE = 1000

OK_CODES = {"00", "000"}

"""
하루 트래픽을 다 쓰면 API가 이 코드를 돌려준다.

개발계정은 1,000회/일이라 시군구 31개 × 36개월 = 1,116회를 한 번에 돌 수 없다.
한도에 걸리면 예외로 죽지 않고 그때까지 넣은 것을 남긴 채 멈춘다 —
수집 이력이 남아 있으므로 다음 날 다시 실행하면 이어서 받는다.
(운영계정은 100,000회/일이라 한 번에 끝난다)
"""
QUOTA_CODES = {"22"}


class QuotaExceeded(Exception):
    """일일 호출 한도 초과."""


def month_range(n: int) -> list[str]:
    """오늘 기준 최근 n개월의 YYYYMM 목록 (과거 -> 현재)."""
    today = date.today()
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def _request(key: str, lawd_cd: str, ym: str, page: int) -> tuple[list[dict], int]:
    """한 페이지를 가져온다. (항목, 전체건수)."""
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.get(
                API,
                params={
                    "serviceKey": key, "LAWD_CD": lawd_cd, "DEAL_YMD": ym,
                    "numOfRows": str(PAGE_SIZE), "pageNo": str(page),
                },
                timeout=30,
            )
            r.raise_for_status()
            root = ET.fromstring(r.content)

            code = (root.findtext(".//resultCode") or "").strip()
            if code in QUOTA_CODES:
                raise QuotaExceeded(root.findtext(".//resultMsg"))
            if code not in OK_CODES:
                msg = root.findtext(".//resultMsg")
                # 한도 초과가 다른 코드로 오는 경우까지 잡는다
                if msg and "LIMIT" in msg.upper():
                    raise QuotaExceeded(msg)
                raise RuntimeError(f"API 오류 {code}: {msg}")

            items = []
            for item in root.iterfind(".//item"):
                items.append({c.tag: (c.text or "").strip() for c in item})

            total = int(root.findtext(".//totalCount") or len(items))
            return items, total

        except QuotaExceeded:
            raise
        except Exception as e:  # noqa: BLE001 - 재시도 후 마지막 예외를 올린다
            last_err = e
            if attempt < RETRIES:
                time.sleep(SLEEP * attempt * 2)
    raise RuntimeError(f"{lawd_cd} {ym} 수집 실패 ({RETRIES}회 시도): {last_err}")


def fetch_month(key: str, lawd_cd: str, ym: str) -> tuple[list[dict], int]:
    """한 달치 전부를 가져온다. (항목, 호출 횟수).

    거래가 많은 시군구는 한 달에 1,000건을 넘는다. 첫 페이지의 totalCount를
    보고 남은 페이지를 마저 받지 않으면 조용히 잘린 데이터가 쌓인다.
    """
    items, total = _request(key, lawd_cd, ym, 1)
    calls = 1

    while len(items) < total:
        calls += 1
        time.sleep(SLEEP)
        more, _ = _request(key, lawd_cd, ym, calls)
        if not more:
            break
        items.extend(more)

    return items, calls


def to_won(amount: str | None) -> int | None:
    """'2,833' (만원) -> 28,330,000 (원).

    콤마를 빼고 만원 단위를 원으로 환산한다. 이 처리를 놓치면 금액이 10,000배 틀린다.
    """
    if not amount:
        return None
    try:
        return int(amount.replace(",", "").strip()) * 10_000
    except ValueError:
        return None


def to_float(v: str | None) -> float | None:
    if not v:
        return None
    try:
        return float(v.replace(",", "").strip())
    except ValueError:
        return None


def split_umd(umd: str | None) -> tuple[str | None, str | None]:
    """'지평면 망미리' -> ('지평면', '망미리').

    parcel.emd와 조인하려면 읍면 단위로 맞춰야 한다.
    """
    if not umd:
        return None, None
    t = umd.split()
    if len(t) >= 2:
        return t[0], " ".join(t[1:])
    return t[0], None


def dsn() -> str:
    return (
        f"host={os.getenv('PGHOST', 'localhost')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'ddotoro')} user={os.getenv('PGUSER', 'ddotoro')} "
        f"password={os.getenv('PGPASSWORD', 'ddotoro_local')}"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=MONTHS)
    ap.add_argument("--limit", type=int, default=0,
                    help="이번 실행에서 쓸 최대 API 호출 수 (0이면 무제한)")
    ap.add_argument("--sigungu", nargs="*", metavar="코드",
                    help="대상 시군구 코드. 생략하면 적재된 필지의 전체 시군구")
    ap.add_argument("--refetch", action="store_true",
                    help="이미 수집한 (시군구, 월)도 다시 가져온다")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    key = os.getenv("RTMS_SERVICE_KEY")
    if not key:
        sys.exit(".env에 RTMS_SERVICE_KEY가 없다")

    with psycopg.connect(dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute((Path(__file__).parent / "sql" / "02_land_trade.sql").read_text())
            cur.execute((Path(__file__).parent / "sql" / "04_trade_fetch_log.sql").read_text())
        conn.commit()

        # 대상 시군구는 적재된 필지에서 얻는다
        if args.sigungu:
            targets = sorted(set(args.sigungu))
        else:
            with conn.cursor() as cur:
                # 주소가 붙은 필지가 하나도 없는 코드는 제외한다.
                # 원본에 PNU만 있고 주소가 빈 필지가 0.05%쯤 있는데, 그중에는
                # 실재하지 않는 시군구코드(41601 등)가 섞여 있어 그대로 두면
                # 응답이 0건인 줄 알면서 36개월씩 호출을 태우게 된다.
                cur.execute(
                    "SELECT DISTINCT sigungu_cd FROM parcel "
                    "WHERE sigungu_cd IS NOT NULL AND sigungu IS NOT NULL "
                    "ORDER BY 1"
                )
                targets = [r[0].strip() for r in cur.fetchall()]

        if not targets:
            sys.exit("대상 시군구가 없다. 필지를 먼저 적재할 것.")

        months = month_range(args.months)

        # 이미 받은 (시군구, 월)
        done: set[tuple[str, str]] = set()
        if not args.refetch:
            with conn.cursor() as cur:
                cur.execute("SELECT sigungu_cd, deal_ym FROM trade_fetch_log")
                done = {(a.strip(), b.strip()) for a, b in cur.fetchall()}

        todo = [(s, m) for s in targets for m in months if (s, m) not in done]
        print(f"시군구 {len(targets)}개 × {len(months)}개월 = {len(targets)*len(months):,}칸")
        print(f"이미 수집 {len(done):,}칸 / 남은 작업 {len(todo):,}칸")
        if args.limit:
            print(f"이번 실행 호출 한도: {args.limit:,}회")
        print("-" * 60)

        calls = total_items = 0
        quota_hit = False

        for sigungu_cd, ym in todo:
            if args.limit and calls >= args.limit:
                print(f"\n지정한 호출 한도({args.limit:,})에 도달해 멈춘다.")
                break
            try:
                items, used = fetch_month(key, sigungu_cd, ym)
            except QuotaExceeded as e:
                print(f"\n일일 호출 한도 초과로 중단한다: {e}")
                quota_hit = True
                break

            calls += used
            total_items += len(items)
            time.sleep(SLEEP)

            rows = []
            for d in items:
                emd, ri = split_umd(d.get("umdNm"))
                rows.append((
                    d.get("sggCd") or sigungu_cd, emd, ri, ym,
                    int(d["dealDay"]) if (d.get("dealDay") or "").isdigit() else None,
                    to_won(d.get("dealAmount")),
                    to_float(d.get("dealArea")),
                    d.get("jimok") or None,
                    d.get("landUse") or None,
                    d.get("shareDealingType") or None,
                    d.get("dealingGbn") or None,
                    d.get("cdealType") or None,
                    psycopg.types.json.Jsonb(d),
                ))

            with conn.cursor() as cur:
                """
                (시군구, 월) 단위로 갈아끼운다.

                월만 보고 지우면 같은 달의 다른 시군구 데이터까지 날아간다.
                행 단위 중복 제거를 쓰지 않는 이유는 따로 있다 — 같은
                (읍면리, 일자, 금액, 면적, 지목) 조합이 실제로 여러 건 존재해서
                UNIQUE 제약을 걸면 정상 거래가 사라진다(양평에서 1,489건 확인).
                """
                cur.execute(
                    "DELETE FROM land_trade WHERE sigungu_cd = %s AND deal_ym = %s",
                    (sigungu_cd, ym),
                )
                if rows:
                    cur.executemany(
                        "INSERT INTO land_trade (sigungu_cd, emd, ri, deal_ym, deal_day, "
                        "deal_amount, area_sqm, jimok, land_use, share_type, dealing_gbn, "
                        "cancel_type, raw) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        rows,
                    )
                # 0건도 기록해야 다음 실행에서 건너뛴다
                cur.execute(
                    "INSERT INTO trade_fetch_log (sigungu_cd, deal_ym, item_count) "
                    "VALUES (%s,%s,%s) ON CONFLICT (sigungu_cd, deal_ym) "
                    "DO UPDATE SET item_count = EXCLUDED.item_count, fetched_at = now()",
                    (sigungu_cd, ym, len(items)),
                )
            conn.commit()

            if len(items):
                print(f"  {sigungu_cd} {ym}  {len(items):>4}건"
                      f"{'  (페이징 ' + str(used) + '회)' if used > 1 else ''}", flush=True)

        print("=" * 60)
        print(f"API 호출: {calls:,}회 / 수집: {total_items:,}건")
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM trade_fetch_log")
            got = cur.fetchone()[0]
        remaining = len(targets) * len(months) - got
        if remaining > 0:
            print(f"남은 작업 {remaining:,}칸. 다시 실행하면 이어서 받는다"
                  f"{' (내일 이후)' if quota_hit else ''}.")
        else:
            print("전 구간 수집 완료.")


if __name__ == "__main__":
    main()
