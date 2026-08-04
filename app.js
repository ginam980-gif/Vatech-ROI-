/* ================= Constants ================= */
const WARRANTY_MONTHS = 120;
const EQUIPMENT_MODELS = [
  { name: "Ace 9", price: 4480000 },
  { name: "Smart Plus", price: 6980000 },
  { name: "Green X 12", price: 7680000 },
  { name: "Green X Plus", price: 12600000 },
  { name: "Green X 21", price: 13600000 },
];
const DEFAULT_EQUIPMENT_MODEL = "Green X 12";
const currency = (v) => `¥${Math.round(v).toLocaleString()}`;

/* ================= Utils ================= */
const formatNumber = (v) =>
  v === "" || v === null || isNaN(v) ? "" : Number(v).toLocaleString();

const parseNumber = (v) =>
  Number(String(v).replace(/,/g, ""));

/* 万・億単位の短縮表記 — グラフのラベル用 */
const trimZeros = (s) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

const compactYen = (v) => {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);

  if (abs >= 1e8) {
    const oku = abs / 1e8;
    return `${sign}¥${trimZeros(oku.toFixed(oku >= 10 ? 1 : 2))}億`;
  }
  if (abs >= 1e4) {
    const man = abs / 1e4;
    if (man >= 100) return `${sign}¥${Math.round(man).toLocaleString()}万`;
    return `${sign}¥${trimZeros(man.toFixed(man >= 10 ? 1 : 2))}万`;
  }
  return `${sign}¥${Math.round(abs).toLocaleString()}`;
};

/* ================= State ================= */
const state = {
  equipmentModel: DEFAULT_EQUIPMENT_MODEL,
  equipmentPrice: EQUIPMENT_MODELS.find((model) => model.name === DEFAULT_EQUIPMENT_MODEL).price,

  income: {
    pano: { fee: 4020, perDay: 6, days: 24 },
    ctIns: { fee: 11700, perDay: 3, days: 24 },
    ctSelf: { fee: 50000, perDay: 1, days: 24 },
    ceph: { fee: 3000, perDay: 1, days: 24 },
    other: 0,
  },

  cost: {
    maintenance: 0,
    consumables: 1000,
    electricity: 100000,

    rent: 1000000,
    rentRatio: 10,

    doctor: 1006650,
    doctorRatio: 5,

    staff: 702750,
    staffRatio: 10,

    other: 0,
  }
};

/* ================= DOM ================= */
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

const svgEl = (tag, attrs) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const key in attrs) el.setAttribute(key, attrs[key]);
  return el;
};

const REDUCE_MOTION =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 배분 블록들을 저장할 배열
let occupancyBlocks = [];
// 수입 블록들 (행별 소계 표시용)
let incomeBlocks = [];

/* ================= Motion helpers ================= */
/* 여러 값을 동시에 보간해 주는 작은 애니메이터 */
function createAnimator(keys, apply, duration = 560) {
  const current = {};
  let raf = 0;
  let fallback = 0;
  let primed = false;

  const settle = (target) => {
    keys.forEach((k) => { current[k] = target[k]; });
    apply(current);
  };

  return function set(target, opts = {}) {
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(fallback);

    if (!primed) {
      primed = true;
      keys.forEach((k) => {
        current[k] = opts.from && k in opts.from ? opts.from[k] : target[k];
      });
    }

    const from = { ...current };
    const dur = REDUCE_MOTION ? 0 : (opts.duration ?? duration);

    if (dur === 0) {
      settle(target);
      return;
    }

    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      keys.forEach((k) => { current[k] = from[k] + (target[k] - from[k]) * e; });
      apply(current);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
        clearTimeout(fallback);
      }
    };
    raf = requestAnimationFrame(step);

    // 非表示タブなど rAF が動かない環境でも最終値は必ず反映する
    fallback = setTimeout(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      settle(target);
    }, dur + 150);
  };
}

