/* 시안용 지적도 생성기 — 실제 VWorld 타일/PostGIS 응답 대신 쓰는 대역품.
   필지 모양이 하나하나 달라야 실루엣(시그니처)이 성립하므로 격자를 왜곡해 생성한다.
   가격 구간 경계값과 읍면 2곳 시세는 실제 집계값, 그 외 수치는 시안이다. */
(function () {
  'use strict';

  // 결정론적 난수 — 새로고침해도 같은 지적도가 나와야 한다
  function lcg(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  var W = 1000, H = 700;
  var UNIT_M = 2.2;                  // 1 viewBox 단위 = 2.2m
  var COLS = 60, ROWS = 42;          // 필지 하나가 평균 36m×36m ≈ 1,300㎡
  var CW = W / COLS, CH = H / ROWS;

  // 실제 분위수 경계 (원/㎡)
  var BINS = [21300, 42400, 77100, 156000];
  // 읍면별 실제 리(里) — 읍면과 리가 어긋나면 사용자가 바로 알아챈다
  var TOWN_RI = {
    '양평읍': ['양근리', '오빈리', '공흥리', '창대리'],
    '강상면': ['교평리', '병산리', '대석리'],
    '강하면': ['전수리', '왕창리', '성덕리'],
    '양서면': ['양수리', '용담리', '국수리', '도곡리'],
    '서종면': ['문호리', '정배리', '수능리', '노문리', '명달리'],
    '옥천면': ['옥천리', '아신리', '신복리'],
    '단월면': ['보룡리', '산음리', '향소리'],
    '청운면': ['갈운리', '용두리', '다대리'],
    '용문면': ['다문리', '광탄리', '마룡리'],
    '지평면': ['지평리', '월산리', '곡수리'],
    '양동면': ['쌍학리', '석곡리', '계정리'],
    '개군면': ['공세리', '부리', '상자포리']
  };
  var JIMOK = [
    { code: '전', label: '전(밭)', w: 30 },
    { code: '답', label: '답(논)', w: 18 },
    { code: '임', label: '임야(산)', w: 24 },
    { code: '대', label: '대(집터)', w: 16 },
    { code: '과', label: '과수원', w: 6 },
    { code: '잡', label: '잡종지', w: 6 }
  ];

  // 양평군 읍면 12개 — 양평읍·청운면은 실제 집계값, 나머지는 시안
  var TOWNS = [
    { name: '양평읍', x: 470, y: 330, rate: 229585, deals: 1938, real: true },
    { name: '강상면', x: 360, y: 470, rate: 141000, deals: 320 },
    { name: '강하면', x: 250, y: 545, rate: 128000, deals: 265 },
    { name: '양서면', x: 210, y: 300, rate: 186000, deals: 410 },
    { name: '서종면', x: 245, y: 130, rate: 152000, deals: 372 },
    { name: '옥천면', x: 400, y: 205, rate: 118000, deals: 244 },
    { name: '단월면', x: 700, y: 205, rate: 61000, deals: 176 },
    { name: '청운면', x: 830, y: 135, rate: 72570, deals: 149, real: true },
    { name: '용문면', x: 620, y: 330, rate: 96000, deals: 388 },
    { name: '지평면', x: 730, y: 430, rate: 68000, deals: 201 },
    { name: '양동면', x: 880, y: 330, rate: 54000, deals: 168 },
    { name: '개군면', x: 500, y: 585, rate: 104000, deals: 297 }
  ];

  // 남한강 — 필지가 없는 띠
  var RIVER = [[0, 470], [140, 440], [270, 455], [380, 400], [470, 415], [560, 372], [700, 385], [840, 350], [1000, 372]];
  // 주요 도로 2개 (6번 국도 / 지방도)
  var ROADS = [
    [[0, 258], [190, 246], [370, 288], [520, 300], [700, 262], [1000, 250]],
    [[430, 0], [452, 180], [470, 330], [498, 500], [512, 700]]
  ];

  function riverY(x) {
    for (var i = 1; i < RIVER.length; i++) {
      if (x <= RIVER[i][0]) {
        var a = RIVER[i - 1], b = RIVER[i];
        var t = (x - a[0]) / (b[0] - a[0]);
        return a[1] + (b[1] - a[1]) * t;
      }
    }
    return RIVER[RIVER.length - 1][1];
  }
  function nearRoad(x, y, tol) {
    for (var r = 0; r < ROADS.length; r++) {
      var pts = ROADS[r];
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        var dx = b[0] - a[0], dy = b[1] - a[1];
        var L = dx * dx + dy * dy;
        var t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)) : 0;
        var px = a[0] + dx * t, py = a[1] + dy * t;
        if (Math.hypot(x - px, y - py) < tol) return true;
      }
    }
    return false;
  }
  function polyArea(pts) {
    var s = 0;
    for (var i = 0, n = pts.length; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(s) / 2;
  }
  function pickJimok(rnd) {
    var total = JIMOK.reduce(function (s, j) { return s + j.w; }, 0);
    var v = rnd() * total;
    for (var i = 0; i < JIMOK.length; i++) { v -= JIMOK[i].w; if (v <= 0) return JIMOK[i]; }
    return JIMOK[0];
  }

  function build() {
    var rnd = lcg(20260730);
    // 왜곡 격자
    var grid = [];
    for (var r = 0; r <= ROWS; r++) {
      grid[r] = [];
      for (var c = 0; c <= COLS; c++) {
        var jx = (c === 0 || c === COLS) ? 0 : (rnd() - 0.5) * CW * 0.62;
        var jy = (r === 0 || r === ROWS) ? 0 : (rnd() - 0.5) * CH * 0.62;
        grid[r][c] = [c * CW + jx, r * CH + jy];
      }
    }

    var out = [], id = 0;
    for (var r2 = 0; r2 < ROWS; r2++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        var pts = [grid[r2][c2], grid[r2][c2 + 1], grid[r2 + 1][c2 + 1], grid[r2 + 1][c2]];
        // 5각형으로 한 번 더 쪼개 모양을 다양하게
        if (rnd() < 0.34) {
          var mid = [(pts[1][0] + pts[2][0]) / 2 + (rnd() - 0.5) * 4,
                     (pts[1][1] + pts[2][1]) / 2 + (rnd() - 0.5) * 4];
          pts = [pts[0], pts[1], mid, pts[2], pts[3]];
        }
        var cx = 0, cy = 0;
        pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
        cx /= pts.length; cy /= pts.length;

        if (Math.abs(cy - riverY(cx)) < 40) continue;            // 남한강
        if (nearRoad(cx, cy, 8)) continue;                       // 도로
        if (rnd() < 0.025) continue;                             // 구거·소로

        // 읍면 판정 + 가격: 중심지에 가까울수록 비싸다
        var town = TOWNS[0], best = 1e9;
        for (var t = 0; t < TOWNS.length; t++) {
          var d = Math.hypot(cx - TOWNS[t].x, cy - TOWNS[t].y);
          if (d < best) { best = d; town = TOWNS[t]; }
        }
        var decay = Math.exp(-best / 118);
        var rate = Math.round(town.rate * (0.16 + 1.05 * decay) * (0.6 + rnd() * 0.95));
        rate = Math.max(4200, Math.min(640000, rate));
        var noPrice = rnd() < 0.0048;                            // 결측 0.448%

        var areaM2 = Math.round(polyArea(pts) * UNIT_M * UNIT_M);
        var j = pickJimok(rnd);
        var riList = TOWN_RI[town.name];
        var ri = riList[Math.floor(rnd() * riList.length)];
        var num = (10 + Math.floor(rnd() * 620)) + '-' + (1 + Math.floor(rnd() * 28));

        out.push({
          id: 'p' + (id++),
          pts: pts,
          cx: cx, cy: cy,
          town: town.name,
          ri: ri,
          jibun: (j.code === '임' && rnd() < 0.3 ? '산' : '') + num,
          jimok: j.label,
          jimokCode: j.code,
          area: areaM2,
          rate: noPrice ? null : rate,
          total: noPrice ? null : rate * areaM2,
          bin: noPrice ? 0 : (rate < BINS[0] ? 1 : rate < BINS[1] ? 2 : rate < BINS[2] ? 3 : rate < BINS[3] ? 4 : 5),
          pnu: '41830' + String(340 + Math.floor(rnd() * 12)) + '2' +
               String(10000 + Math.floor(rnd() * 89999)) + String(1000 + Math.floor(rnd() * 8999))
        });
      }
    }
    return out;
  }

  /* ── 표기 규칙 ──────────────────────────────
     금액은 한국식(3억 2,180만원), 면적은 평 병기 */
  function won(n) {
    if (n == null) return '정보 없음';
    var eok = Math.floor(n / 1e8);
    var man = Math.round((n - eok * 1e8) / 1e4);
    if (man === 10000) { return (eok + 1) + '억원'; }
    if (eok && man) return eok + '억 ' + man.toLocaleString('ko-KR') + '만원';
    if (eok) return eok + '억원';
    if (man >= 1) return man.toLocaleString('ko-KR') + '만원';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }
  function num(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function pyeong(m2) { return Math.round(m2 / 3.305785); }
  function areaText(m2) { return num(m2) + '㎡ (' + num(pyeong(m2)) + '평)'; }
  function ratePyeong(rate) { return Math.round(rate * 3.305785); }
  function pathOf(pts) { return 'M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + 'Z'; }

  // 실루엣: 필지 폴리곤을 정사각 viewBox에 정규화
  function silhouette(pts, box) {
    box = box || 88;
    var pad = 11;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var s = (box - pad * 2) / Math.max(maxX - minX, maxY - minY);
    var ox = (box - (maxX - minX) * s) / 2, oy = (box - (maxY - minY) * s) / 2;
    return 'M' + pts.map(function (p) {
      return ((p[0] - minX) * s + ox).toFixed(1) + ' ' + ((p[1] - minY) * s + oy).toFixed(1);
    }).join('L') + 'Z';
  }

  // 시세 추이 — 원본 A16~A19에 2022~2025가 있어 5년은 즉시 가능, 10년은 추가 수급 필요.
  // 2023년은 전국적으로 공시지가가 하락한 해다.
  function history(rate) {
    var f = [0.95, 0.88, 0.92, 0.96, 1];      // 2023년 하락 후 회복
    return [2022, 2023, 2024, 2025, 2026].map(function (y, i) {
      return { year: y, rate: Math.round(rate * f[i]) };
    });
  }

  window.DDO = {
    W: W, H: H, BINS: BINS, TOWNS: TOWNS, RIVER: RIVER, ROADS: ROADS,
    build: build, won: won, num: num, pyeong: pyeong, areaText: areaText,
    ratePyeong: ratePyeong, pathOf: pathOf, silhouette: silhouette, history: history,
    riverY: riverY
  };
})();
