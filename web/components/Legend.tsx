import type { ChipLevel } from "@/components/ParcelMap";
import { NO_PRICE_COLOR, PRICE_BREAKS, RAMP } from "@/lib/priceRamp";

/**
 * 범례는 좌하단 고정.
 *
 * 줌 구간에 따라 지도가 보여주는 것이 달라지므로 범례도 함께 바뀐다.
 * 필지 가격 램프 / 읍면 시세 / 시군구 시세 세 가지다.
 */
export default function Legend({ level }: { level: ChipLevel }) {
  if (level !== "parcel") {
    return (
      <div className="w-[268px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
        <p className="text-[14px] font-medium text-[var(--ink)]">
          {level === "county" ? "시군구별 현재 시세" : "읍면별 현재 시세"}
        </p>
        <p className="mt-1 text-[14px] leading-[1.5] text-[var(--ink-mid)]">
          최근 3년 실거래 중앙값 · 평당
        </p>
        {level === "town" && (
          <p className="mt-2 text-[14px] leading-[1.5] text-[var(--ink-soft)]">
            왼쪽 색 띠가 읍면 간 가격 순위입니다
          </p>
        )}
      </div>
    );
  }

  const low = PRICE_BREAKS[0];
  const high = PRICE_BREAKS[PRICE_BREAKS.length - 1];

  return (
    <div className="w-[268px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
      <p className="text-[14px] font-medium text-[var(--ink)]">㎡당 공시지가</p>

      <div className="mt-2 flex h-2.5 overflow-hidden">
        {RAMP.map((c) => (
          <span key={c} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>

      <div className="tnum mt-1.5 flex justify-between text-[14px] text-[var(--ink-mid)]">
        <span>{(low / 10_000).toFixed(1)}만원</span>
        <span>{(high / 10_000).toFixed(0)}만원+</span>
      </div>

      <p className="mt-3 flex items-center gap-2 text-[14px] text-[var(--ink-mid)]">
        {/* 정보 없음은 색이 아니라 사선 해치로 구분한다 */}
        <span
          className="hatch-none inline-block h-3 w-4 border border-[var(--line-strong)]"
          style={{ backgroundColor: NO_PRICE_COLOR }}
        />
        정보 없음
      </p>
    </div>
  );
}