/* 값이 바뀐 요소에 잠깐 하이라이트를 준다 */
function pulse(el, className = "is-changed", ms = 620) {
  if (!el || REDUCE_MOTION) return;
  el.classList.remove(className);
  void el.offsetWidth; // reflow — 연속 입력에서도 애니메이션이 다시 걸리도록
  el.classList.add(className);
  clearTimeout(el._pulseTimer);
  el._pulseTimer = setTimeout(() => el.classList.remove(className), ms);
}

/* KPI 숫자 카운트업 */
function createCounter(el, format) {
  const animate = createAnimator(["v"], (c) => { el.textContent = format(c.v); }, 420);
  let last = null;
  return (value) => {
    if (last === value) return;
    const isFirst = last === null;
    last = value;
    animate({ v: value }, isFirst ? { from: { v: 0 } } : {});
  };
}

let setKpiNet, setKpiPayback, setKpiProfit;

/* ================= Calculations ================= */
function calcIncome() {
  const c = (i) => i.fee * i.perDay * i.days;
  const pano = c(state.income.pano);
  const ctIns = c(state.income.ctIns);
  const ctSelf = c(state.income.ctSelf);
  const ceph = c(state.income.ceph);
  const total = pano + ctIns + ctSelf + ceph + state.income.other;
  return { pano, ctIns, ctSelf, ceph, total };
}

function calcCost() {
  const rent = state.cost.rent * (state.cost.rentRatio / 100);
  const doctor = state.cost.doctor * (state.cost.doctorRatio / 100);
  const staff = state.cost.staff * (state.cost.staffRatio / 100);

  const total =
    state.cost.maintenance +
    state.cost.consumables +
    state.cost.electricity +
    rent +
    doctor +
    staff +
    state.cost.other;

  return { rent, doctor, staff, total };
}

/* ================= Input Handler (iPad 버그 수정) ================= */
function createInputHandler(input, onChange) {
  let isUpdating = false;  // 재귀 방지 플래그

  const handleInput = (e) => {
    if (isUpdating) return;  // 프로그래밍 방식의 업데이트는 무시

    isUpdating = true;

    const raw = parseNumber(e.target.value);
    onChange(raw);

    // 커서 위치 저장
    const cursorPosition = e.target.selectionStart;
    const oldLength = e.target.value.length;

    // 포맷된 값 설정
    const formatted = formatNumber(raw);
    e.target.value = formatted;

    // 커서 위치 복원 (콤마 추가/제거를 고려)
    const newLength = formatted.length;
    const lengthDiff = newLength - oldLength;
    const newCursorPosition = Math.max(0, cursorPosition + lengthDiff);
    e.target.setSelectionRange(newCursorPosition, newCursorPosition);

    isUpdating = false;
  };

  return handleInput;
}

/* ================= UI Blocks ================= */
function inputBlock(label, desc, value, onChange) {
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `
    <div class="row-head">
      <div>
        <p class="row-title">${label}</p>
        ${desc ? `<p class="row-desc">${desc}</p>` : ""}
      </div>
    </div>
    <div class="row-fields fields-1">
      <label class="field">
        <span class="field-label">月額</span>
        <span class="input-wrap">
          <span class="input-prefix num" aria-hidden="true">¥</span>
          <input type="text" inputmode="numeric" class="input has-prefix">
        </span>
      </label>
    </div>
  `;

  const input = div.querySelector("input");
  input.value = formatNumber(value);
  input.addEventListener('input', createInputHandler(input, onChange));

  return div;
}

