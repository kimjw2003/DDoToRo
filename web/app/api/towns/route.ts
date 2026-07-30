import { NextResponse } from "next/server";
import { query } from "@/lib/db";

type TownRow = {
  sigungu_cd: string;
  sigungu: string | null;
  emd: string;
  lng: string;
  lat: string;
  median_price_per_sqm: string | null;
  deal_count: string;
};

type CountyRow = {
  sigungu_cd: string;
  name: string;
  lng: string;
  lat: string;
  median_price_per_sqm: string | null;
  deal_count: string;
};

export type Town = {
  sigungu_cd: string;
  sigungu: string | null;
  emd: string;
  lng: number;
  lat: number;
  median_price_per_sqm: number | null;
  deal_count: number;
  /** 같은 레벨 안에서 값 순으로 5등분한 단계(0~4). 칩 색에 쓴다 */
  step: number;
};

/** 더 축소했을 때 읍면동 대신 보여줄 시군구 */
export type County = {
  sigungu_cd: string;
  name: string;
  lng: number;
  lat: number;
  median_price_per_sqm: number | null;
  deal_count: number;
  step: number;
};

/*
  실거래를 다시 수집하기 전까지 값이 바뀌지 않는다.
  좌표·필지 집계는 region_summary(머티리얼라이즈드 뷰)에서 오므로 쿼리 자체는
  가볍지만, 경기도 읍면동 수백 개를 매 요청마다 다시 묶을 이유가 없다.
  (dev는 HMR마다 비워지지만 프로덕션에서는 첫 요청만 비용을 치른다)
*/
let cached: { towns: Town[]; counties: County[] } | null = null;

/** 값 순 5분위 경계. 레벨마다 따로 구한다 */
function quantileBreaks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0];
  const cut = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return [cut(0.2), cut(0.4), cut(0.6), cut(0.8)];
}

function stepOf(value: number | null, breaks: number[]): number {
  if (value === null) return 0;
  return breaks.filter((b) => value > b).length;
}

export async function GET() {
  if (!cached) {
    /*
      읍면동.

      region_summary에 좌표와 필지 수가 이미 집계되어 있다.
      실거래는 (시군구코드, 읍면동)으로 조인한다 — 이름만으로 붙이면 다른 시의
      같은 이름 동네 거래가 섞인다.
      INNER JOIN인 이유는 칩이 '실거래 시세'를 뜻하기 때문이다.
      거래가 없는 지역에 공시지가를 대신 넣으면 두 가지 다른 값이 같은 모양으로 섞인다.
    */
    const townRows = await query<TownRow>(
      `SELECT r.sigungu_cd, r.sigungu, r.name AS emd,
              r.lng, r.lat,
              t.median_price_per_sqm,
              t.deal_count
         FROM region_summary r
         JOIN emd_trade_avg t
           ON t.sigungu_cd = r.sigungu_cd AND t.emd = r.name
        WHERE r.level = 'emd'
        ORDER BY r.sigungu_cd, r.name`,
    );

    /*
      시군구.

      읍면동 중앙값의 평균이 아니라 거래 전체에서 다시 구한다.
      읍면동마다 거래 수가 크게 달라 중앙값의 평균은 표본이 적은 동네에
      같은 무게를 주게 되고, 그러면 시 전체 시세가 실제와 어긋난다.
    */
    const countyRows = await query<CountyRow>(
      `SELECT r.sigungu_cd, r.name, r.lng, r.lat,
              d.median_price_per_sqm, d.deal_count
         FROM region_summary r
         JOIN (
           SELECT sigungu_cd,
                  count(*) AS deal_count,
                  round(percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY deal_amount / NULLIF(area_sqm, 0))::numeric)
                    AS median_price_per_sqm
             FROM land_trade
            WHERE area_sqm > 0 AND coalesce(cancel_type, '') = ''
            GROUP BY sigungu_cd
         ) d ON d.sigungu_cd = r.sigungu_cd
        WHERE r.level = 'sigungu'
        ORDER BY r.name`,
    );

    const townBase = townRows.map((r) => ({
      sigungu_cd: r.sigungu_cd.trim(),
      sigungu: r.sigungu,
      emd: r.emd,
      lng: Number(r.lng),
      lat: Number(r.lat),
      median_price_per_sqm:
        r.median_price_per_sqm === null ? null : Number(r.median_price_per_sqm),
      deal_count: Number(r.deal_count),
    }));

    const countyBase = countyRows.map((r) => ({
      sigungu_cd: r.sigungu_cd.trim(),
      name: r.name,
      lng: Number(r.lng),
      lat: Number(r.lat),
      median_price_per_sqm:
        r.median_price_per_sqm === null ? null : Number(r.median_price_per_sqm),
      deal_count: Number(r.deal_count),
    }));

    /*
      칩 색 단계는 레벨마다 그 안에서 다시 5등분한다.
      공시지가 램프 구간을 그대로 쓰면 실거래 중앙값이 대부분 최상위 두 구간에
      몰려 색이 거의 같아진다 — 지역끼리 비교가 안 된다.
    */
    const townBreaks = quantileBreaks(
      townBase
        .map((t) => t.median_price_per_sqm)
        .filter((v): v is number => v !== null),
    );
    const countyBreaks = quantileBreaks(
      countyBase
        .map((c) => c.median_price_per_sqm)
        .filter((v): v is number => v !== null),
    );

    cached = {
      towns: townBase.map((t) => ({
        ...t,
        step: stepOf(t.median_price_per_sqm, townBreaks),
      })),
      counties: countyBase.map((c) => ({
        ...c,
        step: stepOf(c.median_price_per_sqm, countyBreaks),
      })),
    };
  }

  return NextResponse.json({
    count: cached.towns.length,
    towns: cached.towns,
    counties: cached.counties,
  });
}
