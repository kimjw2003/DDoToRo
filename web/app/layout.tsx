import type { Metadata } from "next";
import { Nanum_Myeongjo } from "next/font/google";
import "./globals.css";

/*
  명조는 숫자와 지번에만 쓴다.
  토지대장·등기부등본 같은 공적 장부가 명조로 인쇄되기 때문이며,
  공시지가가 시세가 아니라 공적으로 고시된 가격임을 서체로 전달한다.
  UI 나머지는 Pretendard(globals.css에서 로드)를 쓴다.
*/
const myeongjo = Nanum_Myeongjo({
  variable: "--font-myeongjo",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DDoToRo — 경기 양평군 땅값 조회",
  description:
    "지도에서 필지를 누르면 공시지가와 면적, 지목을 보여줍니다. 경기도 양평군 개별공시지가 조회 서비스.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${myeongjo.variable} h-full`}>
      <head>
        {/* Pretendard는 Google Fonts에 없어 CDN에서 받는다 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
