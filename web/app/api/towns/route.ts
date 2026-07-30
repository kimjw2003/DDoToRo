import { NextResponse } from "next/server";
import { query } from "@/lib/db";

type Row = {
  emd: string;
  lng: number;
  lat: number;
  median_price_per_sqm: string | null;
  deal_count: string;
};

export type Town = {
  emd: string;
  lng: number;
  lat: number;
  median_price_per_sqm: number | null;
  deal_count: number;
  /** 12개 읍면을 값 순으로 5등분한 단계(0~4). 칩 색에 쓴다 */
  step: number;
};

/** 더 축소했을 때 읍면 12개 대신 보여줄 시군구 한 덩어리 */
export type County = {
  name: string;
  lng: number;
  lat: number;
  median_price_per_sqm: number | null;
  deal_count: number;
};

/*
  읍면 12개는 실거래를 다시 수집하기 전까지 값이 바뀌지 않는다.
  집계 쿼리가 34만 건을 훑어 580ms쯤 걸리므로 프로세스 메모리에 담아둔다.
  (dev는 HMR마다 비워지지만 프로덕션에서는 첫 요청만 비용을 치른다)
*/
let cached: { towns: Town[]; county: County } | null = null;

export async function GET() {
  if (!cached) {
    /*
      대표 좌표는 필지 중심점들의 평균이다.
      ST_Extent(bbox 중심)가 3배 빠르지만 옥천면 기준 3.3km까지 어긋난다 —
      읍면 경계가 산으로 길게 뻗은 곳에서 칩이 마을이 아닌 능선에 찍힌다.
    */
    const rows = await query<Row>(
      `SELECT p.emd,
              avg(ST_X(ST_Centroid(p.geom))) AS lng,
              avg(ST_Y(ST_Centroid(p.geom))) AS lat,
              t.median_price_per_sqm,
              t.deal_count
         FROM parcel p
         JOIN emd_trade_avg t ON t.emd = p.emd
        GROUP BY p.emd, t.median_price_per_sqm, t.deal_count
        ORDER BY p.emd`,
    );

    const base = rows.map((r) => ({
      emd: r.emd,
      lng: Number(r.lng),
      lat: Number(r.lat),
      median_price_per_sqm:
        r.median_price_per_sqm === null ? null : Number(r.median_price_per_sqm),
      deal_count: Number(r.deal_count),
    }));

    /*
      칩 색 단계는 읍면 12개 안에서 다시 5등분한다.
      공시지가 램프 구간(21,300~156,000)을 그대로 쓰면 실거래 중앙값이
      대부분 최상위 두 구간에 몰려 색이 거의 같아진다 — 비교가 안 된다.
    */
    const sorted = base
      .map((t) => t.median_price_per_sqm)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const cut = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const breaks = [cut(0.2), cut(0.4), cut(0.6), cut(0.8)];

    const towns: Town[] = base.map((t) => ({
      ...t,
      step:
        t.median_price_per_sqm === null
          ? 0
          : breaks.filter((b) => t.median_price_per_sqm! > b).length,
    }));

    // 시군구는 읍면 중앙값의 평균이 아니라 거래 전체에서 다시 구한다
    const [c] = await query<{ deals: string; median_sqm: string | null }>(
      `SELECT count(*) AS deals,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY deal_amount / NULLIF(area_sqm, 0)) AS median_sqm
         FROM land_trade
        WHERE area_sqm > 0 AND coalesce(cancel_type, '') = ''`,
    );

    cached = {
      towns,
      county: {
        name: "양평군",
        lng: base.reduce((s, t) => s + t.lng, 0) / base.length,
        lat: base.reduce((s, t) => s + t.lat, 0) / base.length,
        median_price_per_sqm:
          c?.median_sqm == null ? null : Math.round(Number(c.median_sqm)),
        deal_count: Number(c?.deals ?? 0),
      },
    };
  }

  return NextResponse.json({
    count: cached.towns.length,
    towns: cached.towns,
    county: cached.county,
  });
}
