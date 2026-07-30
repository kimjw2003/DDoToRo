import { ImageResponse } from "next/og";

import { query } from "@/lib/db";
import { SERVICE_AREA } from "@/lib/region";

/*
  OG 이미지.

  레이아웃 원본은 design/assets/brand/og-image.svg다. 그 SVG를 그대로 배포하지
  않는 이유는 대부분의 SNS 크롤러가 OG 이미지로 SVG를 받지 않기 때문이다.
  여기서 PNG로 굽는다.
*/
export const alt = `DDoToRo — ${SERVICE_AREA.short} 땅값 조회`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1B150D";
const ACCENT = "#9A5048";
const PAPER = "#F9F8F5";
const RAMP = ["#FAEEE5", "#F2D2BE", "#E0AC91", "#CA6E5D", "#9A5048"];

/**
 * Google Fonts에서 필요한 글자만 받아 온다.
 *
 * 한글 폰트 전체는 수 MB라 레포에 두기 부담스럽다. CSS API의 `text=`는
 * 넘긴 글자만 담은 서브셋을 주므로 보통 수 KB로 끝난다.
 *
 * User-Agent를 옛 브라우저로 위장하는 것이 핵심이다. 최신 UA로 요청하면
 * woff2를 돌려주는데 ImageResponse가 쓰는 satori는 woff2를 읽지 못한다.
 */
async function loadFont(
  family: string,
  weight: number,
  text: string,
): Promise<ArrayBuffer | null> {
  try {
    const url =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}` +
      `:wght@${weight}&text=${encodeURIComponent(text)}`;
    const css = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; rv:1.9)" },
    }).then((r) => r.text());

    const src = css.match(/src:\s*url\((https:\/\/[^)]+)\)/);
    if (!src) return null;
    return await fetch(src[1]).then((r) => r.arrayBuffer());
  } catch {
    // 폰트를 못 받아도 이미지 생성 자체는 실패시키지 않는다
    return null;
  }
}

/** '5,210,962' — 실패하면 그 줄을 통째로 감춘다 */
async function parcelCount(): Promise<string | null> {
  try {
    const rows = await query<{ n: string }>("SELECT count(*) AS n FROM parcel");
    const n = Number(rows[0]?.n);
    return Number.isFinite(n) && n > 0 ? n.toLocaleString("ko-KR") : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const title = "DDoToRo";
  const subtitle = `${SERVICE_AREA.short} 땅값 조회`;
  const lead = "내 땅이 얼마짜리인지, 지도에서 바로 확인합니다";

  const count = await parcelCount();
  const footer = count
    ? `필지 ${count}건 · 2026년 공시지가`
    : "2026년 개별공시지가";

  const [hahmlet, plexKr, plexMono] = await Promise.all([
    loadFont("Hahmlet", 600, title),
    loadFont("IBM Plex Sans KR", 400, subtitle + lead),
    loadFont("IBM Plex Mono", 400, footer),
  ]);

  const fonts = [
    hahmlet && { name: "Hahmlet", data: hahmlet, style: "normal" as const, weight: 600 as const },
    plexKr && { name: "PlexKR", data: plexKr, style: "normal" as const, weight: 400 as const },
    plexMono && { name: "PlexMono", data: plexMono, style: "normal" as const, weight: 400 as const },
  ].filter((f): f is NonNullable<typeof f> => Boolean(f));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: PAPER,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 88px",
          position: "relative",
        }}
      >
        {/* 마크 — ㄸ. BrandMark와 같은 좌표이며 형태를 고치지 않는다 */}
        <svg width="144" height="144" viewBox="0 0 32 32" style={{ marginBottom: 28 }}>
          <g fill="none" strokeWidth={3.6} strokeLinejoin="round" strokeLinecap="round">
            <path d="M12.4 7.8 H4.4 V24.2 H12.4" stroke={INK} />
            <path d="M27.6 7.8 H19.6 V24.2 H27.6" stroke={ACCENT} />
          </g>
        </svg>

        <div
          style={{
            fontFamily: "Hahmlet",
            fontSize: 86,
            fontWeight: 600,
            letterSpacing: -2,
            color: INK,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>

        <div style={{ fontFamily: "PlexKR", fontSize: 34, color: "#5F5A52", marginTop: 18 }}>
          {subtitle}
        </div>

        <div style={{ fontFamily: "PlexKR", fontSize: 26, color: "#77716A", marginTop: 22 }}>
          {lead}
        </div>

        <div style={{ display: "flex", height: 1, background: "#E4E1DA", marginTop: 36 }} />

        <div
          style={{
            fontFamily: "PlexMono",
            fontSize: 22,
            letterSpacing: 2,
            color: "#77716A",
            marginTop: 22,
          }}
        >
          {footer}
        </div>

        {/*
          가격 램프 5단 띠.
          이 서비스가 다루는 것이 '가격'이라는 사실을 한 줄로 말한다.
        */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex" }}>
          {RAMP.map((c) => (
            <div key={c} style={{ width: 240, height: 24, background: c }} />
          ))}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
