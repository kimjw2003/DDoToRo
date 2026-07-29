import type { StyleSpecification } from "maplibre-gl";

/**
 * 베이스맵 정의.
 *
 * VWorld 키가 있으면 VWorld, 없으면 OSM으로 떨어진다.
 * 교체가 이 파일 안에서 끝나도록 분리해 두었다.
 *
 * 주의: VWorld WMTS는 타일 좌표가 {z}/{y}/{x} 순서다.
 * 표준 XYZ({z}/{x}/{y})와 x·y가 뒤바뀌어 있어 습관대로 쓰면 타일이 전부 어긋난다.
 */
const VWORLD_KEY = process.env.NEXT_PUBLIC_VWORLD_KEY;

// tiletype 유효값: Base(컬러) / white(백지도) / midnight / Hybrid / Satellite
const vworldTiles = (type: string) =>
  VWORLD_KEY
    ? `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/${type}/{z}/{y}/{x}.png`
    : null;

/*
  배경과 도로를 두 레이어로 나눈다.

  Base 한 장에는 배경(육지·물)과 도로·지명이 함께 그려져 있어,
  배경을 밝히면 도로까지 같이 흐려진다. 래스터라 일부만 골라낼 수 없다.

  Hybrid는 도로·철도·지명·아이콘만 담긴 투명 오버레이다(완전투명 64%).
  Base를 배경으로 깔고 그 위에 Hybrid를 얹으면,
  배경은 밝게 누르면서 도로는 선명하게 되살릴 수 있다.
  배경만 white로 바꾸면 강·산림 색까지 사라져 밋밋해진다.
*/
const VWORLD_TILES = vworldTiles("Base");
const VWORLD_OVERLAY_TILES = vworldTiles("Hybrid");

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
      ...(VWORLD_OVERLAY_TILES
        ? {
            roads: {
              type: "raster" as const,
              tiles: [VWORLD_OVERLAY_TILES],
              tileSize: 256,
              minzoom: 5,
              maxzoom: 18,
            },
          }
        : {}),
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: {
          /*
            채도를 조정할 때 CSS filter: grayscale()를 쓰면 안 된다.
            MapLibre는 베이스맵과 필지 폴리곤을 같은 WebGL 캔버스 하나에 그리므로
            캔버스에 CSS 필터를 걸면 가격 램프 색까지 함께 죽는다.
            반드시 이 레이어의 paint 속성으로 한다.

            누런 육지 배경을 밝은 회백색까지 띄운다.
            여기서 도로가 흐려지는 것은 상관없다.
            도로·지명은 위에 얹는 roads 레이어가 다시 그려준다.
          */
          "raster-saturation": usingVWorld ? -0.55 : -0.6,
          "raster-contrast": usingVWorld ? 0 : -0.15,
          "raster-brightness-min": usingVWorld ? 0.46 : 0.08,
          "raster-opacity": 1,
        },
      },
      // 도로·철도·지명 오버레이. 배경과 독립적으로 색을 조절한다
      ...(VWORLD_OVERLAY_TILES
        ? [
            {
              id: "roads",
              type: "raster" as const,
              source: "roads",
              paint: {
                // hue-rotate로 도로 색조를 돌린다 (0=원본 노랑/베이지)
                "raster-hue-rotate": ROAD_HUE,
                "raster-saturation": ROAD_SATURATION,
                "raster-opacity": ROAD_OPACITY,
              },
            },
          ]
        : []),
    ],
  };
}

/**
 * 도로·지명 오버레이 색 조절값.
 *
 * 배경과 분리된 레이어라 여기만 바꾸면 도로 색이 바뀐다.
 *   hue-rotate  0=원본(노랑·베이지) / 40=올리브 / 180=파랑 / -60=분홍
 *   saturation  -1이면 회색 도로
 */
export const ROAD_HUE = 0;
// 채도를 낮추면 도로가 탁해진다. 원본보다 올려 맑은 베이지·노랑을 살린다
export const ROAD_SATURATION = 0.3;
export const ROAD_OPACITY = 1;

/** 양평군 중심. 초기 위치이자 '현재 위치로' 복귀 지점이다. */
export const YANGPYEONG_CENTER: [number, number] = [127.4874, 37.4917];
export const INITIAL_ZOOM = 15;
export const MIN_PARCEL_ZOOM = 15;
