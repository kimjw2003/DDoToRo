/**
 * 로컬 SQLite를 Turso로 밀어 넣는다.
 *
 * `turso db create --from-dump`를 쓰지 않는 이유: CLI v1.0.31에서 그 기능이
 * 동작하지 않는다. 5줄짜리 최소 덤프로도 빈 DB만 만들어지며 에러조차 나오지 않는다.
 *
 * 대신 libsql 클라이언트로 직접 배치 INSERT 한다. 느려 보이지만 이점이 있다.
 *   - 진행률과 남은 시간이 보인다
 *   - 끊겨도 이어받는다 (원격에 들어간 마지막 id부터 다시)
 *
 * 실행:
 *   node push_turso.mjs                # 이어서 넣기
 *   node push_turso.mjs --reset        # 원격을 비우고 처음부터
 */
import { createClient } from "../web/node_modules/@libsql/client/lib-esm/node.js";
import { readFileSync } from "node:fs";

const LOCAL = "file:/Users/kimjw/Documents/Project/DDoToRo/etl/out/ddotoro.db";
const URL = process.env.TURSO_DATABASE_URL;
const TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!URL || !TOKEN) {
  console.error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 환경변수가 필요하다");
  process.exit(1);
}

/*
  한 번에 보낼 행 수.

  크게 잡을수록 왕복 횟수가 줄지만 요청 하나가 커진다. geojson이 행마다
  수백 바이트~수 KB라 1,000행이면 요청이 수 MB가 되어 실패하기 쉽다.
  400행 정도가 안정적이었다.
*/
const CHUNK = 400;

const local = createClient({ url: LOCAL });
const remote = createClient({ url: URL, authToken: TOKEN });

/** 로컬 DB에서 스키마 그대로 가져온다 (인덱스는 데이터를 다 넣은 뒤에 만든다) */
async function schema() {
  const rs = await local.execute(
    "SELECT type, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
  );
  return {
    tables: rs.rows.filter((r) => r.type === "table").map((r) => String(r.sql)),
    indexes: rs.rows.filter((r) => r.type === "index").map((r) => String(r.sql)),
  };
}

const fmt = (n) => n.toLocaleString("ko-KR");

async function main() {
  const reset = process.argv.includes("--reset");
  const { tables, indexes } = await schema();

  if (reset) {
    console.log("원격 초기화 중...");
    const names = await remote.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    for (const r of names.rows) {
      await remote.execute(`DROP TABLE IF EXISTS "${r.name}"`);
    }
  }

  // 테이블 만들기 (이미 있으면 넘어간다)
  for (const sql of tables) {
    try {
      await remote.execute(sql);
    } catch (e) {
      if (!String(e.message).includes("already exists")) throw e;
    }
  }
  console.log(`테이블 ${tables.length}개 준비 완료`);

  // 작은 테이블부터 통째로
  for (const t of [
    "land_trade",
    "emd_trade_avg",
    "sigungu_trade_avg",
    "region_summary",
  ]) {
    const have = await remote.execute(`SELECT count(*) AS n FROM ${t}`);
    if (Number(have.rows[0].n) > 0) {
      console.log(`  ${t} 이미 ${fmt(Number(have.rows[0].n))}건 — 건너뜀`);
      continue;
    }
    const rs = await local.execute(`SELECT * FROM ${t}`);
    const cols = rs.columns;
    const ph = cols.map(() => "?").join(",");
    for (let i = 0; i < rs.rows.length; i += CHUNK) {
      const slice = rs.rows.slice(i, i + CHUNK);
      await remote.batch(
        slice.map((r) => ({
          sql: `INSERT INTO ${t} (${cols.join(",")}) VALUES (${ph})`,
          args: cols.map((c) => r[c]),
        })),
        "write",
      );
    }
    console.log(`  ${t} ${fmt(rs.rows.length)}건`);
  }

  // 필지 — 이어받기 위해 원격의 마지막 id부터
  const [{ n: total }] = (await local.execute("SELECT count(*) AS n FROM parcel"))
    .rows;
  const done = await remote.execute("SELECT coalesce(max(id),0) AS m FROM parcel");
  let lastId = Number(done.rows[0].m);
  console.log(
    `필지 ${fmt(Number(total))}건 중 ${fmt(lastId)}건 완료 — id ${lastId + 1}부터`,
  );

  const cols = (await local.execute("SELECT * FROM parcel LIMIT 1")).columns;
  const ph = cols.map(() => "?").join(",");
  const sql = `INSERT INTO parcel (${cols.join(",")}) VALUES (${ph})`;
  const t0 = Date.now();
  let sent = 0;

  for (;;) {
    const rs = await local.execute({
      sql: `SELECT * FROM parcel WHERE id > ? ORDER BY id LIMIT ?`,
      args: [lastId, CHUNK],
    });
    if (rs.rows.length === 0) break;

    await remote.batch(
      rs.rows.map((r) => ({ sql, args: cols.map((c) => r[c]) })),
      "write",
    );

    lastId = Number(rs.rows[rs.rows.length - 1].id);
    sent += rs.rows.length;

    if (sent % (CHUNK * 10) === 0) {
      const sec = (Date.now() - t0) / 1000;
      const rate = sent / sec;
      const left = (Number(total) - lastId) / rate / 60;
      process.stdout.write(
        `\r  ${fmt(lastId)}/${fmt(Number(total))} ` +
          `(${((lastId / Number(total)) * 100).toFixed(1)}%) ` +
          `${rate.toFixed(0)}행/초 · 남은 시간 약 ${left.toFixed(0)}분   `,
      );
    }
  }
  console.log(`\n필지 완료 (${((Date.now() - t0) / 60000).toFixed(1)}분)`);

  console.log("인덱스 생성 중...");
  for (const sql of indexes) {
    try {
      await remote.execute(sql);
    } catch (e) {
      if (!String(e.message).includes("already exists")) throw e;
    }
  }

  const check = await remote.execute("SELECT count(*) AS n FROM parcel");
  console.log(`원격 필지 ${fmt(Number(check.rows[0].n))}건 — 완료`);
}

main().catch((e) => {
  console.error("\n실패:", e.message);
  process.exit(1);
});
