"use client";

import ParcelSilhouette, { type ParcelGeometry } from "./ParcelSilhouette";
import {
  formatArea,
  formatJibun,
  formatJimok,
  formatRegion,
  formatWon,
  formatWonPlain,
} from "@/lib/format";

export type ParcelDetail = {
  pnu: string;
  sido: string | null;
  sigungu: string | null;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: number | null;
  price_per_sqm: number | null;
  price_year: number | null;
  total_price: number | null;
  geometry: ParcelGeometry | null;
  emd_trade_avg: {
    emd: string | null;
    deal_count: number;
    avg_price_per_sqm: number | null;
    median_price_per_sqm: number | null;
    from_ym: string | null;
    to_ym: string | null;
  } | null;
};

/**
 * 패널 정보 순서는 DESIGN.md가 정한 것이며 바꾸지 않는다.
 * 실루엣 → 주소 → 총액 → 기준연도 → 단가 → 지목·면적 → 지역 실거래
 */
export default function ParcelPanel({
  parcel,
  loading,
  error,
  onRetry,
}: {
  parcel: ParcelDetail | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <p className="p-5 text-[14px] text-[var(--ink-soft)]">불러오는 중</p>
    );
  }

  if (error) {
    return (
      <div className="p-5">
        <p className="text-[14px] text-[var(--ink-mid)]">
          필지 정보를 불러오지 못했습니다.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 min-h-[44px] rounded border border-[var(--ink)] px-4 text-[14px] text-[var(--ink)]"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!parcel) {
    return (
      <p className="p-5 text-[14px] leading-[1.7] text-[var(--ink-mid)]">
        지도에서 땅을 눌러 보세요
      </p>
    );
  }

  const perPyeong =
    parcel.price_per_sqm !== null ? parcel.price_per_sqm * 3.3058 : null;
  const trade = parcel.emd_trade_avg;

  return (
    <div className="panel-fade-in p-5">
      {/* 1. 필지 실루엣 — 소유자는 자기 땅을 모양으로 알아본다 */}
      <ParcelSilhouette
        geometry={parcel.geometry}
        pricePerSqm={parcel.price_per_sqm}
      />

      {/* 2. 주소 */}
      <p className="mt-4 text-[14px] text-[var(--ink-mid)]">
        {formatRegion(parcel.sido, parcel.sigungu, parcel.emd)}
      </p>
      <h2 className="font-serif-num text-[20px] leading-[1.4] text-[var(--ink)]">
        {formatJibun(parcel.ri, parcel.jibun)}
      </h2>

      {/* 3. 공시지가 총액 — 화면에서 가장 큰 숫자 */}
      <p className="font-serif-num mt-4 text-[34px] leading-[1.25] text-[var(--ink)]">
        {formatWon(parcel.total_price)}
      </p>

      {/* 4. 기준연도 — 실시간 시세가 아님을 반드시 밝힌다 */}
      <p className="text-[14px] text-[var(--ink-soft)]">
        {parcel.price_year ? `${parcel.price_year}년 공시` : "공시연도 정보 없음"}
      </p>

      {/* 5. 단가 */}
      <p className="tnum mt-2 text-[14px] text-[var(--ink-mid)]">
        ㎡당 {formatWonPlain(parcel.price_per_sqm)}
        {perPyeong !== null && <> · 평당 {formatWonPlain(perPyeong)}</>}
      </p>

      <hr className="my-4 border-0 border-t border-[var(--line)]" />

      {/* 7. 지목 · 면적 */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[14px]">
        <dt className="text-[var(--ink-mid)]">지목</dt>
        <dd className="text-[var(--ink)]">{formatJimok(parcel.jimok)}</dd>

        <dt className="text-[var(--ink-mid)]">면적</dt>
        <dd className="tnum text-[var(--ink)]">{formatArea(parcel.area_sqm)}</dd>
      </dl>

      <hr className="my-4 border-0 border-t border-[var(--line)]" />

      {/* 9. 이 지역 실거래 — 안내 문구를 생략하면 자기 땅이 그 값에 팔렸다고 오해한다 */}
      <section>
        <h3 className="text-[14px] text-[var(--ink)]">
          {trade?.emd ?? parcel.emd} 최근 3년 토지 거래
        </h3>
        {trade && trade.deal_count > 0 ? (
          <>
            <p className="tnum mt-1 text-[14px] text-[var(--ink)]">
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

      {/* 링크는 강조색 대신 밑줄로 표시한다 */}
      <a
        href={`/land/${parcel.pnu}`}
        className="mt-5 inline-flex min-h-[44px] items-center text-[14px] text-[var(--ink)] underline underline-offset-4"
      >
        이 땅의 상세 페이지
      </a>
    </div>
  );
}
