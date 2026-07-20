/*
  MONITOR CAMBIARIO DE BOLIVIA
  ----------------------------
  - Cotizaciones actuales: DolarApi Bolivia.
  - Histórico diario: data/history.json.
  - Actualización automática: GitHub Actions.
  - Reservas, tipo de cambio real y base monetaria: series manuales de ejemplo.
*/

const LIVE_API = {
  official: "https://bo.dolarapi.com/v1/dolares/oficial",
  binance: "https://bo.dolarapi.com/v1/dolares/binance"
};

const REFRESH_INTERVAL = 5 * 60 * 1000;
const LAST_LIVE_KEY = "bolivia-fx-last-live-v2";
const TIME_ZONE = "America/La_Paz";

const DASHBOARD_DATA = {
  lastUpdated: "Sin actualización disponible",
  current: {
    usdt: null,
    tco: null,
    reference: null,
    reserves: 2238,
    realExchangeRate: 93.6,
    monetaryBase: 72.4
  },
  previous: {
    usdt: null,
    tco: null,
    reference: null,
    reserves: 2210,
    monetaryBase: 70.8
  },
  market: {
    isoDates: [],
    dates: [],
    usdt: [],
    tco: [],
    reference: []
  },
  reserves: {
    labels: ["Ago", "Sep", "Oct", "Nov", "Dic", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul"],
    values: [2054, 2078, 2041, 2095, 2114, 2089, 2130, 2155, 2182, 2174, 2210, 2238]
  },
  monetaryBase: {
    labels: ["Ago", "Sep", "Oct", "Nov", "Dic", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul"],
    values: [65.2, 65.8, 66.5, 67.3, 68.7, 67.9, 68.4, 69.1, 69.9, 70.3, 70.8, 72.4]
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const isValidNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const fmt = (value, digits = 2) => new Intl.NumberFormat("es-BO", {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits
}).format(Number(value));
const safeFmt = (value, digits = 2) => isValidNumber(value) ? fmt(value, digits) : "—";
const signedPct = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${fmt(value, 2)}%` : "—";
const percentageChange = (current, previous) => {
  if (!isValidNumber(current) || !isValidNumber(previous)) return null;
  return ((Number(current) - Number(previous)) / Number(previous)) * 100;
};

let selectedPeriod = 30;
let historicalDataLoaded = false;

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function parseApiNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Valor inválido en ${fieldName}`);
  }
  return number;
}

function getBoliviaIsoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function createDateLabel(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC"
  }).format(date).replace(".", "");
}

function formatUpdateDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: TIME_ZONE
  }).format(date);
}

function latestValidDate(...values) {
  const dates = values
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) return new Date();
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function updateConnectionStatus(message, state = "live") {
  const badgeText = $("#liveBadgeText");
  const dataStatus = $("#dataStatus");
  const badge = $("#liveBadge");

  const labels = {
    loading: "Conectando",
    live: "En vivo",
    cached: "Último dato",
    error: "Sin conexión"
  };

  if (badgeText) badgeText.textContent = labels[state] || labels.live;
  if (dataStatus) {
    dataStatus.textContent = message;
    dataStatus.classList.toggle("status-error", state === "error");
  }
  if (badge) {
    badge.classList.toggle("connection-loading", state === "loading");
    badge.classList.toggle("connection-error", state === "error");
    badge.classList.toggle("connection-cached", state === "cached");
  }
}

function getMarketPoints() {
  const market = DASHBOARD_DATA.market;
  return market.isoDates.map((date, index) => ({
    date,
    label: market.dates[index],
    usdt: market.usdt[index],
    tco: market.tco[index],
    reference: market.reference[index]
  }));
}

