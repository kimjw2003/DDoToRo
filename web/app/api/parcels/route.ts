import { NextResponse } from "next/server";
import { query } from "@/lib/db";

// z15 미만에서는 필지를 그리지 않는다. 수백만 건을 한 번에 내려보낼 수 없다.
const MIN_ZOOM = 15;
const MAX_FEATURES = 3000;

/*
  상한에 걸릴 때 무엇을 남길 것인가.

  z16 화면 하나에 필지가 5,000~15,000개 들어온다 — 시골도 마찬가지다
  (가평 7,871 · 양평 8,882). 상한 3,000개는 거의 모든 화면에서 걸리므로
  '잘리느냐'가 아니라 '무엇이 남느냐'가 실제 문제다.

  예전에는 순서를 정하지 않아 아무거나 남았고, 그래서 눈에 띄는 큰 필지가
  빠지고 몇 픽셀짜리가 자리를 차지했다(z16에서 1픽셀은 약 2.4m, 100㎡ 필지는
  4×4 픽셀이다). 면적 큰 것부터 채우면 화면에서 의미 있는 것이 남는다.

  최소 면적 임계값을 두는 방법도 재봤지만 버렸다. 도심은 작은 필지가 많고
  시골은 큰 필지가 많아 같은 값이 지역마다 전혀 다르게 작동한다 —
  300㎡로 걸러도 양평은 10,591개가 남았다. 정렬은 그 차이에 저절로 적응한다.
*/

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
      -- 상한에 걸리면 큰 필지부터 남긴다 (위 주석 참고).
      -- bbox 인덱스로 좁힌 뒤 정렬하므로 양평 74ms · 성남 50ms에 그친다
      ORDER BY area_sqm DESC
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
