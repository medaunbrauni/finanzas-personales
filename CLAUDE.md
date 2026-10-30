# Finanzas Personales — notas para Claude

App de una página sin build: `index.html` + `app.js` + `deuda.js`. Publicada en GitHub Pages desde `main /`
(https://medaunbrauni.github.io/finanzas-personales/). Publicar = commit + push; Pages tarda ~1 min.

**El repo es público: nunca subir datos, montos, RFCs, nombres ni reglas de categorización personales.**

## Arquitectura
- Datos en un Google Sheet que la propia app crea (OAuth GIS token client, scope `drive.file`, Client ID del proyecto
  "Bonos AFIRME" de Google Cloud, tipo Interno). Pestañas en `TABS` (app.js); qué hace cada columna está en README.md.
  `cargar()` agrega pestañas y encabezados faltantes a bases viejas, así que se pueden agregar pestañas sin migración.
- Reglas (texto → categoría al importar) ganan sobre lo aprendido por `nivel3`; Repartos mandan un % de un comercio a
  otra categoría solo en los análisis; `#único` en la nota saca un movimiento de los promedios.
- Montos: negativo = gasto, positivo = ingreso. `nivel1` Ingreso/Transferencia no cuentan como gasto (pagos a tarjeta,
  bonos vía intermediario, reparto a terceros).
- Promedios usan `mesesCompletos(n)`: excluye el primer y el último mes (cortes de tarjeta incompletos).
- `deuda.js`: simulador avalancha/bola de nieve; interés = saldo × tasa/360 × 30 × 1.16. Prueba: `node deuda.test.mjs`.

## Importar CSV (botón en Movimientos)
- Encabezado igual a una pestaña → Movimientos se agregan (ids repetidos se ignoran; lo categorizado a mano gana por
  `nivel3`); Presupuesto se agrega/actualiza por `nivel2` (lo que no viene se queda); otras pestañas se reemplazan.
- Encabezado `id` + subconjunto de `nivel1,nivel2,nivel3,ambito,nota` → actualiza movimientos existentes
  (la nota se agrega, no se pisa). Así se mandan correcciones y marcas "Revisar: …".

## Parser (privado, fuera del repo)
`G:\Mi unidad\Finanzas\procesar.py CLAVE1 CLAVE2 …` → `G:\Mi unidad\Finanzas\importar\movimientos_<fecha>.csv`.
Cada PDF se valida contra el resumen del propio estado de cuenta; todo debe decir OK. Las claves de los PDF cambian
cada mes y no se guardan en archivo. Ahí viven las reglas de categorización con datos personales.

Amazon (también privado, en `G:\Mi unidad\Finanzas\amazon\`), con la exportación "Your Orders" de Amazon:
- `amazon_xlsx.py <carpeta Your Orders> <salida.xlsx>` → matriz de pedidos categorizados (físicos + digitales,
  reembolsos prorrateados).
- `amazon_cruce.py <movimientos.csv> <salida.xlsx> <cambios.csv>` → cruza los cargos AMAZON del banco con los pedidos
  y genera un CSV de cambios (`id,nivel1,nivel2,nota`) para importar; compras ≥ $5,000 van a "Compras únicas" con `#único`.
- Correr scripts sobre descargas con `python -I`.

## Probar sin Google
Copiar la app a una carpeta del scratchpad, inyectar antes de `app.js` un `<script>` que ponga token/sheet en storage y
reemplace `window.fetch` con datos del CSV, servir con `python -m http.server 8765 --bind 127.0.0.1` y tomar captura con
Edge headless (`--headless=new --disable-sync --disable-extensions --virtual-time-budget=10000 --screenshot=…`).
Apagar el servidor al terminar.

## Gotchas
- Escribir regex con `\b` vía heredoc + Python no-raw mete un carácter backspace (`\x08`); usar la herramienta Edit.
- `[hidden]` necesita `display:none !important` porque `nav`/`.fila` usan `display:flex`.
- Inputs de dinero: clase `moneda` (texto con formato; `aNumero()` para leer, `fmtIn()` para mostrar).
