import { query } from "@/lib/db";
import { STATIONS } from "@/lib/stations";

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
  /**
   * 연도별 공시지가. 연도 오름차순.
   *
   * 지금은 5개년(2022~2026)이지만 과거 자료를 더 확보하면 그대로 늘어난다.
   * 화면에서 연도 수를 고정으로 가정하지 말 것.
   */
  price_history: { year: number; price_per_sqm: number | null }[];
  /** 가까운 순 3개. 직선거리(m)만 준다 — 도로 경로가 아니다 */
  nearby_stations: { name: string; line: string; distance_m: number }[];
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
  price_history: { year: number; price_per_sqm: number | null }[] | null;
  // count(*)와 NUMERIC은 pg가 문자열로 준다
  deal_count: string | null;
  avg_price_per_sqm: string | null;
  median_price_per_sqm: string | null;
  from_ym: string | null;
  to_ym: string | null;
};

const num = (v: string | null) => (v === null ? null : Number(v));

/** 이보다 먼 역은 '가까운 역'이 아니다. stations.ts 참고 */
const STATION_MAX_M = 15_000;

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
            t.from_ym, t.to_ym,
            -- 연도 수가 늘어나도 쿼리를 고치지 않도록 집계로 받는다
            (SELECT json_agg(json_build_object(
                      'year', h.price_year,
                      'price_per_sqm', h.price_per_sqm)
                    ORDER BY h.price_year)
               FROM parcel_price_history h
              WHERE h.pnu = p.pnu) AS price_history
       FROM parcel p
       -- 읍면동 이름은 시군구를 넘으면 유일하지 않다. 코드까지 맞춰야
       -- 다른 시의 거래가 이 필지의 지역 시세로 붙는 사고를 막는다
       LEFT JOIN emd_trade_avg t
              ON t.sigungu_cd = p.sigungu_cd AND t.emd = p.emd
      WHERE p.pnu = $1`,
    [pnu],
  );

  const r = rows[0];
  if (!r) return null;

  /*
    역까지의 직선거리.
    geography로 캐스팅해야 미터가 나온다 — 4326 그대로 재면 도(degree) 단위라
    값이 무의미해진다.
    역 목록이 짧아 한 번의 쿼리로 전부 재고 가까운 순으로 자른다.

    STATION_MAX_M로 자르는 이유는 stations.ts에 아직 일부 노선만 있기 때문이다.
    자르지 않으면 수원 필지에 40km 밖 양평역이 '가장 가까운 역'으로 붙어
    사실이 아닌 정보가 된다. 목록이 경기도 전체로 채워지면 이 제한은 자연히 무의미해진다.
  */
  const stationRows = await query<{ idx: string; distance_m: string }>(
    `SELECT idx, distance_m FROM (
       SELECT s.idx, ST_Distance(
                ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
              ) AS distance_m
         FROM unnest($3::int[], $4::float8[], $5::float8[]) AS s(idx, lng, lat)
     ) d
      WHERE d.distance_m <= ${STATION_MAX_M}
      ORDER BY distance_m
      LIMIT 3`,
    [
      r.lng,
      r.lat,
      STATIONS.map((_, i) => i),
      STATIONS.map((s) => s.lng),
      STATIONS.map((s) => s.lat),
    ],
  );

  const nearby_stations = stationRows.map((s) => {
    const st = STATIONS[Number(s.idx)];
    return {
      name: st.name,
      line: st.line,
      distance_m: Math.round(Number(s.distance_m)),
    };
  });

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
    // 이력이 하나도 없으면 json_agg가 null을 준다
    price_history: r.price_history ?? [],
    nearby_stations,
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
