import { readFile } from "node:fs/promises";
import nodePath from "node:path";

import { isSafeAssetPath } from "@/lib/assets";

/*
  개발용 자산 서버.

  운영에서는 이 라우트를 타지 않는다 — NEXT_PUBLIC_ASSET_BASE_URL을 S3/Blob
  주소로 두면 브라우저와 서버가 CDN에서 직접 받는다. 여기는 그 주소가 없을 때
  etl/out/assets를 그대로 읽어주는 로컬 대역이다.

  파일은 이미 gzip으로 구워져 있으므로 다시 압축하지 않고 흘려보낸다.
*/

// etl/out은 gitignore 대상이라 배포 번들에 들어가지 않는다. 로컬에서만 동작한다
const ROOT = nodePath.join(process.cwd(), "..", "etl", "out", "assets");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const rel = (await params).path.join("/");
  if (!isSafeAssetPath(rel)) {
    return new Response("bad asset path", { status: 400 });
  }

  try {
    const buf = await readFile(nodePath.join(ROOT, rel));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        // 공시지가는 연 1회 갱신이다. 내용이 바뀔 일이 거의 없다
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    /*
      없는 자산은 파일 자체가 없다 — 필지가 없는 타일 칸, 비어 있는 본번 버킷.
      404가 정상 동작이므로 호출자는 이걸 빈 결과로 처리한다.
    */
    return new Response("no asset", { status: 404 });
  }
}
