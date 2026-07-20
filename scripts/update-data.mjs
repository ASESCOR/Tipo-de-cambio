import fs from "node:fs/promises";

const OFFICIAL_API = "https://bo.dolarapi.com/v1/dolares/oficial";
const BINANCE_API = "https://bo.dolarapi.com/v1/dolares/binance";
const HISTORY_FILE = "data/history.json";
const TIME_ZONE = "America/La_Paz";
const MAX_HISTORY_DAYS = 365;

function numberOrFail(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Valor inválido en ${fieldName}`);
  }
  return number;
}

function getBoliviaDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function createLabel(date) {
  return new Intl.DateTimeFormat("es-BO", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(`${date}T12:00:00Z`)).replace(".", "");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Bolivia-FX-Dashboard/2.0"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} consultando ${url}`);
  }

  return response.json();
}

async function readHistory() {
  try {
    const content = await fs.readFile(HISTORY_FILE, "utf8");
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("El histórico anterior no pudo leerse; se creará uno nuevo.", error.message);
    }
    return [];
  }
}

function normalizeHistory(history) {
  return history
    .filter((item) => item && item.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-MAX_HISTORY_DAYS);
}

async function main() {
  const [official, binance] = await Promise.all([
    fetchJson(OFFICIAL_API),
    fetchJson(BINANCE_API)
  ]);

  const officialBuy = numberOrFail(official.compra, "compra oficial");
  const officialSale = numberOrFail(official.venta, "venta oficial");
  const binanceBuy = numberOrFail(binance.compra, "compra Binance");
  const binanceSale = numberOrFail(binance.venta, "venta Binance");
  const date = getBoliviaDate();

  const newPoint = {
    date,
    label: createLabel(date),
    usdt: Number(((binanceBuy + binanceSale) / 2).toFixed(4)),
    tco: officialBuy,
    reference: officialSale,
    officialUpdatedAt: official.fechaActualizacion || null,
    binanceUpdatedAt: binance.fechaActualizacion || null,
    updatedAt: new Date().toISOString()
  };

  const history = await readHistory();
  const existingIndex = history.findIndex((item) => item.date === date);
  if (existingIndex >= 0) history[existingIndex] = newPoint;
  else history.push(newPoint);

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(
    HISTORY_FILE,
    `${JSON.stringify(normalizeHistory(history), null, 2)}\n`,
    "utf8"
  );

  console.log("Dato diario guardado:", newPoint);
}

main().catch((error) => {
  console.error("No se pudo actualizar el histórico:", error);
  process.exit(1);
});
