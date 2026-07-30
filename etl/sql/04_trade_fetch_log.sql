-- 실거래 수집 이력.
--
-- 거래가 0건인 달은 land_trade에 아무 행도 남기지 않는다. 이력이 없으면
-- 재실행할 때마다 그 달을 다시 호출하게 되는데, 시군구 31개 × 36개월이면
-- 대부분이 0건이라 하루 호출 한도를 그냥 태워버린다.
-- 0건도 '가져왔다'고 기록해 두어야 이어받기가 성립한다.

CREATE TABLE IF NOT EXISTS trade_fetch_log (
  sigungu_cd CHAR(5)     NOT NULL,
  deal_ym    CHAR(6)     NOT NULL,
  item_count INTEGER     NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sigungu_cd, deal_ym)
);
