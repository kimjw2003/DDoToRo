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
          서체는 여기서 <link>로 불러온다.
          globals.css에서 @import 하면 Tailwind가 전개한 규칙 뒤로 밀려 CSS 스펙 위반이 된다.

          Hahmlet          표제·지번·금액 (명조)
          IBM Plex Sans KR 본문·라벨·버튼
          IBM Plex Mono    고유번호·배지·아이브로
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/*
          no-page-custom-font 규칙은 Pages Router의 개별 페이지를 전제로 한다.
          App Router의 root layout은 모든 페이지에 적용되므로 여기서는 해당하지 않는다.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@400;500;600&family=IBM+Plex+Sans+KR:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
