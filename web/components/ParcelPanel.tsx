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
  formatYm,
} from "@/lib/format";
import { RAMP } from "@/lib/priceRamp";

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
  /** 연도 수는 가변이다. 길이를 고정으로 가정하지 말 것 */
  price_history?: { year: number; price_per_sqm: number | null }[];
  /** 가까운 순. 직선거리(m)다 */
  nearby_stations?: { name: string; line: string; distance_m: number }[];
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
        {tab === "price" && <PriceTab parcel={parcel} />}
        {tab === "near" && <NearTab parcel={parcel} />}
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

type ChartMode = "bar" | "line";

function PriceTab({ parcel }: { parcel: ParcelDetail }) {
  const history = parcel.price_history ?? [];
  const trade = parcel.emd_trade_avg;
  // 막대는 연도별 크기 비교에, 선은 흐름 파악에 유리하다. 둘 다 쓰게 둔다
  const [chartMode, setChartMode] = useState<ChartMode>("bar");

  return (
    <>
      {parcel.price_per_sqm === null ? (
        <section className="border-b border-[var(--line)] px-4 py-5">
          <p className="note">
            이 필지는 공시지가 정보가 없습니다. 전체 필지의 0.448%가 여기에
            해당합니다.
          </p>
        </section>
      ) : (
        history.length > 0 && (
          <section className="border-b border-[var(--line)] px-4 py-5">
            <div className="mb-4 flex items-center gap-3">
              <h3 className="text-[17px] font-semibold text-[var(--ink)]">
                공시지가 추이
              </h3>
              <span className="badge">{history.length}년</span>
              <ChartToggle mode={chartMode} onChange={setChartMode} />
            </div>
            <PriceChart history={history} mode={chartMode} />
          </section>
        )
      )}

      <section className="px-4 py-5">
        <h3 className="mb-4 text-[17px] font-semibold text-[var(--ink)]">
          {trade?.emd ?? parcel.emd} 지역 실거래
        </h3>

        {trade && trade.deal_count > 0 ? (
          <>
            {/* 평당을 먼저, 크게. 일반인은 평으로 사고한다 */}
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-serif-num text-[22px] text-[var(--ink)]">
                {formatWonPlain(
                  (trade.median_price_per_sqm ?? 0) * 3.3058,
                )}
              </span>
              <span className="text-[14px] text-[var(--ink-mid)]">
                평당 중앙값 · {trade.deal_count.toLocaleString()}건
              </span>
            </div>
            <p className="tnum mt-0.5 text-[14px] text-[var(--ink-mid)]">
              ㎡당 {formatWonPlain(trade.median_price_per_sqm)} ·{" "}
              {formatYm(trade.from_ym)}~{formatYm(trade.to_ym)}
            </p>

            {/*
              이 문구를 빼면 사용자가 자기 땅이 그 값에 팔렸다고 오해한다.
              값과 반드시 같은 화면에 함께 보여야 한다
            */}
            <p className="note mt-3.5">
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
    </>
  );
}

/**
 * 꼭짓점을 잇는 선.
 *
 * 각 열이 flex로 균등 분배되므로 x는 열 중앙(= (i+0.5)/n)이고,
 * y는 막대 높이와 같은 계산을 쓴다. 두 모드의 점 위치가 어긋나지 않는다.
 * preserveAspectRatio="none"으로 늘리므로 선 두께는 non-scaling-stroke로 고정한다.
 */
function LineOverlay({
  history,
  liftOf,
  height,
}: {
  history: { year: number; price_per_sqm: number | null }[];
  liftOf: (v: number) => number;
  height: number;
}) {
  const n = history.length;
  const pts = history
    .map((h, i) =>
      h.price_per_sqm === null
        ? null
        : {
            x: ((i + 0.5) / n) * 100,
            // 점(HTML)은 바닥 기준 높이를 쓰므로 y로 뒤집는다
            y: height - liftOf(h.price_per_sqm),
          },
    )
    .filter((p): p is { x: number; y: number } => p !== null);

  if (pts.length < 2) return null;

  return (
    <svg
      /*
        라벨 아래, 연도 위. 막대가 차지하던 영역과 정확히 겹친다.
        w-full이 없으면 SVG가 기본 폭(300px)으로 렌더되어 선이 왼쪽에만 그려진다.
      */
      className="pointer-events-none absolute inset-x-0 bottom-[22px] w-full"
      style={{ height }}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke={RAMP[3]}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * 막대 ↔ 선 전환.
 *
 * 차트 바로 위에 붙어 무엇을 바꾸는지가 자명하므로 화면에는 라벨을 두지 않는다.
 * 다만 눈으로 볼 수 없는 사용자에게는 단서가 사라지므로 aria-label과 title은 남긴다.
 */
function ChartToggle({
  mode,
  onChange,
}: {
  mode: ChartMode;
  onChange: (m: ChartMode) => void;
}) {
  const label = mode === "line" ? "선 그래프 (끄면 막대)" : "선 그래프로 보기";
  return (
    // .switch가 margin:0을 지정하므로 정렬은 래퍼가 맡는다
    <span className="ml-auto inline-flex">
      <input
        className="switch switch-sm"
        type="checkbox"
        role="switch"
        aria-label={label}
        title={label}
        checked={mode === "line"}
        onChange={(e) => onChange(e.target.checked ? "line" : "bar")}
      />
    </span>
  );
}

/**
 * 연도별 공시지가 차트.
 *
 * 값·연도 라벨을 SVG 텍스트로 그리지 않는다 — viewBox가 줄면 글자도 같이 줄어
 * 14px 하한이 깨진다. 라벨은 HTML로 두고 그래픽만 비율로 그린다.
 * 연도 수는 배열 길이를 따라가므로 5년이든 10년이든 그대로 동작한다.
 */
function PriceChart({
  history,
  mode,
}: {
  history: { year: number; price_per_sqm: number | null }[];
  mode: ChartMode;
}) {
  const values = history
    .map((h) => h.price_per_sqm)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);

  /*
    막대는 0부터 재고, 선은 값 범위에 맞춰 확대한다.

    공시지가는 해마다 몇 퍼센트씩만 움직인다. 선까지 0부터 그리면 다섯 점이
    상단 4px 안에 겹쳐 추세가 전혀 보이지 않는다. 막대는 크기 비교가 목적이라
    0 기준을 지키고, 선은 흐름을 보는 것이므로 범위를 늘린다.
  */
  const CHART_H = 108;
  const PAD = 10;
  const span = max - min || 1;
  const liftOf = (v: number) =>
    PAD + ((v - min) / span) * (CHART_H - PAD * 2);

  const first = history.find((h) => h.price_per_sqm !== null);
  const last = [...history].reverse().find((h) => h.price_per_sqm !== null);
  const delta =
    first?.price_per_sqm && last?.price_per_sqm
      ? Math.round((last.price_per_sqm / first.price_per_sqm - 1) * 100)
      : null;

  return (
    <>
      {/* 그래픽 높이는 두 모드가 같아야 전환할 때 화면이 튀지 않는다 */}
      <div className="relative flex h-[150px] items-end gap-1.5">
        {mode === "line" && (
          <LineOverlay history={history} liftOf={liftOf} height={CHART_H} />
        )}

        {history.map((h, i) => {
          const v = h.price_per_sqm;
          const isLast = i === history.length - 1;
          // 막대는 0 기준, 선은 값 범위를 확대한 위치를 쓴다
          const barH =
            v === null
              ? 4
              : mode === "line"
                ? liftOf(v)
                : Math.max(6, (v / max) * CHART_H);
          return (
            <div
              key={h.year}
              className="relative flex min-w-0 flex-1 flex-col items-center justify-end"
            >
              <span className="tnum mb-1 text-[14px] leading-none text-[var(--ink-mid)]">
                {v === null ? "—" : Math.round(v / 1000).toLocaleString()}
              </span>

              {mode === "bar" ? (
                <div
                  className="w-full"
                  style={{
                    // 최솟값도 막대가 보이도록 바닥을 깔아준다
                    height: `${barH}px`,
                    backgroundColor: isLast ? RAMP[4] : RAMP[2],
                  }}
                />
              ) : (
                // 선 모드에서는 같은 높이만 차지하고 꼭짓점만 찍는다
                <div className="relative w-full" style={{ height: `${barH}px` }}>
                  {v !== null && (
                    <span
                      className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]"
                      style={{ backgroundColor: isLast ? RAMP[4] : RAMP[3] }}
                    />
                  )}
                </div>
              )}

              <span className="tnum mt-1.5 text-[14px] leading-none text-[var(--ink-mid)]">
                {h.year}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[14px] leading-[1.6] text-[var(--ink-mid)]">
        {delta !== null && first && (
          <>
            {first.year}년 대비 {delta >= 0 ? "+" : ""}
            {delta}% · 단위 ㎡당 천원
            <br />
          </>
        )}
        2023년은 전국적으로 공시지가가 하락한 해입니다.
      </p>
    </>
  );
}

/**
 * 카테고리 아이콘.
 *
 * 색을 배정하지 않는다 — 채도는 가격만 뜻한다.
 * 1.7px 단선에 currentColor를 써서 주변 텍스트와 같은 무채색으로 읽힌다.
 */
function CategoryIcon({ kind }: { kind: string }) {
  const paths: Record<string, React.ReactNode> = {
    station: (
      <>
        <rect x="4.5" y="3.5" width="11" height="9" rx="1.5" />
        <path d="M4.5 9.5h11M7 16l1.5-3M13 16l-1.5-3" />
        <circle cx="7.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      </>
    ),
    school: <path d="M10 3.5l6.5 3-6.5 3-6.5-3 6.5-3zM6 8.5v4c0 1 1.8 2 4 2s4-1 4-2v-4" />,
    hospital: (
      <>
        <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
        <path d="M10 7.5v5M7.5 10h5" />
      </>
    ),
    store: <path d="M4 7.5h12l-1 8H5l-1-8zM7 7.5V6a3 3 0 016 0v1.5" />,
    office: (
      <>
        <path d="M4.5 16V5.5l5.5-2 5.5 2V16" />
        <path d="M8 16v-3.5h4V16M7.5 8h1.5M11 8h1.5" />
      </>
    ),
    bus: (
      <>
        <rect x="4.5" y="3.5" width="11" height="9" rx="1.5" />
        <path d="M4.5 9h11M7 15.5v-3M13 15.5v-3" />
      </>
    ),
  };

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-[var(--ink-mid)]"
      aria-hidden="true"
    >
      {paths[kind] ?? paths.office}
    </svg>
  );
}

/** 걸어갈 만한 거리에서만 도보를 병기한다. 그 위로는 숫자가 무의미해진다 */
const WALKABLE_M = 2000;

/**
 * 소요시간 추정.
 *
 * 직선거리에서 환산한 값이라 실제 도로와 다르다 — 그래서 "추정"을 뗄 수 없다.
 * 도보는 2km 이하에서만 보여준다. 서종면처럼 강과 산을 사이에 둔 6km 거리를
 * "도보 95분"이라 적으면 걸어갈 수 있다는 뜻으로 읽힌다.
 */
function timeText(m: number): string {
  const km = m / 1000;
  // 시골 국도 35km/h, 보행 4km/h
  const car = Math.max(1, Math.round((km / 35) * 60));
  if (m <= WALKABLE_M) {
    const walk = Math.max(1, Math.round((km / 4) * 60));
    return `차 ${car}분 · 도보 ${walk}분 추정`;
  }
  return `차 ${car}분 추정`;
}

function NearTab({ parcel }: { parcel: ParcelDetail }) {
  const stations = parcel.nearby_stations ?? [];

  return (
    <>
      <section className="border-b border-[var(--line)] px-4 py-5">
        <h3 className="mb-4 text-[17px] font-semibold text-[var(--ink)]">
          가까운 역
        </h3>

        {stations.length === 0 ? (
          <p className="text-[14px] text-[var(--ink-mid)]">역 정보가 없습니다</p>
        ) : (
          <ul>
            {stations.map((s, i) => (
              <li
                key={s.name}
                className={`flex items-center gap-3 py-3 ${
                  i > 0 ? "border-t border-[var(--line)]" : ""
                }`}
              >
                <CategoryIcon kind="station" />
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] text-[var(--ink)]">{s.name}</p>
                  <p className="text-[14px] text-[var(--ink-mid)]">{s.line}</p>
                </div>
                {/* 직선거리가 주 표기, 소요시간은 보조다 */}
                <div className="shrink-0 text-right">
                  <p className="tnum text-[16px] leading-[1.3] text-[var(--ink)]">
                    {(s.distance_m / 1000).toFixed(1)}km
                  </p>
                  <p className="tnum text-[14px] leading-[1.3] text-[var(--ink-mid)]">
                    {timeText(s.distance_m)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[14px] leading-[1.6] text-[var(--ink-soft)]">
          직선거리입니다. 실제 도로 거리와 다를 수 있습니다.
        </p>
      </section>

      {/*
        공공시설은 아직 데이터가 없다.
        배지 없이 그럴듯한 수치를 노출하지 않는다 — 어느 항목이 실측인지
        사용자가 구분할 수 없게 된다
      */}
      <section className="px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="text-[17px] font-semibold text-[var(--ink)]">
            주변 시설
          </h3>
          <span className="badge">공공데이터 연동 전</span>
        </div>

        <ul>
          {[
            { kind: "school", name: "초등학교" },
            { kind: "hospital", name: "보건지소" },
            { kind: "store", name: "마트" },
            { kind: "office", name: "관공서" },
            { kind: "bus", name: "버스정류장" },
          ].map((f, i) => (
            <li
              key={f.kind}
              className={`flex items-center gap-3 py-3 ${
                i > 0 ? "border-t border-[var(--line)]" : ""
              }`}
            >
              <CategoryIcon kind={f.kind} />
              <p className="min-w-0 flex-1 text-[16px] text-[var(--ink-soft)]">
                {f.name}
              </p>
              <p className="shrink-0 text-[14px] text-[var(--ink-soft)]">—</p>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[14px] leading-[1.6] text-[var(--ink-mid)]">
          가장 가까운 시설 한 곳까지의 거리를 보여줄 예정입니다.
        </p>
      </section>
    </>
  );
}

