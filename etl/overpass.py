"""Overpass API 클라이언트.

역(fetch_stations.py)과 시설(fetch_facilities.py)이 같이 쓴다.
아래 두 가지는 실제로 겪고 알아낸 것이라 한 곳에만 두어야 한다 —
스크립트마다 다시 쓰면 같은 함정에 또 빠진다.

  1. **User-Agent를 반드시 보낸다.** requests 기본값(python-requests/x.y)이면
     Overpass가 406을 돌려준다. 익명 스크립트를 막는 정책이고,
     이용 정책 자체가 식별 가능한 UA를 요구한다.

  2. **질의를 나눠 쏘지 않는다.** 공용 인스턴스는 동시 슬롯이 2개뿐이라
     짧은 간격으로 여러 번 던지면 429가 난다. 필요한 것을 한 질의에 담고,
     그래도 막히면 --endpoint kumi 미러를 쓴다.
"""

import time

import requests

ENDPOINTS = {
    "main": "https://overpass-api.de/api/interpreter",
    "kumi": "https://overpass.kumi.systems/api/interpreter",
}

HEADERS = {
    "User-Agent": "DDoToRo-ETL/1.0 (+https://github.com/kimjw2003/DDoToRo)"
}

RETRIES = 5
SLEEP = 3.0


def resolve(name: str) -> str:
    """'main' | 'kumi' | 전체 URL -> 실제 엔드포인트."""
    return ENDPOINTS.get(name, name)


def fetch(query: str, endpoint: str = "main", timeout: int = 300) -> dict:
    """Overpass 질의 한 번.

    서버가 바쁘면 200이 아닌 XML/HTML 오류(429, 504, 'too busy')를 돌려준다.
    공용 인스턴스라 흔한 일이므로 넉넉히 재시도한다.
    """
    url = resolve(endpoint)

    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.post(
                url, data={"data": query}, headers=HEADERS, timeout=timeout
            )
            # 오류일 때는 JSON이 아니라 XML/HTML이 온다
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                return r.json()
            if r.status_code == 406:
                raise SystemExit(
                    "Overpass가 406을 돌려줬다. User-Agent가 빠졌는지 확인할 것"
                )
            busy = r.status_code in (429, 504) or "too busy" in r.text
            reason = "서버 혼잡" if busy else f"HTTP {r.status_code}"
        except requests.RequestException as e:
            reason = str(e)[:80]

        if attempt < RETRIES:
            wait = SLEEP * attempt
            print(f"  재시도 {attempt}/{RETRIES - 1} ({reason}) — {wait:.0f}초 대기")
            time.sleep(wait)

    raise SystemExit(
        "Overpass 응답을 받지 못했다. 잠시 뒤 다시 시도하거나 --endpoint kumi 를 쓸 것"
    )
