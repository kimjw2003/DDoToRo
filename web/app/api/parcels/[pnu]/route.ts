import { NextResponse } from "next/server";
import { query } from "@/lib/db";

type Row = {
  pnu: string;
  sido: string | null;
  sigungu: string | null;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: string | null;
  price_per_sqm: string | null;
  price_year: number | null;
  total_price: string | null;
  geometry: string;
  // count(*)는 BIGINT라 pg가 문자열로 준다. number로 선언하면 조용히 틀린다
  deal_count: string | null;
  avg_price_per_sqm: string | null;
  median_price_per_sqm: string | null;
  from_ym: string | null;
  to_ym: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));

// RouteContext는 Next.js 16의 전역 헬퍼로, 경로 리터럴에서 params 타입을 끌어온다
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/parcels/[pnu]">,
) {
  const { pnu } = await ctx.params;

  // PNU는 19자리 문자열이다. 숫자로 다루면 선행 0이 날아간다
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { error: "PNU는 19자리 숫자여야 합니다" },
      { status: 400 },
    );
  }

  // 실거래는 읍면 단위 집계로만 조인한다.
  // 지번이 마스킹되어 제공되므로 필지 단위 매칭은 원천적으로 불가능하다
  const rows = await query<Row>(
    `SELECT p.pnu, p.sido, p.sigungu, p.emd, p.ri, p.jibun, p.jimok,
            p.area_sqm, p.price_per_sqm, p.price_year,
            round(p.area_sqm * p.price_per_sqm) AS total_price,
            ST_AsGeoJSON(p.geom) AS geometry,
            t.deal_count, t.avg_price_per_sqm, t.median_price_per_sqm,
            t.from_ym, t.to_ym
       FROM parcel p
       LEFT JOIN emd_trade_avg t ON t.emd = p.emd
      WHERE p.pnu = $1`,
    [pnu],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "필지를 찾을 수 없습니다" }, { status: 404 });
  }

  const r = rows[0];
  return NextResponse.json({
    pnu: r.pnu,
    sido: r.sido,
    sigungu: r.sigungu,
    emd: r.emd,
    ri: r.ri,
    jibun: r.jibun,
    jimok: r.jimok,
    area_sqm: num(r.area_sqm),
    price_per_sqm: num(r.price_per_sqm),
    price_year: r.price_year,
    total_price: num(r.total_price),
    geometry: JSON.parse(r.geometry),

    // 필드명에 반드시 '읍면 집계'임이 드러나야 한다.
    // 이 필지의 거래 기록이 아니며, 화면에도 그 사실을 명시해야 한다
    emd_trade_avg:
      r.deal_count === null
        ? null
        : {
            emd: r.emd,
            deal_count: num(r.deal_count),
            avg_price_per_sqm: num(r.avg_price_per_sqm),
            median_price_per_sqm: num(r.median_price_per_sqm),
            from_ym: r.from_ym,
            to_ym: r.to_ym,
            note: "이 필지의 거래 기록이 아닌 읍면 단위 평균입니다",
          },
  });
}
