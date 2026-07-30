"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ParcelMap from "@/components/ParcelMap";
import ParcelPanel, { type ParcelDetail } from "@/components/ParcelPanel";
import Legend from "@/components/Legend";
import SearchBox, { type SearchHit } from "@/components/SearchBox";
import { formatWon } from "@/lib/format";

/** 모바일 하단 시트 스냅 3단계. 필지를 누르면 중간으로 열린다 */
const SNAP = { collapsed: "88px", middle: "45vh", expanded: "85vh" } as const;
type Snap = keyof typeof SNAP;

export default function MapView() {
  // 선택 상태는 URL이 원본이다. 상태관리 라이브러리 없이 이걸로 충분하고,
  // 새로고침하거나 링크를 공유해도 같은 필지가 열린다
  const router = useRouter();
  const params = useSearchParams();
  const selectedPnu = params.get("pnu");

  const [parcel, setParcel] = useState<ParcelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [snap, setSnap] = useState<Snap>("collapsed");

  const abort = useRef<AbortController | null>(null);

  const fetchDetail = useCallback(async (pnu: string) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;

    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/parcels/${pnu}`, { signal: ac.signal });
      if (!res.ok) throw new Error(String(res.status));
      setParcel(await res.json());
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(true);
        setParcel(null);
      }
    } finally {
      if (abort.current === ac) setLoading(false);
    }
  }, []);

  // URL(외부 상태) 변화에 맞춰 서버 데이터를 가져온다.
  // 데이터 페칭은 effect의 정당한 용도이지만, fetchDetail이 내부에서
  // setLoading을 호출하는 것을 린트 규칙이 구분하지 못한다.
  useEffect(() => {
    if (!selectedPnu) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDetail(selectedPnu);
  }, [selectedPnu, fetchDetail]);

  // parcel은 selectedPnu에서 파생된다. effect로 비우지 않고 렌더 시점에 맞춘다.
  // pnu가 일치할 때만 보여주므로 선택을 바꾼 직후 이전 필지가 잠깐 보이지 않는다
  const shown = selectedPnu && parcel?.pnu === selectedPnu ? parcel : null;
  const showError = Boolean(selectedPnu) && error;
  const showLoading = Boolean(selectedPnu) && loading && !shown;

  const handleSelect = useCallback(
    (pnu: string | null) => {
      // scroll: false가 없으면 선택할 때마다 화면이 위로 튄다
      router.replace(pnu ? `/?pnu=${pnu}` : "/", { scroll: false });
      setSnap(pnu ? "middle" : "collapsed");
    },
    [router],
  );

  const cycleSnap = () =>
    setSnap((s) =>
      s === "collapsed" ? "middle" : s === "middle" ? "expanded" : "collapsed",
    );

  // 검색 결과를 고르면 지도를 그 필지로 옮기고 선택 상태로 만든다
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number } | null>(null);
  const handlePick = useCallback(
    (hit: SearchHit) => {
      setFlyTo({ lng: hit.lng, lat: hit.lat });
      handleSelect(hit.pnu);
    },
    [handleSelect],
  );

  const panel = (
    <ParcelPanel
      parcel={shown}
      loading={showLoading}
      error={showError}
      onRetry={() => selectedPnu && fetchDetail(selectedPnu)}
    />
  );

  return (
    <main className="flex h-dvh flex-col lg:flex-row">
      {/* 데스크톱 좌측 패널. 폭 320px 고정 */}
      <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-r border-[var(--line)] bg-[var(--surface)] lg:block">
        <header className="border-b border-[var(--line)] px-5 py-4">
          <h1 className="font-serif-num text-[20px] text-[var(--ink)]">DDoToRo</h1>
          <p className="text-[14px] text-[var(--ink-soft)]">
            경기 양평군 땅값 조회
          </p>
          <div className="mt-3">
            <SearchBox onPick={handlePick} />
          </div>
        </header>
        {panel}
      </aside>

      <div className="relative min-h-0 flex-1">
        <ParcelMap
          selectedPnu={selectedPnu}
          onSelect={handleSelect}
          flyTo={flyTo}
        />

        {/*
          범례는 좌하단 고정.
          모바일에서는 하단 시트 높이만큼 띄워야 가리지 않는다.
          시트를 끝까지 펼치면 지도가 거의 안 보이므로 범례도 숨긴다.
        */}
        <div
          className={`absolute left-4 bottom-[var(--legend-bottom)] lg:bottom-6 ${
            snap === "expanded" ? "max-lg:hidden" : ""
          }`}
          style={
            { "--legend-bottom": `calc(${SNAP[snap]} + 16px)` } as React.CSSProperties
          }
        >
          <Legend />
        </div>
      </div>

      {/* 모바일 하단 시트 */}
      <div
        className="sheet-transition fixed inset-x-0 bottom-0 z-10 flex flex-col rounded-t-xl border-t border-[var(--line)] bg-[var(--surface)] transition-[height] duration-200 ease-out lg:hidden"
        style={{ height: SNAP[snap] }}
      >
        <button
          type="button"
          onClick={cycleSnap}
          aria-label="정보 패널 크기 조절"
          className="flex min-h-[44px] w-full shrink-0 items-center justify-center"
        >
          <span className="h-1 w-10 rounded-full bg-[var(--line)]" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {snap === "collapsed" ? (
            shown ? (
              // 접힘 단계에서는 지번과 총액만 보여준다
              <div className="flex items-baseline justify-between gap-3 px-5">
                <span className="font-serif-num text-[20px] text-[var(--ink)]">
                  {[shown.ri, shown.jibun].filter(Boolean).join(" ")}
                </span>
                <span className="font-serif-num text-[20px] text-[var(--ink)]">
                  {formatWon(shown.total_price)}
                </span>
              </div>
            ) : (
              <p className="px-5 text-[14px] text-[var(--ink-mid)]">
                지도에서 땅을 눌러 보세요
              </p>
            )
          ) : (
            panel
          )}
        </div>
      </div>
    </main>
  );
}
