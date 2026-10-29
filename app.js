import { simular, interesMensual } from './deuda.js';

const CLIENT_ID = '542473129173-6nmrt78rbotcqf2sl7qfjbrk6empbief.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file'; // solo ve los archivos que esta app crea
const TABS = {
  Movimientos: ['id', 'fecha', 'mes', 'cuenta', 'descripcion', 'monto', 'nivel1', 'nivel2', 'nivel3', 'ambito', 'msi', 'nota'],
  Presupuesto: ['nivel1', 'nivel2', 'monto'],
  Proyeccion: ['mes', 'ingreso_base', 'ingreso_extra', 'pago_deuda', 'nota'],
  Deudas: ['nombre', 'saldo', 'tasa', 'minimo', 'nota'],
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

let token = null, sheetId = store('finanzas:sheet'), D = { Movimientos: [], Presupuesto: [], Proyeccion: [], Deudas: [] };
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
  const r = await api(`/${sheetId}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE`);
  Object.keys(TABS).forEach((t, i) => {
    const [h = TABS[t], ...filas] = r.valueRanges[i].values || [];
    D[t] = filas.map((f, j) => Object.fromEntries([...h.map((k, c) => [k, f[c] ?? '']), ['_row', j + 2]]));
  });
  D.Movimientos.forEach(m => m.monto = +m.monto);
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
const gastos = () => D.Movimientos.filter(m => !NO_GASTO.includes(m.nivel1));
const meses = () => [...new Set(D.Movimientos.map(m => m.mes))].sort();
const suma = (arr, f = m => m.monto) => arr.reduce((s, m) => s + f(m), 0);
// el último mes suele venir incompleto (falta algún estado de cuenta) → los promedios usan los anteriores
const mesesCompletos = n => meses().slice(0, -1).slice(-n);
function promedioMensual(filtro, n) {
  const ms = mesesCompletos(n);
  return ms.length ? suma(D.Movimientos.filter(m => ms.includes(m.mes) && filtro(m))) / ms.length : 0;
}
const ingresoPromedio = () => promedioMensual(m => m.nivel1 === 'Ingreso' && m.nivel2 !== 'Extraordinario', 6);

// ---------- Resumen ----------
function pintarResumen() {
  const per = $('#fPeriodo').value, amb = $('#fAmbito').value;
  const M = D.Movimientos.filter(m => (!per || m.mes === per) && (!amb || m.ambito === amb));
  const G = M.filter(m => !NO_GASTO.includes(m.nivel1));
  const ing = suma(M.filter(m => m.nivel1 === 'Ingreso'));
  const extra = suma(M.filter(m => m.nivel2 === 'Extraordinario'));
  const gas = -suma(G), intereses = -suma(G.filter(m => m.nivel1 === 'Deuda'));
  const nMeses = per ? 1 : meses().length;
  $('#kpis').innerHTML = [
    ['Ingresos', fmt(ing), extra ? `incluye ${fmt(extra)} extraordinario` : ''],
    ['Gastos', fmt(gas), per ? '' : `${fmt(gas / nMeses)} al mes`],
    ['Intereses y comisiones', fmt(intereses), `${Math.round(intereses / (gas || 1) * 100)}% de tus gastos`],
    ['Balance', `<span class="${ing - gas < 0 ? 'neg' : 'pos'}">${fmt(ing - gas)}</span>`, ''],
  ].map(([t, v, s]) => `<div class="kpi"><small>${t}</small><b>${v}</b><small>${s}</small></div>`).join('');

  // gasto por mes, apilado por nivel 1
  const ms = meses();
  const GA = gastos().filter(m => !amb || m.ambito === amb);
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
    data: { labels: porCat.map(c => c[0]), datasets: [{ label: 'Gasto', data: porCat.map(c => -c[1]), backgroundColor: css('--series-1'), borderRadius: 4, borderSkipped: 'start' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: fmt } }, y: { grid: { display: false } } } },
  });

  const top = Object.values(G.reduce((acc, m) => {
    const a = acc[m.nivel3] ||= { n3: m.nivel3, n2: m.nivel2, veces: 0, total: 0 };
    a.veces++; a.total -= m.monto; return acc;
  }, {})).sort((a, b) => b.total - a.total).slice(0, 15);
  $('#tTop').innerHTML = '<tr><th>Comercio / destino</th><th>Categoría</th><th class="n">Veces</th><th class="n">Total</th></tr>' +
    top.map(t => `<tr><td>${esc(t.n3)}</td><td>${esc(t.n2)}</td><td class="n">${t.veces}</td><td class="n">${fmt(t.total)}</td></tr>`).join('');
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
function pintarMovimientos() {
  const mes = $('#mMes').value, cta = $('#mCuenta').value, cat = $('#mCat').value, txt = $('#mTexto').value.toLowerCase();
  const F = D.Movimientos.filter(m => (!mes || m.mes === mes) && (!cta || m.cuenta === cta) && (!cat || m.nivel2 === cat) &&
    (!txt || `${m.descripcion} ${m.nivel3} ${m.nota}`.toLowerCase().includes(txt)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const LIM = 400;
  $('#mInfo').textContent = `${F.length} movimientos · neto ${fmt(suma(F))}` + (F.length > LIM ? ` · se muestran los ${LIM} más recientes, filtra para ver más` : '');
  $('#tMov').innerHTML = '<tr><th>Fecha</th><th>Cuenta</th><th>Comercio / destino</th><th class="n">Monto</th><th>Nivel 1</th><th>Nivel 2</th><th>Ámbito</th><th>Nota</th><th></th></tr>' +
    F.slice(0, LIM).map(m => `<tr data-id="${esc(m.id)}">
      <td>${esc(m.fecha)}</td><td class="muted">${esc(m.cuenta)}</td>
      <td title="${esc(m.descripcion)}"><input data-k="nivel3" value="${esc(m.nivel3)}"></td>
      <td class="n ${m.monto < 0 ? '' : 'pos'}">${fmt(m.monto)}${m.msi ? ` <span class="muted">${esc(m.msi)}</span>` : ''}</td>
      <td><input data-k="nivel1" list="dl1" value="${esc(m.nivel1)}"></td>
      <td><input data-k="nivel2" list="dl2" value="${esc(m.nivel2)}"></td>
      <td><input data-k="ambito" list="dlA" value="${esc(m.ambito)}"></td>
      <td><input data-k="nota" value="${esc(m.nota)}"></td>
      <td><button class="btn sec" data-iguales title="Aplicar esta categoría a todos los movimientos de este comercio">a todos</button></td></tr>`).join('');
}

function listas() {
  const uniq = k => [...new Set(D.Movimientos.map(m => m[k]).filter(Boolean))].sort();
  const dl = (id, vals) => { let e = document.getElementById(id); if (!e) { e = document.createElement('datalist'); e.id = id; document.body.append(e); } e.innerHTML = vals.map(v => `<option value="${esc(v)}">`).join(''); };
  dl('dl1', uniq('nivel1')); dl('dl2', uniq('nivel2')); dl('dlA', ['Personal', 'Medaunbrauni']);
  const opts = (sel, vals, todos, lbl = v => v) => { const v = $(sel).value; $(sel).innerHTML = `<option value="">${todos}</option>` + vals.map(x => `<option value="${esc(x)}">${esc(lbl(x))}</option>`).join(''); $(sel).value = v; };
  const ms = meses().reverse();
  opts('#fPeriodo', ms, 'Todo el periodo', nombreMes);
  opts('#mMes', ms, 'Todos los meses', nombreMes);
  opts('#mCuenta', uniq('cuenta'), 'Todas las cuentas');
  opts('#mCat', uniq('nivel2'), 'Todas las categorías');
}

const filaMov = m => ['nivel1', 'nivel2', 'nivel3', 'ambito', 'msi', 'nota'].map(k => m[k]);
async function guardarMovs(lista) {
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
  const tab = Object.keys(TABS).find(t => TABS[t].join() === h.join());
  if (!tab) return alert('El CSV no tiene las columnas de ninguna pestaña (' + h.join(', ') + ')');
  const objs = filas.map(f => Object.fromEntries(h.map((k, i) => [k, f[i] ?? ''])));
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
  for (const p of D.Presupuesto) map.set(p.nivel2, p.nivel1);
  return [...map].map(([nivel2, nivel1]) => ({ nivel1, nivel2 })).sort((a, b) => a.nivel1.localeCompare(b.nivel1) || a.nivel2.localeCompare(b.nivel2));
}
const presDe = n2 => +(D.Presupuesto.find(p => p.nivel2 === n2)?.monto || 0);
const totalPresupuesto = () => suma(D.Presupuesto.filter(p => p.nivel1 !== 'Deuda'), p => +p.monto || 0);
// sin presupuesto capturado, el plan usa el gasto real promedio (sin intereses, que ya van en el pago a deudas)
const gastoPlan = () => totalPresupuesto() || -promedioMensual(m => !NO_GASTO.includes(m.nivel1) && m.nivel1 !== 'Deuda', 3);

function pintarPresupuesto() {
  const ult = mesesCompletos(1)[0];
  const filas = categoriasGasto().map(c => ({ ...c, pres: presDe(c.nivel2),
    prom: -promedioMensual(m => m.nivel2 === c.nivel2, 3),
    ult: -suma(D.Movimientos.filter(m => m.mes === ult && m.nivel2 === c.nivel2)) }));
  const tot = k => fmt(suma(filas, f => f[k]));
  $('#tPres').innerHTML = `<tr><th>Nivel 1</th><th>Categoría</th><th class="n">Presupuesto</th><th class="n">Promedio 3 meses</th><th class="n">${ult ? nombreMes(ult) : ''}</th><th style="width:25%">Uso del presupuesto</th></tr>` +
    filas.map(f => {
      const pct = f.pres ? f.ult / f.pres : 0;
      return `<tr><td class="muted">${esc(f.nivel1)}</td><td>${esc(f.nivel2)}</td>
      <td class="n"><input class="num" type="number" step="100" data-n1="${esc(f.nivel1)}" data-n2="${esc(f.nivel2)}" value="${f.pres || ''}"></td>
      <td class="n">${fmt(f.prom)}</td><td class="n">${fmt(f.ult)}</td>
      <td>${f.pres ? `<div class="barra ${pct > 1 ? 'sobre' : ''}" style="width:${Math.min(100, pct * 100)}%" title="${Math.round(pct * 100)}%"></div>` : ''}</td></tr>`;
    }).join('') + `<tr><th></th><th>Total</th><th class="n">${tot('pres')}</th><th class="n">${tot('prom')}</th><th class="n">${tot('ult')}</th><th></th></tr>`;
}

function leerPresupuesto() {
  D.Presupuesto = [...document.querySelectorAll('#tPres input')].filter(i => +i.value > 0)
    .map(i => ({ nivel1: i.dataset.n1, nivel2: i.dataset.n2, monto: +i.value }));
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
  const prom = ingresoPromedio(), gas = gastoPlan();
  return mesesProyeccion().map(mes => {
    const p = D.Proyeccion.find(x => x.mes === mes) || { mes };
    const ingreso = (p.ingreso_base === '' || p.ingreso_base == null ? prom : +p.ingreso_base) + (+p.ingreso_extra || 0);
    const disponible = ingreso - gas;
    const pago = p.pago_deuda === '' || p.pago_deuda == null ? Math.max(0, disponible) : +p.pago_deuda;
    return { ...p, prom, gas, disponible, pago };
  });
}

function pintarPlan() {
  const P = proyeccion();
  const deudas = D.Deudas.map(d => ({ nombre: d.nombre, saldo: +d.saldo || 0, tasa: +d.tasa || 0, minimo: +d.minimo || 0 }));
  const pago = i => (P[i] || P.at(-1))?.pago || 0;
  const minimos = suma(deudas, d => d.minimo);
  const E = [
    ['Avalancha (tasa más alta primero)', simular(deudas, pago, 'avalancha')],
    ['Bola de nieve (saldo más chico primero)', simular(deudas, pago, 'bola')],
    ['Solo pagos mínimos', simular(deudas, () => minimos, 'avalancha')],
  ];
  const av = E[0][1];

  $('#tProy').innerHTML = `<tr><th>Mes</th><th class="n">Ingreso base</th><th class="n">Ingreso extra</th><th class="n">Gastos (${totalPresupuesto() ? 'presupuesto' : 'promedio real'})</th><th class="n">Disponible</th><th class="n">Pago a deudas</th><th class="n">Deuda al cierre</th><th>Nota</th></tr>` +
    P.map((p, i) => `<tr data-mes="${p.mes}"><td>${nombreMes(p.mes)}</td>
      <td class="n"><input class="num" type="number" step="1000" data-k="ingreso_base" placeholder="${Math.round(p.prom)}" value="${p.ingreso_base ?? ''}"></td>
      <td class="n"><input class="num" type="number" step="1000" data-k="ingreso_extra" value="${p.ingreso_extra ?? ''}"></td>
      <td class="n">${fmt(p.gas)}</td><td class="n ${p.disponible < 0 ? 'neg' : ''}">${fmt(p.disponible)}</td>
      <td class="n"><input class="num" type="number" step="1000" data-k="pago_deuda" placeholder="${Math.round(Math.max(0, p.disponible))}" value="${p.pago_deuda ?? ''}"></td>
      <td class="n">${av.meses[i] ? fmt(av.meses[i].total) : fmt(0)}</td>
      <td><input data-k="nota" value="${esc(p.nota)}"></td></tr>`).join('');

  $('#tDeudas').innerHTML = '<tr><th>Tarjeta</th><th class="n">Saldo</th><th class="n">Tasa anual %</th><th class="n">Pago mínimo</th><th class="n">Interés al mes (con IVA)</th><th>Nota</th></tr>' +
    D.Deudas.map((d, i) => `<tr data-i="${i}"><td><input data-k="nombre" value="${esc(d.nombre)}"></td>
      <td class="n"><input class="num" type="number" data-k="saldo" value="${d.saldo}"></td>
      <td class="n"><input class="num" type="number" step="0.01" data-k="tasa" value="${d.tasa}"></td>
      <td class="n"><input class="num" type="number" data-k="minimo" value="${d.minimo}"></td>
      <td class="n">${fmt(interesMensual(+d.saldo || 0, +d.tasa || 0))}</td>
      <td><input data-k="nota" value="${esc(d.nota)}"></td></tr>`).join('');

  const fechaLibre = r => r.libre ? nombreMes(new Date(new Date().getFullYear(), new Date().getMonth() + r.meses.length, 1).toISOString().slice(0, 7)) : 'no se liquida';
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
    tr.querySelectorAll('input').forEach(i => o[i.dataset.k] = i.type === 'number' && i.value !== '' ? +i.value : i.value);
    return o;
  });
  // conserva meses que ya no se muestran (pasados) tal cual
  D.Proyeccion = [...D.Proyeccion.filter(p => !conf.some(c => c.mes === p.mes)), ...conf]
    .filter(p => p.ingreso_base !== '' || p.ingreso_extra !== '' || p.pago_deuda !== '' || p.nota);
  D.Deudas = [...document.querySelectorAll('#tDeudas tr[data-i]')].map(tr => {
    const o = {}; tr.querySelectorAll('input').forEach(i => o[i.dataset.k] = i.type === 'number' ? +i.value || 0 : i.value); return o;
  }).filter(d => d.nombre);
}

