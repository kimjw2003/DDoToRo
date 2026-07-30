import { NextResponse } from "next/server";
import { getParcel, isValidPnu } from "@/lib/parcel";

/*
  조회 로직은 lib/parcel.ts 한 곳에 둔다.
  SSR 페이지(/land/[pnu])와 같은 함수를 쓰므로 응답 형태가 어긋나지 않는다.
*/
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/parcels/[pnu]">,
) {
  const { pnu } = await ctx.params;

  // PNU는 19자리 문자열이다. 숫자로 다루면 선행 0이 날아간다
  if (!isValidPnu(pnu)) {
    return NextResponse.json(
      { error: "PNU는 19자리 숫자여야 합니다" },
      { status: 400 },
    );
  }

  const parcel = await getParcel(pnu);
  if (!parcel) {
    return NextResponse.json({ error: "필지를 찾을 수 없습니다" }, { status: 404 });
  }

  return NextResponse.json({
    ...parcel,
    // 실거래는 읍면 집계다. 필드명만으로 오해할 수 있어 응답에도 못박아 둔다
    emd_trade_avg: parcel.emd_trade_avg && {
      ...parcel.emd_trade_avg,
      note: "이 필지의 거래 기록이 아닌 읍면 단위 평균입니다",
    },
  });
}