function setMarketPoints(points) {
  const cleanPoints = points
    .filter((item) => item && item.date && isValidNumber(item.usdt) && isValidNumber(item.tco) && isValidNumber(item.reference))
    .map((item) => ({
      date: String(item.date),
      label: item.label || createDateLabel(String(item.date)),
      usdt: Number(item.usdt),
      tco: Number(item.tco),
      reference: Number(item.reference)
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-365);

  DASHBOARD_DATA.market.isoDates = cleanPoints.map((item) => item.date);
  DASHBOARD_DATA.market.dates = cleanPoints.map((item) => item.label);
  DASHBOARD_DATA.market.usdt = cleanPoints.map((item) => item.usdt);
  DASHBOARD_DATA.market.tco = cleanPoints.map((item) => item.tco);
  DASHBOARD_DATA.market.reference = cleanPoints.map((item) => item.reference);
}

function upsertLiveMarketPoint(isoDate, values) {
  const points = getMarketPoints();
  const newPoint = {
    date: isoDate,
    label: createDateLabel(isoDate),
    ...values
  };
  const index = points.findIndex((item) => item.date === isoDate);
  if (index >= 0) points[index] = newPoint;
  else points.push(newPoint);
  setMarketPoints(points);
}

function getPreviousPointBefore(isoDate) {
  const points = getMarketPoints().filter((item) => item.date < isoDate);
  return points.length ? points.at(-1) : null;
}

function getSeriesChange(seriesName, periodsBack = 1) {
  const values = DASHBOARD_DATA.market[seriesName].filter(isValidNumber);
  if (values.length < 2) return null;
  const current = values.at(-1);
  const previousIndex = Math.max(0, values.length - 1 - periodsBack);
  return percentageChange(current, values[previousIndex]);
}

function restoreCachedRates() {
  try {
    const cached = JSON.parse(localStorage.getItem(LAST_LIVE_KEY) || "null");
    if (!cached) return false;
    const values = cached.values || cached;
    if (!isValidNumber(values.usdt) || !isValidNumber(values.tco) || !isValidNumber(values.reference)) return false;

    Object.assign(DASHBOARD_DATA.current, values);
    Object.assign(DASHBOARD_DATA.previous, values);
    DASHBOARD_DATA.lastUpdated = cached.updatedAt
      ? formatUpdateDate(cached.updatedAt) || "Último dato guardado"
      : "Último dato guardado";
    updateConnectionStatus("Mostrando el último dato guardado en este navegador.", "cached");
    return true;
  } catch (error) {
    console.warn("No se pudo leer el dato guardado:", error);
    return false;
  }
}

async function loadHistoricalData() {
  try {
    const response = await fetch(`./data/history.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Histórico HTTP ${response.status}`);

    const history = await response.json();
    if (!Array.isArray(history)) throw new Error("El histórico no es una lista válida");

    setMarketPoints(history);
    historicalDataLoaded = DASHBOARD_DATA.market.dates.length > 0;

    if (historicalDataLoaded) {
      const points = getMarketPoints();
      const last = points.at(-1);
      const previous = points.at(-2) || last;
      Object.assign(DASHBOARD_DATA.current, {
        usdt: last.usdt,
        tco: last.tco,
        reference: last.reference
      });
      Object.assign(DASHBOARD_DATA.previous, {
        usdt: previous.usdt,
        tco: previous.tco,
        reference: previous.reference
      });

      const rawLast = history
        .filter((item) => item && item.date === last.date)
        .at(-1);
      DASHBOARD_DATA.lastUpdated = formatUpdateDate(rawLast?.updatedAt) || createDateLabel(last.date);
    }

    return historicalDataLoaded;
  } catch (error) {
    historicalDataLoaded = false;
    console.warn("No se pudo cargar data/history.json:", error);
    return false;
  }
}

async function loadLiveRates() {
  updateConnectionStatus("Actualizando cotizaciones desde DolarApi…", "loading");

  try {
    const [officialResponse, binanceResponse] = await Promise.all([
      fetch(LIVE_API.official, { cache: "no-store", headers: { Accept: "application/json" } }),
      fetch(LIVE_API.binance, { cache: "no-store", headers: { Accept: "application/json" } })
    ]);

    if (!officialResponse.ok) throw new Error(`Dólar oficial HTTP ${officialResponse.status}`);
    if (!binanceResponse.ok) throw new Error(`Dólar Binance HTTP ${binanceResponse.status}`);

    const [official, binance] = await Promise.all([
      officialResponse.json(),
      binanceResponse.json()
    ]);

    const officialBuy = parseApiNumber(official.compra, "compra oficial");
    const officialSale = parseApiNumber(official.venta, "venta oficial");
    const binanceBuy = parseApiNumber(binance.compra, "compra Binance");
    const binanceSale = parseApiNumber(binance.venta, "venta Binance");
    const usdtAverage = Number(((binanceBuy + binanceSale) / 2).toFixed(4));

    const liveValues = {
      usdt: usdtAverage,
      tco: officialBuy,
      reference: officialSale
    };

    const isoDate = getBoliviaIsoDate();
    const previousPoint = getPreviousPointBefore(isoDate);
    const cachedCurrent = { ...DASHBOARD_DATA.current };

    if (previousPoint) {
      Object.assign(DASHBOARD_DATA.previous, {
        usdt: previousPoint.usdt,
        tco: previousPoint.tco,
        reference: previousPoint.reference
      });
    } else if (isValidNumber(cachedCurrent.usdt)) {
      Object.assign(DASHBOARD_DATA.previous, {
        usdt: cachedCurrent.usdt,
        tco: cachedCurrent.tco,
        reference: cachedCurrent.reference
      });
    } else {
      Object.assign(DASHBOARD_DATA.previous, liveValues);
    }

    Object.assign(DASHBOARD_DATA.current, liveValues);
    upsertLiveMarketPoint(isoDate, liveValues);

    const sourceDate = latestValidDate(official.fechaActualizacion, binance.fechaActualizacion);
    const formattedDate = formatUpdateDate(sourceDate) || formatUpdateDate(new Date());
    DASHBOARD_DATA.lastUpdated = formattedDate;

    localStorage.setItem(LAST_LIVE_KEY, JSON.stringify({
      values: liveValues,
      updatedAt: sourceDate.toISOString()
    }));

    updateConnectionStatus(`Dólar oficial y Binance P2P · ${formattedDate}`, "live");
    return liveValues;
  } catch (error) {
    console.error("No se pudieron cargar las cotizaciones:", error);
    const hasFallback = isValidNumber(DASHBOARD_DATA.current.usdt);
    updateConnectionStatus(
      hasFallback
        ? "No se pudo consultar la API. Se muestra el último dato disponible."
        : "No se pudo consultar la API y todavía no existe un dato histórico.",
      "error"
    );
    return null;
  }
}

function initializeValues() {
  const { current, previous } = DASHBOARD_DATA;
  const ratesAvailable = isValidNumber(current.usdt) && isValidNumber(current.tco) && isValidNumber(current.reference);

  setText("lastUpdated", DASHBOARD_DATA.lastUpdated);
  setText("usdtValue", safeFmt(current.usdt));
  setText("tcoValue", safeFmt(current.tco));
  setText("referenceValue", safeFmt(current.reference));

  if (ratesAvailable) {
    const gap = ((current.usdt / current.reference) - 1) * 100;
    const nominalGap = current.usdt - current.reference;
    const usdtChange = getSeriesChange("usdt", 1) ?? percentageChange(current.usdt, previous.usdt);
    const tcoChange = getSeriesChange("tco", 30) ?? percentageChange(current.tco, previous.tco);
    const referenceMargin = ((current.reference / current.tco) - 1) * 100;

    setText("gapValue", fmt(gap));
    setText("gapNominal", `${fmt(nominalGap)} Bs`);
    setText("usdtChange", signedPct(usdtChange));
    setText("tcoChange", signedPct(tcoChange));
    setText("referenceMargin", `${fmt(referenceMargin)}%`);
    setText("heroGap", `${fmt(gap)}%`);

    const changeBadge = $("#usdtChange");
    if (changeBadge) {
      changeBadge.classList.toggle("negative", Number.isFinite(usdtChange) && usdtChange < 0);
      changeBadge.classList.toggle("positive", !Number.isFinite(usdtChange) || usdtChange >= 0);
    }

    const relation = gap >= 0 ? "por encima" : "por debajo";
    setText(
      "marketSummary",
      `El dólar vía USDT cotiza en ${fmt(current.usdt)} Bs/$us, ${fmt(Math.abs(gap))}% ${relation} de la venta oficial. La brecha compara el mercado digital con la referencia administrada.`
    );
  } else {
    ["gapValue", "gapNominal", "usdtChange", "tcoChange", "referenceMargin", "heroGap"].forEach((id) => setText(id, "—"));
    setText("marketSummary", "Aún no se pudo cargar una cotización válida. Revisa la conexión o ejecuta la automatización de GitHub Actions.");
  }

  const reservesChange = percentageChange(current.reserves, previous.reserves);
  const monetaryChange = percentageChange(current.monetaryBase, previous.monetaryBase);
  setText("reservesValue", new Intl.NumberFormat("es-BO").format(current.reserves));
  setText("reservesChange", `${signedPct(reservesChange)} mensual`);
  setText("reservesCaption", "Serie manual");
  setText("rerValue", safeFmt(current.realExchangeRate, 1));
  setText("gaugeNumber", safeFmt(current.realExchangeRate, 1));
  setText("monetaryValue", safeFmt(current.monetaryBase, 1));
  setText("monetaryChange", `${signedPct(monetaryChange)} mensual`);
  setText("monetaryCaption", "Serie manual");

  let rerText = "El índice se mantiene próximo a su nivel de equilibrio de largo plazo.";
  if (current.realExchangeRate < 95) rerText = "El índice está por debajo de 100 y representa una serie manual de referencia.";
  if (current.realExchangeRate > 105) rerText = "El índice supera 100 y representa una serie manual de referencia.";
  setText("rerInterpretation", rerText);

  const gauge = $("#gaugeValue");
  if (gauge) {
    const gaugeMax = 120;
    const gaugeProgress = Math.min(Math.max(current.realExchangeRate / gaugeMax, 0), 1);
    gauge.style.strokeDashoffset = String(267 * (1 - gaugeProgress));
  }

  updateCalculator();
}

function createSparkline(target, values, color = "#12b886", fill = "rgba(18,184,134,.14)") {
  if (!target) return;
  const cleanValues = values.filter(isValidNumber).map(Number);
  if (!cleanValues.length) {
    target.innerHTML = "";
    return;
  }

  const series = cleanValues.length === 1 ? [cleanValues[0], cleanValues[0]] : cleanValues;
  const width = 240;
  const height = 40;
  const pad = 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const points = series.map((value, index) => {
    const x = pad + (index / (series.length - 1)) * (width - pad * 2);
    const y = pad + ((max - value) / range) * (height - pad * 2);
    return [x, y];
  });
  const line = points.map((point) => point.join(",")).join(" ");
  const area = `0,${height} ${line} ${width},${height}`;
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${area}" fill="${fill}"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function periodData(period) {
  const market = DASHBOARD_DATA.market;
  const availableDays = market.dates.length;
  const daysToShow = Math.min(period, availableDays);
  return {
    dates: market.dates.slice(-daysToShow),
    usdt: market.usdt.slice(-daysToShow),
    tco: market.tco.slice(-daysToShow),
    reference: market.reference.slice(-daysToShow)
  };
}

function svgEl(name, attrs = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function drawEmptyChart(svg, message) {
  svg.innerHTML = "";
  const text = svgEl("text", {
    x: "450",
    y: "180",
    "text-anchor": "middle",
    fill: "var(--muted)",
    "font-size": "15"
  });
  text.textContent = message;
  svg.append(text);
}

function drawMainChart(period = selectedPeriod) {
  selectedPeriod = period;
  const svg = $("#mainChart");
  const tooltip = $("#chartTooltip");
  if (!svg || !tooltip) return;

  let data = periodData(period);
  if (!data.dates.length) {
    drawEmptyChart(svg, "El histórico aparecerá después de la primera actualización.");
    setText("periodCaption", "Sin histórico disponible");
    return;
  }

  if (data.dates.length === 1) {
    data = {
      dates: [data.dates[0], data.dates[0]],
      usdt: [data.usdt[0], data.usdt[0]],
      tco: [data.tco[0], data.tco[0]],
      reference: [data.reference[0], data.reference[0]]
    };
  }

  svg.innerHTML = "";
  const width = 900;
  const height = 360;
  const margin = { top: 18, right: 18, bottom: 42, left: 50 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const allValues = [...data.usdt, ...data.reference, ...data.tco].filter(isValidNumber).map(Number);
  if (!allValues.length) {
    drawEmptyChart(svg, "No existen valores válidos para este periodo.");
    return;
  }

  const minRaw = Math.min(...allValues);
  const maxRaw = Math.max(...allValues);
  const pad = Math.max((maxRaw - minRaw) * 0.18, 0.08);
  const min = minRaw - pad;
  const max = maxRaw + pad;
  const x = (index) => margin.left + (index / Math.max(data.dates.length - 1, 1)) * innerW;
  const y = (value) => margin.top + ((max - value) / (max - min)) * innerH;

  const defs = svgEl("defs");
  const gradient = svgEl("linearGradient", { id: "areaGrad", x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(svgEl("stop", { offset: "0%", "stop-color": "#12b886", "stop-opacity": ".20" }));
  gradient.append(svgEl("stop", { offset: "100%", "stop-color": "#12b886", "stop-opacity": "0" }));
  defs.append(gradient);
  svg.append(defs);

  for (let index = 0; index <= 5; index += 1) {
    const yy = margin.top + (innerH / 5) * index;
    svg.append(svgEl("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: yy,
      y2: yy,
      stroke: "var(--line)",
      "stroke-width": "1",
      "stroke-dasharray": "3 6"
    }));
    const value = max - ((max - min) / 5) * index;
    const label = svgEl("text", {
      x: margin.left - 10,
      y: yy + 4,
      "text-anchor": "end",
      fill: "var(--muted)",
      "font-size": "10"
    });
    label.textContent = fmt(value, 2);
    svg.append(label);
  }

  const tickCount = Math.min(6, data.dates.length);
  for (let index = 0; index < tickCount; index += 1) {
    const dataIndex = Math.round((index / Math.max(tickCount - 1, 1)) * (data.dates.length - 1));
    const label = svgEl("text", {
      x: x(dataIndex),
      y: height - 14,
      "text-anchor": index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle",
      fill: "var(--muted)",
      "font-size": "9"
    });
    label.textContent = data.dates[dataIndex];
    svg.append(label);
  }

  const points = (series) => series.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const areaPoints = `${x(0)},${margin.top + innerH} ${points(data.usdt)} ${x(data.usdt.length - 1)},${margin.top + innerH}`;
  svg.append(svgEl("polygon", { points: areaPoints, fill: "url(#areaGrad)" }));

  [
    { values: data.usdt, color: "#12b886", width: 3.1 },
    { values: data.reference, color: "#efaa28", width: 2.1, dash: "7 5" },
    { values: data.tco, color: "#377dff", width: 2.1, dash: "3 5" }
  ].forEach((series) => {
    svg.append(svgEl("polyline", {
      points: points(series.values),
      fill: "none",
      stroke: series.color,
      "stroke-width": series.width,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      ...(series.dash ? { "stroke-dasharray": series.dash } : {})
    }));
  });

  const hitGroup = svgEl("g");
  const step = innerW / Math.max(data.dates.length - 1, 1);
  data.dates.forEach((date, index) => {
    const hit = svgEl("rect", {
      x: x(index) - step / 2,
      y: margin.top,
      width: Math.max(step, 8),
      height: innerH,
      fill: "transparent",
      style: "cursor:crosshair"
    });
    hit.addEventListener("mouseenter", () => showChartTooltip(index, date, data, x, y, tooltip, svg));
    hit.addEventListener("mousemove", () => showChartTooltip(index, date, data, x, y, tooltip, svg));
    hit.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
      svg.querySelectorAll(".hover-marker").forEach((element) => element.remove());
    });
    hitGroup.append(hit);
  });
  svg.append(hitGroup);

  const visibleDays = Math.min(period, DASHBOARD_DATA.market.dates.length);
  setText("periodCaption", period === 365 ? `Últimos ${visibleDays} días` : `Últimos ${visibleDays} días`);
}

function showChartTooltip(index, date, data, x, y, tooltip, svg) {
  svg.querySelectorAll(".hover-marker").forEach((element) => element.remove());
  const vertical = svgEl("line", {
    class: "hover-marker",
    x1: x(index),
    x2: x(index),
    y1: 18,
    y2: 318,
    stroke: "var(--muted)",
    "stroke-width": "1",
    "stroke-dasharray": "3 5",
    opacity: ".55"
  });
  svg.insertBefore(vertical, svg.lastChild);

  [data.usdt[index], data.reference[index], data.tco[index]].forEach((value, seriesIndex) => {
    const colors = ["#12b886", "#efaa28", "#377dff"];
    svg.insertBefore(svgEl("circle", {
      class: "hover-marker",
      cx: x(index),
      cy: y(value),
      r: seriesIndex === 0 ? 4 : 3,
      fill: colors[seriesIndex],
      stroke: "var(--surface)",
      "stroke-width": "2"
    }), svg.lastChild);
  });

  tooltip.innerHTML = `<strong>${date}</strong><span>USDT/BOB <b>${fmt(data.usdt[index])}</b></span><span>Venta oficial <b>${fmt(data.reference[index])}</b></span><span>Compra oficial <b>${fmt(data.tco[index])}</b></span>`;
  tooltip.hidden = false;
  const svgRect = svg.getBoundingClientRect();
  const wrapRect = svg.parentElement.getBoundingClientRect();
  tooltip.style.left = `${((x(index) / 900) * svgRect.width) + (svgRect.left - wrapRect.left)}px`;
  tooltip.style.top = `${((y(data.usdt[index]) / 360) * svgRect.height) + (svgRect.top - wrapRect.top)}px`;
}

function drawReservesChart() {
  const target = $("#reservesChart");
  if (!target) return;
  const values = DASHBOARD_DATA.reserves.values;
  const labels = DASHBOARD_DATA.reserves.labels;
  const width = 520;
  const height = 150;
  const padX = 8;
  const padY = 12;
  const min = Math.min(...values) - 25;
  const max = Math.max(...values) + 25;
  const points = values.map((value, index) => [
    padX + (index / (values.length - 1)) * (width - padX * 2),
    padY + ((max - value) / (max - min)) * (height - padY * 2 - 20)
  ]);
  const line = points.map((point) => point.join(",")).join(" ");
  const area = `${points[0][0]},${height - 20} ${line} ${points.at(-1)[0]},${height - 20}`;
  const labelItems = labels.map((label, index) => (
    index % 2 === 0 || index === labels.length - 1
      ? `<text x="${points[index][0]}" y="${height - 3}" text-anchor="middle" fill="var(--muted)" font-size="8">${label}</text>`
      : ""
  )).join("");

  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Serie manual de reservas internacionales"><defs><linearGradient id="reserveGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#377dff" stop-opacity=".24"/><stop offset="100%" stop-color="#377dff" stop-opacity="0"/></linearGradient></defs><line x1="0" x2="${width}" y1="${height - 20}" y2="${height - 20}" stroke="var(--line)"/><polygon points="${area}" fill="url(#reserveGrad)"/><polyline points="${line}" fill="none" stroke="#377dff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>${labelItems}</svg>`;
}

function drawMonetaryBars() {
  const target = $("#monetaryChart");
  if (!target) return;
  const { labels, values } = DASHBOARD_DATA.monetaryBase;
  const min = Math.min(...values) - 2;
  const max = Math.max(...values);
  target.innerHTML = values.map((value, index) => `<div class="bar-item" title="${labels[index]}: ${fmt(value, 1)}"><i style="height:${Math.max(12, ((value - min) / (max - min)) * 125)}px"></i><span>${index % 2 === 0 || index === values.length - 1 ? labels[index] : ""}</span></div>`).join("");
}

function updateCalculator() {
  const amountInput = $("#amountInput");
  const fromCurrency = $("#fromCurrency");
  const rateSelect = $("#rateSelect");
  if (!amountInput || !fromCurrency || !rateSelect) return;

  const amount = Math.max(Number(amountInput.value) || 0, 0);
  const from = fromCurrency.value;
  const rateName = rateSelect.value;
  const rate = DASHBOARD_DATA.current[rateName];

  if (!isValidNumber(rate)) {
    setText("conversionResult", "No disponible");
    setText("conversionRate", "Esperando una cotización válida");
    return;
  }

  const result = from === "BOB" ? amount / rate : amount * rate;
  const targetCurrency = from === "BOB" ? "USD" : "BOB";
  setText("conversionResult", `${fmt(result, 2)} ${targetCurrency}`);
  setText("conversionRate", `1 USD = ${fmt(rate, 2)} BOB`);
}

function setupInteractions() {
  $$(".date-pills button").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".date-pills button").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      drawMainChart(Number(button.dataset.period));
    });
  });

  ["amountInput", "fromCurrency", "rateSelect"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.addEventListener("input", updateCalculator);
  });

  const swapButton = $("#swapButton");
  if (swapButton) {
    swapButton.addEventListener("click", () => {
      const currency = $("#fromCurrency");
      currency.value = currency.value === "BOB" ? "USD" : "BOB";
      updateCalculator();
    });
  }

  const savedTheme = localStorage.getItem("bolivia-fx-theme");
  if (savedTheme === "dark") document.body.classList.add("dark");

  const themeButton = $("#themeButton");
  if (themeButton) {
    themeButton.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      localStorage.setItem("bolivia-fx-theme", document.body.classList.contains("dark") ? "dark" : "light");
      drawMainChart(selectedPeriod);
    });
  }

  window.addEventListener("resize", () => {
    const tooltip = $("#chartTooltip");
    if (tooltip) tooltip.hidden = true;
  });
}

function renderDashboard() {
  initializeValues();
  createSparkline($("#miniUsdt"), DASHBOARD_DATA.market.usdt.slice(-14));
  drawMainChart(selectedPeriod);
  drawReservesChart();
  drawMonetaryBars();
}

async function refreshLiveDashboard() {
  await loadHistoricalData();
  await loadLiveRates();
  renderDashboard();
}

async function init() {
  setupInteractions();
  restoreCachedRates();
  renderDashboard();
  await refreshLiveDashboard();

  window.setInterval(async () => {
    await loadLiveRates();
    renderDashboard();
  }, REFRESH_INTERVAL);
}

document.addEventListener("DOMContentLoaded", init);
