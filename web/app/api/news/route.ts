import { NextResponse } from "next/server";

export type NewsItem = {
  title: string;
  link: string;
  source_date: string | null;
};

/*
  네이버 검색 API 키가 없으면 이 라우트는 빈 목록을 돌려준다.
  화면은 결과가 비면 섹션 자체를 감추므로, 키가 없는 환경에서도
  주변 탭의 나머지가 그대로 동작한다.
*/
const ID = process.env.NAVER_CLIENT_ID;
const SECRET = process.env.NAVER_CLIENT_SECRET;

/** 네이버 응답은 <b> 태그와 HTML 엔티티가 섞여 온다. 그대로 렌더하면 안 된다 */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** `Mon, 21 Jul 2025 09:00:00 +0900` -> `2025.07.21` */
function toDate(pubDate: string | undefined): string | null {
  if (!pubDate) return null;
  const t = Date.parse(pubDate);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export async function GET(request: Request) {
  const emd = new URL(request.url).searchParams.get("emd")?.trim() ?? "";

  if (!ID || !SECRET) {
    return NextResponse.json({ items: [], reason: "no_credentials" });
  }

  /*
    읍면 이름만으로 검색하면 결과가 거의 없다. 군 단위를 함께 넣어
    범위를 확보하고, 읍면은 결과 안에서 걸러 관련도를 높인다.
  */
  const q = `양평군 부동산 ${emd}`.trim();

  try {
    const res = await fetch(
      `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=10&sort=date`,
      {
        headers: {
          "X-Naver-Client-Id": ID,
          "X-Naver-Client-Secret": SECRET,
        },
        // 뉴스는 실시간성이 크지 않다. 매 클릭마다 외부 호출을 하지 않는다
        next: { revalidate: 1800 },
      },
    );
    if (!res.ok) {
      return NextResponse.json({ items: [], reason: "upstream_error" });
    }

    const json = (await res.json()) as {
      items?: { title?: string; link?: string; pubDate?: string }[];
    };

    const items: NewsItem[] = (json.items ?? [])
      .map((it) => ({
        title: stripTags(it.title ?? ""),
        link: it.link ?? "",
        source_date: toDate(it.pubDate),
      }))
      .filter((it) => it.title && it.link)
      // 읍면 이름이 들어간 기사를 앞으로 올린다
      .sort((a, b) => {
        const hit = (t: string) => (emd && t.includes(emd) ? 0 : 1);
        return hit(a.title) - hit(b.title);
      })
      .slice(0, 5);

    return NextResponse.json({ items });
  } catch {
    // 실패를 화면에 배너로 띄우지 않는다. 섹션이 조용히 사라지는 편이 낫다
    return NextResponse.json({ items: [], reason: "fetch_failed" });
  }
}
