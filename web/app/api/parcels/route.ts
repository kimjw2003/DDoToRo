import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// z15 미만에서는 필지를 그리지 않는다. 34만 건을 한 번에 내려보내면 브라우저가 죽는다.
const MIN_ZOOM = 15;
const MAX_FEATURES = 3000;

type Row = {
  pnu: string;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: number | null;
  price_per_sqm: number | null;
  price_year: number | null;
  geometry: string;
};

/*
  경계상자 조회의 하한 여백(도).

  `minx <= 화면동단` 하나만 걸면 화면 서쪽의 모든 필지가 후보가 되어 인덱스가
  무의미해진다(실측 139ms). minx에 하한을 주면 범위 스캔이 좁아져 13ms로 떨어진다.

  값은 적재된 필지의 실제 최대 크기에서 왔다 — 폭 0.0862도, 높이 0.1219도.
  이보다 작게 잡으면 큰 임야 필지가 조용히 누락된다. 넉넉히 반올림해 둔다.
    SELECT max(maxx-minx), max(maxy-miny) FROM parcel;
*/
const BBOX_MARGIN_LNG = 0.09;
const BBOX_MARGIN_LAT = 0.13;

function parseBbox(raw: string | null) {
  if (!raw) return null;
  const p = raw.split(",").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = p;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const zoom = Number(searchParams.get("zoom") ?? NaN);
  if (!Number.isFinite(zoom)) {
    return NextResponse.json({ error: "zoom이 필요합니다" }, { status: 400 });
  }

  // 줌이 낮으면 쿼리 자체를 하지 않는다
  if (zoom < MIN_ZOOM) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: [],
      too_far: true,
      truncated: false,
      count: 0,
      min_zoom: MIN_ZOOM,
    });
  }

  const bbox = parseBbox(searchParams.get("bbox"));
  if (!bbox) {
    return NextResponse.json(
      { error: "bbox 형식이 올바르지 않습니다 (minLng,minLat,maxLng,maxLat)" },
      { status: 400 },
    );
  }

  /*
    경계상자 교차.

    두 상자가 겹치려면 `내 시작 <= 상대 끝` 이고 `내 끝 >= 상대 시작` 이면 된다.
    앞쪽 조건에 BBOX_MARGIN으로 하한을 더해 idx_parcel_bbox의 범위 스캔을 좁힌다.
    상한보다 1건 더 받아 잘렸는지 판별한다.
  */
  const rows = await query<Row>(
    `SELECT pnu, emd, ri, jibun, jimok, area_sqm, price_per_sqm, price_year,
            geojson AS geometry
       FROM parcel
      WHERE minx BETWEEN ? AND ? AND maxx >= ?
        AND miny BETWEEN ? AND ? AND maxy >= ?
      LIMIT ?`,
    [
      bbox.minLng - BBOX_MARGIN_LNG, bbox.maxLng, bbox.minLng,
      bbox.minLat - BBOX_MARGIN_LAT, bbox.maxLat, bbox.minLat,
      MAX_FEATURES + 1,
    ],
  );

  const truncated = rows.length > MAX_FEATURES;
  const sliced = truncated ? rows.slice(0, MAX_FEATURES) : rows;

  /*
    CDN 캐시.

    공시지가는 연 1회(1월 1일 기준), 필지 경계는 그보다도 드물게 바뀐다.
    같은 화면을 보는 요청끼리 결과가 다를 이유가 없으므로 길게 캐시한다.
    클라이언트가 bbox를 격자에 맞춰 보내기 때문에(ParcelMap의 snapBbox)
    URL이 이산적이고, 지도를 되돌리는 이동은 CDN에서 바로 응답된다.

    데이터를 새로 적재하면 재배포로 캐시가 비워진다 — 연 1회 갱신 주기와 맞다.
    stale-while-revalidate로 만료 뒤에도 일단 옛 응답을 주고 뒤에서 갱신한다.
  */
  return NextResponse.json({
    type: "FeatureCollection",
    features: sliced.map((r) => ({
      type: "Feature",
      id: r.pnu,
      geometry: JSON.parse(r.geometry),
      properties: {
        pnu: r.pnu,
        emd: r.emd,
        ri: r.ri,
        jibun: r.jibun,
        jimok: r.jimok,
        area_sqm: r.area_sqm,
        price_per_sqm: r.price_per_sqm,
        price_year: r.price_year,
      },
    })),
    too_far: false,
    truncated,
    count: sliced.length,
  }, {
    headers: {
      "Cache-Control":
        "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
