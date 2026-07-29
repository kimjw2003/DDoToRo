import { Suspense } from "react";
import MapView from "@/components/MapView";

// useSearchParams를 쓰는 클라이언트 컴포넌트는 Suspense 경계가 필요하다
export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          <p className="text-[14px] text-[var(--ink-soft)]">지도를 불러오는 중</p>
        </div>
      }
    >
      <MapView />
    </Suspense>
  );
}
