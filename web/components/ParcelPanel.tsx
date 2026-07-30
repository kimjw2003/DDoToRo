"use client";

import { useState } from "react";

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

const TABS = [
  { id: "info", label: "땅 정보" },
  { id: "price", label: "시세" },
  { id: "near", label: "주변" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * 고정 요약 카드 + 3탭.
 *
 * 1차는 9블록을 세로로 쌓았는데 항목이 늘면서 그 구조로는 감당이 안 된다.
 * 총액·지번·실루엣을 탭 밖에 고정하는 것이 핵심이다 —
 * 어느 탭에 있어도 지금 보고 있는 땅이 무엇인지 잃지 않는다.
 *
 * 아코디언을 쓰지 않는 이유: 5개가 열리면 다시 세로 스크롤 문제로 돌아간다.
 */
export default function ParcelPanel({
  parcel,
  loading,
  error,
  onRetry,
  onClose,
}: {
  parcel: ParcelDetail | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  // 탭은 화면 상태일 뿐이라 URL에 넣지 않는다. URL에는 ?pnu=만 남긴다
  const [tab, setTab] = useState<TabId>("info");

  if (loading) {
    return <p className="p-5 text-[14px] text-[var(--ink-soft)]">불러오는 중</p>;
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

  return (
    <div className="panel-fade-in flex min-h-0 flex-1 flex-col">
      {/* ── 고정 요약. 이 영역은 스크롤되지 않는다 ── */}
      <div className="border-b border-[var(--line)] px-4 pb-5 pt-4">
        <div className="grid grid-cols-[88px_1fr_auto] items-start gap-4">
          <ParcelSilhouette
            geometry={parcel.geometry}
            pricePerSqm={parcel.price_per_sqm}
          />

          <div className="min-w-0">
            <p className="text-[14px] tracking-[0.012em] text-[var(--ink-mid)]">
              {formatRegion(parcel.sido, parcel.sigungu, parcel.emd)}
            </p>
            <h2 className="font-serif-num text-[22px] leading-[1.3] text-[var(--ink)]">
              {formatJibun(parcel.ri, parcel.jibun)}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="선택 해제"
            className="-mr-1.5 -mt-1.5 grid h-11 w-11 place-items-center border border-transparent text-[var(--ink-mid)] hover:border-[var(--line-strong)] hover:bg-[var(--sunken)] hover:text-[var(--ink)]"
          >
            <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden="true">
              <path
                d="M3 3 L16 16 M16 3 L3 16"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </button>
        </div>

        {/* 총액 — 화면에서 가장 큰 숫자 */}
        <p className="font-serif-num mt-5 text-[40px] leading-[1.05] text-[var(--ink)]">
          {formatWon(parcel.total_price)}
        </p>

        {/*
          기준연도는 총액과 같은 줄에 두지 않는다.
          값 길이에 따라 줄바꿈이 들쭉날쭉해진다
        */}
        <div className="mt-2.5">
          <span className="badge">
            {parcel.price_year ? `${parcel.price_year}년 공시` : "공시연도 없음"}
          </span>
        </div>

        <p className="tnum mt-2 text-[14px] text-[var(--ink-mid)]">
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

      {/* ── 탭 ── */}
      <div
        role="tablist"
        aria-label="필지 정보 분류"
        className="grid grid-cols-3 border-b border-[var(--line)] bg-[var(--paper)]"
      >
        {TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setTab(t.id)}
              className={`h-[50px] border-b-2 px-2 text-[16px] ${
                selected
                  ? "border-[var(--ink)] bg-[var(--surface)] font-semibold text-[var(--ink)]"
                  : "border-transparent font-medium text-[var(--ink-mid)] hover:text-[var(--ink)]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── 탭 내용. 여기만 스크롤한다 ── */}
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {tab === "info" && <InfoTab parcel={parcel} />}
        {tab === "price" && <PriceTab />}
        {tab === "near" && <NearTab />}
      </div>

      {/* ── 고정 푸터 ── */}
      <div className="border-t border-[var(--line)] bg-[var(--surface)] p-4">
        <a
          href={`/land/${parcel.pnu}`}
          className="text-[16px] text-[var(--ink)] underline decoration-1 underline-offset-[3px]"
        >
          이 땅의 상세 페이지 →
        </a>
      </div>
    </div>
  );
}

function InfoTab({ parcel }: { parcel: ParcelDetail }) {
  const address = [parcel.sigungu, parcel.emd, parcel.ri, parcel.jibun]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <section className="border-b border-[var(--line)] px-4 py-5">
        <dl className="grid grid-cols-[88px_1fr] gap-x-4 gap-y-3 text-[16px]">
          <dt className="text-[var(--ink-mid)]">지목</dt>
          <dd>{formatJimok(parcel.jimok)}</dd>

          <dt className="text-[var(--ink-mid)]">면적</dt>
          <dd className="tnum">{formatArea(parcel.area_sqm)}</dd>

          <dt className="text-[var(--ink-mid)]">소재지</dt>
          <dd>{address || "—"}</dd>

          <dt className="text-[var(--ink-mid)]">고유번호</dt>
          <dd className="break-all font-mono text-[14px] tracking-[0.015em]">
            {parcel.pnu}
          </dd>
        </dl>
      </section>

      <section className="px-4 py-5">
        <p className="note">
          <strong className="font-semibold text-[var(--ink)]">
            공시지가는 시세가 아닙니다.
          </strong>
          <br />
          연 1회(매년 1월 1일 기준) 공시되는 공적 가격으로, 실제 거래 시세와
          다릅니다.
        </p>
      </section>
    </>
  );
}

/** 시세 추이·실거래는 Task 9 이후에 붙인다. 그럴듯한 수치를 지어내지 않는다. */
function PriceTab() {
  return <EmptyTab label="시세" badge="데이터 연동 전" />;
}

function NearTab() {
  return <EmptyTab label="주변" badge="데이터 연동 전" />;
}

function EmptyTab({ label, badge }: { label: string; badge: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <span className="badge">{badge}</span>
      <p className="mt-4 text-[14px] leading-[1.7] text-[var(--ink-mid)]">
        {label} 정보는 준비 중입니다.
      </p>
    </div>
  );
}
