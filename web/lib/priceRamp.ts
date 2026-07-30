import type { ExpressionSpecification } from "maplibre-gl";

/**
 * 가격 5단계 램프.
 *
 * 구간은 서비스 범위 전체 ㎡당 가격의 분위수(quantile) 5분할이다.
 * 등간격 분할은 금지한다. 지가 분포가 극단적으로 치우쳐 있어
 * 등간격으로 나누면 대부분이 1단계에 몰린다.
 *
 * 아래 경계값은 적재된 경기도 5,210,962건에서 실제로 계산한 값이다.
 *   SELECT percentile_cont(ARRAY[0.2,0.4,0.6,0.8]) WITHIN GROUP (ORDER BY price_per_sqm)
 *   FROM parcel WHERE price_per_sqm IS NOT NULL;
 *
 * 적재 범위를 바꾸면 반드시 다시 구한다. 양평군만 있을 때는
 * [21300, 42400, 77100, 156000]이었다 — 경기도를 넣자 상위 구간이 3배로 벌어졌고,
 * 옛 값을 그대로 두면 도심 필지가 전부 최상위 색으로 뭉개져 비교가 불가능해진다.
 */
export const PRICE_BREAKS = [32_600, 72_800, 162_800, 461_200] as const;

/*
  점토·벽돌 계열 단일 램프. 값의 출처는 globals.css의 --p1~--p5 하나뿐이다.
  CSS·SVG는 var()를 그대로 이해하므로 여기서는 변수 참조만 들고 있는다.
  (MapLibre만 예외다 — 아래 toRenderableColor 참고)
*/
export const RAMP = [
  "var(--p1)",
  "var(--p2)",
  "var(--p3)",
  "var(--p4)",
  "var(--p5)",
] as const;

export const NO_PRICE_COLOR = "var(--p-none)";

/**
 * MapLibre 스타일 표현식에 넣을 수 있는 색으로 바꾼다.
 *
 * MapLibre는 CSS 변수도, oklch()도 파싱하지 못한다.
 * 그대로 넣으면 `Could not parse color` 로 **레이어 추가 자체가 실패해**
 * 필지가 통째로 사라진다(배경지도는 멀쩡해서 알아채기 어렵다).
 *
 * 브라우저에 계산을 맡겨 rgb 문자열로 받아온다.
 * 이렇게 하면 globals.css가 색의 유일한 출처로 남는다.
 */
const resolved = new Map<string, string>();

function toRenderableColor(color: string): string {
  if (typeof document === "undefined") return color;
  const hit = resolved.get(color);
  if (hit) return hit;

  // 1) CSS 변수를 실제 색으로 풀어낸다
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = color;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();

  /*
    2) rgb로 바꾼다.
    Chrome은 oklch를 계산할 때 lab()으로 직렬화하는데 MapLibre는 그것도 파싱하지 못한다.
    canvas에 1픽셀 찍어 실제 RGB 값을 읽는 것이 형식에 의존하지 않는 유일한 방법이다.
  */
  let value = computed || color;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx) {
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    value = `rgb(${r}, ${g}, ${b})`;
  }

  resolved.set(color, value);
  return value;
}

/** p4·p5 위에는 흰 글자, p1~p3 위에는 먹색 글자를 올린다. */
export const RAMP_TEXT = [
  "oklch(20% 0.018 70)",
  "oklch(20% 0.018 70)",
  "oklch(20% 0.018 70)",
  "#FFFFFF",
  "#FFFFFF",
] as const;

export function priceStep(price: number | null | undefined): number {
  if (price === null || price === undefined) return -1;
  let i = 0;
  for (const b of PRICE_BREAKS) {
    if (price <= b) break;
    i++;
  }
  return i;
}

export function priceColor(price: number | null | undefined): string {
  const i = priceStep(price);
  return i < 0 ? NO_PRICE_COLOR : RAMP[i];
}

/**
 * MapLibre fill-color 표현식.
 *
 * 가격이 없는 필지는 이 레이어에서 제외하고 사선 해치 레이어가 따로 칠한다.
 * MapLibre는 fill-color와 fill-pattern을 한 레이어에서 함께 쓸 수 없다.
 */
export function fillColorExpression(): ExpressionSpecification {
  const c = RAMP.map(toRenderableColor);
  return [
    "step",
    ["to-number", ["get", "price_per_sqm"]],
    c[0],
    PRICE_BREAKS[0], c[1],
    PRICE_BREAKS[1], c[2],
    PRICE_BREAKS[2], c[3],
    PRICE_BREAKS[3], c[4],
  ];
}

/**
 * 가격 정보가 없는 필지를 칠할 45° 사선 해치 패턴을 만든다.
 * 색을 하나 더 늘리지 않고 무늬로 구분한다는 설계 결정에 따른 것이다.
 */
export function hatchImage(size = 8): ImageData | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = toRenderableColor(NO_PRICE_COLOR);
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = toRenderableColor("oklch(80% 0.006 95)");
  ctx.lineWidth = 2;
  ctx.beginPath();
  // 타일이 이어지도록 대각선을 양쪽으로 한 번씩 더 긋는다
  for (let i = -size; i < size * 2; i += 6) {
    ctx.moveTo(i, size);
    ctx.lineTo(i + size, 0);
  }
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}