// ---------- Navegación y eventos ----------
function pintarTodo() { listas(); pintarResumen(); pintarMovimientos(); pintarPresupuesto(); pintarPlan(); }

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
  sheetId = id; store('finanzas:sheet', id); await cargar();
});

['#fPeriodo', '#fAmbito'].forEach(s => $(s).onchange = pintarResumen);
['#mMes', '#mCuenta', '#mCat'].forEach(s => $(s).onchange = pintarMovimientos);
$('#mTexto').oninput = pintarMovimientos;
$('#fileCsv').onchange = conError(async e => { if (e.target.files[0]) await importar(e.target.files[0]); e.target.value = ''; });

$('#tMov').addEventListener('change', conError(async e => {
  const m = D.Movimientos.find(x => x.id === e.target.closest('tr').dataset.id);
  m[e.target.dataset.k] = e.target.value.trim();
  await guardarMovs([m]);
}));
$('#tMov').addEventListener('click', conError(async e => {
  if (!e.target.hasAttribute('data-iguales')) return;
  const m = D.Movimientos.find(x => x.id === e.target.closest('tr').dataset.id);
  const otros = D.Movimientos.filter(x => x !== m && x.nivel3 === m.nivel3 && (x.monto < 0) === (m.monto < 0));
  if (!otros.length) return alert('No hay otros movimientos de ' + m.nivel3);
  if (!confirm(`Poner "${m.nivel1} / ${m.nivel2} / ${m.ambito}" a ${otros.length} movimientos más de ${m.nivel3}?`)) return;
  otros.forEach(x => Object.assign(x, { nivel1: m.nivel1, nivel2: m.nivel2, ambito: m.ambito }));
  await guardarMovs(otros);
  pintarMovimientos();
}));

$('#btnPromedios').onclick = () => {
  document.querySelectorAll('#tPres input').forEach(i => {
    if (!i.value) { const p = -promedioMensual(m => m.nivel2 === i.dataset.n2, 3); if (p > 0) i.value = Math.round(p / 100) * 100; }
  });
};
$('#btnGuardarPres').onclick = conError(async () => {
  leerPresupuesto(); await reescribir('Presupuesto', D.Presupuesto); estado('Presupuesto guardado ✓'); pintarPresupuesto(); pintarPlan();
});
$('#tPres').addEventListener('change', () => { leerPresupuesto(); pintarPresupuesto(); });

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
