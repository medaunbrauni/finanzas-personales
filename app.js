import { simular, interesMensual } from './deuda.js';

const CLIENT_ID = '542473129173-6nmrt78rbotcqf2sl7qfjbrk6empbief.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file'; // solo ve los archivos que esta app crea
const TABS = {
  Movimientos: ['id', 'fecha', 'mes', 'cuenta', 'descripcion', 'monto', 'nivel1', 'nivel2', 'nivel3', 'ambito', 'msi', 'nota'],
  Presupuesto: ['nivel1', 'nivel2', 'monto', 'fijo'],
  Proyeccion: ['mes', 'ingreso_base', 'ingreso_extra', 'pago_deuda', 'nota'],
  Deudas: ['nombre', 'saldo', 'tasa', 'minimo', 'nota', 'saldo_inicial'],
  Sugerencias: ['nivel3', 'nivel1', 'nivel2', 'ambito', 'motivo', 'confianza'],
  Repartos: ['comercio', 'categoria', 'destino', 'porcentaje', 'nota'],
  Reglas: ['contiene', 'nivel1', 'nivel2', 'ambito'],
};
const NO_GASTO = ['Ingreso', 'Transferencia'];
const SERIES_N1 = ['Fijos', 'Variables', 'Deuda', 'Negocio'];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = n => (+n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const nombreMes = m => new Date(m + '-15').toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const store = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v); } catch { return null; } };
const estado = t => $('#estado').textContent = t;

let token = null, sheetId = store('finanzas:sheet'), D = { Movimientos: [], Presupuesto: [], Proyeccion: [], Deudas: [], Sugerencias: [], Repartos: [], Reglas: [] };
const charts = {};

// ---------- Google ----------
try { const t = JSON.parse(sessionStorage.getItem('finanzas:token')); if (t && t.exp > Date.now()) token = t.v; } catch {}

function login() {
  return new Promise((ok, fail) => {
    google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: r => {
        if (r.error) return fail(new Error(r.error));
        token = r.access_token;
        try { sessionStorage.setItem('finanzas:token', JSON.stringify({ v: token, exp: Date.now() + (r.expires_in - 60) * 1000 })); } catch {}
        ok();
      },
    }).requestAccessToken({ prompt: '' });
  });
}

async function api(path, opts = {}) {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (r.status === 401) { await login(); return api(path, opts); }
  if (!r.ok) throw new Error((await r.json()).error?.message || r.statusText);
  return r.json();
}
const rango = r => encodeURIComponent(r);
const escribe = (r, values) => api(`/${sheetId}/values/${rango(r)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values }) });

async function crearBase() {
  estado('Creando base…');
  const s = await api('', { method: 'POST', body: JSON.stringify({
    properties: { title: 'Finanzas Personales', locale: 'es_MX' },
    sheets: Object.keys(TABS).map(title => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
  }) });
  sheetId = s.spreadsheetId;
  store('finanzas:sheet', sheetId);
  await api(`/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({
    valueInputOption: 'RAW', data: Object.entries(TABS).map(([t, h]) => ({ range: `${t}!A1`, values: [h] })),
  }) });
  await cargar();
}

async function cargar() {
  estado('Cargando…');
  const q = Object.keys(TABS).map(t => 'ranges=' + t).join('&');
  let r;
  try {
    // bases creadas con una versión anterior: agrega las pestañas que falten
    const meta = await api(`/${sheetId}?fields=sheets.properties.title`);
    const faltan = Object.keys(TABS).filter(t => !meta.sheets.some(s => s.properties.title === t));
    if (faltan.length) {
      await api(`/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({
        requests: faltan.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }) });
      await api(`/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({
        valueInputOption: 'RAW', data: faltan.map(t => ({ range: `${t}!A1`, values: [TABS[t]] })) }) });
    }
    r = await api(`/${sheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`);
  } catch (e) {
    // id malo o Sheet ajeno: olvidarlo para no fallar en cada recarga
    sheetId = null; store('finanzas:sheet', '');
    $('#elegir').hidden = false; $('#btnLogin').hidden = true;
    throw new Error('No pude abrir esa base. Usa "Crear base nueva" (o pega el link de un Google Sheet creado por esta app). Detalle: ' + e.message);
  }
  store('finanzas:sheet', sheetId);
  Object.keys(TABS).forEach((t, i) => {
    const [h = TABS[t], ...filas] = r.valueRanges[i].values || [];
    D[t] = filas.map((f, j) => Object.fromEntries([...h.map((k, c) => [k, f[c] ?? '']), ['_row', j + 2]]));
  });
  D.Movimientos.forEach(m => m.monto = +m.monto);
  SUG = Object.fromEntries(D.Sugerencias.map(s => [s.nivel3, s]));
  $('#login').hidden = true;
  $('#tabs').hidden = false;
  estado(`${D.Movimientos.length} movimientos`);
  pintarTodo();
}

async function reescribir(t, filas) {
  await api(`/${sheetId}/values/${rango(t)}:clear`, { method: 'POST' });
  await escribe(`${t}!A1`, [TABS[t], ...filas.map(f => TABS[t].map(k => f[k] ?? ''))]);
}

// ---------- Datos derivados ----------
// Repartos: parte de un comercio que en realidad es otra categoría (p. ej. 15% de Amazon es Ocio).
// Solo cambia los análisis (Resumen, Presupuesto, Plan); los movimientos del Sheet quedan igual.
const reglaDe = m => D.Repartos.find(r => r.comercio && r.destino && +r.porcentaje > 0 && (!r.categoria || r.categoria === m.nivel2) &&
  normaliza(`${m.nivel3} ${m.descripcion}`).includes(normaliza(r.comercio)));
const nivel1De = n2 => (D.Movimientos.find(m => m.nivel2 === n2) || D.Presupuesto.find(p => p.nivel2 === n2))?.nivel1 || 'Variables';
let AN = null; // caché; se limpia al guardar movimientos o repartos
const analisis = () => AN ||= D.Movimientos.flatMap(m => {
  const r = NO_GASTO.includes(m.nivel1) ? null : reglaDe(m);
  if (!r) return [m];
  const p = Math.min(100, +r.porcentaje) / 100;
  // bruto: monto de la compra completa (para "compras chicas"); parte: la porción repartida, no cuenta como otra compra
  return [{ ...m, monto: m.monto * (1 - p), bruto: m.monto },
    { ...m, id: m.id + ':r', nivel1: nivel1De(r.destino), nivel2: r.destino, monto: m.monto * p, bruto: m.monto, parte: true }];
});
// gastos únicos (muebles, anticipos…): se marcan con #único en la nota y no entran a promedios
const UNICO = '#único';
const esUnico = m => /#[uú]nico/i.test(m.nota || '');

const gastos = () => analisis().filter(m => !NO_GASTO.includes(m.nivel1));
const meses = () => [...new Set(D.Movimientos.map(m => m.mes))].sort();
const suma = (arr, f = m => m.monto) => arr.reduce((s, m) => s + f(m), 0);
// el primer y el último mes vienen incompletos (los cortes de tarjeta no coinciden con el mes) → no entran a promedios
const mesesCompletos = n => meses().slice(1, -1).slice(-n);
const mesesPres = () => +(store('finanzas:mesesPres') || 3);
function promedioMensual(filtro, n) {
  const ms = mesesCompletos(n);
  return ms.length ? suma(analisis().filter(m => ms.includes(m.mes) && !esUnico(m) && filtro(m))) / ms.length : 0;
}
const ingresoPromedio = () => promedioMensual(m => m.nivel1 === 'Ingreso' && m.nivel2 !== 'Extraordinario', 6);

