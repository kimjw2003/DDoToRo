import type { ExpressionSpecification } from "maplibre-gl";

/**
 * 가격 5단계 램프.
 *
 * 구간은 양평군 전체 ㎡당 가격의 분위수(quantile) 5분할이다.
 * 등간격 분할은 금지한다. 지가 분포가 극단적으로 치우쳐 있어
 * 등간격으로 나누면 대부분이 1단계에 몰린다.
 *
 * 아래 경계값은 적재된 343,116건에서 실제로 계산한 값이다.
 *   SELECT percentile_cont(ARRAY[0.2,0.4,0.6,0.8]) WITHIN GROUP (ORDER BY price_per_sqm)
 *   FROM parcel WHERE price_per_sqm IS NOT NULL;
 */
export const PRICE_BREAKS = [21_300, 42_400, 77_100, 156_000] as const;

export const RAMP = ["#E9F0EB", "#BCD5C6", "#86B29A", "#4E866D", "#234F3D"] as const;
export const NO_PRICE_COLOR = "#F0EEE8";

/** p4·p5 위에는 흰 글자, p1~p3 위에는 먹색 글자를 올린다. */
export const RAMP_TEXT = ["#1C1C1A", "#1C1C1A", "#1C1C1A", "#FFFFFF", "#FFFFFF"] as const;

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

/** MapLibre fill-color 표현식. 가격이 없는 필지는 별도 색으로 칠한다. */
export function fillColorExpression(): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "price_per_sqm"], null],
    NO_PRICE_COLOR,
    [
      "step",
      ["to-number", ["get", "price_per_sqm"]],
      RAMP[0],
      PRICE_BREAKS[0], RAMP[1],
      PRICE_BREAKS[1], RAMP[2],
      PRICE_BREAKS[2], RAMP[3],
      PRICE_BREAKS[3], RAMP[4],
    ],
  ];
}
