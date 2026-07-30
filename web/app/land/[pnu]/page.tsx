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

const PYEONG = 3.3058;

/**
 * 검색 유입 전용 페이지.
 *
 * 자바스크립트를 끈 상태에서도 모든 정보가 보여야 한다 — 차트까지 서버에서
 * HTML로 그리는 이유다. 앱 화면이 아니라 공개 문서에 가깝다.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pnu } = await params;
  const parcel = await getParcel(pnu);
  if (!parcel) return { title: "필지를 찾을 수 없습니다 - DDoToRo" };

  const region = formatRegion(parcel.sido, parcel.sigungu, parcel.emd);
  const jibun = formatJibun(parcel.ri, parcel.jibun);

  return {
    title: `${region} ${jibun} 공시지가 - DDoToRo`,
    // 지번·지목·면적·총액을 모두 넣는다. 검색 결과에서 이 줄이 클릭을 결정한다
    description:
      `${region} ${jibun} ${formatJimok(parcel.jimok)} ${formatArea(parcel.area_sqm)}. ` +
      `${parcel.price_year ?? ""}년 개별공시지가 ${formatWon(parcel.total_price)} ` +
      `(㎡당 ${formatWonPlain(parcel.price_per_sqm)}).`,
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
    parcel.price_per_sqm !== null ? parcel.price_per_sqm * PYEONG : null;
  const trade = parcel.emd_trade_avg;
  const history = parcel.price_history ?? [];

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
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="no-print flex items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
        <Link
          href="/"
          className="font-serif-num text-[19px] font-semibold text-[var(--ink)] no-underline"
        >
          DDoToRo
        </Link>
        <span className="text-[14px] text-[var(--ink-mid)]">
          경기 양평군 땅값 조회
        </span>
      </header>

      <main className="doc">
        <nav
          className="text-[14px] tracking-[0.012em] text-[var(--ink-mid)]"
          aria-label="위치"
        >
          {[parcel.sido, parcel.sigungu, parcel.emd, parcel.ri]
            .filter(Boolean)
            .join(" · ")}
        </nav>

        <div className="doc-head">
          <ParcelSilhouette
            geometry={parcel.geometry}
            pricePerSqm={parcel.price_per_sqm}
            size={104}
          />
          <div>
            <h1 className="font-serif-num m-0 text-[34px] leading-[1.15] tracking-[-0.022em]">
              {jibun}
            </h1>
            <p className="mt-2 text-[16px] text-[var(--ink-mid)]">
              {formatJimok(parcel.jimok)} · {formatArea(parcel.area_sqm)}
            </p>
          </div>
        </div>

        <div className="doc-price">
          <p className="eyebrow">
            {parcel.price_year ?? ""} OFFICIAL PRICE
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-4">
            <span className="font-serif-num text-[46px] leading-[1.05] text-[var(--ink)]">
              {formatWon(parcel.total_price)}
            </span>
            {parcel.price_year && (
              <span className="badge">{parcel.price_year}년 공시</span>
            )}
          </div>
          <p className="tnum mt-2 text-[16px] text-[var(--ink-mid)]">
            {parcel.price_per_sqm === null ? (
              "공시지가 정보 없음"
            ) : (
              <>
                ㎡당 {formatWonPlain(parcel.price_per_sqm)}
                {perPyeong !== null && <> · 평당 {formatWonPlain(perPyeong)}</>}
              </>
            )}
          </p>
        </div>

        <section className="doc-blk">
          <h2 className="m-0 mb-4 text-[17px] font-semibold">땅 정보</h2>
          <dl className="grid grid-cols-[128px_1fr] gap-x-4 gap-y-3 text-[17px]">
            <dt className="text-[16px] text-[var(--ink-mid)]">소재지</dt>
            <dd>
              {region} {jibun}
            </dd>

            <dt className="text-[16px] text-[var(--ink-mid)]">지목</dt>
            <dd>{formatJimok(parcel.jimok)}</dd>

            <dt className="text-[16px] text-[var(--ink-mid)]">면적</dt>
            <dd className="tnum">{formatArea(parcel.area_sqm)}</dd>

            <dt className="text-[16px] text-[var(--ink-mid)]">㎡당 공시지가</dt>
            <dd className="tnum">{formatWonPlain(parcel.price_per_sqm)}</dd>

            <dt className="text-[16px] text-[var(--ink-mid)]">평당 공시지가</dt>
            <dd className="tnum">{formatWonPlain(perPyeong)}</dd>

            <dt className="text-[16px] text-[var(--ink-mid)]">기준연도</dt>
            <dd className="tnum">
              {parcel.price_year ? `${parcel.price_year}년` : "—"}
            </dd>

            <dt className="text-[16px] text-[var(--ink-mid)]">고유번호</dt>
            <dd className="break-all font-mono text-[14px] tracking-[0.015em]">
              {parcel.pnu}
            </dd>
          </dl>
        </section>

        {history.length > 0 && <PriceHistory history={history} />}

        <section className="doc-blk">
          <h2 className="m-0 mb-4 text-[17px] font-semibold">
            {trade?.emd ?? parcel.emd} 지역 실거래
          </h2>
          {trade && trade.deal_count > 0 ? (
            <>
              <div className="flex flex-wrap items-baseline gap-4">
                <span className="font-serif-num text-[28px] text-[var(--ink)]">
                  {formatWonPlain((trade.median_price_per_sqm ?? 0) * PYEONG)}
                </span>
                <span className="text-[14px] text-[var(--ink-mid)]">
                  평당 중앙값 · {trade.deal_count.toLocaleString()}건 · 최근 36개월
                </span>
              </div>
              <p className="tnum mt-0.5 text-[14px] text-[var(--ink-mid)]">
                ㎡당 {formatWonPlain(trade.median_price_per_sqm)}
              </p>
              <p className="note mt-4">
                <strong className="font-semibold text-[var(--ink)]">
                  이 필지의 거래 기록이 아닙니다.
                </strong>
                <br />
                정부가 지번을 일부만 공개해 지역 평균으로만 보여드립니다.
              </p>
            </>
          ) : (
            <p className="text-[14px] text-[var(--ink-mid)]">
              최근 거래 기록이 없습니다
            </p>
          )}
        </section>

        <section className="doc-blk">
          <h2 className="m-0 mb-4 text-[17px] font-semibold">공시지가 안내</h2>
          <p className="m-0 max-w-[62ch] text-[16px] leading-[1.7]">
            공시지가는 연 1회, 매년 1월 1일을 기준으로 정부가 공시하는{" "}
            <strong className="font-semibold">공적 가격</strong>입니다. 세금과
            보상금 산정의 기준이 되며, 실제 거래 시세와는 다릅니다. 보통
            실거래가의 절반에서 70% 수준입니다.
          </p>
        </section>

        <div className="no-print flex flex-wrap gap-3 pt-8">
          <Link
            href={`/?pnu=${parcel.pnu}`}
            className="text-[16px] text-[var(--ink)] underline decoration-1 underline-offset-[3px]"
          >
            지도에서 보기 →
          </Link>
        </div>
      </main>
    </>
  );
}

/**
 * 연도별 막대. SVG를 쓰지 않는다 — viewBox가 줄면 글자가 14px 밑으로 내려간다.
 * 열 수는 연도 수를 따라가므로 5년이든 10년이든 그대로 동작한다.
 */
