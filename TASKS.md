# MVP 작업 지시서

Task는 순서대로 진행한다. **각 Task의 완료 조건(DoD)을 충족하기 전에 다음 Task로 넘어가지 않는다.**
한 Task = 한 세션 기준. 여러 Task를 한 번에 처리하지 말 것.

---

## Task 1 — 원본 데이터 구조 파악

**목표**: 개별공시지가 SHP에 무엇이 들어있는지 확인한다. 이 결과로 이후 설계가 갈린다.

**할 일**
1. `/etl` 디렉토리와 Python 가상환경 생성 (geopandas, pandas, psycopg[binary], requests)
2. `/etl/data`에 있는 개별공시지가 SHP를 읽어 다음을 출력하는 스크립트 작성
   - CRS
   - 전체 컬럼명과 dtype
   - 상위 5행 샘플
   - geometry 타입 (Polygon / Point / 없음)
   - 전체 피처 수
3. 인코딩은 `cp949`로 시도하고, 실패 시 `euc-kr` → `utf-8` 순으로 폴백

**DoD**
- 지가 컬럼명, PNU 컬럼명, geometry 타입이 문서로 정리되어 있다
- 아래 분기 중 어느 쪽인지 결론이 나 있다

**분기**
- **A) Polygon + 지가 모두 존재** → 연속지적도를 사용하지 않는다. Task 2에서 단일 소스로 적재
- **B) 지가만 존재** → 연속지적도 SHP를 추가로 읽어 PNU 조인이 필요하다. Task 2에 조인 단계 추가

**주의**: 결과를 확인하기 전에 DB 스키마나 적재 코드를 작성하지 말 것.

---

## Task 2 — PostGIS 기동 및 데이터 적재

**목표**: 양평군 필지가 좌표와 가격을 갖고 DB에 들어간다.

**할 일**
1. `docker-compose.yml` 작성 (`imresamu/postgis:16-3.5`, 볼륨 영속화, 포트 5432)

   공식 `postgis/postgis`는 **amd64 전용**이라 Apple Silicon에서 네이티브 구동이 안 된다.
   `imresamu/postgis`는 공식 Dockerfile을 multi-arch(arm64 포함)로 빌드한 이미지다.
2. 스키마 작성 — Task 1 결과를 반영해 실제 컬럼에 맞출 것

```sql
CREATE TABLE parcel (
  pnu          CHAR(19) PRIMARY KEY,
  sido         TEXT,
  sigungu      TEXT,
  emd          TEXT,
  jibun        TEXT,           -- 표시용 지번 문자열 (예: '245-7')
  jimok        TEXT,           -- 지목 코드 또는 명칭
  area_sqm     NUMERIC(14,2),
  price_per_sqm BIGINT,        -- 원/㎡, 매칭 실패 시 NULL
  price_year   SMALLINT,
  geom         GEOMETRY(MultiPolygon, 4326)
);
CREATE INDEX idx_parcel_geom ON parcel USING GIST (geom);
CREATE INDEX idx_parcel_emd ON parcel (sigungu, emd);
```

3. 적재 스크립트 작성
   - **양평군(PNU 앞 5자리 = 41830)만 필터링**해서 적재
   - EPSG:5186 → EPSG:4326 변환
   - PNU는 문자열로 유지, 필요 시 zero-padding 보정
   - 배치 insert (한 건씩 커밋 금지)

**DoD**
- `SELECT count(*) FROM parcel` 결과가 출력되어 있다
- `price_per_sqm IS NULL` 비율이 리포트되어 있다 (5% 미만이면 정상)
- 무작위 20개 필지를 GeoJSON으로 `/etl/out/sample.geojson`에 저장했다

**검증 (필수)**
`sample.geojson`을 geojson.io 등에 올려 **실제 양평군 위치에 찍히는지 눈으로 확인한다.**
좌표계 변환 오류는 예외 없이 조용히 통과하므로 반드시 시각 확인이 필요하다.
바다나 아프리카에 찍히면 CRS 처리가 틀린 것이다.

---

## Task 3 — 실거래가 수집

**목표**: 양평군 토지 실거래를 읍면동 단위로 집계할 수 있다.

**할 일**
1. 실거래가 API 클라이언트 작성
   - 인증키는 `.env`에서 읽는다. 하드코딩 금지
   - `LAWD_CD=41830`, 최근 36개월치 순회
   - 호출 간 0.3초 sleep, 실패 시 3회 재시도
   - 0건 응답은 정상 처리 (에러 아님)
2. 결과를 `land_trade` 테이블에 적재

```sql
CREATE TABLE land_trade (
  id           BIGSERIAL PRIMARY KEY,
  sigungu_cd   CHAR(5),
  emd          TEXT,
  deal_ym      CHAR(6),
  deal_amount  BIGINT,     -- 원 단위
  area_sqm     NUMERIC(14,2),
  jimok        TEXT,
  raw          JSONB
);
```

