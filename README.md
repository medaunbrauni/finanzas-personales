# Finanzas Personales

App de una página (sin build) para analizar gastos, planear presupuesto mensual y simular el pago de tarjetas.
Los datos viven en un Google Sheet del usuario; este repo no contiene datos.

- `index.html` / `app.js`: UI. Lee y escribe el Sheet con la API de Google Sheets (OAuth, scope `drive.file`: solo ve el Sheet que la app crea).
- `deuda.js`: simulador avalancha / bola de nieve. Prueba: `node deuda.test.mjs`.

## Pestañas del Sheet
| Pestaña | Columnas |
|---|---|
| Movimientos | id, fecha, mes, cuenta, descripcion, monto (− gasto / + ingreso), nivel1, nivel2, nivel3, ambito, msi, nota |
| Presupuesto | nivel1, nivel2, monto |
| Proyeccion | mes, ingreso_base, ingreso_extra, pago_deuda, nota |
| Deudas | nombre, saldo, tasa, minimo, nota |

"Importar CSV" detecta la pestaña por los encabezados. Movimientos se agregan (los `id` repetidos se ignoran); las demás pestañas se reemplazan.

## Google Cloud (una vez)
Usa el mismo proyecto/Client ID que Bonos AFIRME:
1. APIs y servicios → Biblioteca → habilitar **Google Sheets API**.
2. Credenciales → el Client ID web → orígenes autorizados: `https://medaunbrauni.github.io` (y `http://localhost:8765` para pruebas).
3. Pantalla de consentimiento en modo Testing con tu cuenta como usuario de prueba.
