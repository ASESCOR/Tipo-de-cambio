const API = {
  official: "https://bo.dolarapi.com/v1/dolares/oficial",
  binance: "https://bo.dolarapi.com/v1/dolares/binance",
  fx: "https://api.frankfurter.app/latest?from=USD&to=BRL,ARS,PEN,EUR,GBP,CNY,CLP"
};

const REFRESH_INTERVAL = 5 * 60 * 1000;
const CACHE_KEY = "bolivia-fx-live-v4";
const TIME_ZONE = "America/La_Paz";

const FX_FALLBACK = {
  BRL: 5.20,
  ARS: 1611.75,
  PEN: 3.43,
  EUR: 0.89,
  GBP: 0.77,
  CNY: 6.67,
  CLP: 969.40
};

const CURRENCIES = [
  { code: "BRL", name: "Real Brasileño", flag: "🇧🇷", decimals: 2 },
  { code: "ARS", name: "Peso Argentino", flag: "🇦🇷", decimals: 2 },
  { code: "PEN", name: "Sol Peruano", flag: "🇵🇪", decimals: 2 },
  { code: "EUR", name: "Euro", flag: "🇪🇺", decimals: 2 },
  { code: "GBP", name: "Libra Esterlina", flag: "🇬🇧", decimals: 2 },
  { code: "CNY", name: "Yuan Chino", flag: "🇨🇳", decimals: 2 },
  { code: "CLP", name: "Peso Chileno", flag: "🇨🇱", decimals: 2 }
];

const state = {
  p2pBuy: null,
  p2pSell: null,
  officialBuy: null,
  officialSell: null,
  updatedAt: null,
  history: [],
  period: 30,
  series: "both",
  exchanges: null,
  banks: null,
  fxRates: null,
  fxFallback: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function validNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function format(value, digits = 2) {
  const numeric = validNumber(value);

  if (!numeric) {
    return "—";
  }

  return new Intl.NumberFormat("es-BO", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(numeric);
}

function formatSmart(value) {
  const numeric = validNumber(value);

  if (!numeric) {
    return "—";
  }

  let digits = 2;

  if (numeric < 0.1) {
    digits = 4;
  } else if (numeric >= 100) {
    digits = 2;
  }

  return format(numeric, digits);
}

function formatDate(value, includeYear = false) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: TIME_ZONE
  })
    .format(date)
    .replaceAll(".", "");
}

function setText(id, value) {
  const element = document.getElementById(id);

  if (element) {
    element.textContent = value;
  }
}

function setConnection(message, error = false) {
  const chip = $("#liveChip");
  const note = $("#marketNote");

  setText(
    "liveText",
    error
      ? "Último dato disponible"
      : `Lectura verificada: ${formatDate(state.updatedAt)}`
  );

  if (chip) {
    chip.classList.toggle("error", error);
  }

  if (note) {
    note.textContent = message;
    note.classList.toggle("error", error);
  }
}

function saveCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        p2pBuy: state.p2pBuy,
        p2pSell: state.p2pSell,
        officialBuy: state.officialBuy,
        officialSell: state.officialSell,
        updatedAt: state.updatedAt
      })
    );
  } catch (_) {}
}

function restoreCache() {
  try {
    const cached = JSON.parse(
      localStorage.getItem(CACHE_KEY) || "null"
    );

    if (!cached) {
      return false;
    }

    if (
      ![
        cached.p2pBuy,
        cached.p2pSell,
        cached.officialBuy,
        cached.officialSell
      ].every(validNumber)
    ) {
      return false;
    }

    Object.assign(state, cached);

    return true;
  } catch (_) {
    return false;
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadLiveRates() {
  try {
    const [official, binance] = await Promise.all([
      fetchJson(API.official),
      fetchJson(API.binance)
    ]);

    const values = {
      p2pBuy: validNumber(binance.compra),
      p2pSell: validNumber(binance.venta),
      officialBuy: validNumber(official.compra),
      officialSell: validNumber(official.venta)
    };

    if (!Object.values(values).every(Boolean)) {
      throw new Error("Cotización incompleta");
    }

    Object.assign(state, values);

    const dates = [
      official.fechaActualizacion,
      binance.fechaActualizacion
    ]
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()));

    state.updatedAt = dates.length
      ? new Date(
          Math.max(...dates.map((date) => date.getTime()))
        ).toISOString()
      : new Date().toISOString();

    saveCache();

    renderLive();
    renderBanks();
    renderCurrencies();

    setConnection(
      `Cotizaciones actuales consultadas · ${formatDate(
        state.updatedAt
      )}`
    );
  } catch (error) {
    console.warn(
      "No se pudieron consultar las cotizaciones actuales:",
      error
    );

    const restored = restoreCache();

    if (restored) {
      renderLive();
      renderBanks();
      renderCurrencies();

      setConnection(
        `No se pudo actualizar ahora. Mostrando el último dato guardado · ${formatDate(
          state.updatedAt
        )}`,
        true
      );
    } else {
      setConnection(
        "No se pudo consultar la fuente en este momento.",
        true
      );
    }
  }
}

