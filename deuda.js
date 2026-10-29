// Simulador de pago de tarjetas. Interés mensual = saldo × tasa/360 × 30 × 1.16 (IVA), como lo calculan Banorte y AMEX.
export const interesMensual = (saldo, tasaAnual) => saldo * tasaAnual / 100 / 360 * 30 * 1.16;

// deudas: [{nombre, saldo, tasa, minimo}]; pagoDelMes(i) → dinero total para tarjetas en el mes i
// estrategia: 'avalancha' (tasa más alta primero) | 'bola' (saldo más chico primero)
export function simular(deudas, pagoDelMes, estrategia = 'avalancha', maxMeses = 240) {
  const d = deudas.map(x => ({ ...x, saldo: +x.saldo, liquidada: null }));
  const meses = [];
  let interesTotal = 0, faltante = false;
  for (let i = 0; i < maxMeses && d.some(x => x.saldo > 0.005); i++) {
    for (const x of d) if (x.saldo > 0) { const int = interesMensual(x.saldo, x.tasa); x.saldo += int; interesTotal += int; }
    let dinero = Math.max(0, pagoDelMes(i));
    const vivos = d.filter(x => x.saldo > 0);
    if (vivos.reduce((s, x) => s + Math.min(x.minimo, x.saldo), 0) > dinero + 0.005) faltante = true;
    for (const x of vivos) { const p = Math.min(x.minimo, x.saldo, dinero); x.saldo -= p; dinero -= p; }
    const orden = d.filter(x => x.saldo > 0).sort(estrategia === 'bola' ? (a, b) => a.saldo - b.saldo : (a, b) => b.tasa - a.tasa);
    for (const x of orden) { const p = Math.min(x.saldo, dinero); x.saldo -= p; dinero -= p; }
    for (const x of d) if (x.saldo <= 0.005 && x.liquidada === null) { x.saldo = 0; x.liquidada = i; }
    meses.push({ saldos: d.map(x => x.saldo), total: d.reduce((s, x) => s + x.saldo, 0) });
  }
  const libre = d.every(x => x.liquidada !== null);
  return { meses, interesTotal, faltante, libre, liquidadas: d.map(x => ({ nombre: x.nombre, mes: x.liquidada })) };
}
