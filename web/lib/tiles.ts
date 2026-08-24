import { assetUrl } from "@/lib/assets";
import { MIN_PARCEL_ZOOM } from "@/lib/basemap";
import type { ParcelProps } from "@/components/ParcelMap";

/*
  정적 필지 타일.

  필지를 DB에서 '찾는' 대신 미리 구워둔 파일을 '가져온다'. 파일 이름이 화면
  좌표에서 그대로 계산되므로 조회에 DB가 필요 없고, 적재된 필지가 몇 개든
  브라우저가 받는 파일 수는 화면 크기에만 달린다 — 전국 확장의 전제다.

  파일은 etl/build_tiles.py가 굽는다. 여기 상수를 바꾸면 거기도 같이 바꿔야 한다.
*/

/*
  화면 줌보다 몇 단계 굵은 타일을 받을지.

  같은 줌의 타일을 받으면 1400×900 화면이 타일 30개를 덮는다(양평 실측).
  두 단계 굵게 잡으면 4~6개로 줄고, 파일이 커진 만큼 gzip도 더 잘 든다.
  전송량은 오히려 줄었다 — z16 화면에서 606KB → 340KB.
*/
const ZOOM_OFFSET = 2;

/*
  구워둔 타일 단계. 이 밖은 만들지 않는다.

  아래로는 MIN_PARCEL_ZOOM(z15) 화면이 쓰는 z13이 끝이다. 그보다 멀리서는
  필지를 그리지 않으므로 타일도 필요 없다.

  위로는 z15가 끝이고 **이 단계만 상한 없이 굽는다.** 상한은 멀리서 볼 때
  전송량을 묶으려고 두는 것인데, 가장 깊은 단계에까지 걸면 확대해도 작은
  필지가 영영 빠진다 — 사용자가 아무리 확대해도 볼 수 없는 땅이 생긴다.
  깊은 단계는 화면에 타일이 1~2개만 들어와 상한을 뺴도 전송량이 늘지 않고
  (양평 실측 평균 26KB · 최대 89KB), 용량도 28MB로 상한을 걸었을 때와 같았다.
*/
const MIN_TILE_ZOOM = MIN_PARCEL_ZOOM - ZOOM_OFFSET;
const MAX_TILE_ZOOM = 15;

/** 한 화면이 덮는 타일 수 상한. 이보다 많으면 무언가 잘못된 것이다 */
const MAX_TILES_PER_VIEW = 24;

export type TileKey = { z: number; x: number; y: number };

export function tileZoomFor(viewportZoom: number): number {
  const z = Math.floor(viewportZoom) - ZOOM_OFFSET;
  return Math.max(MIN_TILE_ZOOM, Math.min(MAX_TILE_ZOOM, z));
}

export function lngToTileX(lng: number, z: number): number {
  const n = 2 ** z;
  return Math.max(0, Math.min(n - 1, Math.floor(((lng + 180) / 360) * n)));
}

/** 위도 → 타일 y. 타일 원점이 북서쪽이라 위도가 올라갈수록 y는 작아진다 */
export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const rad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n;
  return Math.max(0, Math.min(n - 1, Math.floor(y)));
}

export type Bounds = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

/** 화면을 덮는 타일 목록 */
export function coveringTiles(b: Bounds, z: number): TileKey[] {
  const x0 = lngToTileX(b.minLng, z);
  const x1 = lngToTileX(b.maxLng, z);
  // 위도가 뒤집히므로 북쪽(maxLat)이 y의 시작이다
  const y0 = latToTileY(b.maxLat, z);
  const y1 = latToTileY(b.minLat, z);

  const out: TileKey[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  }
  return out.slice(0, MAX_TILES_PER_VIEW);
}

export function tileUrl({ z, x, y }: TileKey): string {
  return assetUrl(`tiles/${z}/${x}/${y}.json.gz`);
}

export type ParcelFeature = {
  type: "Feature";
  id?: string;
  geometry: GeoJSON.Geometry;
  properties: ParcelProps;
};

type TileBody = {
  features: ParcelFeature[];
  truncated?: boolean;
};

export type TileResult = {
  collection: GeoJSON.FeatureCollection;
  truncated: boolean;
  count: number;
};

/**
 * 화면에 필요한 타일을 모두 받아 하나로 합친다.
 *
 * 필지는 경계상자가 걸치는 모든 타일에 들어 있으므로(그래야 옆 칸을 볼 때
 * 큰 임야가 사라지지 않는다) 같은 필지가 여러 파일에서 온다. PNU로 걷어낸다.
 */
export async function fetchParcelTiles(
  b: Bounds,
  viewportZoom: number,
  signal?: AbortSignal,
): Promise<TileResult> {
  const tiles = coveringTiles(b, tileZoomFor(viewportZoom));

  const bodies = await Promise.all(
    tiles.map(async (t): Promise<TileBody | null> => {
      const res = await fetch(tileUrl(t), { signal });
      // 필지가 없는 칸은 파일 자체가 없다. 404는 정상이다
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`tile ${t.z}/${t.x}/${t.y}: ${res.status}`);
      return res.json();
    }),
  );

  const byPnu = new Map<string, ParcelFeature>();
  let truncated = false;

  for (const body of bodies) {
    if (!body) continue;
    if (body.truncated) truncated = true;
    for (const f of body.features) {
      // MapLibre의 feature-state는 id로 건다. 선택 표시가 여기에 달려 있다
      if (!byPnu.has(f.properties.pnu)) {
        byPnu.set(f.properties.pnu, { ...f, id: f.properties.pnu });
      }
    }
  }

  const features = [...byPnu.values()];
  return {
    collection: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection,
    truncated,
    count: features.length,
  };
}
