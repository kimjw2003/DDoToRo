import { Pool } from "pg";

// dev 모드는 파일이 바뀔 때마다 모듈을 다시 평가한다.
// globalThis에 담아두지 않으면 저장할 때마다 새 Pool이 생겨 커넥션이 고갈된다.
const globalForPool = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPool.pgPool ??
  new Pool({
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "ddotoro",
    user: process.env.PGUSER ?? "ddotoro",
    password: process.env.PGPASSWORD,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalForPool.pgPool = pool;

export async function query<T = unknown>(text: string, params?: unknown[]) {
  const res = await pool.query(text, params as never);
  return res.rows as T[];
}
