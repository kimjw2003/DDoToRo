"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import BrandMark from "@/components/BrandMark";
import ParcelMap, { type ChipLevel } from "@/components/ParcelMap";
import ParcelPanel, { type ParcelDetail } from "@/components/ParcelPanel";
import Legend from "@/components/Legend";
import SearchBox, { type SearchHit } from "@/components/SearchBox";
import { SERVICE_AREA } from "@/lib/region";

/**
 * 패널 카드 폭.
 *
 * Tailwind 클래스(w-[400px])와 우하단 컨트롤을 밀어낼 거리가 같은 값을 써야 하므로
 * 여기 한 번만 적는다. ParcelMap의 PANEL_ZONE(= 이 값 + 여백 16)과도 짝이다.
 */
const PANEL_CARD_W = 400;

/**
 * 지도 화면.
 *
 * 3차에서 좌측 384px 고정 레일을 걷어내고 지도를 전면으로 깔았다.
 * 검색·패널·범례는 그 위에 떠 있는 카드다 (직방·다방·호갱노노와 같은 구성).
 *
 * 카드가 지도를 가리므로 그 아래 필지는 클릭할 수 없다.
 * ParcelMap이 flyTo에 padding을 넘겨 선택 필지를 가시 영역 중앙에 놓는 것으로 해결한다.
 *
 * 모바일 하단 시트는 이번 범위가 아니다. 2차에서 반쯤 만들어져 있던 SNAP 코드는 걷어냈다 —
 * 여기에 @media로 패널을 접는 코드를 다시 넣지 말 것.
 */
export default function MapView() {
  // 선택 상태는 URL이 원본이다. 상태관리 라이브러리 없이 이걸로 충분하고,
  // 새로고침하거나 링크를 공유해도 같은 필지가 열린다
  const router = useRouter();
  const params = useSearchParams();
  const selectedPnu = params.get("pnu");

  const [parcel, setParcel] = useState<ParcelDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

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
    },
    [router],
  );

  // 범례를 줌 구간에 맞춰 바꾸기 위해 지도가 알려준다
  const [level, setLevel] = useState<ChipLevel>("parcel");

  // 검색 결과를 고르면 지도를 그 필지로 옮기고 선택 상태로 만든다
  const [flyTo, setFlyTo] = useState<{ lng: number; lat: number } | null>(null);
  const handlePick = useCallback(
    (hit: SearchHit) => {
      setFlyTo({ lng: hit.lng, lat: hit.lat });
      handleSelect(hit.pnu);
    },
    [handleSelect],
  );

  // 패널 카드가 떠 있는 동안에만 그린다. 우하단 지도 컨트롤을 밀어낼 폭이기도 하다
  const panelOpen = Boolean(shown || showLoading || showError);

  return (
    <main
      className="app-shell relative overflow-hidden"
      /*
        패널 카드는 오른쪽 전체 높이를 차지해 MapLibre의 우하단 컨트롤
        (줌 · 출처 표기)을 통째로 덮는다. 열려 있는 동안만 왼쪽으로 밀어낸다.
        받는 쪽은 globals.css의 .maplibregl-ctrl-bottom-right다.
      */
      style={
        {
          "--map-ctrl-right": panelOpen ? `${PANEL_CARD_W + 16}px` : "0px",
        } as React.CSSProperties
      }
    >
      {/* 지도가 화면 전체를 채운다. 나머지는 전부 이 위에 뜬다 */}
      <div className="absolute inset-0">
        <ParcelMap
          selectedPnu={selectedPnu}
          onSelect={handleSelect}
          flyTo={flyTo}
          onLevelChange={setLevel}
        />
      </div>

      {/*
        좌상단 검색 카드.
        로고 행 + 입력 + 결과 목록이 한 카드 안에서 아래로 펼쳐진다.
        결과가 길어질 수 있으므로 높이를 화면에 맞춰 제한한다.
      */}
      {/* 아래를 bottom-[128px]로 잘라 결과가 길어져도 좌하단 범례를 덮지 않는다 */}
      <div className="pointer-events-none absolute bottom-[128px] left-4 top-4 z-10 flex w-[360px] flex-col">
        <div className="card pointer-events-auto flex min-h-0 flex-col overflow-hidden">
          {/* 워드마크 잠금 — 마크 + 이름. 사이 간격 12px(gap-3)는 규정값 */}
          <div className="flex items-center gap-3 px-5 pt-5">
            <BrandMark size={28} />
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]">
                DDoToRo
              </h1>
              <p className="t-label leading-tight text-[var(--ink-soft)]">
                {SERVICE_AREA.short} 땅값 조회
              </p>
            </div>
          </div>

          <SearchBox onPick={handlePick} />
        </div>
      </div>

      {/*
        우측 패널 카드.
        선택된 필지가 없고 로딩·에러도 아니면 카드 자체를 그리지 않는다 —
        떠 있는 카드에서 빈 안내문은 지도만 가린다. 빈 상태 안내는 검색 카드가 맡는다.
      */}
      {panelOpen && (
        /* 폭은 PANEL_CARD_W와 같은 값이다. 한쪽만 고치지 말 것 */
        <div className="absolute inset-y-4 right-4 z-10 flex w-[400px] flex-col">
          <div className="card card-raised card-in flex min-h-0 flex-1 flex-col overflow-hidden">
            <ParcelPanel
              parcel={shown}
              loading={showLoading}
              error={showError}
              onRetry={() => selectedPnu && fetchDetail(selectedPnu)}
              onClose={() => handleSelect(null)}
            />
          </div>
        </div>
      )}

      {/* 범례는 좌하단. 검색 카드가 길어져도 겹치지 않게 카드 열 바깥에 둔다 */}
      <div className="pointer-events-none absolute bottom-6 left-4 z-10">
        <Legend level={level} />
      </div>
    </main>
  );
}
