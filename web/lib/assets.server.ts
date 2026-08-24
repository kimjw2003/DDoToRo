import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import { ASSET_BASE, isSafeAssetPath } from "@/lib/assets";

/*
  서버에서 정적 자산을 읽는다.

  상세 페이지는 SSR이라(SEO가 이 페이지에 걸려 있다) 브라우저가 아니라 서버가
  자산을 읽는다. 배포에서는 CDN에서 받고, 로컬에서는 etl/out/assets를 직접 읽는다 —
  주소가 상대경로(/api/assets/…)면 서버 fetch가 호스트를 알 수 없기 때문에
  자기 자신을 다시 호출하지 않고 파일로 간다.
*/

// etl/out은 gitignore 대상이라 배포 번들에 없다. 로컬 전용 경로다
const LOCAL_ROOT = path.join(process.cwd(), "..", "etl", "out", "assets");

/** 자산 하나를 JSON으로. 없으면 null (404는 정상 흐름이다) */
export async function readAssetJson<T>(rel: string): Promise<T | null> {
  if (!isSafeAssetPath(rel)) return null;

  if (ASSET_BASE) {
    const res = await fetch(`${ASSET_BASE}/${rel}`);
    // fetch가 Content-Encoding: gzip을 알아서 푼다
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`asset ${rel}: ${res.status}`);
    return (await res.json()) as T;
  }

  try {
    const buf = await readFile(path.join(LOCAL_ROOT, rel));
    return JSON.parse(gunzipSync(buf).toString("utf8")) as T;
  } catch {
    return null;
  }
}
