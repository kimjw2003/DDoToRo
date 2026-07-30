import { NO_PRICE_COLOR, PRICE_BREAKS, RAMP } from "@/lib/priceRamp";

/** 범례는 좌하단 고정. 가로 램프바와 양끝 값만 보여준다. */
export default function Legend() {
  const low = PRICE_BREAKS[0];
  const high = PRICE_BREAKS[PRICE_BREAKS.length - 1];

  return (
    <div className="rounded border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5">
      <p className="text-[14px] text-[var(--ink-mid)]">㎡당 공시지가</p>

      <div className="mt-1.5 flex h-2.5 w-[168px] overflow-hidden rounded-sm">
        {RAMP.map((c) => (
          <span key={c} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>

      <div className="tnum mt-1 flex w-[168px] justify-between text-[14px] text-[var(--ink-soft)]">
        <span>{(low / 10_000).toFixed(1)}만원</span>
        <span>{(high / 10_000).toFixed(0)}만원+</span>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[14px] text-[var(--ink-soft)]">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm border border-[var(--line)]"
          style={{ backgroundColor: NO_PRICE_COLOR }}
        />
        정보 없음
      </p>
    </div>
  );
}