function occupancyBlock(title, desc, base, ratio, onBase, onRatio, getResult) {
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `
    <div class="row-head">
      <div>
        <p class="row-title">${title}</p>
        <p class="row-desc">${desc}</p>
      </div>
      <span class="row-outwrap">
        <span class="row-outlabel">配分後</span>
        <span class="row-out result-text">${currency(getResult())}</span>
      </span>
    </div>
    <div class="row-fields fields-2">
      <label class="field">
        <span class="field-label">総額</span>
        <span class="input-wrap">
          <span class="input-prefix num" aria-hidden="true">¥</span>
          <input type="text" inputmode="numeric" class="input has-prefix">
        </span>
      </label>
      <label class="field">
        <span class="field-label">CT配分比率</span>
        <span class="input-wrap">
          <input type="text" inputmode="numeric" class="input text-right">
        </span>
      </label>
    </div>
  `;

  const inputs = div.querySelectorAll("input");
  const resultText = div.querySelector(".result-text");

  // 결과 업데이트 함수를 DOM 요소에 저장
  let lastResult = null;
  div.updateResult = () => {
    const value = getResult();
    resultText.textContent = currency(value);
    if (lastResult !== null && lastResult !== value) pulse(resultText);
    lastResult = value;
  };
  div.updateResult();

  // 첫 번째: 금액
  inputs[0].value = formatNumber(base);

  // 두 번째: 비율 - 포커스 없을 때만 % 표시
  inputs[1].value = ratio === "" ? "" : `${formatNumber(ratio)}%`;

  // 금액 입력 핸들러
  let isUpdatingBase = false;
  inputs[0].addEventListener('input', (e) => {
    if (isUpdatingBase) return;
    isUpdatingBase = true;

    const v = parseNumber(e.target.value);
    onBase(v);
    e.target.value = formatNumber(v);

    isUpdatingBase = false;
  });

  // 비율 입력 핸들러 - focus 중에는 % 없이 숫자만, blur 시 % 붙임
  inputs[1].addEventListener('focus', (e) => {
    // 포커스 시 % 제거하고 숫자만 표시 후 전체 선택
    const v = parseNumber(e.target.value.replace(/%/g, ""));
    e.target.value = v === 0 ? "" : String(v);
    setTimeout(() => e.target.select(), 0); // iPad 호환을 위해 setTimeout 사용
  });

  inputs[1].addEventListener('blur', (e) => {
    // 포커스 해제 시 % 붙여서 표시
    const raw = e.target.value.replace(/%/g, "").replace(/[^0-9.]/g, "");
    const v = raw === "" ? 0 : parseFloat(raw);
    onRatio(v);
    e.target.value = `${formatNumber(v)}%`;
  });

  let isUpdatingRatio = false;
  inputs[1].addEventListener('input', (e) => {
    if (isUpdatingRatio) return;
    isUpdatingRatio = true;

    // 입력 중에는 숫자와 소수점만 허용, % 붙이지 않음
    const raw = e.target.value.replace(/%/g, "").replace(/[^0-9.]/g, "");
    e.target.value = raw;

    // 실시간으로 state & 결과 업데이트
    const v = raw === "" ? 0 : parseFloat(raw);
    onRatio(v);

    isUpdatingRatio = false;
  });

  return div;
}

