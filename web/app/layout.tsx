import type { Metadata } from "next";
import "./globals.css";
import { SERVICE_AREA } from "@/lib/region";

export const metadata: Metadata = {
  title: `DDoToRo — ${SERVICE_AREA.short} 땅값 조회`,
  description:
    `지도에서 필지를 누르면 공시지가와 면적, 지목을 보여줍니다. ` +
    `${SERVICE_AREA.name} 개별공시지가 조회 서비스.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <head>
        {/*
          서체는 Pretendard Variable 하나다. 여기서 <link>로 불러온다 —
          globals.css에서 @import 하면 Tailwind가 전개한 규칙 뒤로 밀려 CSS 스펙 위반이 된다.

          파일은 node_modules/pretendard에서 public/fonts/로 복사된다
          (package.json의 copy:fonts, predev/prebuild가 실행). 외부 CDN을 타지 않는다.

          동적 서브셋인 것이 핵심이다. 92개 @font-face가 unicode-range로 쪼개져 있어
          브라우저가 화면에 실제로 뜬 글자의 청크만 받는다. 디스크에는 3.1MB가 있지만
          한 페이지 전송량은 보통 40~80KB다. 통짜 variable(woff2 1.1MB)로 바꾸지 말 것.
        */}
        {/*
          no-css-tags는 "번들러에 맡겨라"는 규칙이지만 여기서는 맞지 않는다.
          이 CSS는 92개 @font-face를 unicode-range로 쪼갠 서브셋 매니페스트라
          globals.css에서 @import 하면 Tailwind가 전개한 규칙 뒤로 밀려
          CSS 스펙 위반이 되고, 발견 시점도 한 왕복 늦어진다.
          <head>의 <link>여야 브라우저가 즉시 폰트를 찾아 나선다.
        */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link
          rel="stylesheet"
          href="/fonts/pretendard/pretendardvariable-dynamic-subset.css"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
