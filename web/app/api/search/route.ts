import { NextResponse } from "next/server";
import { query } from "@/lib/db";

const LIMIT = 20;

type Row = {
  pnu: string;
  sido: string | null;
  sigungu: string | null;
  emd: string | null;
  ri: string | null;
  jibun: string | null;
  jimok: string | null;
  area_sqm: string | null;
  price_per_sqm: string | null;
  lng: number;
  lat: number;
};

/** `245-7`, `산22`처럼 지번으로 볼 수 있는 토큰인지. */
const JIBUN_RE = /^산?\d+(-\d+)?$/;

/** LIKE 패턴에서 %와 _는 와일드카드라 사용자 입력을 그대로 넣으면 안 된다. */
function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) {
    return NextResponse.json({ query: raw, results: [], count: 0 });
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  const hasJibun = JIBUN_RE.test(last);

  // 지번을 뺀 나머지는 읍면 또는 리 이름으로 본다
  const jibun = hasJibun ? last : null;
  const regionTokens = hasJibun ? tokens.slice(0, -1) : tokens;

  const where: string[] = [];
  const params: unknown[] = [];

  if (jibun) {
    params.push(jibun);
    where.push(`jibun = $${params.length}`);
  }

  // '서종면 문호리'처럼 여러 토큰이 오면 모두 만족해야 한다
  for (const t of regionTokens) {
    params.push(`%${escapeLike(t)}%`);
    where.push(
      `(emd || ' ' || coalesce(ri, '')) ILIKE $${params.length} ESCAPE '\\'`,
    );
  }

  if (where.length === 0) {
    return NextResponse.json({ query: raw, results: [], count: 0 });
  }

  params.push(LIMIT);

  const rows = await query<Row>(
    `SELECT pnu, sido, sigungu, emd, ri, jibun, jimok, area_sqm, price_per_sqm,
            ST_X(ST_Centroid(geom)) AS lng,
            ST_Y(ST_Centroid(geom)) AS lat
       FROM parcel
      WHERE ${where.join(" AND ")}
      -- 가격이 있는 필지를 먼저 보여준다. 정보가 없는 필지는 사용자가 할 일이 없다
      ORDER BY (price_per_sqm IS NULL), emd, ri, jibun
      LIMIT $${params.length}`,
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
      area_sqm: r.area_sqm === null ? null : Number(r.area_sqm),
      price_per_sqm: r.price_per_sqm === null ? null : Number(r.price_per_sqm),
      lng: r.lng,
      lat: r.lat,
    })),
  });
}
