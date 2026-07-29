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
  area_sqm: string | null;
  price_per_sqm: string | null;
  price_year: number | null;
  geometry: string;
};

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

  // && 는 bounding box 교차 연산자로 GIST 인덱스를 탄다.
  // 상한보다 1건 더 받아 잘렸는지 판별한다
  const rows = await query<Row>(
    `SELECT pnu, emd, ri, jibun, jimok, area_sqm, price_per_sqm, price_year,
            ST_AsGeoJSON(geom) AS geometry
       FROM parcel
      WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      LIMIT $5`,
    [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, MAX_FEATURES + 1],
  );

  const truncated = rows.length > MAX_FEATURES;
  const sliced = truncated ? rows.slice(0, MAX_FEATURES) : rows;

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
        // NUMERIC/BIGINT는 pg가 정밀도 보존을 위해 문자열로 준다. 숫자로 바꿔 내려보낸다
        area_sqm: r.area_sqm === null ? null : Number(r.area_sqm),
        price_per_sqm: r.price_per_sqm === null ? null : Number(r.price_per_sqm),
        price_year: r.price_year,
      },
    })),
    too_far: false,
    truncated,
    count: sliced.length,
  });
}
