-- DDoToRo 스키마
-- 컨테이너 최초 기동 시 1회 자동 실행된다.
-- 스키마를 바꾸려면 `docker compose down -v`로 볼륨을 지우고 다시 올린다.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE parcel (
  -- PNU 19자리. 선행 0이 유실되면 안 되므로 절대 숫자 타입으로 두지 않는다
  pnu           CHAR(19) PRIMARY KEY,

  -- PNU 앞 5자리. 시군구 단위 집계·필터의 조인 키다.
  -- 이름(sigungu)으로 묶으면 안 된다 — 시도가 다른 동명 시군구가 존재한다
  sigungu_cd    CHAR(5),

  sido          TEXT,                 -- 경기도
  sigungu       TEXT,                 -- 양평군
  emd           TEXT,                 -- 읍면동. 서종면
  ri            TEXT,                 -- 리. 문호리 (동 지역은 NULL)

  jibun         TEXT,                 -- 표시용 지번. 245-7, 산22
  jimok         TEXT,                 -- 지목 명칭. 전 / 답 / 임야 / 대

  area_sqm      NUMERIC(14,2),        -- 원본에 1%만 있어 geometry에서 계산해 채운다
  price_per_sqm BIGINT,               -- 원/㎡. 매칭 실패 시 NULL
  price_year    SMALLINT,             -- 공시 기준연도

  -- 원본은 EPSG:5186(m 단위)이며 적재 시 4326으로 변환한다.
  -- 원본에 Polygon과 MultiPolygon이 섞여 있어 ST_Multi로 통일한다.
  geom          GEOMETRY(MultiPolygon, 4326) NOT NULL
);

/*
  인덱스는 여기서 만들지 않는다.

  적재 대상이 시군구 하나(34만 건)에서 시도 전체(520만 건)로 늘면서
  인덱스를 건 채로 COPY하면 매 행마다 GIST 트리를 갱신하느라 몇 배 느려진다.
  load_parcels.py가 적재를 마친 뒤 create_indexes()에서 한 번에 만든다.
  인덱스 정의는 그쪽에 있다.
*/

COMMENT ON TABLE  parcel IS '개별공시지가 필지';
COMMENT ON COLUMN parcel.sigungu_cd IS 'PNU 앞 5자리 시군구 법정동코드';
COMMENT ON COLUMN parcel.area_sqm IS 'EPSG:5186 좌표에서 계산한 면적. 원본 제공값과 오차 중앙값 0.71%';
COMMENT ON COLUMN parcel.price_per_sqm IS '개별공시지가 원/㎡. 연 1회 갱신되는 공시가격이며 실거래 시세가 아니다';
