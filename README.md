# Finanzas Personales

App de una página (sin build) para analizar gastos, planear presupuesto mensual y simular el pago de tarjetas.
Los datos viven en un Google Sheet del usuario; este repo no contiene datos.

- `index.html` / `app.js`: UI. Lee y escribe el Sheet con la API de Google Sheets (OAuth, scope `drive.file`: solo ve el Sheet que la app crea).
- `deuda.js`: simulador avalancha / bola de nieve. Prueba: `node deuda.test.mjs`.

## Pestañas del Sheet
| Pestaña | Columnas |
|---|---|
| Movimientos | id, fecha, mes, cuenta, descripcion, monto (− gasto / + ingreso), nivel1, nivel2, nivel3, ambito, msi, nota |
| Presupuesto | nivel1, nivel2, monto, fijo (1 = no se ajusta con el ingreso; vacío = fijo si nivel1 es "Fijos") |
| Proyeccion | mes, ingreso_base, ingreso_extra, pago_deuda, nota |
| Deudas | nombre, saldo, tasa, minimo, nota, saldo_inicial (para medir el avance de la meta) |
| Sugerencias | nivel3, nivel1, nivel2, ambito, motivo, confianza (sugerencia IA por comercio; el usuario la acepta con ✓) |
| Reglas | contiene, nivel1, nivel2, ambito (si la descripción contiene el texto → esa categoría al importar; ganan sobre lo aprendido) |
| Repartos | comercio, categoria, destino, porcentaje, nota (manda un % de un comercio a otra categoría; solo afecta los análisis) |

Renglones con nivel1 `Ingreso` son los ingresos que planeas al mes: con ellos, "¿Cuánto me puedo gastar?" respeta fijos y pago a deudas y reparte el resto en proporción.
Presupuesto acepta el renglón `Deuda, Pago a deudas, <monto>`: es el pago mensual a tarjetas que usa el Plan cuando un mes no tiene pago capturado.
Un movimiento con `#único` en la nota (muebles, anticipos…) no entra a los promedios.

"Importar CSV" detecta la pestaña por los encabezados. Movimientos se agregan (los `id` repetidos se ignoran); Presupuesto se agrega o actualiza por categoría (nivel2); las demás pestañas se reemplazan.

## Google Cloud (una vez)
Usa el mismo proyecto/Client ID que Bonos AFIRME:
1. APIs y servicios → Biblioteca → habilitar **Google Sheets API**.
2. Credenciales → el Client ID web → orígenes autorizados: `https://medaunbrauni.github.io` (y `http://localhost:8765` para pruebas).
3. Pantalla de consentimiento en modo Testing con tu cuenta como usuario de prueba.
