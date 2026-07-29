/** 화면 표기 규칙. 금액·면적·용어를 여기서만 포맷한다. */

const PYEONG = 3.3058;

/**
 * 원 단위 정수를 한국식으로 읽는다. `321800000` -> `3억 2,180만원`
 *
 * `321,800,000원`처럼 쓰지 않는다. 일반 사용자는 자릿수를 세지 않는다.
 */
export function formatWon(won: number | null | undefined): string {
  if (won === null || won === undefined || !Number.isFinite(won)) return "—";
  if (won === 0) return "0원";

  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);

  if (eok > 0) {
    return man > 0 ? `${eok}억 ${man.toLocaleString()}만원` : `${eok}억원`;
  }
  if (man > 0) return `${man.toLocaleString()}만원`;
  return `${won.toLocaleString()}원`;
}

/** 단가처럼 작게 쓰는 자리에는 원 단위를 그대로 보여준다. */
export function formatWonPlain(won: number | null | undefined): string {
  if (won === null || won === undefined || !Number.isFinite(won)) return "—";
  return `${Math.round(won).toLocaleString()}원`;
}

/** 한국 사용자는 평으로 사고한다. ㎡를 쓸 때는 항상 평을 병기한다. */
export function formatArea(sqm: number | null | undefined): string {
  if (sqm === null || sqm === undefined || !Number.isFinite(sqm)) return "—";
  const pyeong = Math.round(sqm / PYEONG);
  return `${Math.round(sqm).toLocaleString()}㎡ (${pyeong.toLocaleString()}평)`;
}

export function toPyeong(sqm: number): number {
  return sqm / PYEONG;
}

/**
 * 지목은 전문용어라 괄호로 풀어쓴다. `전` -> `전(밭)`
 *
 * 도로·하천처럼 일반인이 아는 말은 그대로 둔다.
 */
const JIMOK_HINT: Record<string, string> = {
  전: "밭",
  답: "논",
  임야: "산",
  대: "집터",
  구거: "도랑",
  제방: "둑",
  유지: "물이 고인 땅",
  잡종지: "기타",
  광천지: "온천",
  종교용지: "종교시설",
  사적지: "문화재",
};

export function formatJimok(jimok: string | null | undefined): string {
  if (!jimok) return "—";
  const hint = JIMOK_HINT[jimok];
  return hint ? `${jimok}(${hint})` : jimok;
}

/** `문호리 245-7` 형태. 리가 없는 동 지역은 지번만 나온다. */
export function formatJibun(
  ri: string | null | undefined,
  jibun: string | null | undefined,
): string {
  return [ri, jibun].filter(Boolean).join(" ") || "—";
}

/** `경기 양평군 서종면`. '경기도'는 '경기'로 줄여 쓴다. */
export function formatRegion(
  sido: string | null | undefined,
  sigungu: string | null | undefined,
  emd: string | null | undefined,
): string {
  const short = sido?.replace(/도$|특별시$|광역시$/, "") ?? "";
  return [short, sigungu, emd].filter(Boolean).join(" ");
}

/** `202308` -> `2023년 8월` */
export function formatYm(ym: string | null | undefined): string {
  if (!ym || ym.length !== 6) return "—";
  return `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;
}
