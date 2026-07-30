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
  area_sqm: number | null;
  price_per_sqm: number | null;
  price_year: number | null;
  lng: number;
  lat: number;
  geometry: string;
  /** `[[연도, 원/㎡], ...]` JSON 문자열 */
  price_history: string | null;
  deal_count: number | null;
  avg_price_per_sqm: number | null;
  median_price_per_sqm: number | null;
  from_ym: string | null;
  to_ym: string | null;
};

/** 이보다 먼 역은 '가까운 역'이 아니다. stations.ts 참고 */
const STATION_MAX_M = 15_000;

export function isValidPnu(pnu: string) {
  return /^\d{19}$/.test(pnu);
}

/**
 * 두 지점의 직선거리(m).
 *
 * PostGIS의 `ST_Distance(geography)`를 대신한다. 역 목록이 짧아 앱에서 재는
 * 편이 쿼리를 도는 것보다 빠르다. 하버사인이라 지구를 구로 보지만,
 * 수 km 범위에서 오차는 0.5% 미만이라 '가까운 역'을 고르는 데 충분하다.
 */
function distanceM(aLng: number, aLat: number, bLng: number, bLat: number) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** `[[2026,10800], ...]` -> `[{year, price_per_sqm}, ...]` */
function parseHistory(raw: string | null) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as [number, number | null][];
    return arr
      .filter((p) => Array.isArray(p) && p.length >= 1)
      .map(([year, price]) => ({ year, price_per_sqm: price ?? null }))
      .sort((a, b) => a.year - b.year);
  } catch {
    return [];
  }
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
            p.lng, p.lat,
            p.geojson AS geometry,
            p.price_history,
            t.deal_count, t.avg_price_per_sqm, t.median_price_per_sqm,
            t.from_ym, t.to_ym
       FROM parcel p
       -- 읍면동 이름은 시군구를 넘으면 유일하지 않다. 코드까지 맞춰야
       -- 다른 시의 거래가 이 필지의 지역 시세로 붙는 사고를 막는다
       LEFT JOIN emd_trade_avg t
              ON t.sigungu_cd = p.sigungu_cd AND t.emd = p.emd
      WHERE p.pnu = ?`,
    [pnu],
  );

  const r = rows[0];
  if (!r) return null;

  const nearby_stations = STATIONS.map((s) => ({
    name: s.name,
    line: s.line,
    distance_m: Math.round(distanceM(r.lng, r.lat, s.lng, s.lat)),
  }))
    .filter((s) => s.distance_m <= STATION_MAX_M)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 3);

  const total_price =
    r.area_sqm !== null && r.price_per_sqm !== null
      ? Math.round(r.area_sqm * r.price_per_sqm)
      : null;

  return {
    pnu: r.pnu,
    sido: r.sido,
    sigungu: r.sigungu,
    emd: r.emd,
    ri: r.ri,
    jibun: r.jibun,
    jimok: r.jimok,
    area_sqm: r.area_sqm,
    price_per_sqm: r.price_per_sqm,
    price_year: r.price_year,
    total_price,
    lng: r.lng,
    lat: r.lat,
    geometry: JSON.parse(r.geometry),
    price_history: parseHistory(r.price_history),
    nearby_stations,
    emd_trade_avg:
      r.deal_count === null
        ? null
        : {
            emd: r.emd,
            deal_count: r.deal_count,
            avg_price_per_sqm: r.avg_price_per_sqm,
            median_price_per_sqm: r.median_price_per_sqm,
            from_ym: r.from_ym,
            to_ym: r.to_ym,
          },
  };
}
