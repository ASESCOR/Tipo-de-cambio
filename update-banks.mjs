import fs from "node:fs/promises";

const SOURCE_URL =
  "https://www.dolarbluebolivia.click/bancos/";

const OUTPUT_FILE =
  "data/banks.json";

const BANKS = [
  {
    name: "Banco FIE",
    short: "FIE",
    brand: "#df1683",
    ink: "#ffffff"
  },
  {
    name: "Banco Fortaleza",
    short: "FOR",
    brand: "#f59e0b",
    ink: "#ffffff"
  },
  {
    name: "Banco Unión",
    short: "UNI",
    brand: "#005aa9",
    ink: "#ffffff"
  },
  {
    name: "BancoSol",
    short: "SOL",
    brand: "#6f2da8",
    ink: "#ffffff"
  },
  {
    name: "Banco Bisa",
    short: "BISA",
    brand: "#f2c500",
    ink: "#222222"
  },
  {
    name: "BCP",
    short: "BCP",
    brand: "#0055b8",
    ink: "#ffffff"
  },
  {
    name: "BNB",
    short: "BNB",
    brand: "#149b49",
    ink: "#ffffff"
  },
  {
    name: "Banco Económico",
    short: "ECO",
    brand: "#ef3340",
    ink: "#ffffff"
  },
  {
    name: "Banco Ganadero",
    short: "GAN",
    brand: "#3f7f2f",
    ink: "#ffffff"
  },
  {
    name: "Mercantil Santa Cruz",
    short: "BMSC",
    brand: "#6b8e23",
    ink: "#ffffff"
  }
];

function htmlToText(html) {
  return html
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/gi,
      " "
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/gi,
      " "
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value)
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const number = Number(normalized);

  return Number.isFinite(number)
    ? number
    : null;
}

function extractNumbers(text) {
  return (
    text.match(
      /\d{1,3}(?:[.,]\d{2})/g
    ) || []
  ).map(parseNumber);
}

function extractSourceReadTime(text) {
  const match = text.match(
    /Leído\s+(\d{1,2}\/\d{1,2}),\s*(\d{1,2}:\d{2})/i
  );

  if (!match) {
    return null;
  }

  return `${match[1]}, ${match[2]}`;
}

async function fetchPage() {
  const response = await fetch(
    SOURCE_URL,
    {
      headers: {
        "User-Agent":
          "Bolivia-FX-Dashboard/1.0",
        Accept: "text/html"
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      `La fuente respondió HTTP ${response.status}`
    );
  }

  return response.text();
}

function extractBankSection(text) {
  const startText =
    "Lo que publica cada banco";

  const endText =
    "Lo que los bancos pagaron de verdad";

  const start =
    text.indexOf(startText);

  const end =
    text.indexOf(endText);

  if (
    start === -1 ||
    end === -1 ||
    end <= start
  ) {
    throw new Error(
      "No se encontró la tabla de bancos en la fuente."
    );
  }

  return text.slice(
    start,
    end
  );
}

function parseBanks(section) {
  const found = BANKS.map(
    (bank) => ({
      ...bank,
      position:
        section.indexOf(
          bank.name
        )
    })
  )
    .filter(
      (bank) =>
        bank.position >= 0
    )
    .sort(
      (a, b) =>
        a.position -
        b.position
    );

  const results = [];

  for (
    let i = 0;
    i < found.length;
    i++
  ) {
    const bank =
      found[i];

    const next =
      found[i + 1];

    const segment =
      section.slice(
        bank.position,
        next
          ? next.position
          : section.length
      );

    const numbers =
      extractNumbers(segment);

    /*
      La tabla de la fuente tiene:

      Venta
      Diferencia vs oficial
      Compra

      El primer valor es la venta.
      El tercero es la compra cuando
      el banco la publica.
    */

    const sell =
      numbers.length >= 1
        ? numbers[0]
        : null;

    const difference =
      numbers.length >= 2
        ? numbers[1]
        : null;

    const buy =
      numbers.length >= 3
        ? numbers[2]
        : null;

    if (!sell) {
      continue;
    }

    results.push({
      name: bank.name,
      short: bank.short,
      rate: sell,
      buy,
      difference,
      brand: bank.brand,
      ink: bank.ink
    });
  }

  return results;
}

async function readPreviousData() {
  try {
    const content =
      await fs.readFile(
        OUTPUT_FILE,
        "utf8"
      );

    return JSON.parse(
      content
    );
  } catch {
    return null;
  }
}

async function main() {
  console.log(
    "Consultando cotizaciones bancarias..."
  );

  try {
    const html =
      await fetchPage();

    const text =
      htmlToText(html);

    const section =
      extractBankSection(
        text
      );

    const banks =
      parseBanks(section);

    /*
      Evitamos reemplazar el archivo
      con información incompleta si
      la estructura de la página cambia.
    */
    if (banks.length < 8) {
      throw new Error(
        `Solo se pudieron leer ${banks.length} bancos. Se conserva el archivo anterior.`
      );
    }

    const sourceReadAt =
      extractSourceReadTime(
        text
      );

    const output = {
      updatedAt:
        new Date().toISOString(),

      sourceReadAt,

      source:
        SOURCE_URL,

      automatic: true,

      note:
        "Precios publicados por cada banco y obtenidos automáticamente de Dólar Blue Bolivia. El valor en ventanilla o aplicación puede ser distinto.",

      banks
    };

    await fs.mkdir(
      "data",
      {
        recursive: true
      }
    );

    await fs.writeFile(
      OUTPUT_FILE,
      JSON.stringify(
        output,
        null,
        2
      ),
      "utf8"
    );

    console.log(
      `Actualización correcta: ${banks.length} bancos.`
    );

    console.table(
      banks.map(
        (bank) => ({
          Banco:
            bank.name,
          Venta:
            bank.rate,
          Compra:
            bank.buy
        })
      )
    );
  } catch (error) {
    console.error(
      "No se pudo actualizar bancos:",
      error.message
    );

    const previous =
      await readPreviousData();

    /*
      Si ya existe un archivo válido,
      no lo borramos.
    */
    if (
      previous?.banks?.length
    ) {
      console.log(
        "Se conserva la última lectura válida."
      );

      process.exit(0);
    }

    /*
      Solo fallamos el workflow si
      nunca hubo datos anteriores.
    */
    process.exit(1);
  }
}

main();