function incomeEditor(key, label, desc) {
  const data = state.income[key];
  const div = document.createElement("div");
  div.className = "row";
  div.innerHTML = `
    <div class="row-head">
      <div>
        <p class="row-title">${label}</p>
        <p class="row-desc">${desc}</p>
        <p class="row-formula">単価 × 1日撮影回数 × 月間稼働日数</p>
      </div>
      <span class="row-outwrap">
        <span class="row-outlabel">月間</span>
        <span class="row-out result-text"></span>
      </span>
    </div>
    <div class="row-fields fields-3">
      <label class="field">
        <span class="field-label">単価</span>
        <span class="input-wrap">
          <span class="input-prefix num" aria-hidden="true">¥</span>
          <input class="input has-prefix" type="text" inputmode="numeric">
        </span>
      </label>
      <label class="field">
        <span class="field-label">1日回数</span>
        <span class="input-wrap">
          <input class="input" type="text" inputmode="numeric">
        </span>
      </label>
      <label class="field">
        <span class="field-label">稼働日数</span>
        <span class="input-wrap">
          <input class="input" type="text" inputmode="numeric">
        </span>
      </label>
    </div>
  `;

  const i = div.querySelectorAll("input");
  const resultText = div.querySelector(".result-text");

  let lastResult = null;
  div.updateResult = () => {
    const value = calcIncome()[key];
    resultText.textContent = currency(value);
    if (lastResult !== null && lastResult !== value) pulse(resultText);
    lastResult = value;
  };
  div.updateResult();

  i[0].value = formatNumber(data.fee);
  i[1].value = formatNumber(data.perDay);
  i[2].value = formatNumber(data.days);

  // 각 입력 필드에 대한 업데이트 플래그
  let isUpdating = [false, false, false];

  i[0].addEventListener('input', (e) => {
    if (isUpdating[0]) return;
    isUpdating[0] = true;

    data.fee = parseNumber(e.target.value);
    e.target.value = formatNumber(data.fee);
    render();

    isUpdating[0] = false;
  });

  i[1].addEventListener('input', (e) => {
    if (isUpdating[1]) return;
    isUpdating[1] = true;

    data.perDay = parseNumber(e.target.value);
    e.target.value = formatNumber(data.perDay);
    render();

    isUpdating[1] = false;
  });

  i[2].addEventListener('input', (e) => {
    if (isUpdating[2]) return;
    isUpdating[2] = true;

    data.days = parseNumber(e.target.value);
    e.target.value = formatNumber(data.days);
    render();

    isUpdating[2] = false;
  });

  return div;
}

/* ================= Chart: 月間収支 ================= */
const CHART = {
  baseY: 186,
  maxH: 156,
  barW: 62,
  centers: [70, 180, 290],
  labels: ["収入", "費用", "純利益"],
};

let chartParts = null;
let setChart = null;

function buildChart() {
  const svg = $("chart");
  if (!svg) return;
  svg.innerHTML = "";

  const defs = svgEl("defs");
  const gradient = (id, color, from, to) => {
    const g = svgEl("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.append(
      svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": from }),
      svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": to })
    );
    return g;
  };
  defs.append(
    gradient("g-income", "#5b9dff", 0.95, 0.22),
    gradient("g-cost", "#8b97a9", 0.85, 0.18),
    gradient("g-profit", "#2fdd9b", 0.95, 0.2),
    gradient("g-danger", "#ff5c6c", 0.95, 0.2)
  );
  svg.append(defs);

  // Gridlines
  const grid = svgEl("g", {});
  for (let i = 0; i <= 4; i += 1) {
    const y = CHART.baseY - (CHART.maxH / 4) * i;
    grid.append(svgEl("line", {
      x1: 14, x2: 346, y1: y, y2: y,
      stroke: "rgba(255,255,255,0.06)",
      "stroke-width": 1,
      "stroke-dasharray": i === 0 ? "none" : "2 5",
    }));
  }
  svg.append(grid);

  chartParts = CHART.centers.map((cx, i) => {
    const bar = svgEl("rect", {
      x: cx - CHART.barW / 2,
      y: CHART.baseY,
      width: CHART.barW,
      height: 0,
      rx: 7,
      fill: "url(#g-income)",
    });
    const value = svgEl("text", {
      x: cx, y: CHART.baseY - 10, "text-anchor": "middle", class: "svg-value",
    });
    const label = svgEl("text", {
      x: cx, y: CHART.baseY + 24, "text-anchor": "middle", class: "svg-label",
    });
    label.textContent = CHART.labels[i];
    svg.append(bar, value, label);
    return { bar, value };
  });

  setChart = createAnimator(["income", "cost", "net", "max"], (c) => {
    const max = c.max > 0 ? c.max : 1;
    const values = [c.income, c.cost, c.net];
    values.forEach((v, i) => {
      const h = Math.min(CHART.maxH, (Math.abs(v) / max) * CHART.maxH);
      const part = chartParts[i];
      part.bar.setAttribute("height", h);
      part.bar.setAttribute("y", CHART.baseY - h);
      part.value.setAttribute("y", CHART.baseY - h - 10);
      part.value.textContent = compactYen(v);
    });
  });
}