function PriceHistory({
  history,
}: {
  history: { year: number; price_per_sqm: number | null }[];
}) {
  const values = history
    .map((h) => h.price_per_sqm)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const first = history.find((h) => h.price_per_sqm !== null);
  const last = [...history].reverse().find((h) => h.price_per_sqm !== null);
  const delta =
    first?.price_per_sqm && last?.price_per_sqm
      ? Math.round((last.price_per_sqm / first.price_per_sqm - 1) * 100)
      : null;

  const label = history
    .map(
      (h) =>
        `${h.year}년 ${h.price_per_sqm === null ? "정보 없음" : `${h.price_per_sqm.toLocaleString()}원`}`,
    )
    .join(", ");

  return (
    <section className="doc-blk">
      <h2 className="m-0 mb-4 flex flex-wrap items-center gap-2 text-[17px] font-semibold">
        공시지가 추이
        <span className="badge">{history.length}년 · 연도 수 가변</span>
      </h2>

      <div
        className="bars"
        style={{ gridTemplateColumns: `repeat(${history.length}, 1fr)` }}
        role="img"
        aria-label={`㎡당 공시지가 ${label}`}
      >
        {history.map((h) => (
          <div className="col" key={h.year}>
            <span className="v">
              {h.price_per_sqm === null
                ? "—"
                : `${Math.round(h.price_per_sqm / 1000).toLocaleString()}천`}
            </span>
            <span
              className="b"
              style={{
                height:
                  h.price_per_sqm === null
                    ? 4
                    : `${Math.max(6, (h.price_per_sqm / max) * 130)}px`,
              }}
            />
            <span className="y">{h.year}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 max-w-[60ch] text-[14px] leading-[1.6] text-[var(--ink-mid)]">
        단위 ㎡당 원(천 단위).
        {delta !== null && first && (
          <>
            {" "}
            {first.year}년 대비 {delta >= 0 ? "+" : ""}
            {delta}%.
          </>
        )}{" "}
        2023년이 낮은 것은 그해 전국적으로 공시지가가 하락했기 때문이며, 이후
        회복하는 구간입니다.
      </p>
    </section>
  );
}
