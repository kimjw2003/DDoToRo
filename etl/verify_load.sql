-- Task 2 DoD 검증 쿼리

\echo '=== 1. 전체 건수 ==='
SELECT count(*) AS total FROM parcel;

\echo '=== 2. 공시지가 NULL 비율 (5% 미만이면 정상) ==='
SELECT
  count(*) FILTER (WHERE price_per_sqm IS NULL) AS null_price,
  count(*)                                      AS total,
  round(100.0 * count(*) FILTER (WHERE price_per_sqm IS NULL) / count(*), 3) AS null_pct
FROM parcel;

\echo '=== 3. 읍면동별 분포 ==='
SELECT emd,
       count(*)                        AS 필지수,
       count(DISTINCT ri)              AS 리수,
       round(avg(price_per_sqm))       AS 평균_원_per_sqm
FROM parcel
GROUP BY emd
ORDER BY 필지수 DESC;

\echo '=== 4. 지목 분포 (상위 10) ==='
SELECT jimok, count(*) AS cnt
FROM parcel
GROUP BY jimok
ORDER BY cnt DESC
LIMIT 10;

\echo '=== 5. geometry 타입/좌표계 ==='
SELECT DISTINCT ST_GeometryType(geom) AS geom_type, ST_SRID(geom) AS srid FROM parcel;

\echo '=== 6. 좌표 범위 (양평군: lng 127.30~127.77, lat 37.36~37.65) ==='
SELECT
  round(min(ST_XMin(geom))::numeric, 5) AS min_lng,
  round(max(ST_XMax(geom))::numeric, 5) AS max_lng,
  round(min(ST_YMin(geom))::numeric, 5) AS min_lat,
  round(max(ST_YMax(geom))::numeric, 5) AS max_lat
FROM parcel;

\echo '=== 7. 면적 통계 (㎡) ==='
SELECT
  round(min(area_sqm))                   AS 최소,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY area_sqm)::numeric) AS 중앙값,
  round(max(area_sqm))                   AS 최대
FROM parcel;

\echo '=== 8. 유효하지 않은 geometry ==='
SELECT count(*) AS invalid_geom FROM parcel WHERE NOT ST_IsValid(geom);

\echo '=== 9. PNU 형식 위반 (19자리 숫자가 아닌 것) ==='
SELECT count(*) AS bad_pnu FROM parcel WHERE pnu !~ '^[0-9]{19}$';

\echo '=== 10. 샘플 5건 ==='
SELECT pnu, sigungu, emd, ri, jibun, jimok,
       area_sqm, price_per_sqm, price_year,
       round((area_sqm * price_per_sqm)::numeric) AS 총액_원
FROM parcel
WHERE price_per_sqm IS NOT NULL
ORDER BY pnu
LIMIT 5;
