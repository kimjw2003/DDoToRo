import type { StyleSpecification } from "maplibre-gl";

/**
 * 베이스맵 정의.
 *
 * VWorld 키가 있으면 white(무채색 지도), 없으면 OSM으로 떨어진다.
 * 교체가 이 파일 안에서 끝나도록 분리해 두었다.
 *
 * 주의: VWorld WMTS는 타일 좌표가 {z}/{y}/{x} 순서다.
 * 표준 XYZ({z}/{x}/{y})와 x·y가 뒤바뀌어 있어 습관대로 쓰면 타일이 전부 어긋난다.
 */
const VWORLD_KEY = process.env.NEXT_PUBLIC_VWORLD_KEY;

const VWORLD_TILES = VWORLD_KEY
  ? `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/white/{z}/{y}/{x}.png`
  : null;

// OSM 공식 타일 서버는 사용 정책상 실서비스에 쓸 수 없다. 개발용 폴백이다
const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export const usingVWorld = Boolean(VWORLD_TILES);

export function basemapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [VWORLD_TILES ?? OSM_TILES],
        tileSize: 256,
        minzoom: 5,
        // VWorld는 z18이 상한이다. 그 이상에서는 확대해 쓴다.
        // 배경만 흐려지고 필지 폴리곤은 벡터라 선명하게 유지된다
        maxzoom: 18,
        attribution: usingVWorld
          ? '<a href="https://www.vworld.kr" target="_blank" rel="noreferrer">VWorld</a>'
          : '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: {
          /*
            CSS filter: grayscale()를 쓰면 안 된다.
            MapLibre는 베이스맵과 필지 폴리곤을 같은 WebGL 캔버스 하나에 그리므로
            캔버스에 CSS 필터를 걸면 가격 램프 색까지 함께 죽는다.
            채도 제거는 반드시 이 레이어의 paint 속성으로 한다.
          */
          "raster-saturation": -1,
          "raster-contrast": usingVWorld ? 0 : -0.15,
          "raster-opacity": 1,
        },
      },
    ],
  };
}

/** 양평군 중심. 초기 위치이자 '현재 위치로' 복귀 지점이다. */
export const YANGPYEONG_CENTER: [number, number] = [127.4874, 37.4917];
export const INITIAL_ZOOM = 15;
export const MIN_PARCEL_ZOOM = 15;
