-- 지도 시세 칩이 쓰는 지역 집계.
--
-- 읍면 12개(양평군)일 때는 요청마다 집계해도 580ms라 API 메모리 캐시로 버텼다.
-- 경기도 521만 필지에서는 같은 쿼리가 훨씬 무거워져 첫 요청이 몇 초씩 멈춘다.
-- 미리 구워 둔다. 필지를 다시 적재하면 REFRESH 해야 한다
-- (load_parcels.py가 적재 끝에 자동으로 실행한다).

DROP MATERIALIZED VIEW IF EXISTS region_summary;

CREATE MATERIALIZED VIEW region_summary AS
/*
  대표 좌표는 필지 중심점들의 '평균'이다.

  ST_Extent(bbox의 중심)가 3배쯤 빠르지만 읍면 경계가 산줄기를 따라 길게 뻗은
  곳에서 3.3km까지 어긋난다(양평 옥천면에서 확인). 칩이 마을이 아니라 능선에
  찍히면 위치 정보로서 쓸모가 없어진다.
*/
SELECT
  'emd'::text                                                AS level,
  sigungu_cd,
  emd                                                        AS name,
  sido,
  sigungu,
  avg(ST_X(ST_Centroid(geom)))                               AS lng,
  avg(ST_Y(ST_Centroid(geom)))                               AS lat,
  count(*)                                                   AS parcel_count,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_sqm)::numeric)
                                                             AS median_official
FROM parcel
WHERE emd IS NOT NULL
GROUP BY sigungu_cd, sido, sigungu, emd

UNION ALL

SELECT
  'sigungu'::text,
  sigungu_cd,
  sigungu,
  sido,
  sigungu,
  avg(ST_X(ST_Centroid(geom))),
  avg(ST_Y(ST_Centroid(geom))),
  count(*),
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_sqm)::numeric)
FROM parcel
WHERE sigungu IS NOT NULL
GROUP BY sigungu_cd, sido, sigungu;

CREATE INDEX idx_region_summary_level ON region_summary (level);
CREATE INDEX idx_region_summary_key   ON region_summary (sigungu_cd, name);

COMMENT ON MATERIALIZED VIEW region_summary IS
  '지도 칩용 시군구·읍면동 집계. median_official은 개별공시지가 중앙값이며 실거래가 아니다';