async function loadHistory() {
  try {
    const raw = await fetchJson(
      `./data/history.json?v=${Date.now()}`
    );

    if (!Array.isArray(raw)) {
      throw new Error("Histórico inválido");
    }

    state.history = raw
      .filter(
        (item) =>
          item &&
          item.date &&
          validNumber(item.usdt) &&
          validNumber(item.reference)
      )
      .map((item) => ({
        date: String(item.date),
        label: item.label || String(item.date),
        p2p: Number(item.usdt),
        official: Number(item.reference)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    renderHistory();
  } catch (error) {
    console.warn(
      "No se pudo cargar el histórico:",
      error
    );

    state.history = [];

    renderHistory();
  }
}

async function loadManualData() {
  const [
    exchangeResult,
    bankResult
  ] = await Promise.allSettled([
    fetchJson(
      `./data/exchanges.json?v=${Date.now()}`
    ),
    fetchJson(
      `./data/banks.json?v=${Date.now()}`
    )
  ]);

  if (exchangeResult.status === "fulfilled") {
    state.exchanges = exchangeResult.value;
  }

  if (bankResult.status === "fulfilled") {
    state.banks = bankResult.value;
  }

  renderExchanges();
  renderBanks();
}

async function loadFxRates() {
  try {
    const data = await fetchJson(API.fx);
    const rates = data?.rates || {};

    const complete = CURRENCIES.every(
      (currency) =>
        validNumber(rates[currency.code])
    );

    if (!complete) {
      throw new Error(
        "Respuesta de divisas incompleta"
      );
    }

    state.fxRates = rates;
    state.fxFallback = false;
  } catch (error) {
    console.warn(
      "No se pudieron cargar las divisas internacionales; se usa respaldo:",
      error
    );

    state.fxRates = {
      ...FX_FALLBACK
    };

    state.fxFallback = true;
  }

  renderCurrencies();
}

function renderLive() {
  setText(
    "p2pBuy",
    format(state.p2pBuy)
  );

  setText(
    "p2pSell",
    format(state.p2pSell)
  );

  setText(
    "officialBuy",
    format(state.officialBuy)
  );

  setText(
    "officialSell",
    format(state.officialSell)
  );

  setText(
    "lastUpdated",
    formatDate(state.updatedAt, true)
  );

  const average =
    state.p2pBuy && state.p2pSell
      ? (state.p2pBuy + state.p2pSell) / 2
      : null;

  const gap =
    state.p2pSell && state.officialSell
      ? (state.p2pSell / state.officialSell - 1) *
        100
      : null;

  const spread =
    state.p2pBuy && state.p2pSell
      ? Math.abs(
          state.p2pBuy - state.p2pSell
        )
      : null;

  setText(
    "p2pAverage",
    format(average)
  );

  setText(
    "gapPct",
    gap === null
      ? "—"
      : `${gap >= 0 ? "+" : ""}${format(
          gap
        )}%`
  );

  setText(
    "gapText",
    gap === null
      ? "vs. venta oficial"
      : `${
          gap >= 0
            ? "Por encima"
            : "Por debajo"
        } de la venta oficial`
  );

  setText(
    "p2pSpread",
    spread === null
      ? "Spread: —"
      : `Spread: Bs ${format(spread)}`
  );

  updateConverter();
  updateChartSummary();
}

function renderExchanges() {
  const featured = $("#featuredExchanges");
  const other = $("#otherExchanges");

  if (!featured || !other) {
    return;
  }

  const data = state.exchanges;

  if (!data) {
    featured.innerHTML = `
      <p class="section-note">
        No se pudo cargar data/exchanges.json.
      </p>
    `;

    other.innerHTML = "";

    return;
  }

  setText(
    "exchangesUpdated",
    `Lectura manual: ${formatDate(
      data.updatedAt
    )}`
  );

  if (data.note) {
    setText(
      "exchangeNote",
      data.note
    );
  }

  featured.innerHTML = (
    data.featured || []
  )
    .map(
      (item) => `
        <article
          class="exchange-card"
          style="
            --brand:${item.brand};
            --brand-ink:${item.ink || "#fff"};
          "
        >
          <div class="exchange-head">

            <span class="exchange-mark">
              ${item.short}
            </span>

            <div class="exchange-name">
              <strong>
                ${item.name}
              </strong>

              <small>
                ${item.domain}
              </small>
            </div>

            <span class="exchange-manual">
              MANUAL
            </span>

          </div>

          <div class="exchange-average">

            <span>
              ↗ Cotización promedio
            </span>

            <strong>
              Bs ${format(item.average)}
            </strong>

            <small>
              BOB por USDT
            </small>

          </div>

          <div class="exchange-two-values">

            <div class="exchange-value buy">

              <span>
                Compra
              </span>

              <strong>
                Bs ${format(item.buy)}
              </strong>

            </div>

            <div class="exchange-value sell">

              <span>
                Venta
              </span>

              <strong>
                Bs ${format(item.sell)}
              </strong>

            </div>

          </div>

          <a
            class="exchange-link"
            href="${item.url}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sitio oficial
          </a>

        </article>
      `
    )
    .join("");

  other.innerHTML = (
    data.other || []
  )
    .map(
      (item) => `
        <article
          class="exchange-mini"
          style="
            --brand:${item.brand};
            --brand-ink:${item.ink || "#fff"};
          "
        >

          <div class="exchange-mini-head">

            <span class="exchange-mini-mark">
              ${item.short}
            </span>

            <div>

              <strong>
                ${item.name}
              </strong>

              <small>
                ${item.domain}
              </small>

            </div>

          </div>

          <div class="exchange-mini-row buy">

            <span>
              Compra
            </span>

            <strong>
              Bs ${format(item.buy)}
            </strong>

          </div>

          <div class="exchange-mini-row sell">

            <span>
              Venta
            </span>

            <strong>
              Bs ${format(item.sell)}
            </strong>

          </div>

        </article>
      `
    )
    .join("");
}

function renderBanks() {
  const container = $("#bankRows");

  if (!container) {
    return;
  }

  const data = state.banks;

  if (!data?.banks?.length) {
    container.innerHTML = `
      <p class="section-note">
        No se pudo cargar data/banks.json.
      </p>
    `;

    return;
  }

  const base =
    validNumber(state.officialSell) ||
    Math.min(
      ...data.banks.map(
        (bank) => Number(bank.rate)
      )
    );

  setText(
    "bankOfficial",
    base
      ? `Bs ${format(base)}`
      : "—"
  );

  setText(
    "banksUpdated",
    `Leído ${formatDate(data.updatedAt)}`
  );

  if (data.note) {
    setText(
      "bankNote",
      data.note
    );
  }

  const groups = new Map();

  data.banks.forEach((bank) => {
    const key = Number(
      bank.rate
    ).toFixed(2);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups
      .get(key)
      .push(bank);
  });

  const rows = [
    ...groups.entries()
  ].sort(
    (a, b) =>
      Number(a[0]) - Number(b[0])
  );

  const maxRate = Math.max(
    ...rows.map(
      ([rate]) => Number(rate)
    )
  );

  const minRate = Math.min(
    ...rows.map(
      ([rate]) => Number(rate)
    )
  );

  const range = Math.max(
    maxRate - minRate,
    0.01
  );

  container.innerHTML = rows
    .map(([rateString, banks]) => {
      const rate = Number(
        rateString
      );

      const diff = base
        ? rate - base
        : 0;

      const progress =
        25 +
        ((rate - minRate) / range) *
          75;

      const className =
        diff <= 0.01
          ? "low"
          : diff >= 0.2
          ? "high"
          : "mid";

      const diffClass =
        diff <= 0.01
          ? "zero"
          : diff >= 0.2
          ? "high"
          : "";

      const badges = banks
        .map(
          (bank) => `
            <span
              class="bank-badge"
              title="${bank.name}"
              style="
                --brand:${bank.brand};
                --brand-ink:${
                  bank.ink || "#fff"
                };
              "
            >
              ${bank.short}
            </span>
          `
        )
        .join("");

      return `
        <div
          class="bank-row ${className}"
        >

          <div class="bank-rate">

            <strong>
              ${format(rate)}
            </strong>

            <span
              class="bank-diff ${diffClass}"
            >
              ${
                diff >= 0
                  ? "+"
                  : ""
              }${format(diff)}
            </span>

          </div>

          <div>

            <div class="bank-track">
              <div
                class="bank-bar"
                style="
                  width:${progress.toFixed(
                    1
                  )}%
                "
              ></div>
            </div>

            <div class="bank-badges">
              ${badges}
            </div>

          </div>

        </div>
      `;
    })
    .join("");
}

function renderCurrencies() {
  const body = $("#currencyTableBody");

  if (!body) {
    return;
  }

  const rates = state.fxRates;

  if (!rates) {
    return;
  }

  const p2pReference =
    validNumber(state.p2pSell) ||
    validNumber(state.officialSell);

  body.innerHTML = CURRENCIES
    .map((currency) => {
      const usdToCurrency =
        validNumber(
          rates[currency.code]
        );

      const unitInBob =
        usdToCurrency &&
        p2pReference
          ? p2pReference /
            usdToCurrency
          : null;

      return `
        <tr>

          <td>

            <div class="currency-name">

              <span class="flag">
                ${currency.flag}
              </span>

              <span>
                ${currency.name}
              </span>

            </div>

          </td>

          <td>

            <span class="currency-usd-pill">
              ${formatSmart(
                usdToCurrency
              )} ${currency.code}
            </span>

          </td>

          <td>

            <span class="currency-bob-pill">
              Bs ${formatSmart(
                unitInBob
              )}
            </span>

          </td>

        </tr>
      `;
    })
    .join("");

  setText(
    "fxStatus",
    state.fxFallback
      ? "Valores de respaldo"
      : "Mercado internacional actualizado"
  );
}

function getRate() {
  const key =
    $("#rateSelect")?.value ||
    "p2pSell";

  return validNumber(
    state[key]
  );
}

function updateConverter() {
  const amount = Number(
    $("#amountInput")?.value || 0
  );

  const from =
    $("#fromCurrency")?.value ||
    "USD";

  const rate = getRate();

  const output =
    $("#resultInput");

  setText(
    "toCurrency",
    from === "USD"
      ? "BOB"
      : "USD"
  );

  if (
    !rate ||
    !Number.isFinite(amount) ||
    amount < 0
  ) {
    if (output) {
      output.value = "—";
    }

    setText(
      "conversionRate",
      "—"
    );

    return;
  }

  const result =
    from === "USD"
      ? amount * rate
      : amount / rate;

  if (output) {
    output.value =
      new Intl.NumberFormat(
        "es-BO",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }
      ).format(result);
  }

  setText(
    "conversionRate",
    `1 USD = Bs ${format(rate)}`
  );
}

function swapConversion() {
  const select =
    $("#fromCurrency");

  if (!select) {
    return;
  }

  select.value =
    select.value === "USD"
      ? "BOB"
      : "USD";

  updateConverter();
}

function selectedHistory() {
  if (state.period === "max") {
    return state.history;
  }

  const count = Number(
    state.period
  );

  if (count <= 1) {
    return state.history.slice(-1);
  }

  return state.history.slice(
    -count
  );
}

function updateChartSummary() {
  const average =
    state.p2pBuy &&
    state.p2pSell
      ? (state.p2pBuy +
          state.p2pSell) /
        2
      : null;

  const p2p =
    average ||
    state.history.at(-1)?.p2p ||
    null;

  const official =
    state.officialSell ||
    state.history.at(-1)
      ?.official ||
    null;

  const gap =
    p2p && official
      ? (p2p / official - 1) *
        100
      : null;

  const selected =
    selectedHistory();

  const first =
    selected[0]?.p2p ||
    null;

  const last =
    selected.at(-1)?.p2p ||
    p2p;

  const change =
    first && last
      ? (last / first - 1) *
        100
      : 0;

  setText(
    "chartP2p",
    p2p
      ? `Bs ${format(p2p)}`
      : "—"
  );

  setText(
    "chartOfficial",
    official
      ? `Bs ${format(official)}`
      : "—"
  );

  setText(
    "chartGap",
    gap === null
      ? "—"
      : `${
          gap >= 0
            ? "+"
            : ""
        }${format(gap)}%`
  );

  setText(
    "chartChange",
    `${
      change >= 0
        ? "+"
        : ""
    }${format(
      Math.abs(change)
    )}%`.replace(
      "+-",
      "-"
    )
  );
}

function svgElement(
  name,
  attrs = {}
) {
  const el =
    document.createElementNS(
      "http://www.w3.org/2000/svg",
      name
    );

  Object.entries(
    attrs
  ).forEach(
    ([key, value]) =>
      el.setAttribute(
        key,
        value
      )
  );

  return el;
}

function renderChart() {
  const svg =
    $("#historyChart");

  const tooltip =
    $("#chartTooltip");

  if (!svg) {
    return;
  }

  svg.innerHTML = "";

  const data =
    selectedHistory();

  if (!data.length) {
    const text =
      svgElement(
        "text",
        {
          x: 600,
          y: 180,
          "text-anchor":
            "middle",
          fill: "#8b98ab",
          "font-size": 14
        }
      );

    text.textContent =
      "El histórico se irá formando con las actualizaciones diarias";

    svg.appendChild(text);

    return;
  }

  const W = 1200;
  const H = 360;

  const pad = {
    left: 62,
    right: 50,
    top: 22,
    bottom: 42
  };

  const keys =
    state.series === "p2p"
      ? ["p2p"]
      : state.series ===
        "official"
      ? ["official"]
      : [
          "p2p",
          "official"
        ];

  const all = data
    .flatMap((d) =>
      keys.map(
        (key) => d[key]
      )
    )
    .filter(validNumber);

  let min = Math.min(...all);
  let max = Math.max(...all);

  const span = Math.max(
    max - min,
    0.1
  );

  min -= span * 0.15;
  max += span * 0.15;

  const x = (i) =>
    pad.left +
    (data.length === 1
      ? (W -
          pad.left -
          pad.right) /
        2
      : (i /
          (data.length -
            1)) *
        (W -
          pad.left -
          pad.right));

  const y = (v) =>
    pad.top +
    ((max - v) /
      (max - min)) *
      (H -
        pad.top -
        pad.bottom);

  for (
    let i = 0;
    i < 6;
    i++
  ) {
    const yy =
      pad.top +
      (i / 5) *
        (H -
          pad.top -
          pad.bottom);

    svg.appendChild(
      svgElement(
        "line",
        {
          x1: pad.left,
          y1: yy,
          x2:
            W -
            pad.right,
          y2: yy,
          stroke:
            "#dfe6f0",
          "stroke-width": 1
        }
      )
    );

    const value =
      max -
      (i / 5) *
        (max - min);

    const label =
      svgElement(
        "text",
        {
          x: W - 6,
          y: yy + 4,
          fill:
            "#718198",
          "font-size": 10,
          "text-anchor":
            "end"
        }
      );

    label.textContent =
      format(value);

    svg.appendChild(
      label
    );
  }

  const verticalCount =
    Math.min(
      12,
      Math.max(
        2,
        data.length
      )
    );

  for (
    let i = 0;
    i <
    verticalCount;
    i++
  ) {
    const index =
      Math.round(
        (i /
          (verticalCount -
            1)) *
          (data.length -
            1)
      );

    const xx =
      x(index);

    svg.appendChild(
      svgElement(
        "line",
        {
          x1: xx,
          y1: pad.top,
          x2: xx,
          y2:
            H -
            pad.bottom,
          stroke:
            "#edf1f6",
          "stroke-width": 1
        }
      )
    );
  }

  const makePath = (
    key
  ) =>
    data
      .map(
        (d, i) =>
          `${
            i === 0
              ? "M"
              : "L"
          } ${x(i)} ${y(
            d[key]
          )}`
      )
      .join(" ");

  if (
    keys.includes(
      "p2p"
    )
  ) {
    svg.appendChild(
      svgElement(
        "path",
        {
          d: makePath(
            "p2p"
          ),
          fill: "none",
          stroke:
            "#2563eb",
          "stroke-width": 3,
          "stroke-linecap":
            "round",
          "stroke-linejoin":
            "round"
        }
      )
    );
  }

  if (
    keys.includes(
      "official"
    )
  ) {
    svg.appendChild(
      svgElement(
        "path",
        {
          d: makePath(
            "official"
          ),
          fill: "none",
          stroke:
            "#0b9f4a",
          "stroke-width": 2.3,
          "stroke-linecap":
            "round",
          "stroke-linejoin":
            "round"
        }
      )
    );
  }

  const labelCount =
    Math.min(
      8,
      data.length
    );

  const used =
    new Set();

  for (
    let i = 0;
    i < labelCount;
    i++
  ) {
    const index =
      labelCount === 1
        ? 0
        : Math.round(
            (i /
              (labelCount -
                1)) *
              (data.length -
                1)
          );

    if (
      used.has(index)
    ) {
      continue;
    }

    used.add(index);

    const label =
      svgElement(
        "text",
        {
          x: x(index),
          y: H - 12,
          fill:
            "#718198",
          "font-size": 10,
          "text-anchor":
            index === 0
              ? "start"
              : index ===
                data.length -
                  1
              ? "end"
              : "middle"
        }
      );

    label.textContent =
      data[index].label;

    svg.appendChild(
      label
    );
  }

  data.forEach(
    (d, i) => {
      const hit =
        svgElement(
          "rect",
          {
            x:
              Math.max(
                pad.left,
                x(i) -
                  13
              ),
            y: pad.top,
            width: 26,
            height:
              H -
              pad.top -
              pad.bottom,
            fill:
              "transparent"
          }
        );

      hit.style.cursor =
        "crosshair";

      hit.addEventListener(
        "mouseenter",
        () =>
          showTooltip(
            d,
            x(i),
            Math.min(
              y(d.p2p),
              y(
                d.official
              )
            ),
            tooltip
          )
      );

      hit.addEventListener(
        "mousemove",
        () =>
          showTooltip(
            d,
            x(i),
            Math.min(
              y(d.p2p),
              y(
                d.official
              )
            ),
            tooltip
          )
      );

      hit.addEventListener(
        "mouseleave",
        () => {
          if (tooltip) {
            tooltip.hidden =
              true;
          }
        }
      );

      svg.appendChild(
        hit
      );
    }
  );
}

function showTooltip(
  d,
  x,
  y,
  tooltip
) {
  if (!tooltip) {
    return;
  }

  const gap =
    (d.p2p /
      d.official -
      1) *
    100;

  tooltip.innerHTML = `
    <strong>
      ${d.label}
    </strong>

    <span>
      P2P
      <b>
        Bs ${format(d.p2p)}
      </b>
    </span>

    <span>
      Oficial
      <b>
        Bs ${format(d.official)}
      </b>
    </span>

    <span>
      Brecha
      <b>
        ${
          gap >= 0
            ? "+"
            : ""
        }${format(gap)}%
      </b>
    </span>
  `;

  tooltip.style.left =
    `${(x / 1200) * 100}%`;

  tooltip.style.top =
    `${(y / 360) * 100}%`;

  tooltip.hidden = false;
}

function renderTable() {
  const body =
    $("#historyTableBody");

  if (!body) {
    return;
  }

  const rows =
    selectedHistory()
      .slice()
      .reverse();

  if (!rows.length) {
    body.innerHTML = `
      <tr>
        <td colspan="4">
          El histórico se irá completando con las actualizaciones diarias.
        </td>
      </tr>
    `;

    return;
  }

  body.innerHTML = rows
    .map((d) => {
      const gap =
        (d.p2p /
          d.official -
          1) *
        100;

      return `
        <tr>
          <td>
            ${d.label}
          </td>

          <td>
            Bs ${format(d.p2p)}
          </td>

          <td>
            Bs ${format(d.official)}
          </td>

          <td>
            ${
              gap >= 0
                ? "+"
                : ""
            }${format(gap)}%
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderHistory() {
  const chartPanel =
    $("#chartPanel");

  const tablePanel =
    $("#historyTablePanel");

  const legend =
    $("#chartLegend");

  const p2pLegend =
    $(".legend-p2p-row");

  const officialLegend =
    $(".legend-official-row");

  const tableMode =
    state.series === "table";

  if (chartPanel) {
    chartPanel.hidden =
      tableMode;
  }

  if (legend) {
    legend.hidden =
      tableMode;
  }

  if (tablePanel) {
    tablePanel.hidden =
      !tableMode;
  }

  if (p2pLegend) {
    p2pLegend.hidden =
      state.series ===
      "official";
  }

  if (officialLegend) {
    officialLegend.hidden =
      state.series ===
      "p2p";
  }

  renderChart();
  renderTable();
  updateChartSummary();

  const selected =
    selectedHistory();

  const label =
    state.period === "max"
      ? "Todo el histórico disponible"
      : state.period === 1
      ? "Última lectura diaria disponible"
      : `Últimos ${state.period} días · 1 punto por día`;

  setText(
    "rangeCaption",
    label
  );

  if (
    selected.length >= 2
  ) {
    const first =
      selected[0];

    const last =
      selected.at(-1);

    const startGap =
      (first.p2p /
        first.official -
        1) *
      100;

    const endGap =
      (last.p2p /
        last.official -
        1) *
      100;

    setText(
      "trendSummary",
      `La brecha pasó de ${format(
        startGap
      )}% a ${format(
        endGap
      )}% en el rango seleccionado. Lecturas guardadas diariamente por GitHub Actions.`
    );
  } else {
    setText(
      "trendSummary",
      "El histórico se completa con las lecturas diarias guardadas por GitHub Actions."
    );
  }
}

function setupEvents() {
  $("#amountInput")?.addEventListener(
    "input",
    updateConverter
  );

  $("#fromCurrency")?.addEventListener(
    "change",
    updateConverter
  );

  $("#rateSelect")?.addEventListener(
    "change",
    updateConverter
  );

  $("#swapButton")?.addEventListener(
    "click",
    swapConversion
  );

  $$("[data-quick]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          const input =
            $("#amountInput");

          if (!input) {
            return;
          }

          input.value =
            button.dataset.quick;

          updateConverter();
        }
      );
    }
  );

  $$("[data-period]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          state.period =
            button.dataset.period ===
            "max"
              ? "max"
              : Number(
                  button.dataset.period
                );

          $$(
            "[data-period]"
          ).forEach(
            (item) =>
              item.classList.toggle(
                "active",
                item ===
                  button
              )
          );

          renderHistory();
        }
      );
    }
  );

  $$("[data-series]").forEach(
    (button) => {
      button.addEventListener(
        "click",
        () => {
          state.series =
            button.dataset.series;

          $$(
            "[data-series]"
          ).forEach(
            (item) =>
              item.classList.toggle(
                "active",
                item ===
                  button
              )
          );

          renderHistory();
        }
      );
    }
  );
}

async function init() {
  setupEvents();

  restoreCache();

  if (state.p2pBuy) {
    renderLive();
  }

  await Promise.allSettled([
    loadHistory(),
    loadLiveRates(),
    loadManualData(),
    loadFxRates()
  ]);

  setInterval(
    loadLiveRates,
    REFRESH_INTERVAL
  );
}

document.addEventListener(
  "DOMContentLoaded",
  init
);