// ---------- Resumen ----------
function pintarResumen() {
  // promedio mensual: últimos N meses completos, todo dividido entre N
  const prom = $('#fProm').checked, msProm = prom ? mesesCompletos(+$('#fPromN').value) : [];
  $('#fPeriodo').disabled = prom;
  const per = prom ? '' : $('#fPeriodo').value, amb = $('#fAmbito').value, cta = $('#fCuenta').value;
  const enCuenta = m => !cta || (cta.endsWith('*') ? m.cuenta.startsWith(cta.slice(0, -1)) : m.cuenta === cta);
  const div = prom ? msProm.length || 1 : 1;
  // "sin deuda": quita intereses y comisiones para ver el costo de tu nivel de vida
  const sinDeuda = $('#fSinDeuda').checked;
  const esGasto = m => !NO_GASTO.includes(m.nivel1) && !(sinDeuda && m.nivel1 === 'Deuda');
  const enFiltro = m => (prom ? msProm.includes(m.mes) : !per || m.mes === per) && (!amb || m.ambito === amb) && enCuenta(m);
  // en promedios no entran los gastos únicos; en un periodo sí, y se avisa cuánto suman
  const M = analisis().filter(m => enFiltro(m) && !(prom && esUnico(m)));
  const G = M.filter(esGasto);
  const ing = suma(M.filter(m => m.nivel1 === 'Ingreso')) / div;
  const extra = suma(M.filter(m => m.nivel2 === 'Extraordinario')) / div;
  const gas = -suma(G) / div, intereses = -suma(M.filter(m => m.nivel1 === 'Deuda')) / div;
  const unicos = -suma(G.filter(esUnico)), unicosProm = prom ? -suma(analisis().filter(m => enFiltro(m) && esUnico(m) && esGasto(m))) : 0;
  const nMeses = per ? 1 : meses().length;
  const falta = gas - (ing - extra);
  $('#promInfo').textContent = prom && msProm.length ? `Promedio mensual de ${msProm.length} meses: ${nombreMes(msProm[0])} – ${nombreMes(msProm.at(-1))}` : '';
  $('#kpis').innerHTML = [
    ['Ingresos' + (prom ? ' al mes' : ''), fmt(ing), extra ? `incluye ${fmt(extra)} extraordinario` : ''],
    ['Gastos' + (sinDeuda ? ' sin deuda' : '') + (prom ? ' al mes' : ''), fmt(gas),
      unicos ? `incluye ${fmt(unicos)} de gastos únicos` : unicosProm ? `sin ${fmt(unicosProm / div)} al mes de gastos únicos` : per || prom ? '' : `${fmt(gas / nMeses)} al mes`],
    sinDeuda
      ? ['Ingreso necesario sin deuda', fmt(gas), `${falta > 0 ? 'te faltan' : 'te sobran'} ${fmt(Math.abs(falta))} sin contar extraordinarios`]
      : ['Intereses y comisiones', fmt(intereses), `${Math.round(intereses / (gas || 1) * 100)}% de tus gastos`],
    ['Balance' + (sinDeuda ? ' sin deuda' : ''), `<span class="${ing - gas < 0 ? 'neg' : 'pos'}">${fmt(ing - gas)}</span>`, sinDeuda ? `la deuda te cuesta ${fmt(intereses)} en intereses` : ''],
  ].map(([t, v, s], i) => `<div class="kpi ${['k-ing', 'k-gas', sinDeuda ? 'k-gas' : 'k-int', 'k-bal'][i]}"><small>${t}</small><b>${v}</b><small>${s}</small></div>`).join('');
  $('#vacio').hidden = D.Movimientos.length > 0;
  pintarSemaforo(); pintarMeta(); pintarComparar();
  pintarRecorte(amb, enCuenta);

  // gasto por mes, apilado por nivel 1
  const ms = meses();
  const GA = gastos().filter(m => esGasto(m) && (!amb || m.ambito === amb) && enCuenta(m));
  const n1 = m => SERIES_N1.includes(m.nivel1) ? m.nivel1 : 'Otros';
  const series = [...SERIES_N1, 'Otros'].filter(s => GA.some(m => n1(m) === s));
  grafica('gMeses', {
    type: 'bar',
    data: { labels: ms.map(nombreMes), datasets: series.map(s => ({
      label: s, data: ms.map(mes => -suma(GA.filter(m => m.mes === mes && n1(m) === s))),
      backgroundColor: css(`--series-${SERIES_N1.indexOf(s) + 1}`) || css('--text-muted'),
      borderColor: css('--surface-1'), borderWidth: { top: 2 },
    })) },
    options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: fmt } } },
      interaction: { mode: 'index', intersect: false } },
  });

  // por categoría nivel 2
  const porCat = agrupa(G, m => m.nivel2).sort((a, b) => a[1] - b[1]);
  $('#gCatWrap').style.height = Math.max(200, porCat.length * 28 + 40) + 'px';
  grafica('gCat', {
    type: 'bar',
    data: { labels: porCat.map(c => c[0]), datasets: [{ label: 'Gasto', data: porCat.map(c => -c[1] / div), backgroundColor: porCat.map(c => colorDe(c[0])), borderRadius: 4, borderSkipped: 'start' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: fmt } }, y: { grid: { display: false } } },
      onClick: (_, els) => { if (els[0]) { catDet = porCat[els[0].index][0]; pintarResumen(); $('#detalle').scrollIntoView({ behavior: 'smooth' }); } },
      onHover: (e, els) => e.native.target.style.cursor = els[0] ? 'pointer' : 'default' },
  });
  pintarDetalle(G, div, porCat.map(c => c[0]));

  const top = Object.values(G.reduce((acc, m) => {
    const a = acc[destino(m)] ||= { n3: destino(m), n2: m.nivel2, veces: 0, total: 0 };
    a.veces += m.parte ? 0 : 1; a.total -= m.monto; return acc;
  }, {})).sort((a, b) => b.total - a.total).slice(0, 15);
  $('#tTop').innerHTML = `<tr><th>Comercio / destino</th><th>Categoría</th><th class="n">Veces${prom ? ' al mes' : ''}</th><th class="n">${prom ? 'Al mes' : 'Total'}</th></tr>` +
    top.map(t => `<tr><td>${esc(t.n3)}</td><td>${esc(t.n2)}</td><td class="n">${+(t.veces / div).toFixed(1)}</td><td class="n">${fmt(t.total / div)}</td></tr>`).join('');
}

// ---------- Colores por categoría ----------
// la misma categoría lleva el mismo color en todas las gráficas (asignado por gasto total, de mayor a menor)
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#9b59d0', '#e0457b', '#14a3b8', '#8a9a2e', '#c0622f', '#5b6cd9', '#d4a72c', '#3fb6a8', '#b5487a', '#6f8fd0', '#c97b4a', '#7cae4f'];
let COLOR = {};
const coloresCategoria = () => { COLOR = Object.fromEntries(agrupa(gastos(), m => m.nivel2).sort((a, b) => a[1] - b[1]).map(([c], i) => [c, PALETA[i % PALETA.length]])); };
const colorDe = c => COLOR[c] || css('--text-muted');
const punto = c => `<span class="dot" style="background:${colorDe(c)}"></span>`;

// ---------- Semáforo del mes ----------
function pintarSemaforo() {
  const mes = (!$('#fProm').checked && $('#fPeriodo').value) || meses().at(-1);
  const cats = D.Presupuesto.filter(p => !['Deuda', 'Ingreso'].includes(p.nivel1) && +p.monto > 0);
  const caja = $('#semaforo');
  caja.hidden = !mes;
  if (!mes) return;
  if (!cats.length) return caja.innerHTML = '<h2>¿Cómo voy este mes?</h2><p class="muted">Captura tu presupuesto en 🎯 Presupuesto para ver aquí cómo vas contra él.</p>';
  const hoy = new Date(), [y, mm] = mes.split('-').map(Number), dias = new Date(y, mm, 0).getDate();
  const enCurso = hoy.getFullYear() === y && hoy.getMonth() + 1 === mm, avance = enCurso ? hoy.getDate() / dias : 1;
  const G = analisis().filter(m => m.mes === mes && !NO_GASTO.includes(m.nivel1) && m.nivel1 !== 'Deuda');
  const filas = cats.map(p => { const g = -suma(G.filter(m => m.nivel2 === p.nivel2)); return { cat: p.nivel2, pres: +p.monto, g, pct: g / p.monto }; })
    .sort((a, b) => b.pct - a.pct);
  // verde: a ritmo del mes; ámbar: más rápido que los días que van; rojo: ya se pasó
  const color = f => f.pct > 1 ? 'rojo' : f.pct > avance ? 'ambar' : 'verde';
  const tp = suma(filas, f => f.pres), tg = suma(filas, f => f.g);
  caja.innerHTML = `<h2>${nombreMes(mes)}: ¿cómo voy contra el presupuesto?</h2>
    <p class="muted">${enCurso ? `Van ${hoy.getDate()} de ${dias} días. ` : ''}Llevas <b>${fmt(tg)}</b> de ${fmt(tp)}: ${tg > tp ? `<span class="neg">te pasaste ${fmt(tg - tp)}</span>` : `te quedan <b class="pos">${fmt(tp - tg)}</b>`}.
    Verde = vas a ritmo · ámbar = vas más rápido que el mes · rojo = ya te pasaste. Lo de tarjetas llega con el corte, así que lo más reciente puede faltar.</p>
    <div class="sem">${filas.map(f => `<div class="c"><span>${punto(f.cat)}${esc(f.cat)}</span><span class="${f.pct > 1 ? 'neg' : ''}">${fmt(f.g)} <span class="muted">/ ${fmt(f.pres)}</span></span>
      <div class="pista"><div class="${color(f)}" style="width:${Math.min(100, f.pct * 100)}%"></div></div></div>`).join('')}</div>`;
}

// ---------- Meta de deuda ----------
function pintarMeta() {
  const { deudas, E } = estrategias(), total = suma(deudas, d => d.saldo);
  $('#metaDeuda').hidden = !total;
  if (!total) return;
  const inicial = Math.max(total, suma(D.Deudas, d => +d.saldo_inicial || +d.saldo || 0)), pagado = inicial - total;
  $('#metaDeuda').innerHTML = `<div><small class="muted">Meta: cero deudas · debes</small><br><b class="grande">${fmt(total)}</b>
      <span class="muted"> de ${fmt(inicial)} · llevas pagado ${fmt(pagado)} (${Math.round(pagado / inicial * 100)}%)</span></div>
    <div style="text-align:right"><small class="muted">Libre de deudas (avalancha)</small><br><b class="grande">${fechaLibre(E[0][1])}</b><br>
      <small class="neg">${fmt(suma(deudas, d => interesMensual(d.saldo, d.tasa)))} de intereses al mes</small></div>
    <div class="pista"><div style="width:${pagado / inicial * 100}%"></div></div>`;
}

// ---------- Comparar meses ----------
function pintarComparar() {
  const ms = meses().slice().reverse();
  for (const s of ['#cmpA', '#cmpB']) { const v = $(s).value; $(s).innerHTML = ms.map(m => `<option value="${m}">${nombreMes(m)}</option>`).join(''); if (v) $(s).value = v; }
  const comp = mesesCompletos(2);
  if (!$('#cmpA').dataset.listo && comp.length === 2) { $('#cmpA').value = comp[1]; $('#cmpB').value = comp[0]; $('#cmpA').dataset.listo = 1; }
  const a = $('#cmpA').value, b = $('#cmpB').value, G = gastos();
  const tot = mes => Object.fromEntries(agrupa(G.filter(m => m.mes === mes), m => m.nivel2).map(([k, v]) => [k, -v]));
  const A = tot(a), B = tot(b);
  const filas = [...new Set([...Object.keys(A), ...Object.keys(B)])].map(c => ({ c, a: A[c] || 0, b: B[c] || 0 }))
    .map(f => ({ ...f, d: f.a - f.b })).filter(f => Math.abs(f.d) >= 50).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const max = Math.max(1, ...filas.map(f => Math.abs(f.d)));
  const ta = suma(Object.values(A), x => x), tb = suma(Object.values(B), x => x);
  $('#cmpInfo').innerHTML = `Total ${fmt(ta)} contra ${fmt(tb)}: <span class="${ta > tb ? 'neg' : 'pos'}">${ta > tb ? '+' : ''}${fmt(ta - tb)}</span>`;
  $('#tCmp').innerHTML = `<tr><th>Categoría</th><th class="n">${nombreMes(a)}</th><th class="n">${nombreMes(b)}</th><th class="n">Diferencia</th><th style="width:30%"></th></tr>` +
    filas.map(f => `<tr><td class="ancho">${punto(f.c)}${esc(f.c)}</td><td class="n" data-l="${nombreMes(a)}">${fmt(f.a)}</td><td class="n muted" data-l="${nombreMes(b)}">${fmt(f.b)}</td>
      <td class="n ${f.d > 0 ? 'neg' : 'pos'}" data-l="Diferencia">${f.d > 0 ? '+' : ''}${fmt(f.d)}</td>
      <td class="ancho"><div class="barra" style="width:${Math.abs(f.d) / max * 100}%;background:var(${f.d > 0 ? '--critical' : '--good'})"></div></td></tr>`).join('');
}

