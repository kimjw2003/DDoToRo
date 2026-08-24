import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
 * 서체를 레포 안에서 읽는다.
 *
 * 3차에서 Pretendard 하나로 통일했는데 Pretendard는 Google Fonts에 없다.
 * 그래서 2차의 CSS API + `text=` 서브셋 방식을 쓸 수 없다.
 *
 * 또 하나 —
 * **ImageResponse가 쓰는 satori는 woff2를 읽지 못한다.** 화면용으로 받아 둔
 * public/fonts의 woff2 청크를 그대로 가져다 쓰면 조용히 실패한다.
 * app/_fonts에 KS X 1001 서브셋 **woff**를 따로 두는 이유다.
 * (`_` 로 시작하는 폴더는 Next.js가 라우팅에서 제외한다)
 *
 * 읽는 방식은 `readFile(join(process.cwd(), "assets/…"))` 다 — Next 16이 문서화한 형태다.
 * **경로를 리터럴로 적는다.** 변수로 조립하면 빌드의 파일 추적이 놓쳐
 * 배포본 함수 번들에 폰트가 빠진다.
 *
 * `fetch(new URL(…, import.meta.url))` 은 쓰지 말 것 —
 * Turbopack 빌드에서 file: URL로 풀려 fetch가 던지고,
 * 폰트가 0개가 되어 "No fonts are loaded"로 빌드가 죽는다.
 */
async function loadFonts(): Promise<{
  regular: Buffer | null;
  bold: Buffer | null;
}> {
  try {
    const [regular, bold] = await Promise.all([
      readFile(join(process.cwd(), "assets/Pretendard-Regular.subset.woff")),
      readFile(join(process.cwd(), "assets/Pretendard-Bold.subset.woff")),
    ]);
    return { regular, bold };
  } catch {
    // 폰트를 못 읽어도 이미지 생성 자체는 실패시키지 않는다
    return { regular: null, bold: null };
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

  const { regular, bold } = await loadFonts();

  // 서체는 하나다. 굵기만 둘 등록한다
  const fonts = [
    regular && {
      name: "Pretendard",
      data: regular,
      style: "normal" as const,
      weight: 400 as const,
    },
    bold && {
      name: "Pretendard",
      data: bold,
      style: "normal" as const,
      weight: 700 as const,
    },
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
          // 서체는 Pretendard 하나다. 아래 블록들은 굵기·크기만 다르다
          fontFamily: "Pretendard",
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
            fontSize: 88,
            fontWeight: 700,
            letterSpacing: -2.8,
            color: INK,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>

        <div style={{ fontSize: 34, color: "#5F5A52", marginTop: 18 }}>
          {subtitle}
        </div>

        <div style={{ fontSize: 26, color: "#77716A", marginTop: 22 }}>
          {lead}
        </div>

        <div
          style={{ display: "flex", height: 1, background: "#E4E1DA", marginTop: 36 }}
        />

        <div style={{ fontSize: 22, color: "#77716A", marginTop: 22 }}>
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
