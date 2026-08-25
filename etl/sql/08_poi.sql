-- 주변 생활시설.
--
-- Task 12에서 상세 패널에 자리만 잡아 두고 값은 전부 '—'였다.
-- 적재는 etl/fetch_facilities.py가 한다. 출처는 OpenStreetMap(ODbL)이다.
--
-- 보여주는 것은 개수가 아니라 **가장 가까운 하나까지의 거리**다.
-- 시골 땅에서 '반경 500m 내 30개'는 의미가 없다.

CREATE TABLE IF NOT EXISTS poi (
  -- OSM id는 node/way/relation 사이에서만 유일하다. 타입까지 묶어야 기본키가 된다
  osm_type   TEXT NOT NULL,
  osm_id     BIGINT NOT NULL,
  -- 'school' | 'hospital' | 'store' | 'office' | 'bus'
  -- web/components/ParcelPanel.tsx의 CategoryIcon 이름과 같아야 한다
  kind       TEXT NOT NULL,
  -- 이름이 없는 시설이 있다(특히 버스정류장). 거리만으로도 쓸모가 있어 버리지 않는다
  name       TEXT,
  lng        DOUBLE PRECISION NOT NULL,
  lat        DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id)
);

-- 필지 한 건마다 '카테고리별 가장 가까운 하나'를 찾는다.
-- kind로 먼저 갈라 위경도 상자로 자르는 것이 조회 모양이므로 그 순서로 만든다.
CREATE INDEX IF NOT EXISTS idx_poi_kind_pos ON poi(kind, lat, lng);