// ---------- Dónde recortar ----------
// variables de los últimos 3 meses completos vs. los 3 anteriores, con compras chicas y presupuesto
function pintarRecorte(amb, enCuenta) {
  const ms = mesesCompletos(6), rec = ms.slice(-3), ant = ms.slice(0, -3);
  const V = analisis().filter(m => m.nivel1 === 'Variables' && m.monto < 0 && !esUnico(m) && (!amb || m.ambito === amb) && enCuenta(m));
  const prom = (cat, lista) => lista.length ? -suma(V.filter(m => m.nivel2 === cat && lista.includes(m.mes))) / lista.length : 0;
  const filas = [...new Set(V.filter(m => rec.includes(m.mes)).map(m => m.nivel2))].map(cat => ({
    cat, ahora: prom(cat, rec), antes: prom(cat, ant), pres: presDe(cat),
    chicas: V.filter(m => m.nivel2 === cat && rec.includes(m.mes) && (m.bruto ?? m.monto) > -300).length / (rec.length || 1),
  })).filter(f => f.ahora >= 100).sort((a, b) => b.ahora - a.ahora);
  const tend = f => {
    if (!f.antes) return '<span class="muted">nuevo</span>';
    const p = Math.round((f.ahora / f.antes - 1) * 100);
    return `<span class="${p > 5 ? 'neg' : p < -5 ? 'pos' : 'muted'}">${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p)}%</span>`;
  };
  $('#tRecorte').innerHTML = rec.length < 3 ? '<tr><td class="muted">Hacen falta al menos 3 meses completos.</td></tr>' :
    `<tr><th>Categoría</th><th class="n">Al mes ahora</th><th class="n">Antes</th><th class="n">Tendencia</th><th class="n">Compras chicas al mes</th><th class="n">Presupuesto</th><th class="n">Si recortas 20%</th></tr>` +
    filas.map(f => `<tr data-cat="${esc(f.cat)}"><td class="ancho">${punto(f.cat)}<b>${esc(f.cat)}</b></td><td class="n" data-l="Al mes ahora">${fmt(f.ahora)}</td><td class="n muted" data-l="Antes">${f.antes ? fmt(f.antes) : '—'}</td>
      <td class="n" data-l="Tendencia">${tend(f)}</td><td class="n" data-l="Compras chicas al mes">${f.chicas >= 1 ? Math.round(f.chicas) : '—'}</td>
      <td class="n ${f.pres && f.ahora > f.pres ? 'neg' : ''}" data-l="Presupuesto">${f.pres ? fmt(f.pres) : '—'}</td><td class="n pos" data-l="Si recortas 20%">${fmt(f.ahora * 0.2)}</td></tr>`).join('') +
    `<tr class="sub"><th>Total variables</th><th class="n">${fmt(suma(filas, f => f.ahora))}</th><th class="n">${fmt(suma(filas, f => f.antes))}</th><th></th><th></th><th></th><th class="n">${fmt(suma(filas, f => f.ahora) * 0.2)}</th></tr>`;
}

// ---------- Desglose de una categoría ----------
let catDet = null;
// agrupa por destino: sin folios/fechas y juntando lo que se pagó vía Lega/Integrex
const destino = m => /vía intermediario/.test(m.nota) ? 'Vía Lega / Integrex' : (m.nivel3 || '').replace(/\$[\d,]+(\.\d\d)?( MXN)?|\b\d{4,}\b/g, '').replace(/ de tu cuenta.*$/i, '').replace(/\s+/g, ' ').trim() || '(sin nombre)';

