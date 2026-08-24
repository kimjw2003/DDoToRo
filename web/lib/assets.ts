/*
  미리 구워둔 정적 자산의 주소.

  지도 타일(tiles/)과 필지 상세(details/)가 한 버킷에 함께 올라간다.
  둘 다 etl/이 굽고, 경로가 화면 좌표나 PNU에서 그대로 계산되므로
  '어디 있는지' 묻는 왕복이 없다.

  이 파일은 클라이언트 번들에도 들어간다 — node: 모듈을 import하지 말 것.
  서버에서 파일을 읽는 쪽은 assets.server.ts다.
*/

/**
 * 자산 루트.
 *
 * 비어 있으면 개발용 라우트(/api/assets)가 etl/out/assets를 직접 읽는다.
 * 배포에는 반드시 S3/Blob 주소를 넣어야 한다 — etl/out은 gitignore 대상이라
 * 번들에 들어가지 않는다.
 */
export const ASSET_BASE =
  process.env.NEXT_PUBLIC_ASSET_BASE_URL?.replace(/\/$/, "") ?? "";

/** 브라우저가 받을 주소. 경로는 항상 `.json.gz`까지 포함한다 */
export function assetUrl(path: string): string {
  return ASSET_BASE ? `${ASSET_BASE}/${path}` : `/api/assets/${path}`;
}

/** 상위 디렉토리 탈출을 막는다. 라우트와 서버 읽기 양쪽에서 쓴다 */
export function isSafeAssetPath(path: string): boolean {
  return /^[A-Za-z0-9/._-]+$/.test(path) && !path.includes("..");
}
