import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { InValue } from "@libsql/client";

const LIMIT = 20;

type Row = {
  pnu: string;
  sido: string | null;
  sigungu: string | null;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: number | null;
  price_per_sqm: number | null;
  lng: number;
  lat: number;
};

/** `245-7`, `산22`처럼 지번으로 볼 수 있는 토큰인지. */
const JIBUN_RE = /^산?\d+(-\d+)?$/;

/**
 * 앞자리 일치를 범위 조건으로 바꾼다.
 *
 * `LIKE '서종%'`을 쓰면 안 된다 — SQLite의 LIKE는 기본적으로 대소문자를 무시해서
 * 인덱스를 타지 못하고 521만 건을 훑는다(실측 2.2초). 부등호 두 개로 바꾸면
 * 같은 결과를 인덱스 범위 스캔으로 얻는다(0ms).
 *
 * 상한의 ￿는 유니코드에서 가장 큰 코드포인트라 어떤 글자보다 뒤에 온다.
 */
function prefixRange(token: string): [string, string] {
  return [token, token + "￿"];
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) {
    return NextResponse.json({ query: raw, results: [], count: 0 });
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  const hasJibun = JIBUN_RE.test(last);

  // 지번을 뺀 나머지는 시군구 또는 읍면동, 리 이름으로 본다
  const jibun = hasJibun ? last : null;
  const regionTokens = hasJibun ? tokens.slice(0, -1) : tokens;

  const where: string[] = [];
  const params: InValue[] = [];

  if (jibun) {
    params.push(jibun);
    where.push("jibun = ?");
  }

  /*
    '수원시 파장동'처럼 여러 토큰이 오면 모두 만족해야 한다.
    토큰 하나가 어느 단계 이름인지 미리 알 수 없으므로 세 컬럼 중 아무 곳이나
    앞자리가 맞으면 통과시킨다. 읍면동 이름은 시군구를 넘으면 유일하지 않아
    ('중앙동'은 여러 시에 있다) 시를 함께 적으면 그만큼 좁혀진다.
  */
  for (const t of regionTokens) {
    const [lo, hi] = prefixRange(t);
    params.push(lo, hi, lo, hi, lo, hi);
    where.push(
      "((emd >= ? AND emd < ?) OR (ri >= ? AND ri < ?) OR (sigungu >= ? AND sigungu < ?))",
    );
  }

  if (where.length === 0) {
    return NextResponse.json({ query: raw, results: [], count: 0 });
  }

  params.push(LIMIT);

  const rows = await query<Row>(
    `SELECT pnu, sido, sigungu, emd, ri, jibun, jimok, area_sqm, price_per_sqm,
            lng, lat
       FROM parcel
      WHERE ${where.join(" AND ")}
      -- 가격이 있는 필지를 먼저 보여준다. 정보가 없는 필지는 사용자가 할 일이 없다
      ORDER BY (price_per_sqm IS NULL), sigungu, emd, ri, jibun
      LIMIT ?`,
    params,
  );

  return NextResponse.json({
    query: raw,
    parsed: { region: regionTokens.join(" ") || null, jibun },
    count: rows.length,
    results: rows.map((r) => ({
      pnu: r.pnu,
      sido: r.sido,
      sigungu: r.sigungu,
      emd: r.emd,
      ri: r.ri,
      jibun: r.jibun,
      jimok: r.jimok,
      area_sqm: r.area_sqm,
      price_per_sqm: r.price_per_sqm,
      lng: r.lng,
      lat: r.lat,
    })),
  });
}
