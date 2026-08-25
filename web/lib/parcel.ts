import type { InValue } from "@libsql/client";

import { readAssetJson } from "@/lib/assets.server";
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
  /**
   * 연도별 공시지가. 연도 오름차순.
   *
   * 지금은 5개년(2022~2026)이지만 과거 자료를 더 확보하면 그대로 늘어난다.
   * 화면에서 연도 수를 고정으로 가정하지 말 것.
   */
  price_history: { year: number; price_per_sqm: number | null }[];
  /** 가까운 순 3개. 직선거리(m)만 준다 — 도로 경로가 아니다 */
  nearby_stations: { name: string; line: string; distance_m: number }[];
  /**
   * 카테고리별 **가장 가까운 하나**. 개수를 세지 않는다.
   * 반경 안에 없으면 distance_m이 null이고, 자리는 남는다.
   */
  nearby_facilities: {
    kind: string;
    name: string | null;
    distance_m: number | null;
  }[];
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

/** etl/build_details.py가 굽는 파일 한 개. 지역명은 법정동 안에서 같아 위로 올려 둔다 */
type DetailFile = {
  sigungu_cd: string;
  sido: string | null;
  sigungu: string | null;
  emd: string | null;
  ri: string | null;
  /** 키는 PNU 뒤 9자리 (산여부 + 본번 + 부번) */
  parcels: Record<string, DetailEntry>;
};

type DetailEntry = {
  jibun: string | null;
  jimok: string | null;
  area_sqm: number | null;
  price_per_sqm: number | null;
  price_year: number | null;
  lng: number;
  lat: number;
  geometry: Parcel["geometry"];
  /** `[[연도, 원/㎡], ...]` */
  price_history: [number, number | null][];
};

type TradeRow = {
  deal_count: number | null;
  avg_price_per_sqm: number | null;
  median_price_per_sqm: number | null;
  from_ym: string | null;
  to_ym: string | null;
};

/**
 * 이보다 먼 역은 '가까운 역'이 아니다.
 *
 * 자르지 않으면 역이 드문 군 지역 필지에 수십 km 밖 역이 붙는다.
 * 시골 땅에 '가장 가까운 역 38km'는 정보가 아니라 소음이다.
 */
const STATION_MAX_M = 15_000;

export function isValidPnu(pnu: string) {
  return /^\d{19}$/.test(pnu);
}

/**
 * 두 지점의 직선거리(m).
 *
 * PostGIS의 `ST_Distance(geography)`를 대신한다 — 웹 DB는 SQLite라 공간 함수가 없다.
 * 하버사인이라 지구를 구로 보지만, 수 km 범위에서 오차는 0.5% 미만이라
 * '가까운 역'을 고르는 데 충분하다.
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

/**
 * 가까운 역 세 곳.
 *
 * 2차까지는 lib/stations.ts에 경의중앙선 9개가 상수로 박혀 있었다.
 * 경기도 전역으로 넓힌 뒤에도 그대로여서 양평군 밖 필지에는 결과가 비었다 —
 * 복정역이 코앞인 성남 필지가 '역 정보가 없습니다'로 나왔다.
 *
 * 이제 station 테이블에서 읽는다(etl/fetch_stations.py가 채운다).
 * 위도로 먼저 잘라 후보를 줄인 뒤 거리를 잰다. 경도는 자르지 않는다 —
 * 위도에 따라 경도 1도의 길이가 달라져 상수 하나로 자를 수 없고,
 * 위도 한 겹만 잘라도 700행이 수십 행으로 줄어든다.
 *
 * 거리 계산을 SQL이 아니라 앱에서 하는 이유: SQLite에는 삼각함수가 있지만
 * 컬럼 계산이라 인덱스를 못 타고, 어차피 후보가 수십 행이라 차이가 없다.
 */
async function nearbyStations(lng: number, lat: number) {
  // 위도 1도 ≈ 111km. 15km는 약 0.135도다
  const dLat = STATION_MAX_M / 111_000;

  const rows = await query<{
    name: string;
    line: string | null;
    lng: number;
    lat: number;
  }>(
    "SELECT name, line, lng, lat FROM station WHERE lat BETWEEN ? AND ?",
    [lat - dLat, lat + dLat],
  );

  return rows
    .map((s) => ({
      name: s.name,
      // 노선명이 없는 역도 버리지 않는다. 이름과 거리만으로도 쓸모가 있다
      line: s.line ?? "",
      distance_m: Math.round(distanceM(lng, lat, s.lng, s.lat)),
    }))
    .filter((s) => s.distance_m <= STATION_MAX_M)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 3);
}

/**
 * 카테고리별 최대 탐색 반경(m).
 *
 * 카테고리마다 '그 이상은 의미가 없는' 거리가 다르다.
 * 버스정류장이 8km 밖에 있으면 교통편이 없는 것이고, 면사무소는 20km도 정상이다.
 * 넉넉하게 잡으면 조회가 무거워지고, 좁게 잡으면 시골 필지가 전부 빈칸이 된다.
 */
const FACILITY_MAX_M: Record<string, number> = {
  school: 15_000,
  hospital: 15_000,
  store: 8_000,
  office: 20_000,
  bus: 5_000,
};

/** 화면에 뜨는 순서다. ParcelPanel의 CategoryIcon 이름과 같아야 한다 */
const FACILITY_ORDER = ["school", "hospital", "store", "office", "bus"] as const;

