/* ================= Constants ================= */
const WARRANTY_MONTHS = 120;
const currency = (v) => `¥${Math.round(v).toLocaleString()}`;

/* ================= Utils ================= */
const formatNumber = (v) =>
  v === "" || v === null || isNaN(v) ? "" : Number(v).toLocaleString();

const parseNumber = (v) =>
  Number(String(v).replace(/,/g, ""));

/* ================= State ================= */
const state = {
  equipmentPrice: 7680000,

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

// 배분 블록들을 저장할 배열
let occupancyBlocks = [];

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
  div.className = "space-y-1";
  div.innerHTML = `
    <p class="text-sm font-medium">${label}</p>
    ${desc ? `<p class="text-xs text-gray-500">${desc}</p>` : ""}
    <input type="text" inputmode="numeric" class="input">
  `;

  const input = div.querySelector("input");
  input.value = formatNumber(value);
  input.addEventListener('input', createInputHandler(input, onChange));

  return div;
}

function occupancyBlock(title, desc, base, ratio, onBase, onRatio, getResult) {
  const div = document.createElement("div");
  div.className = "bg-gray-50-box space-y-2";
  div.innerHTML = `
    <p class="font-medium text-sm">${title}</p>
    <p class="text-xs text-gray-500">${desc}</p>
    <div class="grid grid-cols-2 gap-2">
      <input type="text" inputmode="numeric" class="input">
      <input type="text" inputmode="numeric" class="input text-right">
    </div>
    <p class="text-xs text-gray-500 result-text">配分後: ${currency(getResult())}</p>
  `;

  const inputs = div.querySelectorAll("input");
  const resultText = div.querySelector(".result-text");

  // 결과 업데이트 함수를 DOM 요소에 저장
  div.updateResult = () => {
    resultText.textContent = `配分後: ${currency(getResult())}`;
  };

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
  div.className = "bg-gray-50-box space-y-3";
  div.innerHTML = `
    <div>
      <p class="font-medium text-sm">${label}</p>
      <p class="text-xs text-gray-500">${desc}</p>
      <p class="text-xs text-gray-400 mt-1">
        単価 × 1日撮影回数 × 月間稼働日数
      </p>
    </div>
    <div class="grid grid-cols-3 gap-2">
      <input class="input" type="text" inputmode="numeric">
      <input class="input" type="text" inputmode="numeric">
      <input class="input" type="text" inputmode="numeric">
    </div>
  `;

  const i = div.querySelectorAll("input");
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

/* ================= Chart ================= */
function drawChart(income, cost, net) {
  const svg = $("chart");
  svg.innerHTML = "";
  const max = Math.max(income, cost, Math.abs(net));

  const data = [
    { label: "収入", value: income, color: "#9ca3af" },
    { label: "費用", value: cost, color: "#9ca3af" },
    { label: "純利益", value: net, color: "#dc2626" },
  ];

  data.forEach((d, i) => {
    const h = Math.abs(d.value) / max * 160;
    const x = 50 + i * 90;
    const y = 190 - h;

    const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", 50);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", 6);
    rect.setAttribute("fill", d.color);

    const text = document.createElementNS("http://www.w3.org/2000/svg","text");
    text.setAttribute("x", x + 25);
    text.setAttribute("y", 215);
    text.setAttribute("text-anchor","middle");
    text.textContent = d.label;

    svg.append(rect, text);
  });
}

/* ================= Render ================= */
function render() {
  const income = calcIncome();
  const cost = calcCost();

  const net = income.total - cost.total;
  const payback = net > 0 ? Math.ceil(state.equipmentPrice / net) : 0;
  const netProfit = net * (WARRANTY_MONTHS - payback);

  $("kpi-net").textContent = currency(net);
  $("kpi-payback").textContent = `${payback} ヶ月`;
  $("kpi-profit").textContent = currency(netProfit);

  $("income-total").textContent = currency(income.total);
  $("cost-total").textContent = currency(cost.total);

  // 배분 블록들의 결과값 업데이트
  occupancyBlocks.forEach(block => block.updateResult());

  drawChart(income.total, cost.total, net);
}

/* ================= Init ================= */
function init() {
  const incomeWrap = $("income-blocks");
  incomeWrap.append(
    incomeEditor("pano","PANO(パノラマ撮影)","パノラマX線撮影による保険収入"),
    incomeEditor("ctIns","CT(保険)","保険適用CT撮影による収入"),
    incomeEditor("ctSelf","CT(自費)","インプラント・精密診断等の自費CT撮影"),
    incomeEditor("ceph","CEPH","矯正用セファロ撮影による収入"),
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
    inputBlock("消耗品","(バイトピニール・手袋・アルコール)",state.cost.consumables,v=>{state.cost.consumables=v;render();}),
    inputBlock("電気代","CT稼働分のみ想定",state.cost.electricity,v=>{state.cost.electricity=v;render();}),
    rentBlock,
    doctorBlock,
    staffBlock,
    inputBlock("その他費用","通信費・雑費など",state.cost.other,v=>{state.cost.other=v;render();})
  );

  const eq = $("equipmentPrice");
  eq.value = formatNumber(state.equipmentPrice);
  
  let isUpdatingEq = false;
  eq.addEventListener('input', (e) => {
    if (isUpdatingEq) return;
    isUpdatingEq = true;
    
    state.equipmentPrice = parseNumber(e.target.value);
    e.target.value = formatNumber(state.equipmentPrice);
    render();
    
    isUpdatingEq = false;
  });

  render();
}

init();

