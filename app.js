const API = {
  official: "https://bo.dolarapi.com/v1/dolares/oficial",
  binance: "https://bo.dolarapi.com/v1/dolares/binance"
};

const REFRESH_INTERVAL = 5 * 60 * 1000;
const CACHE_KEY = "bolivia-fx-live-v3";
const TIME_ZONE = "America/La_Paz";

const state = {
  p2pBuy: null,
  p2pSell: null,
  officialBuy: null,
  officialSell: null,
  updatedAt: null,
  history: [],
  period: 30
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function format(value, digits = 2) {
  if (!number(value)) return "—";
  return new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(Number(value));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TIME_ZONE
  }).format(date).replace(".", "");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setConnection(message, error = false) {
  const chip = $("#liveChip");
  const note = $("#marketNote");
  setText("liveText", error ? "Último dato" : "En vivo");
  if (chip) chip.classList.toggle("error", error);
  if (note) {
    note.textContent = message;
    note.classList.toggle("error", error);
  }
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      p2pBuy: state.p2pBuy,
      p2pSell: state.p2pSell,
      officialBuy: state.officialBuy,
      officialSell: state.officialSell,
      updatedAt: state.updatedAt
    }));
  } catch (_) {}
}

function restoreCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!cached) return false;
    if (![cached.p2pBuy, cached.p2pSell, cached.officialBuy, cached.officialSell].every(number)) return false;
    Object.assign(state, cached);
    return true;
  } catch (_) {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadLiveRates() {
  try {
    const [official, binance] = await Promise.all([
      fetchJson(API.official),
      fetchJson(API.binance)
    ]);

    const values = {
      p2pBuy: number(binance.compra),
      p2pSell: number(binance.venta),
      officialBuy: number(official.compra),
      officialSell: number(official.venta)
    };

    if (!Object.values(values).every(Boolean)) throw new Error("Cotización incompleta");

    Object.assign(state, values);
    const dates = [official.fechaActualizacion, binance.fechaActualizacion]
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));
    state.updatedAt = dates.length
      ? new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString()
      : new Date().toISOString();

    saveCache();
    renderLive();
    setConnection(`Cotizaciones verificadas · ${formatDate(state.updatedAt)}`);
  } catch (error) {
    console.warn("No se pudieron consultar las cotizaciones actuales:", error);
    const restored = restoreCache();
    if (restored) {
      renderLive();
      setConnection(`No se pudo actualizar ahora. Mostrando el último dato guardado · ${formatDate(state.updatedAt)}`, true);
    } else {
      setConnection("No se pudo consultar la fuente en este momento.", true);
    }
  }
}

