"use client";

import { useEffect, useRef, useState } from "react";
import { formatJimok, formatWonPlain } from "@/lib/format";

export type SearchHit = {
  pnu: string;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  price_per_sqm: number | null;
  lng: number;
  lat: number;
};

/**
 * 지번 검색.
 *
 * 3차에서 좌상단 검색 카드 **안쪽**에 놓인다. 결과 목록도 같은 카드 안에서
 * 아래로 펼쳐진다 — 카드 밖에 따로 떠 있는 드롭다운을 만들지 않는다.
 * 바깥 여백·라운드·그림자는 카드가 맡으므로 여기서 다시 주지 않는다.
 */
export default function SearchBox({
  onPick,
}: {
  onPick: (hit: SearchHit) => void;
}) {
  const [q, setQ] = useState("");
  // 결과를 검색어와 함께 들고 있으면, 입력이 바뀌는 순간 이전 결과가 저절로 무효가 된다.
  // effect에서 따로 비울 필요가 없다
  const [found, setFound] = useState<{ q: string; results: SearchHit[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const term = q.trim();
  const hits = found && found.q === term ? found.results : null;

  useEffect(() => {
    if (term.length < 2) return;

    // 타이핑 중 매 글자마다 쏘지 않는다
    const timer = setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ac.signal,
        });
        const json = await res.json();
        setFound({ q: term, results: json.results ?? [] });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setFound({ q: term, results: [] });
        }
      } finally {
        if (abort.current === ac) setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [term]);

  const open = term.length >= 2;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="px-5 pb-5 pt-4">
        <label htmlFor="parcel-search" className="sr-only">
          지번으로 땅 찾기
        </label>

        <div className="relative">
          <SearchIcon />
          <input
            id="parcel-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            // 특정 지역 지번을 예로 들면 그 동네만 찾는 곳으로 오해된다.
            // 입력 형식만 보여주고 지역명은 넣지 않는다
            placeholder="읍면동 + 지번 (예: 파장동 100-1)"
            autoComplete="off"
            className="h-12 w-full rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--sunken)] pl-11 pr-3 text-[16px] text-[var(--ink)] transition-colors placeholder:text-[var(--ink-soft)] hover:border-[var(--line-strong)] focus:border-[var(--accent-400)] focus:bg-[var(--surface)]"
          />
        </div>

        {/*
          빈 상태 안내. 3차에서는 선택 전에 패널 카드를 그리지 않으므로
          "지도에서 땅을 눌러 보세요"를 여기서 말한다.
        */}
        {!open && (
          <p className="t-label mt-3 text-[var(--ink-soft)]">
            지도에서 땅을 눌러 보세요
          </p>
        )}
      </div>

      {open && (
        <div className="min-h-0 overflow-y-auto border-t border-[var(--line-soft)] px-5 py-3">
          {loading && hits === null ? (
            <p className="t-label text-[var(--ink-soft)]">찾는 중</p>
          ) : hits && hits.length === 0 ? (
            <p className="t-label text-[var(--ink-mid)]">
              &lsquo;{term}&rsquo;에 해당하는 필지가 없습니다. 지번을 확인해
              주세요
            </p>
          ) : (
            <ul>
              {hits?.map((h, i) => (
                <li
                  key={h.pnu}
                  className={
                    i > 0 ? "border-t border-[var(--line-soft)]" : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      onPick(h);
                      setQ("");
                    }}
                    className="-mx-2 flex min-h-[44px] w-[calc(100%+1rem)] items-baseline justify-between gap-3 rounded-[var(--r-xs)] px-2 py-2 text-left transition-colors hover:bg-[var(--accent-50)]"
                  >
                    <span className="text-[16px] text-[var(--ink)]">
                      {[h.emd, h.ri, h.jibun].filter(Boolean).join(" ")}
                      <span className="t-label ml-2 text-[var(--ink-soft)]">
                        {formatJimok(h.jimok)}
                      </span>
                    </span>
                    <span className="tnum t-label shrink-0 text-[var(--ink-mid)]">
                      {h.price_per_sqm === null
                        ? "정보 없음"
                        : `${formatWonPlain(h.price_per_sqm)}/㎡`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** 1.7px 단선 아이콘. 채도를 주지 않는다 — 채도는 가격만 뜻한다 */
function SearchIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-soft)]"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2 L17 17" />
    </svg>
  );
}
