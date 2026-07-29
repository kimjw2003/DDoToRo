# Task 4 결과 — bbox 조회 API

작업일 2026-07-29 · `/web` (Next.js 16.2.12, App Router, TypeScript, Tailwind)

---

## DoD 충족

| 항목 | 결과 | 기준 |
|---|---|---|
| curl로 양평군 좌표 조회 | 피처 반환 확인 | — |
| 응답 시간 | **bbox 26ms / 상세 17ms** | 500ms 이내 — 통과 |

첫 요청은 492ms가 나왔으나 이는 Turbopack 라우트 최초 컴파일 시간이다.
워밍업 후 실측은 위와 같다.

---

## 엔드포인트

### `GET /api/parcels?bbox=minLng,minLat,maxLng,maxLat&zoom=15`

```json
{
  "type": "FeatureCollection",
  "features": [ { "type": "Feature", "id": "<pnu>", "geometry": {...},
                  "properties": { "pnu", "emd", "ri", "jibun", "jimok",
                                  "area_sqm", "price_per_sqm", "price_year" } } ],
  "too_far": false,
  "truncated": false,
  "count": 378
}
```

- `zoom < 15`이면 **쿼리를 아예 실행하지 않고** 빈 FeatureCollection + `too_far: true` 반환
- 상한 3,000건. 초과 시 잘라내고 `truncated: true`
  (상한보다 1건 더 조회해 잘림 여부를 판별한다)
- `ST_MakeEnvelope` + `&&` 연산자로 GIST 인덱스를 탄다

### `GET /api/parcels/[pnu]`

```json
{
  "pnu": "4183025021107360000",
  "sido": "경기도", "sigungu": "양평군", "emd": "양평읍", "ri": "양근리",
  "jibun": "736", "jimok": "도로",
  "area_sqm": 1641.27, "price_per_sqm": 236600, "price_year": 2026,
  "total_price": 388324482,
  "geometry": { "type": "MultiPolygon", ... },
  "emd_trade_avg": {
    "emd": "양평읍", "deal_count": 1938,
    "avg_price_per_sqm": 353314, "median_price_per_sqm": 229585,
    "from_ym": "202308", "to_ym": "202607",
    "note": "이 필지의 거래 기록이 아닌 읍면 단위 평균입니다"
  }
}
```

`total_price`는 서버에서 정수로 계산해 내려준다 (`round(area_sqm * price_per_sqm)`).
금액을 프론트에서 부동소수점으로 곱하지 않게 하기 위함이다.

실거래는 **`emd_trade_avg`라는 이름으로 감싸** 읍면 집계임을 드러냈고,
응답 자체에 `note`를 넣어 필지 거래 기록이 아님을 명시했다.
DESIGN.md가 요구하는 화면 문구는 Task 5에서 별도로 넣는다.

### 에러 응답

| 상황 | HTTP | 응답 |
|---|---|---|
| zoom 누락 | 400 | `zoom이 필요합니다` |
| bbox 형식 오류 / min>max | 400 | `bbox 형식이 올바르지 않습니다` |
| PNU가 19자리 숫자가 아님 | 400 | `PNU는 19자리 숫자여야 합니다` |
| 없는 PNU | 404 | `필지를 찾을 수 없습니다` |

---

## Next.js 15가 아니라 16이 설치됐다

`create-next-app@latest`가 **16.2.12**를 설치했다. CLAUDE.md에는 15로 적혀 있으나
App Router 구조는 동일하고 작성한 코드도 그대로 동작한다.

프로젝트에 딸려온 `web/AGENTS.md`가 "이 버전은 기존과 다를 수 있으니
`node_modules/next/dist/docs/`를 먼저 읽으라"고 안내해 확인했고, 두 가지를 반영했다.

1. **`RouteContext<'/api/parcels/[pnu]'>`** — 16에서 추가된 전역 타입 헬퍼.
   경로 리터럴에서 params 타입을 끌어와 강타입이 된다.
   `{ params }: { params: Promise<...> }`도 동작하지만 이쪽이 관용적이다
2. **Route Handler는 기본적으로 캐시되지 않는다.** 실시간 DB 조회에 적합하므로 기본값을 유지했다.
   캐싱이 필요해지면 `export const dynamic = 'force-static'`을 명시해야 한다

---

## 처리한 문제 3가지

### 1. `pg`가 BIGINT/NUMERIC을 문자열로 준다

`deal_count`가 `"1938"`(문자열)로 응답에 나갔다. 타입 선언은 `number`였는데
런타임 타입이 달라 **타입 체커가 잡지 못했다.**

`count(*)`는 BIGINT, `area_sqm`은 NUMERIC이라 pg가 정밀도 보존을 위해 문자열로 반환한다.
모든 해당 컬럼에 명시적 `Number()` 변환을 적용했다.

### 2. dev 모드 HMR에서 커넥션 풀이 누적된다

파일을 저장할 때마다 모듈이 재평가되어 `new Pool()`이 반복 생성된다.
`globalThis`에 캐싱해 dev에서 재사용하도록 했다 (`lib/db.ts`).

### 3. Turbopack이 워크스페이스 루트를 잘못 추론했다

홈 디렉토리(`/Users/kimjw/`)에도 `package-lock.json`이 있어 그쪽을 루트로 잡았다.
`next.config.ts`에 `turbopack.root`를 명시해 고정했다.

---

## 알려진 이슈 — npm 취약점 12건

`npm audit`이 high 12건을 보고한다. 내역은 다음과 같다.

- **10건이 eslint 계열** 개발 의존성 (`eslint`, `eslint-config-next` 등)
- 나머지는 `sharp`(이미지 최적화), `postcss` — 빌드/이미지 처리용

**`npm audit fix --force`를 실행하면 안 된다.** Next.js를 9.3.3으로 다운그레이드한다.
지도 타일은 외부 URL이라 `sharp`를 쓰지 않으므로 실질 위험이 낮다.
상위 패키지 업데이트로 자연 해소될 때까지 둔다.

---

## 재현 방법

```bash
docker compose up -d          # DB
cd web && npm run dev         # http://localhost:3000

curl "localhost:3000/api/parcels?bbox=127.487,37.487,127.507,37.497&zoom=16"
curl "localhost:3000/api/parcels/4183025021107360000"
```

`web/.env.local`에 DB 접속 정보와 `NEXT_PUBLIC_VWORLD_KEY`가 필요하다
(`.env.example` 참고, 커밋되지 않는다).
