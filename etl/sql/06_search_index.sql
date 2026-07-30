-- 지역명 검색 인덱스.
--
-- 검색은 '서종면 문호리'처럼 부분 문자열로 들어오므로 ILIKE '%...%'를 쓴다.
-- B-tree는 앞부분이 고정되지 않은 패턴에 쓸 수 없어 521만 건을 전부 훑게 되고,
-- 실측 1,063ms가 나왔다. 검색창은 타이핑마다 호출되므로 그대로 둘 수 없다.
--
-- trigram(3글자 조각) GIN 인덱스는 중간 일치도 색인한다.
-- 인덱스 식은 search/route.ts의 WHERE 식과 '완전히 같아야' 한다 — 한 글자라도
-- 다르면 플래너가 같은 식으로 인식하지 못해 조용히 Seq Scan으로 돌아간다.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_parcel_region_trgm
    ON parcel USING GIN (
      (coalesce(sigungu, '') || ' ' || emd || ' ' || coalesce(ri, ''))
      gin_trgm_ops
    );

-- 지번 단독 조회용.
-- idx_parcel_search는 (emd, jibun)이라 지역이 ILIKE로 들어오면 선두 컬럼을
-- 쓸 수 없다. 지번은 그 자체로 선택도가 높아 단독 인덱스가 효율적이다.
CREATE INDEX IF NOT EXISTS idx_parcel_jibun ON parcel (jibun);
