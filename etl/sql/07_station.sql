-- 전철·철도 역.
--
-- 2차까지는 web/lib/stations.ts에 경의중앙선 9개를 상수로 박아 두었다.
-- 서비스 범위를 경기도 전역으로 넓힌 뒤에도 그대로여서, 양평군 밖 필지에는
-- '가까운 역'이 아예 뜨지 않았다(수원 복정동 필지 → 빈 배열).
-- 수도권 전철역만 수백 개라 필지 조회마다 배열 전체를 도는 방식은 그 규모에서 맞지 않는다.
--
-- 적재는 etl/fetch_stations.py가 한다.

CREATE TABLE IF NOT EXISTS station (
  -- OSM 노드 id. 재수집해도 같은 역이 같은 행으로 들어온다
  osm_id      BIGINT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- 노선명. 환승역은 여러 개라 ' · '로 이어 붙인 문자열 하나로 굳힌다.
  -- 배열로 두면 SQLite로 내보낼 때 다시 문자열로 풀어야 한다
  line        TEXT,
  lng         DOUBLE PRECISION NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  -- 'subway' | 'train' | 'light_rail' 등. 지금은 쓰지 않지만
  -- 나중에 일반철도를 걸러내야 할 때 필요하다
  kind        TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 필지 하나당 반경 15km 안의 역만 본다.
-- 위경도 각각에 범위 조건을 걸어 후보를 줄인 뒤 거리를 잰다
CREATE INDEX IF NOT EXISTS idx_station_lat ON station(lat);
CREATE INDEX IF NOT EXISTS idx_station_lng ON station(lng);
