import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈 디렉토리에도 package-lock.json이 있어 Turbopack이 워크스페이스 루트를
  // 그쪽으로 잘못 추론한다. 이 프로젝트를 루트로 못박는다
  turbopack: { root: __dirname },
};

export default nextConfig;
