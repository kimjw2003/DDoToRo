/**
 * DDoToRo 마크 — ㄸ
 *
 * 서비스 이름의 첫 자음이고, 두 획 사이의 흰 틈은 필지를 가르는 길이다.
 * 원본 파일은 `public/brand/mark.svg`이며 여기에 인라인으로 두는 이유는
 * 헤더에서 요청을 한 번 줄이고 바탕에 따라 색을 바꿔 쓰기 위해서다.
 *
 * 형태를 고치기 전에 DESIGN.md의 '브랜드 마크' 절을 읽는다.
 * 특히 가로획이 12.4 / 27.6에서 끊기는 것은 의도된 값이다 —
 * 둥근 캡이 1.8을 더 뻗어 원래 폭 14.2 / 29.4에 정확히 닿는다.
 * 캡을 butt로 바꾸거나 좌표를 14.2 / 29.4로 되돌리면 마크가 틀어진다.
 *
 * 색을 토큰(var(--ink) 등)으로 바꾸지 않는다. 이 마크는 OG·파비콘과 같은 값이어야 하고
 * 그쪽은 외부에서 렌더되어 CSS 변수를 읽지 못한다.
 */

const INK = "#1B150D";
const ACCENT = "#9A5048";
const PAPER = "#F9F8F5";

type Tone = "duo" | "solid" | "mono" | "reverse";

/** duo: 먹+벽돌(주 마크) · solid: 벽돌 단색 · mono: 먹 단색 · reverse: 어두운 바탕용 */
export default function BrandMark({
  size = 32,
  tone = "duo",
}: {
  size?: number;
  tone?: Tone;
}) {
  const left =
    tone === "duo" ? INK : tone === "mono" ? INK : tone === "reverse" ? PAPER : ACCENT;
  const right = tone === "mono" ? INK : tone === "reverse" ? PAPER : ACCENT;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <g
        fill="none"
        strokeWidth={3.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M12.4 7.8 H4.4 V24.2 H12.4" stroke={left} />
        <path d="M27.6 7.8 H19.6 V24.2 H27.6" stroke={right} />
      </g>
    </svg>
  );
}
