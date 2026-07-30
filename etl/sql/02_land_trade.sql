-- 토지 매매 실거래가 (Task 3)
--
-- 지번이 마스킹되어(`4**`) 제공되므로 개별 필지에 매칭할 수 없다.
-- 반드시 읍면동 단위 집계로만 사용한다.

CREATE TABLE IF NOT EXISTS land_trade (
  id           BIGSERIAL PRIMARY KEY,
  sigungu_cd   CHAR(5),
  emd          TEXT,            -- 읍면. '지평면' (원본 umdNm '지평면 망미리'를 분해)
  ri           TEXT,            -- 리. '망미리'
  deal_ym      CHAR(6),         -- 계약년월 202606
  deal_day     SMALLINT,

  -- 원본 dealAmount는 만원 단위 콤마 문자열('2,833')이다. x10,000 해서 원 단위로 저장한다
  deal_amount  BIGINT,
  area_sqm     NUMERIC(14,2),
  jimok        TEXT,

  land_use     TEXT,            -- 용도지역. 거래 건 단위라 필지에 붙일 수 없다. 보관만
  share_type   TEXT,            -- '지분'이면 필지 일부 거래 -> ㎡당 단가가 왜곡된다
  dealing_gbn  TEXT,            -- 직거래 / 중개거래
  cancel_type  TEXT,            -- 값이 있으면 계약해제 건이다

  raw          JSONB            -- 필드명이 예상과 다를 때 재파싱할 수 있도록 원본 보관

  -- UNIQUE 제약을 두지 않는다.
  -- 같은 (읍면리, 일자, 금액, 면적, 지목) 조합이 응답의 7.4%에서 실제로 여러 건 나온다.
  -- 한 필지의 지분을 여러 명에게 나눠 판 경우가 대표적이며 모두 별개 거래다.
  -- 재수집 시 중복은 fetch_trades.py가 월 단위로 DELETE 후 INSERT 해서 막는다.
);

CREATE INDEX IF NOT EXISTS idx_trade_emd ON land_trade (sigungu_cd, emd, deal_ym);

-- 읍면동별 ㎡당 평균 거래가.
--
-- 해제된 계약만 제외한다. 실제로 성사되지 않은 거래이기 때문이다.
--
-- 지분 거래는 제외하지 않는다. 필지 일부만 거래되지만 dealArea도 그 지분 면적으로
-- 오기 때문에 ㎡당 단가가 왜곡되지 않는다. 실측값도 거의 같다
-- (지분 215,134원/㎡ vs 일반 220,299원/㎡). 전체의 47.9%라 제외하면 표본만 절반이 된다.
--
-- 반드시 sigungu_cd로 함께 묶는다. 읍면동 이름은 시군구를 넘으면 유일하지 않다
-- (경기도만 해도 '중앙동'이 여러 시에 있다). 이름만으로 묶으면 서로 다른 지역의
-- 거래가 한 덩어리가 되어 조용히 틀린 시세가 나온다.
-- REPLACE로는 갈아끼울 수 없다. 컬럼을 앞에 추가하는 것은 이름 변경으로 취급되어
-- 'cannot change name of view column'로 거부된다. 반드시 지우고 새로 만든다.
DROP VIEW IF EXISTS emd_trade_avg;

CREATE VIEW emd_trade_avg AS
SELECT
  sigungu_cd,
  emd,
  count(*)                                        AS deal_count,
  round(avg(deal_amount / NULLIF(area_sqm, 0)))   AS avg_price_per_sqm,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY deal_amount / NULLIF(area_sqm, 0))::numeric)
                                                  AS median_price_per_sqm,
  min(deal_ym)                                    AS from_ym,
  max(deal_ym)                                    AS to_ym
FROM land_trade
WHERE area_sqm > 0
  AND coalesce(cancel_type, '') = ''
GROUP BY sigungu_cd, emd;

COMMENT ON VIEW emd_trade_avg IS
  '읍면동 단위 실거래 집계. 지번이 마스킹되어 개별 필지 매칭은 불가능하다';