function drawChart(income, cost, net) {
  if (!setChart) return;
  const max = Math.max(income, cost, Math.abs(net));

  chartParts[0].bar.setAttribute("fill", "url(#g-income)");
  chartParts[1].bar.setAttribute("fill", "url(#g-cost)");
  chartParts[2].bar.setAttribute("fill", net < 0 ? "url(#g-danger)" : "url(#g-profit)");
  chartParts[2].value.setAttribute("fill", net < 0 ? "#ff5c6c" : "#2fdd9b");

  setChart({ income, cost, net, max }, { from: { income: 0, cost: 0, net: 0, max } });
}

/* ================= Chart: 累積損益カーブ ================= */
const TL = { x0: 52, x1: 444, top: 30, bottom: 194 };

let tlParts = null;
let setTimeline = null;

function buildTimeline() {
  const svg = $("timeline");
  if (!svg) return;
  svg.innerHTML = "";

  const defs = svgEl("defs");
  const area = (id, color) => {
    const g = svgEl("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.append(
      svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.34 }),
      svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0.02 })
    );
    return g;
  };
  defs.append(area("t-profit", "#2fdd9b"), area("t-loss", "#ff5c6c"));
  svg.append(defs);

  // X axis ticks
  const axis = svgEl("g", {});
  for (let m = 0; m <= WARRANTY_MONTHS; m += 24) {
    const x = TL.x0 + (m / WARRANTY_MONTHS) * (TL.x1 - TL.x0);
    axis.append(svgEl("line", {
      x1: x, x2: x, y1: TL.top, y2: TL.bottom,
      stroke: "rgba(255,255,255,0.05)", "stroke-width": 1,
    }));
    const t = svgEl("text", { x, y: TL.bottom + 20, "text-anchor": "middle", class: "svg-axis" });
    t.textContent = String(m);
    axis.append(t);
  }
  const unit = svgEl("text", { x: TL.x1, y: TL.bottom + 38, "text-anchor": "end", class: "svg-axis" });
  unit.textContent = "経過月数（ヶ月）";
  axis.append(unit);
  svg.append(axis);

  const lossArea = svgEl("polygon", { fill: "url(#t-loss)", points: "" });
  const profitArea = svgEl("polygon", { fill: "url(#t-profit)", points: "" });
  const zeroLine = svgEl("line", {
    stroke: "rgba(255,255,255,0.28)", "stroke-width": 1, "stroke-dasharray": "3 4",
    x1: TL.x0, x2: TL.x1, y1: 0, y2: 0,
  });
  const lossLine = svgEl("line", { stroke: "#ff5c6c", "stroke-width": 2.5, "stroke-linecap": "round" });
  const profitLine = svgEl("line", { stroke: "#2fdd9b", "stroke-width": 2.5, "stroke-linecap": "round" });

  const markerLine = svgEl("line", {
    stroke: "rgba(233,194,122,0.55)", "stroke-width": 1, "stroke-dasharray": "3 4",
  });
  const markerRing = svgEl("circle", {
    r: 6, fill: "rgba(10,12,16,0.9)", stroke: "#e9c27a", "stroke-width": 2,
  });
  const markerDot = svgEl("circle", { r: 2.2, fill: "#e9c27a" });
  const markerText = svgEl("text", { class: "svg-value", fill: "#e9c27a", "text-anchor": "middle" });

  // カーブと重ならないよう、プロット領域の上に固定表示する
  const startLabel = svgEl("text", {
    class: "svg-axis", "text-anchor": "start", x: TL.x0, y: TL.top - 10,
  });
  const endLabel = svgEl("text", {
    class: "svg-value", "text-anchor": "end", x: TL.x1, y: TL.top - 10,
  });

  svg.append(
    lossArea, profitArea, zeroLine, lossLine, profitLine,
    markerLine, markerRing, markerDot, markerText, startLabel, endLabel
  );

  tlParts = {
    lossArea, profitArea, zeroLine, lossLine, profitLine,
    markerLine, markerRing, markerDot, markerText, startLabel, endLabel,
  };

  setTimeline = createAnimator(["net", "price"], (c) => {
    const { net, price } = c;
    const end = net * WARRANTY_MONTHS - price;
    const yMin = Math.min(-price, end, 0);
    const yMax = Math.max(0, end);
    const span = yMax - yMin || 1;

    const xAt = (m) => TL.x0 + (m / WARRANTY_MONTHS) * (TL.x1 - TL.x0);
    const yAt = (v) => TL.bottom - ((v - yMin) / span) * (TL.bottom - TL.top);

    const y0 = yAt(0);
    const yStart = yAt(-price);
    const yEnd = yAt(end);

    // 損益分岐点（月）
    const cross = net > 0 ? price / net : Infinity;
    const hasCross = cross > 0 && cross <= WARRANTY_MONTHS;
    const xCross = hasCross ? xAt(cross) : TL.x1;

    zeroLine.setAttribute("y1", y0);
    zeroLine.setAttribute("y2", y0);

    // 赤いエリア: 0 〜 分岐点
    lossArea.setAttribute("points",
      `${TL.x0},${yStart} ${xCross},${hasCross ? y0 : yEnd} ${xCross},${y0} ${TL.x0},${y0}`);
    lossLine.setAttribute("x1", TL.x0);
    lossLine.setAttribute("y1", yStart);
    lossLine.setAttribute("x2", xCross);
    lossLine.setAttribute("y2", hasCross ? y0 : yEnd);

    // 緑のエリア: 分岐点 〜 120ヶ月
    if (hasCross) {
      profitArea.setAttribute("points", `${xCross},${y0} ${TL.x1},${yEnd} ${TL.x1},${y0}`);
      profitLine.setAttribute("x1", xCross);
      profitLine.setAttribute("y1", y0);
      profitLine.setAttribute("x2", TL.x1);
      profitLine.setAttribute("y2", yEnd);
      profitArea.setAttribute("opacity", 1);
      profitLine.setAttribute("opacity", 1);
    } else {
      profitArea.setAttribute("opacity", 0);
      profitLine.setAttribute("opacity", 0);
    }

    const markerOpacity = hasCross ? 1 : 0;
    [markerLine, markerRing, markerDot, markerText].forEach((el) =>
      el.setAttribute("opacity", markerOpacity));

    if (hasCross) {
      markerLine.setAttribute("x1", xCross);
      markerLine.setAttribute("x2", xCross);
      markerLine.setAttribute("y1", y0);
      markerLine.setAttribute("y2", TL.bottom);
      markerRing.setAttribute("cx", xCross);
      markerRing.setAttribute("cy", y0);
      markerDot.setAttribute("cx", xCross);
      markerDot.setAttribute("cy", y0);
      markerText.setAttribute("x", Math.min(TL.x1 - 34, Math.max(TL.x0 + 34, xCross)));
      markerText.setAttribute("y", y0 - 16);
      markerText.textContent = `回収 ${Math.ceil(cross)}ヶ月`;
    } else {
      markerText.textContent = "";
    }

    startLabel.textContent = `投資額 ${compactYen(price)}`;

    endLabel.setAttribute("fill", end >= 0 ? "#2fdd9b" : "#ff5c6c");
    endLabel.textContent = `120ヶ月 ${compactYen(end)}`;
  });
}

