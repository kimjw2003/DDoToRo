"""Task 3: 양평군 토지 매매 실거래가를 수집해 적재한다.

지번이 마스킹(`4**`)되어 제공되므로 개별 필지에 매칭할 수 없다.
읍면동 단위 집계로만 쓴다.

Task 1 부록에서 확인한 함정을 반영한다.
  - 응답이 XML이다 (JSON 아님)
  - dealAmount는 만원 단위 콤마 문자열이다 ('2,833' -> 28,330,000원)
  - 지분 거래가 섞여 있어 ㎡당 단가를 왜곡한다 (집계 뷰에서 제외)
  - 양평군은 거래가 드물어 특정 월 0건은 정상이다

실행:
    source venv/bin/activate && python fetch_trades.py
"""

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
LAWD_CD = "41830"   # 양평군
MONTHS = 36
SLEEP = 0.3
RETRIES = 3


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


def fetch_month(key: str, ym: str) -> list[dict]:
    """한 달치를 가져온다. 0건은 정상이므로 빈 리스트를 돌려준다."""
    last_err = None
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.get(
                API,
                params={
                    "serviceKey": key, "LAWD_CD": LAWD_CD, "DEAL_YMD": ym,
                    "numOfRows": "1000", "pageNo": "1",
                },
                timeout=30,
            )
            r.raise_for_status()
            root = ET.fromstring(r.content)

            code = root.findtext(".//resultCode")
            if code not in ("000", "00"):
                raise RuntimeError(f"API 오류 {code}: {root.findtext('.//resultMsg')}")

            items = []
            for item in root.iterfind(".//item"):
                d = {}
                for child in item:
                    text = (child.text or "").strip()
                    d[child.tag] = text
                items.append(d)
            return items

        except Exception as e:  # noqa: BLE001 - 재시도 후 마지막 예외를 올린다
            last_err = e
            if attempt < RETRIES:
                time.sleep(SLEEP * attempt * 2)
    raise RuntimeError(f"{ym} 수집 실패 ({RETRIES}회 시도): {last_err}")


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
    load_dotenv(ROOT / ".env")
    key = os.getenv("RTMS_SERVICE_KEY")
    if not key:
        sys.exit(".env에 RTMS_SERVICE_KEY가 없다")

    with psycopg.connect(dsn()) as conn:
        with conn.cursor() as cur:
            cur.execute((Path(__file__).parent / "sql" / "02_land_trade.sql").read_text())
        conn.commit()

        months = month_range(MONTHS)
        print(f"수집 범위: {months[0]} ~ {months[-1]} ({len(months)}개월)")

        total, months_with_data, masked_sample = 0, 0, None
        for ym in months:
            items = fetch_month(key, ym)
            time.sleep(SLEEP)
            if not items:
                continue  # 양평군은 거래가 드물어 0건이 정상이다
            months_with_data += 1
            total += len(items)
            if masked_sample is None:
                masked_sample = items[0]

            rows = []
            for d in items:
                emd, ri = split_umd(d.get("umdNm"))
                rows.append((
                    d.get("sggCd") or LAWD_CD, emd, ri, ym,
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
                # 월 단위로 갈아끼운다. 같은 (읍면리,일자,금액,면적,지목) 조합이
                # 실제로 여러 건 존재하므로 행 단위 중복 제거를 쓰면 정상 거래가 사라진다
                cur.execute("DELETE FROM land_trade WHERE deal_ym = %s", (ym,))
                cur.executemany(
                    "INSERT INTO land_trade (sigungu_cd, emd, ri, deal_ym, deal_day, "
                    "deal_amount, area_sqm, jimok, land_use, share_type, dealing_gbn, "
                    "cancel_type, raw) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    rows,
                )
            conn.commit()
            print(f"  {ym}  {len(items):>3}건", flush=True)

        print("=" * 60)
        print(f"데이터가 있는 개월: {months_with_data}/{len(months)}")
        print(f"총 거래 건수: {total:,}")
        if masked_sample:
            print(f"지번 마스킹 확인: jibun={masked_sample.get('jibun')!r} "
                  f"(umdNm={masked_sample.get('umdNm')!r})")


if __name__ == "__main__":
    main()
