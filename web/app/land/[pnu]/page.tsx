import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ParcelSilhouette from "@/components/ParcelSilhouette";
import { getParcel } from "@/lib/parcel";
import {
  formatArea,
  formatJibun,
  formatJimok,
  formatRegion,
  formatWon,
  formatWonPlain,
} from "@/lib/format";

type Props = { params: Promise<{ pnu: string }> };

/**
 * 이 페이지는 SEO의 핵심이다.
 * 자바스크립트를 끈 상태에서도 필지 정보가 전부 HTML로 보여야 한다.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pnu } = await params;
  const parcel = await getParcel(pnu);
  if (!parcel) return { title: "필지를 찾을 수 없습니다 - DDoToRo" };

  const region = formatRegion(parcel.sido, parcel.sigungu, parcel.emd);
  const jibun = formatJibun(parcel.ri, parcel.jibun);

  return {
    title: `${region} ${jibun} 공시지가 - DDoToRo`,
    description:
      `${region} ${jibun}의 ${parcel.price_year ?? ""}년 개별공시지가는 ` +
      `${formatWon(parcel.total_price)}입니다. ` +
      `면적 ${formatArea(parcel.area_sqm)}, 지목 ${formatJimok(parcel.jimok)}, ` +
      `㎡당 ${formatWonPlain(parcel.price_per_sqm)}.`,
    alternates: { canonical: `/land/${parcel.pnu}` },
  };
}

export default async function LandPage({ params }: Props) {
  const { pnu } = await params;
  const parcel = await getParcel(pnu);
  if (!parcel) notFound();

  const region = formatRegion(parcel.sido, parcel.sigungu, parcel.emd);
  const jibun = formatJibun(parcel.ri, parcel.jibun);
  const perPyeong =
    parcel.price_per_sqm !== null ? parcel.price_per_sqm * 3.3058 : null;
  const trade = parcel.emd_trade_avg;

  // 검색엔진이 장소로 이해하도록 구조화 데이터를 넣는다
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: `${region} ${jibun}`,
    address: {
      "@type": "PostalAddress",
      addressCountry: "KR",
      addressRegion: parcel.sido ?? undefined,
      addressLocality: parcel.sigungu ?? undefined,
      streetAddress: [parcel.emd, parcel.ri, parcel.jibun]
        .filter(Boolean)
        .join(" "),
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: parcel.lat,
      longitude: parcel.lng,
    },
    identifier: parcel.pnu,
    ...(parcel.area_sqm
      ? {
          additionalProperty: {
            "@type": "PropertyValue",
            name: "면적",
            value: parcel.area_sqm,
            unitCode: "MTK",
          },
        }
      : {}),
  };

  return (
    <main className="mx-auto max-w-[720px] px-5 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-8">
        <Link
          href={`/?pnu=${parcel.pnu}`}
          className="text-[14px] text-[var(--ink-mid)] underline underline-offset-4"
        >
          지도로 돌아가기
        </Link>
      </nav>

      <ParcelSilhouette
        geometry={parcel.geometry}
        pricePerSqm={parcel.price_per_sqm}
        size={88}
      />

      <p className="mt-5 text-[14px] text-[var(--ink-mid)]">{region}</p>
      <h1 className="font-serif-num text-[24px] leading-[1.4] text-[var(--ink)]">
        {jibun}
      </h1>

      <p className="font-serif-num mt-5 text-[34px] leading-[1.25] text-[var(--ink)]">
        {formatWon(parcel.total_price)}
      </p>
      <p className="text-[13px] text-[var(--ink-soft)]">
        {parcel.price_year ? `${parcel.price_year}년 공시` : "공시연도 정보 없음"}
      </p>
      <p className="tnum mt-2 text-[13px] text-[var(--ink-mid)]">
        ㎡당 {formatWonPlain(parcel.price_per_sqm)}
        {perPyeong !== null && <> · 평당 {formatWonPlain(perPyeong)}</>}
      </p>

      <hr className="my-6 border-0 border-t border-[var(--line)]" />

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[16px]">
        <dt className="text-[var(--ink-mid)]">지목</dt>
        <dd>{formatJimok(parcel.jimok)}</dd>

        <dt className="text-[var(--ink-mid)]">면적</dt>
        <dd className="tnum">{formatArea(parcel.area_sqm)}</dd>

        <dt className="text-[var(--ink-mid)]">고유번호</dt>
        <dd className="tnum text-[14px] text-[var(--ink-mid)]">{parcel.pnu}</dd>
      </dl>

      <hr className="my-6 border-0 border-t border-[var(--line)]" />

      <section>
        <h2 className="text-[16px] text-[var(--ink)]">
          {trade?.emd ?? parcel.emd} 최근 3년 토지 거래
        </h2>
        {trade && trade.deal_count > 0 ? (
          <>
            <p className="tnum mt-1 text-[16px]">
              평균 ㎡당 {formatWonPlain(trade.median_price_per_sqm)} ·{" "}
              {trade.deal_count.toLocaleString()}건
            </p>
            <p className="mt-3 border-t border-[var(--line)] pt-3 text-[14px] leading-[1.7] text-[var(--ink-mid)]">
              이 필지의 거래 기록이 아닙니다.
              <br />
              정부가 지번을 일부만 공개해 지역 평균으로만 보여드립니다.
            </p>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-[var(--ink-mid)]">
            최근 거래 기록이 없습니다
          </p>
        )}
      </section>

      <hr className="my-6 border-0 border-t border-[var(--line)]" />

      <p className="text-[13px] leading-[1.7] text-[var(--ink-soft)]">
        개별공시지가는 매년 1월 1일을 기준으로 연 1회 공시되는 공적 가격입니다.
        실제 거래 시세와는 다릅니다.
      </p>
    </main>
  );
}
