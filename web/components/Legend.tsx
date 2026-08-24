import type { ChipLevel } from "@/components/ParcelMap";
import { NO_PRICE_COLOR, PRICE_BREAKS, RAMP } from "@/lib/priceRamp";

/**
 * 범례는 좌하단 고정.
 *
 * 줌 구간에 따라 지도가 보여주는 것이 달라지므로 범례도 함께 바뀐다.
 * 필지 가격 램프 / 읍면 시세 / 시군구 시세 세 가지다.
 *
 * 3차에서 테두리를 빼고 그림자로 지도에서 떼어 놓는다.
 */
export default function Legend({ level }: { level: ChipLevel }) {
  if (level !== "parcel") {
    return (
      <div className="card w-[268px] px-4 py-3.5">
        <p className="text-[14px] font-semibold text-[var(--ink)]">
          {level === "county" ? "시군구별 현재 시세" : "읍면별 현재 시세"}
        </p>
        <p className="t-label mt-0.5 text-[var(--ink-mid)]">
          최근 3년 실거래 중앙값 · 평당
        </p>
        {level === "town" && (
          <p className="t-label mt-1.5 text-[var(--ink-soft)]">
            왼쪽 색 띠가 읍면 간 가격 순위입니다
          </p>
        )}
      </div>
    );
  }

  const low = PRICE_BREAKS[0];
  const high = PRICE_BREAKS[PRICE_BREAKS.length - 1];

  return (
    <div className="card w-[268px] px-4 py-3.5">
      <p className="text-[14px] font-semibold text-[var(--ink)]">
        ㎡당 공시지가
      </p>

      {/* 램프바. overflow-hidden이 있어야 양끝이 라운드에 맞게 잘린다 */}
      <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-[var(--r-full)]">
        {RAMP.map((c) => (
          <span key={c} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>

      <div className="tnum t-label mt-1.5 flex justify-between text-[var(--ink-mid)]">
        <span>{(low / 10_000).toFixed(1)}만원</span>
        <span>{(high / 10_000).toFixed(0)}만원+</span>
      </div>

      <p className="t-label mt-2.5 flex items-center gap-2 text-[var(--ink-mid)]">
        {/* 정보 없음은 색이 아니라 사선 해치로 구분한다 */}
        <span
          className="hatch-none inline-block h-3.5 w-4.5 rounded-[3px]"
          style={{ backgroundColor: NO_PRICE_COLOR }}
        />
        정보 없음
      </p>
    </div>
  );
}
