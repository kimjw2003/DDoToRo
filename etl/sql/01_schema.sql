-- DDoToRo 스키마 (Task 2)
-- 컨테이너 최초 기동 시 1회 자동 실행된다.
-- 스키마를 바꾸려면 `docker compose down -v`로 볼륨을 지우고 다시 올린다.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE parcel (
  -- PNU 19자리. 선행 0이 유실되면 안 되므로 절대 숫자 타입으로 두지 않는다
  pnu           CHAR(19) PRIMARY KEY,

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

-- 지도 bbox 조회용
CREATE INDEX idx_parcel_geom ON parcel USING GIST (geom);

-- 읍면동 단위 집계/필터용
CREATE INDEX idx_parcel_emd ON parcel (sigungu, emd);

-- 검색용 ('서종면 245-7' 형태로 들어온다)
CREATE INDEX idx_parcel_search ON parcel (emd, jibun);

COMMENT ON TABLE  parcel IS '개별공시지가 필지. 양평군(41830)만 적재';
COMMENT ON COLUMN parcel.area_sqm IS 'EPSG:5186 좌표에서 계산한 면적. 원본 제공값과 오차 중앙값 0.71%';
COMMENT ON COLUMN parcel.price_per_sqm IS '개별공시지가 원/㎡. 연 1회 갱신되는 공시가격이며 실거래 시세가 아니다';