function pintarDetalle(G, div, cats) {
  if (!cats.includes(catDet)) catDet = cats[0];
  $('#fCatDet').innerHTML = cats.map(c => `<option${c === catDet ? ' selected' : ''}>${esc(c)}</option>`).join('');
  const X = G.filter(m => m.nivel2 === catDet);
  const total = -suma(X) / div;
  const grupos = Object.values(X.reduce((a, m) => {
    const k = destino(m), g = a[k] ||= { k, veces: 0, total: 0, ej: m.descripcion };
    g.veces++; g.total -= m.monto / div; return a;
  }, {})).sort((a, b) => b.total - a.total);
  const TOP = 10, top = grupos.slice(0, TOP), resto = grupos.slice(TOP);
  const barras = resto.length ? [...top, { k: `Otros (${resto.length})`, total: suma(resto, g => g.total) }] : top;
  $('#detTotal').textContent = `${fmt(total)}${div > 1 ? ' al mes' : ''} · ${X.length} movimientos`;
  $('#gDetWrap').style.height = Math.max(160, barras.length * 30 + 40) + 'px';
  grafica('gDet', {
    type: 'bar',
    data: { labels: barras.map(g => g.k.length > 45 ? g.k.slice(0, 44) + '…' : g.k), datasets: [{ label: catDet, data: barras.map(g => g.total), backgroundColor: colorDe(catDet), borderRadius: 4, borderSkipped: 'start' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmt(c.parsed.x)} · ${Math.round(c.parsed.x / (total || 1) * 100)}%` } } },
      scales: { x: { ticks: { callback: fmt } }, y: { grid: { display: false } } } },
  });
  $('#tDet').innerHTML = `<tr><th>Destino / comercio</th><th class="n">Veces${div > 1 ? ' al mes' : ''}</th><th class="n">${div > 1 ? 'Al mes' : 'Total'}</th><th class="n">%</th><th>Ejemplo del estado de cuenta</th></tr>` +
    grupos.map(g => `<tr><td>${esc(g.k)}</td><td class="n">${+(g.veces / div).toFixed(1)}</td><td class="n">${fmt(g.total)}</td>
      <td class="n">${Math.round(g.total / (total || 1) * 100)}%</td><td class="muted" title="${esc(g.ej)}">${esc(g.ej.slice(0, 60))}</td></tr>`).join('');
}

const agrupa = (arr, key) => Object.entries(arr.reduce((a, m) => (a[key(m)] = (a[key(m)] || 0) + m.monto, a), {}));

function grafica(id, cfg) {
  charts[id]?.destroy();
  Chart.defaults.color = css('--text-secondary');
  Chart.defaults.borderColor = css('--border');
  cfg.options = { responsive: true, maintainAspectRatio: false, ...cfg.options };
  cfg.options.plugins = { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed[cfg.options.indexAxis === 'y' ? 'x' : 'y'])}` } }, ...cfg.options.plugins };
  charts[id] = new Chart($('#' + id), cfg);
}

// ---------- Movimientos ----------
// búsqueda sin acentos, mayúsculas ni signos (* - . /); todas las palabras deben aparecer, en cualquier orden
const normaliza = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ$]+/g, ' ').trim();
function pintarMovimientos() {
  const mes = $('#mMes').value, cta = $('#mCuenta').value, cat = $('#mCat').value, palabras = normaliza($('#mTexto').value).split(' ').filter(Boolean);
  const F = D.Movimientos.filter(m => (!mes || m.mes === mes) && (!cta || m.cuenta === cta) && (!cat || (cat === SOLO_SUG ? sugDe(m) : m.nivel2 === cat)) &&
    (!palabras.length || (t => palabras.every(w => t.includes(w)))(normaliza(`${m.nivel3} ${m.descripcion} ${m.nota} ${m.nivel1} ${m.nivel2} ${m.cuenta}`))))
    .sort((a, b) => orden.dir * (orden.k === 'monto' ? a.monto - b.monto : String(a[orden.k]).localeCompare(String(b[orden.k]), 'es')) || b.fecha.localeCompare(a.fecha));
  const LIM = 400;
  visibles = F.slice(0, LIM);
  $('#mInfo').textContent = `${F.length} movimientos · neto ${fmt(suma(F))}` + (F.length > LIM ? ` · se muestran los primeros ${LIM}, filtra para ver más` : '');
  const th = (k, t, cls = '') => `<th data-sort="${k}" class="${cls}" style="cursor:pointer">${t}${orden.k === k ? (orden.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  $('#tMov').innerHTML = `<tr><th><input type="checkbox" id="selTodos" title="Seleccionar todos los visibles" ${visibles.length && visibles.every(m => sel.has(m.id)) ? 'checked' : ''}></th>` +
    th('fecha', 'Fecha') + th('cuenta', 'Cuenta') + th('nivel3', 'Comercio / destino') + th('monto', 'Monto', 'n') + '<th>Único</th>' + th('nivel1', 'Nivel 1') +
    th('nivel2', 'Nivel 2') + th('ambito', 'Ámbito') + '<th>Sugerencia IA</th>' + th('nota', 'Nota') + '<th></th></tr>' + visibles.map(filaHTML).join('');
  pintarBulk();
}

let orden = { k: 'fecha', dir: -1 }, visibles = [];

// sugerencias IA (pestaña Sugerencias, por comercio); se muestran solo si difieren de lo que ya tiene
let SUG = {};
const SOLO_SUG = '__sug__';
const sugDe = m => { const s = SUG[m.nivel3]; return s && (s.nivel1 !== m.nivel1 || s.nivel2 !== m.nivel2 || s.ambito !== m.ambito) ? s : null; };
async function aceptarSugerencias(lista) {
  lista.forEach(m => { const s = sugDe(m); Object.assign(m, { nivel1: s.nivel1, nivel2: s.nivel2, ambito: s.ambito }); });
  await guardarMovs(lista);
}
const sel = new Set();
// agrega o quita la marca #único de la nota
function marcaUnico(m, on) {
  const sin = (m.nota || '').replace(/\s*·?\s*#[uú]nico/gi, '').trim();
  m.nota = on ? (sin ? `${sin} · ${UNICO}` : UNICO) : sin;
}

function pintarBulk() {
  $('#bulk').hidden = !sel.size;
  $('#bulkN').textContent = `${sel.size} seleccionado${sel.size === 1 ? '' : 's'}`;
  for (const k of Object.keys(OPC)) {
    const s = $('#b_' + k), v = s.value;
    s.innerHTML = `<option value="">${k === 'ambito' ? 'Ámbito' : 'Nivel ' + k.slice(-1)}: sin cambio</option>` +
      OPC[k].map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('') + `<option value="${NUEVA}">+ Nueva…</option>`;
    s.value = OPC[k].includes(v) ? v : '';
  }
}

const filaHTML = m => `<tr data-id="${esc(m.id)}">
      <td><input type="checkbox" data-sel ${sel.has(m.id) ? 'checked' : ''}></td>
      <td data-l="${esc(m.cuenta)}">${esc(m.fecha)}</td><td class="muted solo-pc">${esc(m.cuenta)}</td>
      <td class="ancho" title="${esc(m.descripcion)}"><input data-k="nivel3" value="${esc(m.nivel3)}"></td>
      <td class="n ${m.monto < 0 ? '' : 'pos'}" data-l="Monto">${fmt(m.monto)}${m.msi ? ` <span class="muted">${esc(m.msi)}</span>` : ''}</td>
      <td data-l="Único"><label title="Gasto único (muebles, anticipos…): no entra a los promedios"><input type="checkbox" data-unico ${esUnico(m) ? 'checked' : ''}> único</label></td>
      <td data-l="Nivel 1">${desplegable('nivel1', m.nivel1)}</td>
      <td data-l="Categoría">${desplegable('nivel2', m.nivel2)}</td>
      <td data-l="Ámbito">${desplegable('ambito', m.ambito)}</td>
      <td data-l="Sugerencia IA">${sugDe(m) ? `<span title="${esc(sugDe(m).motivo)} · confianza ${esc(sugDe(m).confianza)}">${esc(sugDe(m).nivel2)}${sugDe(m).confianza === 'baja' ? ' <span class="muted">(?)</span>' : ''}</span>
        <button class="btn sec" data-sug title="Aceptar sugerencia">✓</button>` : ''}</td>
      <td class="ancho" data-l="Nota"><input data-k="nota" value="${esc(m.nota)}" title="${esc(m.nota)}"></td>
      <td><button class="btn sec" data-iguales title="Aplicar esta categoría a todos los movimientos de este comercio">a todos</button></td></tr>`;

// opciones de los desplegables de categoría; "+ Nueva…" agrega a estas listas
const OPC = { nivel1: [], nivel2: [], ambito: [] };
const NUEVA = '__nueva__';
const desplegable = (k, v) => `<select data-k="${k}">` +
  [...new Set([...OPC[k], v].filter(Boolean))].map(x => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('') +
  `<option value="${NUEVA}">+ Nueva…</option></select>`;
const agregaOpcion = (k, v) => { if (!OPC[k].includes(v)) OPC[k] = [...OPC[k], v].sort((a, b) => a.localeCompare(b)); };

function listas() {
  const uniq = k => [...new Set(D.Movimientos.map(m => m[k]).filter(Boolean))].sort();
  for (const k of ['nivel1', 'nivel2']) [...D.Presupuesto, ...D.Sugerencias].forEach(p => p[k] && agregaOpcion(k, p[k]));
  for (const k of Object.keys(OPC)) uniq(k).forEach(v => agregaOpcion(k, v));
  ['Personal', 'Medaunbrauni'].forEach(v => agregaOpcion('ambito', v));
  const opts = (sel, vals, todos, lbl = v => v) => { const v = $(sel).value; $(sel).innerHTML = `<option value="">${todos}</option>` + vals.map(x => `<option value="${esc(x)}">${esc(lbl(x))}</option>`).join(''); $(sel).value = v; };
  const ms = meses().reverse();
  opts('#fPeriodo', ms, 'Todo el periodo', nombreMes);
  // grupos primero (todas las TC Banorte), luego cada cuenta
  const cuentas = uniq('cuenta'), grupos = [...new Set(cuentas.filter(c => /\d{4}$/.test(c)).map(c => c.replace(/ \d{4}$/, '') + ' *'))];
  opts('#fCuenta', [...grupos, ...cuentas], 'Todas las cuentas', c => c.endsWith(' *') ? c.slice(0, -2) + ' (todas)' : c);
  opts('#mMes', ms, 'Todos los meses', nombreMes);
  opts('#mCuenta', uniq('cuenta'), 'Todas las cuentas');
  const cat = $('#mCat').value;
  opts('#mCat', uniq('nivel2'), 'Todas las categorías');
  if (D.Sugerencias.length) $('#mCat').insertAdjacentHTML('beforeend', `<option value="${SOLO_SUG}">★ Con sugerencia IA</option>`);
  $('#mCat').value = cat;
}

const filaMov = m => ['nivel1', 'nivel2', 'nivel3', 'ambito', 'msi', 'nota'].map(k => m[k]);
async function guardarMovs(lista) {
  AN = null;
  estado('Guardando…');
  await api(`/${sheetId}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({
    valueInputOption: 'RAW', data: lista.map(m => ({ range: `Movimientos!G${m._row}:L${m._row}`, values: [filaMov(m)] })),
  }) });
  estado('Guardado ✓');
}

// ---------- Importar CSV ----------
function parseCSV(t) {
  const filas = [[]]; let campo = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true;
    else if (c === ',') { filas.at(-1).push(campo); campo = ''; }
    else if (c === '\n') { filas.at(-1).push(campo.replace(/\r$/, '')); campo = ''; filas.push([]); }
    else campo += c;
  }
  if (campo || filas.at(-1).length) filas.at(-1).push(campo);
  return filas.filter(f => f.length > 1 || f[0]);
}

