# Task 5 결과 — 지도 화면

작업일 2026-07-29 · `/web` (MapLibre GL JS 6, VWorld white 타일)

---

## DoD 충족

| 항목 | 결과 |
|---|---|
| 필지 클릭 시 패널에 값이 채워진다 | 확인 (아래 캡처 내용) |
| 모바일 375px에서 하단 시트로 전환된다 | 확인 |
| 375px 가로 스크롤 없음 | 확인 |
| 콘솔 에러 | 없음 |

Playwright로 실제 브라우저를 띄워 검증했다. 선택된 필지의 패널 출력:

```
경기 양평군 양평읍
양근리 448-8
162억 9,081만원
2026년 공시
㎡당 1,542,000원 · 평당 5,097,544원
지목  대(집터)
면적  10,565㎡ (3,196평)
양평읍 최근 3년 토지 거래
평균 ㎡당 229,585원 · 1,938건
이 필지의 거래 기록이 아닙니다.
정부가 지번을 일부만 공개해 지역 평균으로만 보여드립니다.
```

---

## 가장 큰 문제 — MapLibre 워커가 죽어 있었다

**증상**: 배경지도는 멀쩡히 나오는데 필지 폴리곤만 하나도 안 그려졌다.
콘솔 에러 없음, `map.on('error')` 에도 아무것도 안 잡힘. API는 3,000건을 정상 반환.

**진단 과정**

1. 소스에 데이터가 들어갔는지 확인 → `querySourceFeatures` 0건
2. API 응답 자체를 브라우저에서 다시 넣어봐도 0건
3. `id` 필드 제거, 추가 필드 제거 → 여전히 0건
4. **지도 중앙에 사각형 하나를 직접 그려봐도 0건** → 데이터 문제가 아니다
5. Turbopack 대신 webpack, headless 대신 실제 브라우저 → 모두 동일
6. `setData()`가 반환하는 Promise를 `await` 하자 **영원히 resolve되지 않음**

**원인**: MapLibre는 GeoJSON 파싱·타일링을 웹 워커에서 한다.
워커는 `new URL('./maplibre-gl-worker.mjs', import.meta.url)`로 자기 경로를 잡는데,
Next.js 번들을 거치면서 이 URL이 페이지 주소(`http://localhost:3000/`)로 잘못 해석됐다.

래스터 타일은 메인 스레드에서 처리되므로 **배경지도만 멀쩡하고 폴리곤만 조용히 사라진다.**
실패가 예외로 드러나지 않고 Promise가 pending으로 남기 때문에 로그로는 절대 안 보인다.

**해결**: 워커 파일을 `public/maplibre/`로 복사하고 `setWorkerUrl()`로 직접 가리킨다.

```
package.json  "copy:maplibre" + predev/prebuild 훅으로 자동 복사
ParcelMap.tsx setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")
.gitignore    /public/maplibre/ (빌드 산출물이므로 커밋하지 않음)
```

워커가 같은 디렉토리의 `maplibre-gl-shared.mjs`를 import하므로 두 파일 다 복사해야 한다.

> 교훈: 빌드·타입·린트가 전부 통과해도 화면은 비어 있을 수 있다.
> 브라우저로 실제로 띄워보지 않았으면 이 버그는 그대로 남았다.

---

## MapLibre 6에서 달라진 점

- **default export가 없다.** `import maplibregl from "maplibre-gl"`는 실패한다.
  named import를 쓴다 (`MapLibreMap`, `NavigationControl`, `setWorkerUrl` …)
- **`setData()`가 `Promise<void>`를 반환한다.** await하지 않으면 실패가 묻힌다

---

## DESIGN.md 반영 내역

**색은 오직 가격을 뜻한다**

- 베이스맵 VWorld `white` + `raster-saturation: -1`.
  CSS `filter: grayscale()`은 쓰지 않는다. MapLibre는 베이스맵과 폴리곤을
  같은 WebGL 캔버스에 그리므로 캔버스에 필터를 걸면 가격 램프 색까지 죽는다
- UI 크롬·텍스트는 전부 무채색. 선택은 색이 아니라 **먹선 2px**, 호버는 1px
- 가격 5단계는 실제 분위수 경계를 쓴다: `21,300 / 42,400 / 77,100 / 156,000` 원/㎡

**서체**

- 총액·지번·h1만 나눔명조(`next/font/google`로 self-host)
- 나머지는 Pretendard(CDN `<link>`).
  `globals.css`에 `@import`로 넣으면 Tailwind 전개 규칙 뒤로 밀려 CSS 스펙 위반 경고가 난다

**시그니처 — 필지 실루엣**

패널 상단에 그 필지의 실제 모양을 SVG로 그린다. 위도에 따른 경도 축소를
`cos(lat)`으로 보정하지 않으면 모양이 옆으로 눌린다. MultiPolygon은 가장 큰 폴리곤만 쓴다.

**레이아웃**

- 데스크톱 320px 고정 패널 + 지도
- 모바일 하단 시트 3단계(88px / 45vh / 85vh). 필지를 누르면 중간 단계로 열린다
- 범례는 좌하단. 모바일에서는 시트 높이만큼 띄우고, 끝까지 펼치면 숨긴다

---

## 상태 관리

상태관리 라이브러리를 쓰지 않았다. **선택 필지는 URL이 원본이다.**

```
/?pnu=4183025021104480008
```

`useSearchParams`로 읽고 `router.replace(..., { scroll: false })`로 쓴다.
새로고침하거나 링크를 공유해도 같은 필지가 열린다. Task 6의 검색·상세 페이지와도 이어진다.

`parcel` 상세는 `selectedPnu`에서 파생시켰다. effect로 동기화하지 않고
렌더 시점에 `parcel?.pnu === selectedPnu`로 맞춰, 선택을 바꾼 직후
이전 필지 정보가 잠깐 보이는 문제를 없앴다.

---

## 성능·안정성 처리

- 지도 이동/줌 종료 후 **300ms 디바운스**
- 이동이 빠를 때 이전 요청이 늦게 도착해 화면을 덮어쓰지 않도록 `AbortController`로 취소
- 데이터가 새로 들어오면 `feature-state`가 초기화되므로 선택 표시를 다시 건다
- z15 미만은 API 호출 자체를 하지 않고 "지도를 확대하면 필지가 표시됩니다"만 띄운다

---

## 재현 방법

```bash
docker compose up -d
cd web && npm run dev     # predev가 MapLibre 워커를 public으로 복사한다
open http://localhost:3000
```