function drawTimeline(net, price) {
  if (!setTimeline) return;
  setTimeline({ net, price }, { from: { net: 0, price } });
}

/* ================= Render ================= */
function render() {
  const income = calcIncome();
  const cost = calcCost();

  const net = income.total - cost.total;
  const payback = net > 0 ? Math.ceil(state.equipmentPrice / net) : 0;
  const netProfit = net * (WARRANTY_MONTHS - payback);

  setKpiNet(net);
  setKpiPayback(payback);
  setKpiProfit(netProfit);
  $("kpi-card-net").classList.toggle("is-negative", net <= 0);

  $("income-total").textContent = currency(income.total);
  $("cost-total").textContent = currency(cost.total);

  // 배분 블록들의 결과값 업데이트
  occupancyBlocks.forEach(block => block.updateResult());
  incomeBlocks.forEach(block => block.updateResult());

  drawChart(income.total, cost.total, net);
  drawTimeline(net, state.equipmentPrice);
}

/* ================= Equipment model chips ================= */
function buildModelChips(select) {
  const wrap = $("model-chips");
  if (!wrap) return () => {};

  const chips = EQUIPMENT_MODELS.map((model) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "model-chip";
    chip.setAttribute("role", "radio");
    chip.dataset.model = model.name;
    chip.innerHTML = `
      <span class="model-name">${model.name}</span>
      <span class="model-price">${currency(model.price)}</span>
    `;
    // select を唯一の入力元として保ち、change イベントで既存ロジックへ委譲する
    chip.addEventListener("click", () => {
      if (select.value === model.name) return;
      select.value = model.name;
      select.dispatchEvent(new Event("change"));
    });
    wrap.append(chip);
    return chip;
  });

  return () => {
    chips.forEach((chip) => {
      chip.setAttribute("aria-checked", String(chip.dataset.model === select.value));
    });
  };
}

