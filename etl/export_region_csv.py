"""지역별 땅값 집계를 CSV 한 장으로 내보낸다.

공공데이터포털 활용사례 등록의 '공유 데이터' 첨부용이며, 개별공시지가(필지 단위)와
토지 실거래가(오픈API)를 읍면동·시군구 단위로 결합한 파생 데이터다.

원본 필지는 521만 건 3.5GB라 첨부 한도(10MB)에 들어가지 않는다. 그리고 실거래는
지번이 마스킹되어 제공되므로 애초에 필지 단위로 결합할 수 없다 — 지역 집계가
두 데이터를 함께 볼 수 있는 유일한 단위다.

읍면동은 이름만으로 묶지 않는다. 시군구를 넘으면 이름이 겹치므로
반드시 (sigungu_cd, emd) 쌍으로 결합한다.

실행:
    python export_region_csv.py            # 경기도 전체
    python export_region_csv.py --out /경로/파일.csv
"""

import argparse
import csv
import sqlite3
from pathlib import Path

DB = Path(__file__).parent / "out" / "ddotoro-small.db"
OUT = Path(__file__).parent / "out" / "지역별_공시지가_실거래_집계.csv"

# 한국 사용자는 평으로 사고한다. ㎡ 값에 이걸 곱하면 평당 값이다
SQM_PER_PYEONG = 3.3058

HEADER = [
    "구분",
    "시도",
    "시군구코드",
    "시군구",
    "읍면동",
    "필지수",
    "공시지가_기준연도",
    "공시지가_중앙값_원_per_㎡",
    "공시지가_중앙값_원_per_평",
    "실거래_건수",
    "실거래_중앙값_원_per_㎡",
    "실거래_중앙값_원_per_평",
    "실거래_평균_원_per_㎡",
    "실거래_집계시작_년월",
    "실거래_집계종료_년월",
    "중심점_경도",
    "중심점_위도",
]


def per_pyeong(v):
    return round(v * SQM_PER_PYEONG) if v is not None else None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DB))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    # 공시지가 기준연도는 전 필지가 같다. 한 번만 읽어 모든 행에 적는다
    year = con.execute("SELECT MAX(price_year) FROM parcel").fetchone()[0]

    rows = []

    # 시군구 — 실거래 집계 테이블의 컬럼이 읍면동 쪽과 다르다(평균·기간이 없다)
    for r in con.execute(
        """SELECT r.sigungu_cd, r.sido, r.name, r.lng, r.lat,
                  r.parcel_count, r.median_official,
                  t.deal_count, t.median_price_per_sqm
             FROM region_summary r
             LEFT JOIN sigungu_trade_avg t ON t.sigungu_cd = r.sigungu_cd
            WHERE r.level = 'sigungu'
            ORDER BY r.sigungu_cd"""
    ):
        rows.append([
            "시군구", r["sido"], r["sigungu_cd"], r["name"], "",
            r["parcel_count"], year,
            r["median_official"], per_pyeong(r["median_official"]),
            r["deal_count"],
            r["median_price_per_sqm"], per_pyeong(r["median_price_per_sqm"]),
            "", "", "",
            round(r["lng"], 6), round(r["lat"], 6),
        ])

    # 읍면동 — 이름이 아니라 (시군구코드, 이름) 쌍으로 결합한다
    for r in con.execute(
        """SELECT r.sigungu_cd, r.sido, r.sigungu, r.name, r.lng, r.lat,
                  r.parcel_count, r.median_official,
                  t.deal_count, t.median_price_per_sqm, t.avg_price_per_sqm,
                  t.from_ym, t.to_ym
             FROM region_summary r
             LEFT JOIN emd_trade_avg t
                    ON t.sigungu_cd = r.sigungu_cd AND t.emd = r.name
            WHERE r.level = 'emd'
            ORDER BY r.sigungu_cd, r.name"""
    ):
        rows.append([
            "읍면동", r["sido"], r["sigungu_cd"], r["sigungu"], r["name"],
            r["parcel_count"], year,
            r["median_official"], per_pyeong(r["median_official"]),
            r["deal_count"],
            r["median_price_per_sqm"], per_pyeong(r["median_price_per_sqm"]),
            r["avg_price_per_sqm"],
            r["from_ym"], r["to_ym"],
            round(r["lng"], 6), round(r["lat"], 6),
        ])

    con.close()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig — BOM이 없으면 엑셀이 한글을 깨뜨린다
    with out.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)

    size = out.stat().st_size
    n_sig = sum(1 for r in rows if r[0] == "시군구")
    n_emd = len(rows) - n_sig
    n_trade = sum(1 for r in rows if r[9] is not None)

    print(f"{out}")
    print(f"  {len(rows):,}행 (시군구 {n_sig} · 읍면동 {n_emd:,})")
    print(f"  실거래 집계 있음 {n_trade:,}행 ({n_trade / len(rows) * 100:.0f}%)")
    print(f"  {size / 1024:.0f} KB  (첨부 한도 10MB)")


if __name__ == "__main__":
    main()
