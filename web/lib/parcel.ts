import { query } from "@/lib/db";

/** 필지 상세. API 라우트와 SSR 페이지가 같은 형태를 쓴다. */
export type Parcel = {
  pnu: string;
  sido: string | null;
  sigungu: string | null;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: number | null;
  price_per_sqm: number | null;
  price_year: number | null;
  total_price: number | null;
  lng: number;
  lat: number;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  emd_trade_avg: {
    emd: string | null;
    deal_count: number;
    avg_price_per_sqm: number | null;
    median_price_per_sqm: number | null;
    from_ym: string | null;
    to_ym: string | null;
  } | null;
};

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
  lng: number;
  lat: number;
  geometry: string;
  // count(*)와 NUMERIC은 pg가 문자열로 준다
  deal_count: string | null;
  avg_price_per_sqm: string | null;
  median_price_per_sqm: string | null;
  from_ym: string | null;
  to_ym: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));

export function isValidPnu(pnu: string) {
  return /^\d{19}$/.test(pnu);
}

/**
 * 필지 한 건을 읍면 실거래 집계와 함께 읽는다.
 *
 * 실거래는 지번이 마스킹되어 제공되므로 필지 단위 매칭이 불가능하다.
 * 반드시 읍면 단위 집계로만 붙인다.
 */
export async function getParcel(pnu: string): Promise<Parcel | null> {
  if (!isValidPnu(pnu)) return null;

  const rows = await query<Row>(
    `SELECT p.pnu, p.sido, p.sigungu, p.emd, p.ri, p.jibun, p.jimok,
            p.area_sqm, p.price_per_sqm, p.price_year,
            round(p.area_sqm * p.price_per_sqm) AS total_price,
            ST_X(ST_Centroid(p.geom)) AS lng,
            ST_Y(ST_Centroid(p.geom)) AS lat,
            ST_AsGeoJSON(p.geom) AS geometry,
            t.deal_count, t.avg_price_per_sqm, t.median_price_per_sqm,
            t.from_ym, t.to_ym
       FROM parcel p
       LEFT JOIN emd_trade_avg t ON t.emd = p.emd
      WHERE p.pnu = $1`,
    [pnu],
  );

  const r = rows[0];
  if (!r) return null;

  return {
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
    lng: r.lng,
    lat: r.lat,
    geometry: JSON.parse(r.geometry),
    emd_trade_avg:
      r.deal_count === null
        ? null
        : {
            emd: r.emd,
            deal_count: Number(r.deal_count),
            avg_price_per_sqm: num(r.avg_price_per_sqm),
            median_price_per_sqm: num(r.median_price_per_sqm),
            from_ym: r.from_ym,
            to_ym: r.to_ym,
          },
  };
}