/* ================= Scroll behaviour ================= */
function initScrollEffects() {
  // 100vw はスクロールバー幅を含むため、実際の表示幅を CSS 変数で渡す。
  // rAF で間引くと、rAF が回らない状態（非表示タブでの回転など）で
  // フラグが戻らず以降の resize を取りこぼすため、同期的に更新する。
  let lastViewportWidth = -1;
  const syncViewportWidth = () => {
    const width = document.documentElement.clientWidth;
    if (width === lastViewportWidth) return;
    lastViewportWidth = width;
    document.documentElement.style.setProperty("--vw", `${width}px`);
  };
  syncViewportWidth();
  window.addEventListener("resize", syncViewportWidth);
  // iOS は回転直後の値が古いことがあるので遅れて取り直す
  window.addEventListener("orientationchange", () => setTimeout(syncViewportWidth, 150));

  // 스크롤 리빌
  const revealables = document.querySelectorAll(".reveal");
  if (REDUCE_MOTION || !("IntersectionObserver" in window)) {
    revealables.forEach((el) => el.classList.add("is-visible"));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });
    revealables.forEach((el) => io.observe(el));
  }

  // KPI 바 고정 상태
  const bar = $("kpibar");
  const sentinel = document.querySelector(".kpibar-sentinel");
  if (bar && sentinel && "IntersectionObserver" in window) {
    const navHeight = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--nav-h"), 10) || 60;
    const io = new IntersectionObserver(
      ([entry]) => bar.classList.toggle("is-stuck", !entry.isIntersecting),
      { rootMargin: `-${navHeight + 4}px 0px 0px 0px`, threshold: 0 }
    );
    io.observe(sentinel);
  }
}