async function importar(file) {
  const [h, ...filas] = parseCSV((await file.text()).replace(/^﻿/, ''));
  // un CSV con menos columnas al final (p. ej. Presupuesto sin "fijo") también cuenta
  const tab = Object.keys(TABS).find(t => TABS[t].join() === h.join()) ||
    Object.keys(TABS).find(t => h.length >= 3 && h.length < TABS[t].length && TABS[t].slice(0, h.length).join() === h.join());
  const objs = filas.map(f => Object.fromEntries(h.map((k, i) => [k, f[i] ?? ''])));
  // CSV de cambios: id + algunas columnas de Movimientos → actualiza los existentes (la nota se agrega, no se pisa)
  const EDITABLES = ['nivel1', 'nivel2', 'nivel3', 'ambito', 'nota'];
  if (!tab && h[0] === 'id' && h.slice(1).every(k => EDITABLES.includes(k))) {
    const porId = Object.fromEntries(D.Movimientos.map(m => [m.id, m]));
    const lista = objs.filter(o => porId[o.id]).map(o => {
      const m = porId[o.id];
      for (const k of h.slice(1)) {
        if (!o[k]) continue;
        m[k] = k === 'nota' && m.nota && !m.nota.includes(o.nota) ? `${m.nota} · ${o.nota}` : k === 'nota' && m.nota ? m.nota : o[k];
      }
      return m;
    });
    if (!confirm(`Actualizar ${lista.length} movimientos (${objs.length - lista.length} no se encontraron)?`)) return;
    await guardarMovs(lista);
    return pintarTodo();
  }
  if (!tab) return alert('El CSV no tiene las columnas de ninguna pestaña (' + h.join(', ') + ')');
  if (tab === 'Presupuesto') {
    // se agrega/actualiza por categoría; las que no vienen en el CSV se quedan como están
    const nuevas = objs.filter(o => !D.Presupuesto.some(p => p.nivel2 === o.nivel2));
    if (!confirm(`Presupuesto: ${objs.length - nuevas.length} categorías se actualizan y ${nuevas.length} se agregan. Las demás no se tocan. ¿Seguir?`)) return;
    const porCat = Object.fromEntries(D.Presupuesto.map(p => [p.nivel2, p]));
    for (const o of objs) porCat[o.nivel2] = { ...porCat[o.nivel2], ...Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '').map(([k, v]) => [k, k === 'monto' ? aNumero(v) : v])) };
    await reescribir(tab, Object.values(porCat));
    return cargar();
  }
  if (tab !== 'Movimientos') {
    if (!confirm(`Esto reemplaza la pestaña ${tab} con ${objs.length} filas. ¿Seguir?`)) return;
    await reescribir(tab, objs);
    return cargar();
  }
  const existentes = new Set(D.Movimientos.map(m => m.id));
  // lo que ya categorizaste a mano gana sobre las reglas del script
  const aprendido = {};
  for (const m of [...D.Movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha))) aprendido[m.nivel3 + (m.monto < 0)] = m;
  const nuevos = objs.filter(o => !existentes.has(o.id)).map(o => {
    o.monto = +o.monto;
    const a = aprendido[o.nivel3 + (o.monto < 0)];
    if (a && !o.nota) Object.assign(o, { nivel1: a.nivel1, nivel2: a.nivel2, ambito: a.ambito });
    aplicaRegla(o);
    return TABS.Movimientos.map(k => o[k]);
  });
  if (!nuevos.length) return alert('No hay movimientos nuevos en ese archivo.');
  estado(`Importando ${nuevos.length}…`);
  await api(`/${sheetId}/values/${rango('Movimientos!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: nuevos }) });
  await cargar();
  alert(`${nuevos.length} movimientos nuevos (${objs.length - nuevos.length} ya existían).`);
}

// ---------- Presupuesto ----------
function categoriasGasto() {
  const map = new Map();
  for (const m of gastos()) if (m.nivel1 !== 'Deuda') map.set(m.nivel2, m.nivel1);
  for (const p of D.Presupuesto) if (!['Deuda', 'Ingreso'].includes(p.nivel1)) map.set(p.nivel2, p.nivel1);
  return [...map].map(([nivel2, nivel1]) => ({ nivel1, nivel2 })).sort((a, b) => a.nivel1.localeCompare(b.nivel1) || a.nivel2.localeCompare(b.nivel2));
}
// una categoría puede llamarse igual como ingreso y como gasto (p. ej. Medaunbrauni): sin n1, solo gastos
const presDe = (n2, n1) => +(D.Presupuesto.find(p => p.nivel2 === n2 && (n1 ? p.nivel1 === n1 : p.nivel1 !== 'Ingreso'))?.monto || 0);
const totalPresupuesto = () => suma(D.Presupuesto.filter(p => !['Deuda', 'Ingreso'].includes(p.nivel1)), p => +p.monto || 0);
// fijo: no se ajusta con el ingreso; si no lo has marcado, se toma por fijo lo de nivel 1 "Fijos"
const esFijo = c => { const p = D.Presupuesto.find(x => x.nivel2 === c.nivel2 && x.nivel1 !== 'Ingreso'); return p && p.fijo !== '' && p.fijo != null ? String(p.fijo) === '1' : c.nivel1 === 'Fijos'; };
// ingresos que planeas (renglones nivel 1 "Ingreso" del presupuesto); sin capturar, el promedio real
const hayIngresoPlaneado = () => D.Presupuesto.some(p => p.nivel1 === 'Ingreso' && +p.monto);
const ingresoPlaneado = () => suma(D.Presupuesto.filter(p => p.nivel1 === 'Ingreso'), p => +p.monto || 0) || ingresoPromedio();
const redondea = n => Math.round(n / 100) * 100;
// pago mensual a tarjetas que planeas: renglón Deuda / Pago a deudas del presupuesto
const PAGO_DEUDA = 'Pago a deudas';
const presDeuda = () => presDe(PAGO_DEUDA);
// sin presupuesto capturado, el plan usa el gasto real promedio (sin intereses, que ya van en el pago a deudas)
const gastoPlan = () => totalPresupuesto() || -promedioMensual(m => !NO_GASTO.includes(m.nivel1) && m.nivel1 !== 'Deuda', 3);

const rangoPromedio = () => {
  const ms = mesesCompletos(mesesPres());
  return ms.length ? `${ms.length} meses (${nombreMes(ms[0])} – ${nombreMes(ms.at(-1))})${ms.length < mesesPres() ? ' · no hay más datos' : ''}` : '';
};

function pintarPresupuesto() {
  $('#presMeses').value = mesesPres();
  const ult = mesesCompletos(1)[0];
  const filas = filasPresupuesto(ult);
  const aj = ajuste(filas);
  filas.forEach(f => f.aj = aj.de(f));
  const tot = k => fmt(suma(filas, f => f[k]));
  $('#tPres').innerHTML = `<tr><th>Nivel 1</th><th>Categoría</th><th title="No se ajusta con el ingreso">Fijo</th><th class="n">Presupuesto</th><th class="n">Con tu ingreso</th><th class="n">Promedio ${rangoPromedio()}</th><th class="n">${ult ? nombreMes(ult) : ''}</th><th style="width:20%">Uso del presupuesto</th></tr>` +
    filas.map(f => {
      const pct = f.pres ? f.ult / f.pres : 0;
      return `<tr><td class="muted solo-pc">${esc(f.nivel1)}</td><td class="ancho">${punto(f.nivel2)}<b>${esc(f.nivel2)}</b></td>
      <td data-l="Fijo"><input type="checkbox" data-fijo data-n2="${esc(f.nivel2)}" ${f.fijo ? 'checked' : ''}></td>
      <td class="n" data-l="Presupuesto"><input class="num moneda" inputmode="decimal" data-n1="${esc(f.nivel1)}" data-n2="${esc(f.nivel2)}" value="${fmtIn(f.pres || '')}"></td>
      <td class="n ${f.fijo ? 'muted' : f.aj < (f.pres || f.prom) ? 'neg' : 'pos'}" data-l="Con tu ingreso">${fmt(f.aj)}</td>
      <td class="n" data-l="Promedio">${fmt(f.prom)}</td><td class="n" data-l="${ult ? nombreMes(ult) : ''}">${fmt(f.ult)}</td>
      <td class="ancho">${f.pres ? `<div class="barra ${pct > 1 ? 'sobre' : ''}" style="width:${Math.min(100, pct * 100)}%" title="${Math.round(pct * 100)}%"></div>` : ''}</td></tr>`;
    }).join('') + `<tr class="sub"><th class="solo-pc"></th><th>Total gastos</th><th></th><th class="n">${tot('pres')}</th><th class="n">${tot('aj')}</th><th class="n">${tot('prom')}</th><th class="n">${tot('ult')}</th><th></th></tr>` +
    filaDeuda(suma(filas, f => f.pres), ult);
  pintarIngresos(aj);
}

const filasPresupuesto = ult => categoriasGasto().map(c => ({ ...c, pres: presDe(c.nivel2), fijo: esFijo(c),
  prom: -promedioMensual(m => m.nivel2 === c.nivel2, mesesPres()),
  ult: ult ? -suma(analisis().filter(m => m.mes === ult && m.nivel2 === c.nivel2)) : 0 }));

// reparte el ingreso: fijos y pago a deudas se respetan; lo que sobra se reparte entre los flexibles
// en proporción a su presupuesto (o a su promedio si no tienen presupuesto). Ese monto es el tope:
// si el ingreso sube, los gastos no suben; la diferencia queda como sobrante
function ajuste(filas) {
  const ing = ingresoPlaneado(), fijos = suma(filas.filter(f => f.fijo), f => f.pres), deuda = presDeuda();
  const base = f => f.pres || f.prom, flex = suma(filas.filter(f => !f.fijo), base);
  const libre = ing - fijos - deuda, factor = flex > 0 ? Math.min(1, Math.max(0, libre) / flex) : 0;
  return { ing, fijos, deuda, flex, libre, factor, de: f => f.fijo ? f.pres : redondea(base(f) * factor) };
}

function pintarIngresos(aj) {
  const cats = [...new Set([...D.Movimientos.filter(m => m.nivel1 === 'Ingreso').map(m => m.nivel2), ...D.Presupuesto.filter(p => p.nivel1 === 'Ingreso').map(p => p.nivel2)])].sort();
  $('#tIng').innerHTML = `<tr><th>Ingreso</th><th class="n">Lo que espero al mes</th><th class="n">Promedio ${rangoPromedio()}</th></tr>` +
    cats.map(c => `<tr><td class="ancho"><b>${esc(c)}</b>${c === 'Extraordinario' ? ' <span class="muted">(bonos, ventas: mejor no contar con ellos)</span>' : ''}</td>
      <td class="n" data-l="Lo que espero al mes"><input class="num moneda" inputmode="decimal" data-n1="Ingreso" data-n2="${esc(c)}" value="${fmtIn(presDe(c, 'Ingreso') || '')}"></td>
      <td class="n muted" data-l="Promedio">${fmt(promedioMensual(m => m.nivel1 === 'Ingreso' && m.nivel2 === c, mesesPres()))}</td></tr>`).join('') +
    `<tr class="sub"><th>Total ${hayIngresoPlaneado() ? '' : '<span class="muted" style="font-weight:400">(sin capturar: se usa tu promedio sin extraordinarios)</span>'}</th><th class="n">${fmt(aj.ing)}</th><th></th></tr>`;
  const pct = Math.round(aj.factor * 100);
  $('#ajuste').innerHTML = aj.libre < 0
    ? `<b class="neg">Tus fijos (${fmt(aj.fijos)}) y el pago a deudas (${fmt(aj.deuda)}) suman ${fmt(aj.fijos + aj.deuda)}: superan tu ingreso por ${fmt(-aj.libre)}.</b> No queda nada para lo demás: baja algún fijo o el pago a deudas, o sube el ingreso.`
    : `Ingreso <b>${fmt(aj.ing)}</b> − fijos ${fmt(aj.fijos)} − pago a deudas ${fmt(aj.deuda)} = <b>${fmt(aj.libre)}</b> para lo demás.
       ${pct < 100 ? `Es el <b class="neg">${pct}%</b> de` : 'Cubre el 100% de'} lo que hoy tienes para esas categorías (${fmt(aj.flex)}): ${pct < 100 ? `cada una tendría que bajar ${100 - pct}%` : `te alcanza: cada una se queda en su presupuesto (o promedio) y te sobran <b class="pos">${fmt(aj.libre - aj.flex)}</b> para ahorro o para pagar más deuda`}.`;
}

// deuda aparte: el pago a tarjetas + totales contra el ingreso promedio (sin extraordinarios)
function filaDeuda(gastoPres, ult) {
  const pago = presDeuda(), ing = ingresoPlaneado(), total = gastoPres + pago, resto = ing - total;
  const minimos = suma(D.Deudas, d => +d.minimo || 0);
  const intereses = -promedioMensual(m => m.nivel1 === 'Deuda', mesesPres());
  return `<tr><td class="muted solo-pc">Deuda</td><td class="ancho"><b>${PAGO_DEUDA}</b></td><td class="muted" data-l="Fijo">siempre</td>
      <td class="n" data-l="Presupuesto"><input class="num moneda" inputmode="decimal" data-n1="Deuda" data-n2="${PAGO_DEUDA}" value="${fmtIn(pago || '')}"></td>
      <td class="n muted" data-l="Con tu ingreso">${fmt(pago)}</td>
      <td class="n muted" title="Intereses y comisiones promedio" data-l="Intereses promedio">${fmt(intereses)}</td>
      <td class="n muted" data-l="Intereses último mes">${ult ? fmt(-suma(D.Movimientos.filter(m => m.mes === ult && m.nivel1 === 'Deuda'))) : ''}</td>
      <td class="muted">${minimos ? `mínimos de tus tarjetas: ${fmt(minimos)}` : ''}${pago && pago < minimos ? ' <span class="neg">· no cubre los mínimos</span>' : ''}</td></tr>
    <tr class="sub"><th class="solo-pc"></th><th>Total con deuda</th><th></th><th class="n">${fmt(total)}</th><th colspan="4"></th></tr>
    <tr><td class="solo-pc"></td><td>${hayIngresoPlaneado() ? 'Ingreso que planeas' : 'Ingreso promedio (sin extraordinarios, 6 meses)'}</td><td></td><td class="n">${fmt(ing)}</td><td colspan="4"></td></tr>
    <tr><td class="solo-pc"></td><td><b>${resto < 0 ? 'Te falta' : 'Te sobra'}</b></td><td></td><td class="n ${resto < 0 ? 'neg' : 'pos'}"><b>${fmt(Math.abs(resto))}</b></td><td colspan="4"></td></tr>`;
}

// los montos se ven como moneda ($1,234) y se editan como número
const aNumero = v => +String(v).replace(/[^0-9.]/g, '') || 0;
const fmtIn = n => n === '' || n == null ? '' : (+n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 });

function leerPresupuesto() {
  const fijo = Object.fromEntries([...document.querySelectorAll('#tPres [data-fijo]')].map(c => [c.dataset.n2, c.checked ? 1 : 0]));
  D.Presupuesto = [...document.querySelectorAll('#tPres input.moneda, #tIng input.moneda')].filter(i => aNumero(i.value) > 0)
    .map(i => ({ nivel1: i.dataset.n1, nivel2: i.dataset.n2, monto: aNumero(i.value), fijo: i.dataset.n1 === 'Ingreso' ? '' : fijo[i.dataset.n2] ?? '' }));
}

// ---------- Reglas de categoría ----------
// "si la descripción contiene X → categoría Y"; la primera que coincide gana
const reglaCat = m => D.Reglas.find(r => r.contiene && r.nivel2 && normaliza(`${m.nivel3} ${m.descripcion}`).includes(normaliza(r.contiene)));
function aplicaRegla(m) {
  const r = reglaCat(m);
  if (!r) return false;
  const nuevo = { nivel1: r.nivel1 || nivel1De(r.nivel2), nivel2: r.nivel2, ambito: r.ambito || m.ambito };
  if (nuevo.nivel1 === m.nivel1 && nuevo.nivel2 === m.nivel2 && nuevo.ambito === m.ambito) return false;
  Object.assign(m, nuevo);
  return true;
}

const opcionesCat = (v, vacio) => `<option value="">${vacio}</option>` +
  [...new Set([...OPC.nivel2, v].filter(Boolean))].map(x => `<option value="${esc(x)}"${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');

function pintarReglas() {
  const cuenta = r => r.contiene ? D.Movimientos.filter(m => reglaCat(m) === r).length : 0;
  $('#tReg').innerHTML = '<tr><th>Si la descripción contiene</th><th>Categoría</th><th>Ámbito</th><th class="n">Movimientos que coinciden</th><th></th></tr>' +
    (D.Reglas.length ? '' : '<tr><td colspan="5" class="muted">Aún no hay reglas. Ejemplo: AMAZON → Casa consumibles. Da clic en “+ Regla”.</td></tr>') +
    D.Reglas.map((r, i) => `<tr data-i="${i}"><td class="ancho" data-l="Si la descripción contiene"><input data-k="contiene" value="${esc(r.contiene)}" placeholder="AMAZON"></td>
      <td data-l="Categoría"><select data-k="nivel2">${opcionesCat(r.nivel2, 'Elige…')}</select></td>
      <td data-l="Ámbito"><select data-k="ambito"><option value="">Sin cambio</option>${OPC.ambito.map(a => `<option${a === r.ambito ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></td>
      <td class="n" data-l="Coinciden">${cuenta(r)}</td><td><button class="btn sec" data-quitar title="Quitar">✕</button></td></tr>`).join('');
}

function leerReglas() {
  D.Reglas = [...document.querySelectorAll('#tReg tr[data-i]')].map(tr => {
    const o = {}; tr.querySelectorAll('[data-k]').forEach(i => o[i.dataset.k] = i.value.trim());
    return { ...o, nivel1: o.nivel2 ? nivel1De(o.nivel2) : '' };
  });
}

// ---------- Repartos ----------
function pintarRepartos() {
  const ms = mesesCompletos(mesesPres());
  const cats = opcionesCat;
  $('#tRep').innerHTML = (D.Repartos.length ? '' : '<tr><td class="muted">Sin repartos. Ejemplo: AMAZON, solo en Casa consumibles → Ocio 15%.</td></tr>') + '<tr><th>Si la descripción contiene</th><th>Solo en la categoría</th><th>Mandar a</th><th class="n">%</th><th class="n">≈ al mes</th><th class="n">Comercio al mes</th><th>Nota</th><th></th></tr>' +
    D.Repartos.map((r, i) => {
      // cuánto mueve: total del comercio (antes de repartir) en los meses del promedio
      const base = ms.length ? -suma(D.Movimientos.filter(m => ms.includes(m.mes) && reglaDe(m) === r)) / ms.length : 0;
      return `<tr data-i="${i}"><td class="ancho" data-l="Si la descripción contiene"><input data-k="comercio" value="${esc(r.comercio)}" placeholder="AMAZON"></td>
      <td data-l="Solo en la categoría"><select data-k="categoria">${cats(r.categoria, 'Cualquiera')}</select></td>
      <td data-l="Mandar a"><select data-k="destino">${cats(r.destino, 'Elige…')}</select></td>
      <td class="n" data-l="%"><input class="num" type="number" min="0" max="100" step="1" data-k="porcentaje" value="${esc(r.porcentaje)}"></td>
      <td class="n" data-l="≈ al mes">${fmt(base * (+r.porcentaje || 0) / 100)}</td><td class="n muted" data-l="Comercio al mes">${fmt(base)}</td>
      <td class="ancho" data-l="Nota"><input data-k="nota" value="${esc(r.nota)}"></td>
      <td><button class="btn sec" data-quitar title="Quitar">✕</button></td></tr>`;
    }).join('');
}

function leerRepartos() {
  D.Repartos = [...document.querySelectorAll('#tRep tr[data-i]')].map(tr => {
    const o = {}; tr.querySelectorAll('[data-k]').forEach(i => o[i.dataset.k] = i.type === 'number' ? (i.value === '' ? '' : +i.value) : i.value.trim()); return o;
  });
  AN = null;
}

// ---------- Plan y deudas ----------
function mesesProyeccion() {
  const hoy = new Date(), out = [];
  const ultimo = D.Proyeccion.map(p => p.mes).sort().at(-1);
  for (let i = 1; ; i++) {
    const m = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1).toISOString().slice(0, 7);
    if (i > 12 && (!ultimo || m > ultimo)) break;
    out.push(m);
  }
  return out;
}

function proyeccion() {
  const prom = ingresoPlaneado(), gas = gastoPlan();
  return mesesProyeccion().map(mes => {
    const p = D.Proyeccion.find(x => x.mes === mes) || { mes };
    const ingreso = (p.ingreso_base === '' || p.ingreso_base == null ? prom : +p.ingreso_base) + (+p.ingreso_extra || 0);
    const disponible = ingreso - gas;
    const pago = p.pago_deuda === '' || p.pago_deuda == null ? presDeuda() || Math.max(0, disponible) : +p.pago_deuda;
    return { ...p, prom, gas, disponible, pago };
  });
}

function estrategias() {
  const P = proyeccion();
  const deudas = D.Deudas.map(d => ({ nombre: d.nombre, saldo: +d.saldo || 0, tasa: +d.tasa || 0, minimo: +d.minimo || 0 }));
  const pago = i => (P[i] || P.at(-1))?.pago || 0;
  const minimos = suma(deudas, d => d.minimo);
  const E = [
    ['Avalancha (tasa más alta primero)', simular(deudas, pago, 'avalancha')],
    ['Bola de nieve (saldo más chico primero)', simular(deudas, pago, 'bola')],
    ['Solo pagos mínimos', simular(deudas, () => minimos, 'avalancha')],
  ];
  return { P, deudas, minimos, E };
}
const fechaLibre = r => r.libre ? nombreMes(new Date(new Date().getFullYear(), new Date().getMonth() + r.meses.length, 1).toISOString().slice(0, 7)) : 'no se liquida';

function pintarPlan() {
  const { P, deudas, minimos, E } = estrategias(), av = E[0][1];

  $('#tProy').innerHTML = `<tr><th>Mes</th><th class="n">Ingreso base</th><th class="n">Ingreso extra</th><th class="n">Gastos (${totalPresupuesto() ? 'presupuesto' : 'promedio real'})</th><th class="n">Disponible</th><th class="n">Pago a deudas</th><th class="n">Deuda al cierre</th><th>Nota</th></tr>` +
    P.map((p, i) => `<tr data-mes="${p.mes}"><td>${nombreMes(p.mes)}</td>
      <td class="n"><input class="num moneda" inputmode="decimal" data-k="ingreso_base" placeholder="${fmt(p.prom)}" value="${fmtIn(p.ingreso_base)}"></td>
      <td class="n"><input class="num moneda" inputmode="decimal" data-k="ingreso_extra" value="${fmtIn(p.ingreso_extra)}"></td>
      <td class="n">${fmt(p.gas)}</td><td class="n ${p.disponible < 0 ? 'neg' : ''}">${fmt(p.disponible)}</td>
      <td class="n"><input class="num moneda" inputmode="decimal" data-k="pago_deuda" placeholder="${fmt(presDeuda() || Math.max(0, p.disponible))}" value="${fmtIn(p.pago_deuda)}"></td>
      <td class="n">${av.meses[i] ? fmt(av.meses[i].total) : fmt(0)}</td>
      <td><input data-k="nota" value="${esc(p.nota)}"></td></tr>`).join('');

  $('#tDeudas').innerHTML = '<tr><th>Tarjeta</th><th class="n">Saldo</th><th class="n">Tasa anual %</th><th class="n">Pago mínimo</th><th class="n">Interés al mes (con IVA)</th><th class="n" title="Con cuánto empezaste: sirve para medir tu avance">Saldo inicial (meta)</th><th>Nota</th></tr>' +
    D.Deudas.map((d, i) => `<tr data-i="${i}"><td><input data-k="nombre" value="${esc(d.nombre)}"></td>
      <td class="n"><input class="num moneda" inputmode="decimal" data-k="saldo" value="${fmtIn(d.saldo)}"></td>
      <td class="n"><input class="num" type="number" step="0.01" data-k="tasa" value="${d.tasa}"></td>
      <td class="n"><input class="num moneda" inputmode="decimal" data-k="minimo" value="${fmtIn(d.minimo)}"></td>
      <td class="n">${fmt(interesMensual(+d.saldo || 0, +d.tasa || 0))}</td>
      <td class="n"><input class="num moneda" inputmode="decimal" data-k="saldo_inicial" placeholder="${fmt(d.saldo)}" value="${fmtIn(d.saldo_inicial)}"></td>
      <td><input data-k="nota" value="${esc(d.nota)}"></td></tr>`).join('');

  const total = suma(deudas, d => d.saldo);
  $('#kpisPlan').innerHTML = [
    ['Deuda total', fmt(total)],
    ['Intereses al mes hoy', fmt(suma(deudas, d => interesMensual(d.saldo, d.tasa)))],
    ['Libre de deudas (avalancha)', fechaLibre(av)],
    ['Ahorro vs. solo mínimos', av.libre && E[2][1].libre ? fmt(E[2][1].interesTotal - av.interesTotal) : '—'],
  ].map(([t, v]) => `<div class="kpi"><small>${t}</small><b>${v}</b></div>`).join('') +
    (av.faltante ? `<div class="aviso" style="grid-column:1/-1">⚠ En algún mes lo que pagas no alcanza para los mínimos (${fmt(minimos)}): la deuda crece. Sube ingreso, baja presupuesto o captura "Pago a deudas".</div>` : '');

  $('#tEstr').innerHTML = '<tr><th>Estrategia</th><th class="n">Meses</th><th>Sin deudas en</th><th class="n">Intereses totales</th><th>Orden en que se liquidan</th></tr>' +
    E.map(([n, r]) => `<tr><td>${n}</td><td class="n">${r.libre ? r.meses.length : '—'}</td><td>${fechaLibre(r)}</td><td class="n">${fmt(r.interesTotal)}</td>
      <td>${r.liquidadas.filter(x => x.mes !== null).sort((a, b) => a.mes - b.mes).map(x => `${esc(x.nombre)} (mes ${x.mes + 1})`).join(' → ')}</td></tr>`).join('');

  const largo = Math.min(60, Math.max(...E.map(([, r]) => r.meses.length)));
  const etiquetas = Array.from({ length: largo }, (_, i) => nombreMes(new Date(new Date().getFullYear(), new Date().getMonth() + i + 1, 1).toISOString().slice(0, 7)));
  grafica('gDeuda', {
    type: 'line',
    data: { labels: etiquetas, datasets: E.map(([n, r], i) => ({
      label: n, data: etiquetas.map((_, k) => r.meses[k]?.total ?? 0),
      borderColor: css(`--series-${i + 1}`), backgroundColor: css(`--series-${i + 1}`), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4,
    })) },
    options: { interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: fmt } }, x: { grid: { display: false } } } },
  });
}

function leerPlan() {
  const conf = [...document.querySelectorAll('#tProy tr[data-mes]')].map(tr => {
    const o = { mes: tr.dataset.mes };
    tr.querySelectorAll('input').forEach(i => o[i.dataset.k] = i.value === '' ? '' : i.classList.contains('moneda') ? aNumero(i.value) : i.value);
    return o;
  });
  // conserva meses que ya no se muestran (pasados) tal cual
  D.Proyeccion = [...D.Proyeccion.filter(p => !conf.some(c => c.mes === p.mes)), ...conf]
    .filter(p => p.ingreso_base !== '' || p.ingreso_extra !== '' || p.pago_deuda !== '' || p.nota);
  D.Deudas = [...document.querySelectorAll('#tDeudas tr[data-i]')].map(tr => {
    const o = {}; tr.querySelectorAll('input').forEach(i => o[i.dataset.k] = i.classList.contains('moneda') ? aNumero(i.value) : i.type === 'number' ? +i.value || 0 : i.value); return o;
  }).filter(d => d.nombre).map(d => ({ ...d, saldo_inicial: d.saldo_inicial || d.saldo }));
}

// ---------- Navegación y eventos ----------
function pintarTodo() { AN = null; listas(); coloresCategoria(); pintarResumen(); pintarMovimientos(); pintarPresupuesto(); pintarReglas(); pintarRepartos(); pintarPlan(); }

$('#tabs').addEventListener('click', e => {
  const v = e.target.dataset.v; if (!v) return;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b === e.target));
  document.querySelectorAll('main > section:not(#login)').forEach(s => s.hidden = s.id !== v);
  store('finanzas:vista', v);
});

const conError = fn => async (...a) => { try { await fn(...a); } catch (e) { estado(''); alert('Error: ' + e.message); } };

$('#btnLogin').onclick = conError(async () => {
  await login();
  if (sheetId) await cargar(); else { $('#elegir').hidden = false; $('#btnLogin').hidden = true; }
});
$('#btnCrear').onclick = conError(crearBase);
$('#btnUsar').onclick = conError(async () => {
  const id = ($('#urlSheet').value.match(/\/d\/([\w-]+)/) || [])[1] || $('#urlSheet').value.trim();
  if (!id) return;
  sheetId = id; await cargar();
});

['#fPeriodo', '#fAmbito', '#fCuenta'].forEach(s => $(s).onchange = pintarResumen);
$('#fSinDeuda').checked = store('finanzas:sinDeuda') === '1';
$('#fSinDeuda').onchange = e => { store('finanzas:sinDeuda', e.target.checked ? '1' : '0'); pintarResumen(); };
$('#tRecorte').addEventListener('click', e => {
  const cat = e.target.closest('tr[data-cat]')?.dataset.cat;
  if (!cat) return;
  catDet = cat; pintarResumen(); $('#detalle').scrollIntoView({ behavior: 'smooth' });
});
$('#fCatDet').onchange = e => { catDet = e.target.value; pintarResumen(); };
try { const g = JSON.parse(localStorage.getItem('finanzas:prom')); if (g) { $('#fProm').checked = g.on; $('#fPromN').value = g.n; } } catch {}
['#fProm', '#fPromN'].forEach(s => $(s).onchange = () => {
  store('finanzas:prom', JSON.stringify({ on: $('#fProm').checked, n: $('#fPromN').value }));
  pintarResumen();
});
['#mMes', '#mCuenta', '#mCat'].forEach(s => $(s).onchange = pintarMovimientos);
$('#mTexto').oninput = pintarMovimientos;
$('#fileCsv').onchange = conError(async e => { if (e.target.files[0]) await importar(e.target.files[0]); e.target.value = ''; });

$('#tMov').addEventListener('change', conError(async e => {
  if (e.target.id === 'selTodos') {
    visibles.forEach(m => e.target.checked ? sel.add(m.id) : sel.delete(m.id));
    document.querySelectorAll('#tMov [data-sel]').forEach(c => c.checked = e.target.checked);
    return pintarBulk();
  }
  if (e.target.hasAttribute('data-unico')) {
    const m = D.Movimientos.find(x => x.id === e.target.closest('tr').dataset.id);
    marcaUnico(m, e.target.checked);
    e.target.closest('tr').outerHTML = filaHTML(m);
    return guardarMovs([m]);
  }
  if (e.target.hasAttribute('data-sel')) {
    const id = e.target.closest('tr').dataset.id;
    e.target.checked ? sel.add(id) : sel.delete(id);
    return pintarBulk();
  }
  const m = D.Movimientos.find(x => x.id === e.target.closest('tr').dataset.id);
  const k = e.target.dataset.k;
  let v = e.target.value.trim();
  if (v === NUEVA) {
    v = (prompt(`Nombre de la nueva opción (${k === 'ambito' ? 'ámbito' : k.replace('nivel', 'nivel ')}):`) || '').trim();
    if (!v) { e.target.value = m[k]; return; }
    agregaOpcion(k, v);
  }
  m[k] = v;
  // al elegir categoría, el nivel 1 se acomoda solo según cómo ya está clasificada en otros movimientos
  if (k === 'nivel2') {
    const n1 = (D.Movimientos.find(x => x !== m && x.nivel2 === v) || D.Presupuesto.find(p => p.nivel2 === v))?.nivel1;
    if (n1) m.nivel1 = n1;
  }
  // solo se redibuja la fila: si se redibuja la tabla, el filtro la esconde antes de poder darle "a todos"
  e.target.closest('tr').outerHTML = filaHTML(m);
  await guardarMovs([m]);
  if (k !== 'nota') listas();
}));
$('#tMov').addEventListener('click', e => {
  const k = e.target.closest('th[data-sort]')?.dataset.sort;
  if (!k) return;
  orden = { k, dir: orden.k === k ? -orden.dir : (k === 'fecha' || k === 'monto' ? -1 : 1) };
  pintarMovimientos();
});

// cambio en bulk
['nivel1', 'nivel2', 'ambito'].forEach(k => $('#b_' + k).onchange = e => {
  if (e.target.value !== NUEVA) return;
  const v = (prompt('Nombre de la nueva opción:') || '').trim();
  if (v) { agregaOpcion(k, v); pintarBulk(); }
  e.target.value = v;
});
$('#bulkAplicar').onclick = conError(async () => {
  const cambio = Object.fromEntries(['nivel1', 'nivel2', 'ambito'].map(k => [k, $('#b_' + k).value]).filter(([, v]) => v));
  if (!Object.keys(cambio).length) return alert('Elige al menos un nivel o ámbito para cambiar.');
  if (cambio.nivel2 && !cambio.nivel1) {
    const n1 = (D.Movimientos.find(x => x.nivel2 === cambio.nivel2 && !sel.has(x.id)) || D.Presupuesto.find(p => p.nivel2 === cambio.nivel2))?.nivel1;
    if (n1) cambio.nivel1 = n1;
  }
  const lista = D.Movimientos.filter(m => sel.has(m.id));
  lista.forEach(m => Object.assign(m, cambio));
  await guardarMovs(lista);
  sel.clear();
  ['nivel1', 'nivel2', 'ambito'].forEach(k => $('#b_' + k).value = '');
  listas(); pintarMovimientos();
});
$('#bulkUnico').onclick = conError(async () => {
  const lista = D.Movimientos.filter(m => sel.has(m.id));
  const on = !lista.every(esUnico);
  lista.forEach(m => marcaUnico(m, on));
  await guardarMovs(lista);
  sel.clear(); pintarMovimientos();
  estado(`${lista.length} ${on ? 'marcados' : 'desmarcados'} como gasto único ✓`);
});
$('#bulkQuitar').onclick = () => { sel.clear(); pintarMovimientos(); };
$('#bulkSug').onclick = conError(async () => {
  const lista = D.Movimientos.filter(m => sel.has(m.id) && sugDe(m));
  if (!lista.length) return alert('Ninguno de los seleccionados tiene sugerencia IA.');
  await aceptarSugerencias(lista);
  sel.clear(); listas(); pintarMovimientos();
});

$('#tMov').addEventListener('click', conError(async e => {
  if (e.target.hasAttribute('data-sug')) {
    const m = D.Movimientos.find(x => x.id === e.target.closest('tr').dataset.id);
    await aceptarSugerencias([m]);
    e.target.closest('tr').outerHTML = filaHTML(m);
    return listas();
  }
  if (!e.target.hasAttribute('data-iguales')) return;
  const m = D.Movimientos.find(x => x.id === e.target.closest('tr').dataset.id);
  const otros = D.Movimientos.filter(x => x !== m && x.nivel3 === m.nivel3 && (x.monto < 0) === (m.monto < 0));
  if (!otros.length) return alert('No hay otros movimientos de ' + m.nivel3);
  if (!confirm(`Poner "${m.nivel1} / ${m.nivel2} / ${m.ambito}" a ${otros.length} movimientos más de ${m.nivel3}?`)) return;
  otros.forEach(x => Object.assign(x, { nivel1: m.nivel1, nivel2: m.nivel2, ambito: m.ambito }));
  await guardarMovs(otros);
  pintarMovimientos();
}));

$('#presMeses').onchange = e => { store('finanzas:mesesPres', e.target.value); pintarPresupuesto(); };
$('#btnPromedios').onclick = () => {
  document.querySelectorAll('#tPres input.moneda').forEach(i => {
    if (!i.value) { const p = -promedioMensual(m => m.nivel2 === i.dataset.n2, mesesPres()); if (p > 0) i.value = fmt(Math.round(p / 100) * 100); }
  });
};
// solo limpia la pantalla; se borra del Sheet hasta darle Guardar
$('#btnBorrarPres').onclick = () => {
  if (!confirm('¿Borrar todos los montos del presupuesto? (Se borra del Sheet hasta que le des Guardar)')) return;
  D.Presupuesto = []; pintarPresupuesto(); pintarPlan();
};
$('#btnGuardarPres').onclick = conError(async () => {
  leerPresupuesto(); await reescribir('Presupuesto', D.Presupuesto); estado('Presupuesto guardado ✓'); pintarPresupuesto(); pintarPlan();
});
$('#tPres').addEventListener('change', () => { leerPresupuesto(); pintarPresupuesto(); });
$('#tIng').addEventListener('change', () => { leerPresupuesto(); pintarPresupuesto(); });
$('#btnAjustar').onclick = conError(async () => {
  leerPresupuesto();
  const filas = filasPresupuesto(), aj = ajuste(filas);
  if (aj.libre < 0) return alert('Tus fijos y el pago a deudas ya superan tu ingreso: no hay nada que repartir.');
  if (!confirm(`¿Poner en el presupuesto los montos ajustados a un ingreso de ${fmt(aj.ing)}? Los fijos y el pago a deudas no cambian.`)) return;
  for (const f of filas.filter(f => !f.fijo)) {
    const p = D.Presupuesto.find(x => x.nivel2 === f.nivel2 && x.nivel1 !== 'Ingreso'), v = aj.de(f);
    if (p) p.monto = v; else if (v > 0) D.Presupuesto.push({ nivel1: f.nivel1, nivel2: f.nivel2, monto: v, fijo: 0 });
  }
  D.Presupuesto = D.Presupuesto.filter(p => +p.monto > 0);
  await reescribir('Presupuesto', D.Presupuesto); estado('Presupuesto ajustado y guardado ✓'); pintarPresupuesto(); pintarPlan(); pintarResumen();
});
// los repartos se ven en vivo en Presupuesto y Resumen; se guardan en el Sheet con el botón
const repintarRepartos = () => { leerRepartos(); pintarRepartos(); pintarPresupuesto(); pintarResumen(); pintarPlan(); };
$('#tRep').addEventListener('change', repintarRepartos);
$('#tRep').addEventListener('click', e => {
  if (!e.target.hasAttribute('data-quitar')) return;
  e.target.closest('tr').remove(); repintarRepartos();
});
$('#btnAddRep').onclick = () => {
  leerRepartos(); D.Repartos.push({ comercio: '', categoria: '', destino: '', porcentaje: '', nota: '' }); pintarRepartos();
};
$('#tReg').addEventListener('change', () => { leerReglas(); pintarReglas(); });
$('#tReg').addEventListener('click', e => { if (e.target.hasAttribute('data-quitar')) { e.target.closest('tr').remove(); leerReglas(); pintarReglas(); } });
$('#btnAddReg').onclick = () => { leerReglas(); D.Reglas.push({ contiene: '', nivel1: '', nivel2: '', ambito: '' }); pintarReglas(); };
$('#btnGuardarReg').onclick = conError(async () => {
  leerReglas(); D.Reglas = D.Reglas.filter(r => r.contiene && r.nivel2);
  await reescribir('Reglas', D.Reglas); estado('Reglas guardadas ✓'); pintarReglas();
});
$('#btnAplicarReg').onclick = conError(async () => {
  leerReglas();
  const lista = D.Movimientos.filter(m => { const c = { ...m }; return aplicaRegla(c); });
  if (!lista.length) return alert('Todos los movimientos ya cumplen las reglas.');
  if (!confirm(`Cambiar la categoría de ${lista.length} movimientos según las reglas?`)) return;
  lista.forEach(aplicaRegla);
  await guardarMovs(lista); pintarTodo();
});
['#cmpA', '#cmpB'].forEach(s => $(s).onchange = pintarComparar);
$('#btnGuardarRep').onclick = conError(async () => {
  leerRepartos();
  D.Repartos = D.Repartos.filter(r => r.comercio && r.destino);
  await reescribir('Repartos', D.Repartos); estado('Repartos guardados ✓'); pintarTodo();
});
document.addEventListener('focusin', e => { if (e.target.matches('input.moneda')) { e.target.value = e.target.value && aNumero(e.target.value); e.target.select(); } });
document.addEventListener('focusout', e => { if (e.target.matches('input.moneda') && e.target.value) e.target.value = fmtIn(aNumero(e.target.value)); });

$('#tProy').addEventListener('change', () => { leerPlan(); pintarPlan(); });
$('#tDeudas').addEventListener('change', () => { leerPlan(); pintarPlan(); });
$('#btnGuardarProy').onclick = conError(async () => { leerPlan(); await reescribir('Proyeccion', D.Proyeccion); estado('Proyección guardada ✓'); });
$('#btnGuardarDeudas').onclick = conError(async () => { leerPlan(); await reescribir('Deudas', D.Deudas); estado('Tarjetas guardadas ✓'); });
$('#btnAddDeuda').onclick = () => { leerPlan(); D.Deudas.push({ nombre: 'Nueva', saldo: 0, tasa: 0, minimo: 0, nota: '' }); pintarPlan(); };
$('#btnMasMeses').onclick = () => {
  leerPlan();
  const ult = mesesProyeccion().at(-1), [y, m] = ult.split('-').map(Number);
  const nuevo = new Date(y, m - 1 + 6, 1).toISOString().slice(0, 7);
  D.Proyeccion.push({ mes: nuevo, ingreso_base: '', ingreso_extra: '', pago_deuda: '', nota: ' ' });
  pintarPlan();
};

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => D.Movimientos.length && pintarTodo());

// arranque: si ya hay sesión, entra directo
if (token && sheetId) conError(cargar)().then(() => {
  const v = store('finanzas:vista'); if (v) document.querySelector(`#tabs [data-v="${v}"]`)?.click();
});