3. 읍면동별 ㎡당 평균 거래가를 계산하는 뷰 또는 쿼리 작성

**DoD**
- 36개월 중 실제 데이터가 있는 개월 수와 총 건수가 리포트되어 있다
- 응답의 지번 필드가 마스킹되어 있음을 샘플로 확인했다
- 읍면동별 집계 결과가 출력되어 있다

**주의**: `raw` 컬럼에 원본 응답을 그대로 보관할 것. 필드명이 예상과 다를 때 재파싱할 수 있어야 한다.

---

## Task 4 — bbox 조회 API

**목표**: 지도 화면 영역에 해당하는 필지를 GeoJSON으로 받을 수 있다.

**할 일**
1. `/web`에 Next.js 15 프로젝트 생성 (TypeScript, Tailwind, App Router)
2. `GET /api/parcels?bbox=minLng,minLat,maxLng,maxLat&zoom=15`
   - zoom < 15 이면 빈 FeatureCollection과 `{ "too_far": true }` 반환
   - PostGIS `ST_MakeEnvelope` + `&&` 연산자 사용
   - 결과 상한 3000건, 초과 시 잘라내고 플래그 반환
   - geometry는 `ST_AsGeoJSON`으로 직렬화
3. `GET /api/parcels/[pnu]` — 단일 필지 상세
   - 필지 정보 + 해당 읍면동 실거래 집계를 함께 반환
   - 실거래는 반드시 지역 집계임을 나타내는 필드명으로 (`emd_trade_avg` 등)

**DoD**
- curl로 양평군 좌표 범위를 조회해 피처가 반환된다
- 응답 시간이 500ms 이내다 (초과 시 인덱스 확인)

---

## Task 5 — 지도 화면

**목표**: 지도에서 필지가 가격별로 색칠되고, 클릭하면 정보가 뜬다.

**할 일**
1. MapLibre GL JS + OSM 래스터 타일 베이스맵
2. 초기 위치는 양평군 중심, zoom 15
3. 지도 이동/줌 종료 시 bbox API 호출 (300ms 디바운스)
4. 필지 채색: ㎡당 가격 기준 5단계 **단일 색상 램프** (연함 → 진함). 무지개 팔레트 금지
5. zoom < 15 이면 폴리곤 대신 "확대해 주세요" 안내 표시
6. 필지 클릭 시 좌측 패널에 상세 표시

**좌측 패널 표시 순서 (이 순서를 지킬 것)**
1. 주소 (읍면동 + 지번)
2. **공시지가 총액** — 가장 크게. 예: `3억 2,180만원`
3. ㎡당 / 평당 단가 (작게)
4. 지목, 면적(㎡ + 평 병기), 기준연도
5. 이 지역 최근 실거래 평균 — **"이 필지의 거래가가 아님"을 명시**

**DoD**
- 지도에서 필지를 클릭하면 패널에 값이 채워진다
- 모바일 폭(375px)에서 패널이 하단 시트로 전환된다

---

## Task 6 — 검색과 상세 페이지

**목표**: 주소로 필지를 찾을 수 있고, 필지마다 고유 URL이 있다.

**할 일**
1. `GET /api/search?q=서종면 245-7`
   - 읍면동명 + 지번 파싱, `parcel` 테이블 LIKE 검색
   - 도로명주소는 MVP 범위 밖
2. 검색 결과 클릭 시 지도가 해당 필지로 이동하고 선택 상태가 된다
3. `/land/[pnu]` 서버 사이드 렌더링 페이지
   - 필지 정보 전체를 HTML로 렌더 (SEO)
   - `<title>`: `경기 양평군 서종면 245-7 공시지가 - DDoToRo`
   - `<meta description>`에 총액과 면적 포함
   - JSON-LD `Place` 구조화 데이터
   - 지도로 돌아가는 링크

**DoD**
- JS를 끈 상태로 `/land/{pnu}`에 접속해도 내용이 보인다
- 검색 → 지도 이동 → 상세 페이지 흐름이 끊기지 않는다

---

## 완료 후 확인

- [ ] 양평군 전체 필지가 지도에 뜬다
- [ ] 필지 클릭 → 총액이 보인다
- [ ] 검색이 동작한다
- [ ] `/land/[pnu]`가 SSR된다
- [ ] 모바일에서 사용 가능하다
- [ ] `price_per_sqm` NULL 비율이 5% 미만이다

여기까지가 MVP다. 도로접면(맹지 판별), 용도지역, 공시지가 시계열, 전국 확장은 **모두 이후 작업**이며 지금 착수하지 않는다.