/* ================= Init ================= */
function init() {
  const kpiNetEl = $("kpi-net");
  const kpiPaybackEl = $("kpi-payback");
  const kpiProfitEl = $("kpi-profit");

  setKpiNet = createCounter(kpiNetEl, currency);
  setKpiPayback = createCounter(kpiPaybackEl, (v) => `${Math.round(v)} ヶ月`);
  setKpiProfit = createCounter(kpiProfitEl, currency);

  buildChart();
  buildTimeline();

  const incomeWrap = $("income-blocks");
  const panoBlock = incomeEditor("pano","PANO(パノラマ撮影)","パノラマX線撮影による保険収入");
  const ctInsBlock = incomeEditor("ctIns","CT(保険)","保険適用CT撮影による収入");
  const ctSelfBlock = incomeEditor("ctSelf","CT(自費)","インプラント・精密診断等の自費CT撮影");
  const cephBlock = incomeEditor("ceph","CEPH","矯正用セファロ撮影による収入");

  incomeBlocks = [panoBlock, ctInsBlock, ctSelfBlock, cephBlock];

  incomeWrap.append(
    panoBlock,
    ctInsBlock,
    ctSelfBlock,
    cephBlock,
    inputBlock("その他収入","紹介料・臨時撮影など",state.income.other,v=>{state.income.other=v;render();})
  );

  const costWrap = $("cost-blocks");
  const costCalc = () => calcCost();

  const rentBlock = occupancyBlock(
    "家賃配分",
    "院内設置面積分のみ按分",
    state.cost.rent,
    state.cost.rentRatio,
    v=>{state.cost.rent=v;render();},
    v=>{state.cost.rentRatio=v;render();},
    () => costCalc().rent
  );

  const doctorBlock = occupancyBlock(
    "医師人件費配分",
    "CT診断・説明にかかる稼働分",
    state.cost.doctor,
    state.cost.doctorRatio,
    v=>{state.cost.doctor=v;render();},
    v=>{state.cost.doctorRatio=v;render();},
    () => costCalc().doctor
  );

  const staffBlock = occupancyBlock(
    "スタッフ人件費配分",
    "撮影・運用対応分",
    state.cost.staff,
    state.cost.staffRatio,
    v=>{state.cost.staff=v;render();},
    v=>{state.cost.staffRatio=v;render();},
    () => costCalc().staff
  );

  // 배분 블록들을 배열에 저장
  occupancyBlocks = [rentBlock, doctorBlock, staffBlock];

  costWrap.append(
    inputBlock("保守メンテナンス","",state.cost.maintenance,v=>{state.cost.maintenance=v;render();}),
    inputBlock("消耗品","(バイトビニール・手袋・アルコール)",state.cost.consumables,v=>{state.cost.consumables=v;render();}),
    inputBlock("電気代","CT稼働分のみ想定",state.cost.electricity,v=>{state.cost.electricity=v;render();}),
    rentBlock,
    doctorBlock,
    staffBlock,
    inputBlock("その他費用","通信費・雑費など",state.cost.other,v=>{state.cost.other=v;render();})
  );

  const equipmentModel = $("equipmentModel");
  const eq = $("equipmentPrice");

  EQUIPMENT_MODELS.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.name;
    option.textContent = model.name;
    equipmentModel.append(option);
  });

  equipmentModel.value = state.equipmentModel;
  eq.value = formatNumber(state.equipmentPrice);

  equipmentModel.addEventListener('change', (e) => {
    const selectedModel = EQUIPMENT_MODELS.find((model) => model.name === e.target.value);
    if (!selectedModel) return;

    state.equipmentModel = selectedModel.name;
    state.equipmentPrice = selectedModel.price;
    eq.value = formatNumber(state.equipmentPrice);
    render();
  });

  const syncModelChips = buildModelChips(equipmentModel);
  equipmentModel.addEventListener('change', syncModelChips);
  syncModelChips();

  let isUpdatingEq = false;
  eq.addEventListener('input', (e) => {
    if (isUpdatingEq) return;
    isUpdatingEq = true;

    state.equipmentPrice = parseNumber(e.target.value);
    e.target.value = formatNumber(state.equipmentPrice);
    render();

    isUpdatingEq = false;
  });

  initScrollEffects();
  render();
}

init();
