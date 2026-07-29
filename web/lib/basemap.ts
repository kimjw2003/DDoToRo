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

/*
  tiletype 유효값: Base(컬러) / white(백지도) / midnight / Hybrid / Satellite

  Base(컬러)를 쓴다. white는 무채색이라 가격 램프와 충돌이 전혀 없지만,
  강·도로·지명·시설이 사라져 "내 땅이 어디쯤인지" 알아보기 어렵다는 판단이다.
*/
const VWORLD_TILES = VWORLD_KEY
  ? `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`
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
            채도를 조정할 때 CSS filter: grayscale()를 쓰면 안 된다.
            MapLibre는 베이스맵과 필지 폴리곤을 같은 WebGL 캔버스 하나에 그리므로
            캔버스에 CSS 필터를 걸면 가격 램프 색까지 함께 죽는다.
            반드시 이 레이어의 paint 속성으로 한다.

            컬러 지도는 채도를 살짝만 낮춰 배경이 필지 색을 이기지 않게 한다.
            완전히 빼면(-1) 지명·도로 구분이 흐려져 컬러로 바꾼 의미가 사라진다.
            OSM 폴백은 색이 강해 조금 더 눌러준다.
          */
          "raster-saturation": usingVWorld ? -0.5 : -0.6,
          "raster-contrast": usingVWorld ? -0.12 : -0.15,
          // VWorld 육지 배경이 누런 베이지라 밝기 하한을 올려 톤을 띄운다.
          // 배경이 연해질수록 위에 얹은 가격 램프가 또렷해진다
          "raster-brightness-min": usingVWorld ? 0.24 : 0.08,
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
