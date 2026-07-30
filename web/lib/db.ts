import { createClient, type Client, type InValue } from "@libsql/client";

/*
  Turso(libSQL) 연결.

  PostGIS를 쓰지 않는다. 공간 연산은 적재 시점(etl/export_sqlite.py)에 끝내고
  여기서는 단순 조회만 한다 — 중심점·경계상자·분위수가 모두 컬럼으로 굳어 있다.

  URL 두 가지를 모두 받는다.
    file:/절대경로/ddotoro.db   로컬 파일. 배포 전 검증용
    libsql://<db>.turso.io      원격. 이때만 authToken이 필요하다

  dev 모드는 파일이 바뀔 때마다 모듈을 다시 평가하므로 globalThis에 담아
  저장할 때마다 커넥션이 새로 생기는 것을 막는다.
*/
const globalForDb = globalThis as unknown as { libsql?: Client };

function connect(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL이 없습니다. .env.local을 확인하세요 " +
        "(로컬 검증은 file:<절대경로>/etl/out/ddotoro.db)",
    );
  }
  return createClient({
    url,
    // 로컬 파일에는 토큰이 필요 없다
    authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN,
  });
}

export const db = globalForDb.libsql ?? connect();
if (process.env.NODE_ENV !== "production") globalForDb.libsql = db;

/**
 * 조회 한 번.
 *
 * 자리표시자는 `?`다. PostgreSQL의 `$1`이 아니다 —
 * 옛 쿼리를 그대로 옮기면 조용히 빈 결과가 돌아온다.
 */
export async function query<T = unknown>(
  sql: string,
  args: InValue[] = [],
): Promise<T[]> {
  const rs = await db.execute({ sql, args });
  return rs.rows as unknown as T[];
}
