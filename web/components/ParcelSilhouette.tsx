import { priceColor } from "@/lib/priceRamp";

type Ring = number[][];

/** API가 내려주는 GeoJSON geometry. 좌표 깊이는 type에 따라 다르다 */
export type ParcelGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

/**
 * 그 필지의 실제 모양을 그린다.
 *
 * 땅은 하나하나 모양이 다르다. 아파트 동호수와 결정적으로 다른 점이고,
 * 소유자는 자기 땅을 모양으로 알아본다. 이 서비스를 기억하게 만드는 요소다.
 * 장식은 여기 한 곳에만 쓴다.
 */
export default function ParcelSilhouette({
  geometry,
  pricePerSqm,
  // 2차에서 72 -> 88px. 단독 페이지는 104px를 넘긴다
  size = 88,
}: {
  geometry: ParcelGeometry | null;
  pricePerSqm: number | null;
  size?: number;
}) {
  if (!geometry) return null;

  // MultiPolygon이면 가장 큰 폴리곤만 쓴다
  const pts: Ring | undefined =
    geometry.type === "MultiPolygon"
      ? largestRing(geometry.coordinates as number[][][][])
      : (geometry.coordinates as number[][][])[0];

  if (!pts || pts.length < 3) return null;

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // 위도에 따라 경도 1도의 실제 길이가 달라진다. 보정하지 않으면 모양이 옆으로 눌린다
  const latRad = ((minY + maxY) / 2) * (Math.PI / 180);
  const w = (maxX - minX) * Math.cos(latRad);
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;

  const pad = 4;
  const inner = size - pad * 2;
  const scale = Math.min(inner / w, inner / h);
  const offX = pad + (inner - w * scale) / 2;
  const offY = pad + (inner - h * scale) / 2;

  const d =
    pts
      .map((p, i) => {
        const x = offX + (p[0] - minX) * Math.cos(latRad) * scale;
        // SVG는 y축이 아래로 향한다
        const y = offY + (maxY - p[1]) * scale;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="이 필지의 모양"
    >
      <path
        d={d}
        fill={priceColor(pricePerSqm)}
        stroke="var(--ink)"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function largestRing(polys: Ring[][]): Ring {
  let best = polys[0][0];
  let bestArea = -1;
  for (const poly of polys) {
    const ring = poly[0];
    const a = Math.abs(shoelace(ring));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  return best;
}

function shoelace(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return s / 2;
}