async function loadHistory() {
  try {
    const response = await fetch(`./data/history.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    if (!Array.isArray(raw)) throw new Error("Histórico inválido");

    state.history = raw
      .filter((item) => item && item.date && number(item.usdt) && number(item.reference))
      .map((item) => ({
        date: String(item.date),
        label: item.label || String(item.date),
        p2p: Number(item.usdt),
        official: Number(item.reference)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    renderHistory();
  } catch (error) {
    console.warn("No se pudo cargar el histórico:", error);
    renderHistory();
  }
}

function renderLive() {
  setText("p2pBuy", format(state.p2pBuy));
  setText("p2pSell", format(state.p2pSell));
  setText("officialBuy", format(state.officialBuy));
  setText("officialSell", format(state.officialSell));
  setText("lastUpdated", formatDate(state.updatedAt));

  const average = state.p2pBuy && state.p2pSell ? (state.p2pBuy + state.p2pSell) / 2 : null;
  const gap = state.p2pSell && state.officialSell
    ? ((state.p2pSell / state.officialSell) - 1) * 100
    : null;
  const spread = state.p2pBuy && state.p2pSell
    ? state.p2pSell - state.p2pBuy
    : null;

  setText("p2pAverage", format(average));
  setText("gapPct", gap === null ? "—" : format(gap));
  setText("gapText", gap === null ? "Comparación sobre la venta oficial" : `${gap >= 0 ? "Por encima" : "Por debajo"} de la venta oficial`);
  setText("p2pSpread", spread === null ? "Spread compra/venta: —" : `Spread compra/venta: Bs ${format(spread)}`);

  updateConverter();
  updateChartSummary();
}

function getRate() {
  const key = $("#rateSelect")?.value || "p2pSell";
  return number(state[key]);
}

function updateConverter() {
  const amount = Number($("#amountInput")?.value || 0);
  const from = $("#fromCurrency")?.value || "USD";
  const rate = getRate();
  const output = $("#resultInput");

  setText("toCurrency", from === "USD" ? "BOB" : "USD");

  if (!rate || !Number.isFinite(amount) || amount < 0) {
    if (output) output.value = "—";
    setText("conversionRate", "—");
    return;
  }

  const result = from === "USD" ? amount * rate : amount / rate;
  if (output) output.value = new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(result);

  setText("conversionRate", `1 USD = Bs ${format(rate)}`);
}

function swapConversion() {
  const select = $("#fromCurrency");
  if (!select) return;
  select.value = select.value === "USD" ? "BOB" : "USD";
  updateConverter();
}

function selectedHistory() {
  if (state.period === "max") return state.history;
  const count = Number(state.period);
  return state.history.slice(-count);
}

function updateChartSummary() {
  const average = state.p2pBuy && state.p2pSell ? (state.p2pBuy + state.p2pSell) / 2 : null;
  const p2p = average || state.history.at(-1)?.p2p || null;
  const official = state.officialSell || state.history.at(-1)?.official || null;
  const gap = p2p && official ? ((p2p / official) - 1) * 100 : null;
  setText("chartP2p", p2p ? `Bs ${format(p2p)}` : "—");
  setText("chartOfficial", official ? `Bs ${format(official)}` : "—");
  setText("chartGap", gap === null ? "—" : `${gap >= 0 ? "+" : ""}${format(gap)}%`);
}

function svgElement(name, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function renderChart() {
  const svg = $("#historyChart");
  const tooltip = $("#chartTooltip");
  if (!svg) return;
  svg.innerHTML = "";

  const data = selectedHistory();
  if (!data.length) {
    const text = svgElement("text", { x: 480, y: 180, "text-anchor": "middle", fill: "#9ca3af", "font-size": 14 });
    text.textContent = "El histórico se irá formando con las actualizaciones diarias";
    svg.appendChild(text);
    return;
  }

  const W = 960, H = 360;
  const pad = { left: 52, right: 24, top: 24, bottom: 42 };
  const all = data.flatMap((d) => [d.p2p, d.official]).filter(number);
  let min = Math.min(...all), max = Math.max(...all);
  const span = Math.max(max - min, .1);
  min -= span * .14;
  max += span * .14;

  const x = (i) => pad.left + (data.length === 1 ? (W - pad.left - pad.right) / 2 : (i / (data.length - 1)) * (W - pad.left - pad.right));
  const y = (v) => pad.top + ((max - v) / (max - min)) * (H - pad.top - pad.bottom);

  for (let i = 0; i < 5; i++) {
    const yy = pad.top + (i / 4) * (H - pad.top - pad.bottom);
    svg.appendChild(svgElement("line", { x1: pad.left, y1: yy, x2: W - pad.right, y2: yy, stroke: "#edf0f4", "stroke-width": 1 }));
    const value = max - (i / 4) * (max - min);
    const label = svgElement("text", { x: 8, y: yy + 4, fill: "#9ca3af", "font-size": 10 });
    label.textContent = format(value);
    svg.appendChild(label);
  }

  const makePath = (key) => data.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(d[key])}`).join(" ");
  svg.appendChild(svgElement("path", { d: makePath("p2p"), fill: "none", stroke: "#1769e0", "stroke-width": 3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  svg.appendChild(svgElement("path", { d: makePath("official"), fill: "none", stroke: "#0f9f6e", "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));

  const tickIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
  tickIndexes.forEach((i) => {
    const label = svgElement("text", { x: x(i), y: H - 12, fill: "#9ca3af", "font-size": 10, "text-anchor": i === 0 ? "start" : i === data.length - 1 ? "end" : "middle" });
    label.textContent = data[i].label;
    svg.appendChild(label);
  });

  data.forEach((d, i) => {
    const hit = svgElement("rect", { x: Math.max(pad.left, x(i) - 12), y: pad.top, width: 24, height: H - pad.top - pad.bottom, fill: "transparent" });
    hit.style.cursor = "crosshair";
    hit.addEventListener("mouseenter", () => showTooltip(d, x(i), Math.min(y(d.p2p), y(d.official)), tooltip));
    hit.addEventListener("mousemove", () => showTooltip(d, x(i), Math.min(y(d.p2p), y(d.official)), tooltip));
    hit.addEventListener("mouseleave", () => { if (tooltip) tooltip.hidden = true; });
    svg.appendChild(hit);
  });
}

function showTooltip(d, x, y, tooltip) {
  if (!tooltip) return;
  const gap = ((d.p2p / d.official) - 1) * 100;
  tooltip.innerHTML = `<strong>${d.label}</strong><span>P2P <b>Bs ${format(d.p2p)}</b></span><span>Oficial <b>Bs ${format(d.official)}</b></span><span>Brecha <b>${gap >= 0 ? "+" : ""}${format(gap)}%</b></span>`;
  tooltip.style.left = `${(x / 960) * 100}%`;
  tooltip.style.top = `${(y / 360) * 100}%`;
  tooltip.hidden = false;
}

function renderTable() {
  const body = $("#historyTableBody");
  if (!body) return;
  const rows = selectedHistory().slice(-8).reverse();
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">El histórico se irá completando con las actualizaciones diarias.</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((d) => {
    const gap = ((d.p2p / d.official) - 1) * 100;
    return `<tr><td>${d.label}</td><td>Bs ${format(d.p2p)}</td><td>Bs ${format(d.official)}</td><td>${gap >= 0 ? "+" : ""}${format(gap)}%</td></tr>`;
  }).join("");
}

function renderHistory() {
  renderChart();
  renderTable();
  updateChartSummary();
}

function setupEvents() {
  $("#amountInput")?.addEventListener("input", updateConverter);
  $("#fromCurrency")?.addEventListener("change", updateConverter);
  $("#rateSelect")?.addEventListener("change", updateConverter);
  $("#swapButton")?.addEventListener("click", swapConversion);

  $$('[data-quick]').forEach((button) => {
    button.addEventListener("click", () => {
      const input = $("#amountInput");
      if (!input) return;
      input.value = button.dataset.quick;
      updateConverter();
    });
  });

  $$('[data-period]').forEach((button) => {
    button.addEventListener("click", () => {
      state.period = button.dataset.period === "max" ? "max" : Number(button.dataset.period);
      $$('[data-period]').forEach((item) => item.classList.toggle("active", item === button));
      renderHistory();
    });
  });
}

async function init() {
  setupEvents();
  restoreCache();
  if (state.p2pBuy) renderLive();
  await Promise.allSettled([loadHistory(), loadLiveRates()]);
  setInterval(loadLiveRates, REFRESH_INTERVAL);
}

document.addEventListener("DOMContentLoaded", init);