/**
 * 카테고리별 '가장 가까운 하나'.
 *
 * 개수를 세지 않는다 — 시골 땅에서 '반경 500m 내 30개'는 의미가 없고,
 * 사려는 사람이 묻는 것은 '가장 가까운 초등학교가 몇 km인가'다.
 *
 * 다섯 카테고리를 **한 질의**로 묶는다. Turso는 원격 HTTP라 왕복 한 번이
 * 100~200ms다. 카테고리마다 따로 쏘면 그것만으로 1초가 붙는다.
 *
 * 정렬은 하버사인이 아니라 평면 근사다. 등경도 보정(cos lat)만 넣으면
 * 수십 km 범위에서 순위가 뒤바뀌지 않으므로, 후보를 고르는 데는 이걸로 충분하고
 * 화면에 쓸 실제 거리만 앱에서 하버사인으로 다시 잰다.
 */
async function nearbyFacilities(lng: number, lat: number) {
  // 위도 1도 ≈ 111km. 경도 1도는 위도에 따라 줄어든다
  const mPerLat = 111_000;
  const mPerLng = 111_000 * Math.cos((lat * Math.PI) / 180);
  // 평면 근사에서 경도 차를 위도 차와 같은 척도로 만드는 계수
  const lngScale = (mPerLng / mPerLat) ** 2;

  const parts: string[] = [];
  const args: InValue[] = [];
  for (const kind of FACILITY_ORDER) {
    const r = FACILITY_MAX_M[kind];
    const dLat = r / mPerLat;
    const dLng = r / mPerLng;
    parts.push(
      `SELECT * FROM (
         SELECT kind, name, lng, lat FROM poi
          WHERE kind = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
          ORDER BY (lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) * ?
          LIMIT 1)`,
    );
    args.push(
      kind,
      lat - dLat, lat + dLat,
      lng - dLng, lng + dLng,
      lat, lat, lng, lng, lngScale,
    );
  }

  const rows = await query<{
    kind: string;
    name: string | null;
    lng: number;
    lat: number;
  }>(parts.join(" UNION ALL "), args);

  const found = new Map(rows.map((r) => [r.kind, r]));

  // 없는 카테고리도 자리를 남긴다 — 목록이 필지마다 들쭉날쭉하면 비교가 어렵다
  return FACILITY_ORDER.map((kind) => {
    const r = found.get(kind);
    return {
      kind,
      name: r?.name ?? null,
      distance_m: r ? Math.round(distanceM(lng, lat, r.lng, r.lat)) : null,
    };
  });
}

/** `[[2026,10800], ...]` -> `[{year, price_per_sqm}, ...]` */
function parseHistory(raw: [number, number | null][] | undefined) {
  if (!raw) return [];
  return raw
    .filter((p) => Array.isArray(p) && p.length >= 1)
    .map(([year, price]) => ({ year, price_per_sqm: price ?? null }))
    .sort((a, b) => a.year - b.year);
}

/**
 * 필지 한 건을 읍면 실거래 집계와 함께 읽는다.
 *
 * 필지는 DB가 아니라 미리 구워둔 파일에서 온다 — 경로가 PNU에서 그대로
 * 계산되므로 색인을 거치지 않는다 (etl/build_details.py 참고).
 *   PNU 4111112900 1 0100 0001  ->  details/4111112900/1.json.gz
 *          └법정동┘  └본번┘         └ 디렉토리 ┘ └ 본번 끝자리
 *
 * 실거래 집계는 DB에 남는다. 필지가 아니라 지역 단위라 행이 몇천 개뿐이고,
 * 갱신 주기도 공시지가(연 1회)와 달라 파일에 함께 굽지 않는 편이 낫다.
 * 지번이 마스킹되어 제공되므로 반드시 읍면 단위로만 붙인다.
 */
export async function getParcel(pnu: string): Promise<Parcel | null> {
  if (!isValidPnu(pnu)) return null;

  const file = await readAssetJson<DetailFile>(
    `details/${pnu.slice(0, 10)}/${pnu[14]}.json.gz`,
  );
  const p = file?.parcels?.[pnu.slice(10)];
  if (!file || !p) return null;

  const trade = await query<TradeRow>(
    // 읍면동 이름은 시군구를 넘으면 유일하지 않다. 코드까지 맞춰야
    // 다른 시의 거래가 이 필지의 지역 시세로 붙는 사고를 막는다
    `SELECT deal_count, avg_price_per_sqm, median_price_per_sqm, from_ym, to_ym
       FROM emd_trade_avg
      WHERE sigungu_cd = ? AND emd = ?`,
    [file.sigungu_cd, file.emd],
  );
  const t = trade[0];

  // 둘 다 DB 왕복이라 나란히 보낸다. 순서대로 기다리면 지연이 두 배가 된다
  const [nearby_stations, nearby_facilities] = await Promise.all([
    nearbyStations(p.lng, p.lat),
    nearbyFacilities(p.lng, p.lat),
  ]);

  const total_price =
    p.area_sqm !== null && p.price_per_sqm !== null
      ? Math.round(p.area_sqm * p.price_per_sqm)
      : null;

  return {
    pnu,
    sido: file.sido,
    sigungu: file.sigungu,
    emd: file.emd,
    ri: file.ri,
    jibun: p.jibun,
    jimok: p.jimok,
    area_sqm: p.area_sqm,
    price_per_sqm: p.price_per_sqm,
    price_year: p.price_year,
    total_price,
    lng: p.lng,
    lat: p.lat,
    geometry: p.geometry,
    price_history: parseHistory(p.price_history),
    nearby_stations,
    nearby_facilities,
    emd_trade_avg:
      !t || t.deal_count === null
        ? null
        : {
            emd: file.emd,
            deal_count: t.deal_count,
            avg_price_per_sqm: t.avg_price_per_sqm,
            median_price_per_sqm: t.median_price_per_sqm,
            from_ym: t.from_ym,
            to_ym: t.to_ym,
          },
  };
}
