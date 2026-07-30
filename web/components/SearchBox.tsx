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

  return (
    <div>
      <label htmlFor="parcel-search" className="sr-only">
        지번으로 땅 찾기
      </label>
      <input
        id="parcel-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        // 특정 지역 지번을 예로 들면 그 동네만 찾는 곳으로 오해된다.
        // 입력 형식만 보여주고 지역명은 넣지 않는다
        placeholder="읍면동 + 지번 (예: 파장동 100-1)"
        autoComplete="off"
        className="min-h-[44px] w-full rounded border border-[var(--line)] bg-[var(--surface)] px-3 text-[16px] text-[var(--ink)] placeholder:text-[var(--ink-soft)]"
      />

      {term.length >= 2 && (
        <div className="mt-2">
          {loading && hits === null ? (
            <p className="text-[14px] text-[var(--ink-soft)]">찾는 중</p>
          ) : hits && hits.length === 0 ? (
            <p className="text-[14px] leading-[1.7] text-[var(--ink-mid)]">
              &lsquo;{term}&rsquo;에 해당하는 필지가 없습니다. 지번을 확인해
              주세요
            </p>
          ) : (
            <ul className="max-h-[280px] overflow-y-auto">
              {hits?.map((h) => (
                <li key={h.pnu}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(h);
                      setQ("");
                    }}
                    className="flex min-h-[44px] w-full items-baseline justify-between gap-3 border-b border-[var(--line)] py-2 text-left"
                  >
                    <span className="text-[14px] text-[var(--ink)]">
                      {[h.emd, h.ri, h.jibun].filter(Boolean).join(" ")}
                      <span className="ml-2 text-[14px] text-[var(--ink-soft)]">
                        {formatJimok(h.jimok)}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[14px] text-[var(--ink-mid)]">
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
