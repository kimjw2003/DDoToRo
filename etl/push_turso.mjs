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

// --local=<경로>로 바꿀 수 있다. 실거래만 갱신할 때는 그때 내보낸 파일을 가리켜야 한다
const LOCAL =
  process.argv.find((a) => a.startsWith("--local="))?.slice("--local=".length) ??
  "file:/Users/kimjw/Documents/Project/DDoToRo/etl/out/ddotoro.db";
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

/**
 * 표 몇 개만 지우고 다시 넣는다.
 *
 * 통짜 적재(아래 main)는 이미 데이터가 있는 표를 건너뛰므로 갱신에 쓸 수 없다.
 * 실거래는 매달 새로 들어오고 신고 지연으로 최근 1~2개월이 나중에 채워지는데,
 * 그때마다 521만 필지를 다시 밀어넣을 이유가 없다.
 *
 * DELETE와 INSERT를 batch 하나에 묶는다 — libSQL이 이걸 한 트랜잭션으로 실행하므로
 * 중간에 끊겨도 표가 빈 채로 남지 않는다. 운영 DB를 건드리는 작업이라 중요하다.
 */
async function replaceTables(local, remote, names) {
  for (const t of names) {
    const rs = await local.execute(`SELECT * FROM ${t}`);

    /*
      원격에 없는 표면 먼저 만든다.

      --replace는 원래 있는 표를 갱신하는 용도라 없으면 DELETE에서 죽었다.
      새 표(station 같은)를 처음 올릴 때 통짜 적재를 다시 돌릴 이유는 없으므로
      로컬 DDL을 그대로 가져다 만든다.
    */
    const ddl = await local.execute({
      sql: "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
      args: [t],
    });
    if (!ddl.rows.length) throw new Error(`로컬에 ${t} 표가 없다`);
    try {
      await remote.execute(ddl.rows[0].sql);
      console.log(`  ${t}  원격에 없어 새로 만듦`);
    } catch (e) {
      if (!String(e.message).includes("already exists")) throw e;
    }

    /*
      인덱스도 함께 옮긴다.

      표만 만들면 poi(7만 행)에서 최근접 조회가 전체 스캔이 된다.
      sqlite_master의 sql이 null인 행은 UNIQUE 제약이 자동으로 만든 것이라 건너뛴다.
    */
    const idx = await local.execute({
      sql: "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
      args: [t],
    });
    for (const row of idx.rows) {
      try {
        await remote.execute(row.sql);
      } catch (e) {
        if (!String(e.message).includes("already exists")) throw e;
      }
    }
    if (idx.rows.length) console.log(`  ${t}  인덱스 ${idx.rows.length}개 확인`);

    const before = await remote.execute(`SELECT count(*) AS n FROM ${t}`);

    const cols = rs.columns;
    const ph = cols.map(() => "?").join(",");
    const sql = `INSERT INTO ${t} (${cols.join(",")}) VALUES (${ph})`;

    await remote.batch(
      [
        { sql: `DELETE FROM ${t}`, args: [] },
        ...rs.rows.map((r) => ({ sql, args: cols.map((c) => r[c]) })),
      ],
      "write",
    );

    const after = await remote.execute(`SELECT count(*) AS n FROM ${t}`);
    console.log(
      `  ${t}  ${fmt(Number(before.rows[0].n))} -> ${fmt(Number(after.rows[0].n))}건`,
    );
  }
}

async function main() {
  const reset = process.argv.includes("--reset");

  /*
    --replace 표1,표2   그 표만 갈아끼우고 끝낸다.
    큰 표에는 쓰지 말 것 — 한 batch에 다 담으므로 요청이 그만큼 커진다.
  */
  const replaceArg = process.argv.find((a) => a.startsWith("--replace="));
  if (replaceArg) {
    const names = replaceArg.slice("--replace=".length).split(",").filter(Boolean);
    console.log(`갈아끼울 표: ${names.join(", ")}`);
    await replaceTables(local, remote, names);
    console.log("완료");
    return;
  }

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
