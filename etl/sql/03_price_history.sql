-- 공시지가 연도별 이력 (Task 10)
--
-- 원본 SHP 한 행에 당해(A9)와 과거 4개년(A16~A19)이 함께 들어 있다.
-- 이를 연도별 행으로 펼쳐 담는다. 연도 수가 늘어날 것을 전제로 한 구조이므로
-- 10년치를 확보하면 컬럼 추가 없이 행만 늘리면 된다.

CREATE TABLE IF NOT EXISTS parcel_price_history (
  pnu           CHAR(19) NOT NULL,
  price_year    SMALLINT NOT NULL,
  price_per_sqm BIGINT,
  PRIMARY KEY (pnu, price_year),

  -- 좌표 이상치로 parcel에서 지워지는 필지는 이력도 함께 사라져야 한다
  FOREIGN KEY (pnu) REFERENCES parcel (pnu) ON DELETE CASCADE
);

COMMENT ON TABLE parcel_price_history IS
  '연도별 개별공시지가. 2023년은 전국적으로 하락한 해라 우하향 구간이 정상이다';
