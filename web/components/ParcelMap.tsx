"use client";

import { useEffect, useRef, useState } from "react";
// maplibre-gl 6은 default export가 없다. named export만 쓴다
import {
  MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type ExpressionSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/*
  MapLibre는 GeoJSON 파싱·타일링을 웹 워커에서 한다.

  워커는 `new URL('./maplibre-gl-worker.mjs', import.meta.url)`로 자기 경로를 잡는데,
  Next.js 번들을 거치면 이 URL이 페이지 주소로 잘못 해석되어 워커가 뜨지 않는다.
  래스터 타일은 메인 스레드에서 처리되므로 배경지도만 멀쩡히 보이고
  필지 폴리곤만 조용히 사라진다. setData()가 반환하는 Promise는 영영 resolve되지 않는다.

  워커 파일을 public/maplibre로 복사해(package.json의 copy:maplibre) 직접 가리킨다.
  워커가 같은 디렉토리의 maplibre-gl-shared.mjs를 import하므로 둘 다 있어야 한다.
*/
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

import {
  basemapStyle,
  INITIAL_ZOOM,
  MIN_PARCEL_ZOOM,
  YANGPYEONG_CENTER,
} from "@/lib/basemap";
import { fillColorExpression, hatchImage } from "@/lib/priceRamp";

const SRC = "parcels";
const DEBOUNCE_MS = 300;

/*
  클릭·호버 대상 레이어.
  가격이 있는 필지와 없는 필지를 서로 다른 레이어로 그리므로 둘 다 잡아야 한다.
  하나만 넣으면 가격 정보가 없는 필지를 클릭할 수 없다.
*/
const PICK_LAYERS = ["parcel-fill", "parcel-fill-none"];

export type ParcelProps = {
  pnu: string;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: number | null;
  price_per_sqm: number | null;
  price_year: number | null;
};

type Props = {
  selectedPnu: string | null;
  onSelect: (pnu: string | null) => void;
  /** 지도가 선택 필지로 이동해야 할 때 쓴다 (검색 결과 등) */
  flyTo?: { lng: number; lat: number } | null;
};

export default function ParcelMap({ selectedPnu, onSelect, flyTo }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);

  const [tooFar, setTooFar] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // 이벤트 핸들러가 항상 최신 선택값을 보도록 ref로 들고 있는다
  const selectedRef = useRef<string | null>(selectedPnu);
  selectedRef.current = selectedPnu;

  useEffect(() => {
    if (!container.current || map.current) return;

    const m = new MapLibreMap({
      container: container.current,
      style: basemapStyle(),
      center: YANGPYEONG_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: 8,
      maxZoom: 19,
      attributionControl: { compact: true },
    });
    map.current = m;

    // 개발 중 브라우저 콘솔에서 지도 상태를 확인하기 위해 노출한다
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __map?: MapLibreMap }).__map = m;
    }

    m.addControl(new NavigationControl({ showCompass: false }), "top-right");

    m.on("load", () => {
      m.addSource(SRC, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        promoteId: "pnu",
      });

      /*
        필지를 도로·지명 레이어 '아래'에 끼워 넣는다.
        위에 그리면 필지 색이 지명과 아이콘을 덮어 읽을 수 없게 된다.
        (OSM 폴백일 때는 roads 레이어가 없으므로 맨 위에 쌓인다)
      */
      const beforeId = m.getLayer("roads") ? "roads" : undefined;

      // 밑의 지형이 비쳐야 위치를 파악할 수 있다. 선택된 필지만 불투명하게 올린다
      const fillOpacity: ExpressionSpecification = [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        1,
        0.72,
      ];

      m.addLayer(
        {
          id: "parcel-fill",
          type: "fill",
          source: SRC,
          // 가격이 없는 필지는 아래 해치 레이어가 맡는다
          filter: ["!=", ["get", "price_per_sqm"], null],
          paint: {
            "fill-color": fillColorExpression(),
            "fill-opacity": fillOpacity,
          },
        },
        beforeId,
      );

      /*
        가격 정보가 없는 필지(0.448%)는 색을 하나 더 늘리지 않고 45° 사선으로 구분한다.
        MapLibre는 fill-color와 fill-pattern을 한 레이어에 함께 쓸 수 없어 레이어를 나눈다.
      */
      const hatch = hatchImage();
      if (hatch && !m.hasImage("hatch-none")) {
        m.addImage("hatch-none", hatch);
      }
      m.addLayer(
        {
          id: "parcel-fill-none",
          type: "fill",
          source: SRC,
          filter: ["==", ["get", "price_per_sqm"], null],
          paint: {
            "fill-pattern": "hatch-none",
            "fill-opacity": fillOpacity,
          },
        },
        beforeId,
      );

      // 경계선은 흰색이다. 먹선으로 하면 축소 시 화면이 새까매진다
      m.addLayer(
        {
          id: "parcel-line",
          type: "line",
          source: SRC,
          paint: {
            "line-color": "#FFFFFF",
            "line-width": 0.5,
          },
        },
        beforeId,
      );

      /*
        선택과 호버는 색이 아니라 먹선 굵기로 표현한다.
        이 레이어만 도로 '위'에 둔다. 2px 얇은 선이라 지명을 가리지 않고,
        지금 어느 필지를 보고 있는지는 도로에 묻히면 안 되는 정보다.
      */
      m.addLayer({
        id: "parcel-outline",
        type: "line",
        source: SRC,
        paint: {
          "line-color": "#1C1C1A",
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2,
            ["boolean", ["feature-state", "hover"], false],
            1,
            0,
          ],
        },
      });

      load(m);
    });

    m.on("moveend", () => schedule(m));
    m.on("zoomend", () => schedule(m));

    let hovered: string | number | undefined;
    m.on("mousemove", PICK_LAYERS, (e: MapLayerMouseEvent) => {
      m.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      if (!f?.id) return;
      if (hovered !== undefined) {
        m.setFeatureState({ source: SRC, id: hovered }, { hover: false });
      }
      hovered = f.id;
      m.setFeatureState({ source: SRC, id: hovered }, { hover: true });
    });

    m.on("mouseleave", PICK_LAYERS, () => {
      m.getCanvas().style.cursor = "";
      if (hovered !== undefined) {
        m.setFeatureState({ source: SRC, id: hovered }, { hover: false });
      }
      hovered = undefined;
    });

    m.on("click", PICK_LAYERS, (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const pnu = f?.properties?.pnu as string | undefined;
      if (pnu) onSelect(pnu);
    });

    // 빈 곳을 누르면 선택을 푼다
    m.on("click", (e: MapMouseEvent) => {
      const hits = m.queryRenderedFeatures(e.point, { layers: PICK_LAYERS });
      if (hits.length === 0) onSelect(null);
    });

    return () => {
      m.remove();
      map.current = null;
    };
    // 최초 1회만 생성한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function schedule(m: MapLibreMap) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => load(m), DEBOUNCE_MS);
  }

  async function load(m: MapLibreMap) {
    const zoom = m.getZoom();
    const src = m.getSource(SRC) as GeoJSONSource | undefined;
    if (!src) return;

    if (zoom < MIN_PARCEL_ZOOM) {
      setTooFar(true);
      setTruncated(false);
      setFailed(false);
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const b = m.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");

    // 이동이 빠르면 이전 요청이 늦게 도착해 화면을 덮어쓴다. 직전 요청을 취소한다
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/parcels?bbox=${bbox}&zoom=${Math.floor(zoom)}`,
        { signal: ac.signal },
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();

      setTooFar(Boolean(json.too_far));
      setTruncated(Boolean(json.truncated));
      setFailed(false);
      src.setData(json);

      // 데이터가 새로 들어오면 feature-state가 초기화되므로 선택 표시를 다시 건다
      if (selectedRef.current) {
        m.setFeatureState(
          { source: SRC, id: selectedRef.current },
          { selected: true },
        );
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setFailed(true);
    } finally {
      if (abort.current === ac) setLoading(false);
    }
  }

  // 선택이 바뀌면 이전 필지의 표시를 지우고 새 필지에 건다
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !m.isStyleLoaded() || !m.getSource(SRC)) return;

    if (prevSelected.current) {
      m.setFeatureState(
        { source: SRC, id: prevSelected.current },
        { selected: false },
      );
    }
    if (selectedPnu) {
      m.setFeatureState({ source: SRC, id: selectedPnu }, { selected: true });
    }
    prevSelected.current = selectedPnu;
  }, [selectedPnu]);

  useEffect(() => {
    if (!flyTo || !map.current) return;
    map.current.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: Math.max(map.current.getZoom(), 17),
      duration: 800,
    });
  }, [flyTo]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />

      {/*
        z15 미만에서는 여전히 필지를 그리지 않지만(34만 건을 한 번에 내려보낼 수 없다)
        안내 문구는 띄우지 않는다. 지도를 덮는 배너가 거슬린다는 판단이다.
      */}

      {failed && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
            <span className="text-[14px] text-[var(--ink-mid)]">
              필지 정보를 불러오지 못했습니다
            </span>
            <button
              type="button"
              onClick={() => map.current && load(map.current)}
              className="min-h-[36px] rounded border border-[var(--ink)] px-3 text-[14px] text-[var(--ink)]"
            >
              다시 시도
            </button>
          </div>
        </div>
      )}

      {truncated && !tooFar && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2">
          <p className="rounded border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-[14px] text-[var(--ink-mid)]">
            필지가 많아 일부만 표시됩니다. 더 확대해 주세요
          </p>
        </div>
      )}

      {loading && !tooFar && (
        <div className="pointer-events-none absolute right-4 top-4">
          <span className="rounded bg-[var(--surface)] px-2.5 py-1 text-[14px] text-[var(--ink-soft)]">
            불러오는 중
          </span>
        </div>
      )}
    </div>
  );
}
