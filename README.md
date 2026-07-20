# Monitor Cambiario de Bolivia

Página web estática con cotizaciones actuales del dólar oficial y Binance P2P, histórico diario y publicación automática en GitHub Pages.

## Estructura

```text
.
├── .github/
│   └── workflows/
│       └── update-exchange-rates.yml
├── assets/
│   └── favicon.svg
├── data/
│   └── history.json
├── scripts/
│   └── update-data.mjs
├── app.js
├── index.html
├── styles.css
└── README.md
```

## Qué se actualiza automáticamente

- `USDT / BOB`: promedio entre compra y venta de Binance P2P entregadas por DolarApi.
- `TCO`: compra oficial entregada por DolarApi con fuente BCB.
- `Venta oficial`: venta oficial entregada por DolarApi con fuente BCB.
- `Brecha cambiaria`: cálculo automático entre USDT/BOB y venta oficial.
- `data/history.json`: un registro diario, conservando hasta 365 días.

Las reservas internacionales, el tipo de cambio real y la base monetaria permanecen como series manuales de ejemplo dentro de `app.js`.

## Subir a GitHub

1. Entra a la carpeta del proyecto.
2. Selecciona todo su contenido, incluyendo la carpeta oculta `.github`.
3. Sube los archivos directamente a la raíz del repositorio.
4. En GitHub debe verse `index.html` directamente en la página principal del repositorio.

> En Windows, activa **Ver → Mostrar → Elementos ocultos** para poder ver y subir la carpeta `.github`.

## Activar GitHub Pages

1. Abre el repositorio.
2. Entra a **Settings → Pages**.
3. En **Build and deployment**, selecciona **GitHub Actions**.
4. Regresa a la pestaña **Actions**.
5. Abre **Actualizar y publicar monitor cambiario**.
6. Presiona **Run workflow** y luego **Run workflow** nuevamente.
7. Espera el check verde.

El flujo también se ejecutará:

- al subir cambios a la rama `main`;
- todos los días a las 23:47, hora de Bolivia;
- manualmente desde la pestaña Actions.

## Permisos necesarios

En **Settings → Actions → General → Workflow permissions**, selecciona:

```text
Read and write permissions
```

Después presiona **Save**.

## Probar en la computadora

No abras `index.html` con doble clic. Ejecuta un servidor local desde la carpeta:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

## Fuentes de datos

- Dólar oficial: `https://bo.dolarapi.com/v1/dolares/oficial`
- Binance P2P: `https://bo.dolarapi.com/v1/dolares/binance`

La información es únicamente referencial y no reemplaza una cotización bancaria, financiera u oficial.
