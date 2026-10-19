#!/usr/bin/env node
/**
 * Prueba de no regresión de la consulta que compone buscar-pubmed.html.
 *
 *   node tests/buscar-pubmed/constructquery.mjs               compara con la línea base
 *   node tests/buscar-pubmed/constructquery.mjs --fijar-base  reescribe la línea base
 *
 * Requisitos: Node 18+ y Playwright con Chromium. Si Playwright está instalado globalmente:
 *   NODE_PATH="$(npm root -g)" node tests/buscar-pubmed/constructquery.mjs
 * (o `npm i -D playwright && npx playwright install chromium` en una carpeta de trabajo).
 *
 * QUÉ PRUEBA. Abre la página real en Chromium, servida desde este repositorio, la maneja como un
 * usuario (escribe, pulsa filtros, cambia operadores y fecha) y lee la consulta que compone.
 *   1. Con Trending apagado, cada estado de ESTADOS debe producir exactamente la consulta de la
 *      línea base (constructquery-base.json), fijada con el código ANTERIOR a Trending. Si cambia,
 *      la página construye otra búsqueda para quien no usa Trending: eso es una regresión.
 *   2. Con Trending encendido, comprueba la semántica: se añade con AND a todo lo demás, nunca
 *      dentro del OR de una categoría, antes de la fecha, sin duplicarse si ya está escrito, cuenta
 *      en «Filtros activos», se apaga con Limpiar, se guarda y se recupera, y llega a los contadores.
 *
 * QUÉ NO PRUEBA. No usa el contenido real de los filtros: cada fichero de pubmed-filters se sustituye
 * por una cadena fija (`(id[tw])`, o `NOT (id[tw])` en los tres filtros de exclusión), para que la
 * prueba mida la composición y no cambie cuando cambie un filtro. No consulta PubMed: las llamadas
 * a E-utilities reciben un recuento ficticio y se registran.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASE = join(HERE, 'constructquery-base.json');
const FIJAR = process.argv.includes('--fijar-base');
const EXCLUSIONES = new Set(['humans', 'adults', 'ocde']);

// Cada estado es lo que haría un usuario. `filtros` usa data-type (botón simple) o base_variante
// (botón con S/E). Cubre cada categoría, los dos operadores, las variantes S/E, las exclusiones NOT,
// las revistas, la fecha, los comentarios con # y combinaciones de todo ello.
const ESTADOS = [
  { id: 'vacio' },
  { id: 'solo-termino', termino: 'heart failure' },
  { id: 'termino-con-comentario', termino: '# nota del asistente\nasthma[tiab]\n# otra nota' },
  { id: 'metodologia-una', termino: 'asthma', filtros: ['metaanalysis'] },
  { id: 'metodologia-dos-or', termino: 'asthma', filtros: ['metaanalysis', 'gpc'] },
  { id: 'metodologia-dos-and', termino: 'asthma', filtros: ['metaanalysis', 'gpc'], operadores: { methodology: 'AND' } },
  { id: 'clinico-sensible', termino: 'copd', filtros: ['treatment_sensible'] },
  { id: 'clinico-especifico', termino: 'copd', filtros: ['treatment_especifico'] },
  { id: 'ambito-ap-y-geriatria', termino: 'falls', filtros: ['primary_sensible', 'geriatrics_especifico'] },
  { id: 'exclusion-sola', termino: 'sepsis', filtros: ['humans'] },
  { id: 'exclusion-y-regular', termino: 'sepsis', filtros: ['humans', 'pediatrics'] },
  { id: 'revista-sola', filtros: ['jnl_cardiology'] },
  { id: 'revistas-dos', termino: 'atrial fibrillation', filtros: ['jnl_cardiology', 'jnl_top_publications'] },
  { id: 'solo-fecha', fecha: '7' },
  { id: 'todo-junto', termino: 'semaglutide', fecha: '30',
    filtros: ['metaanalysis', 'treatment_sensible', 'primary_sensible', 'adults', 'jnl_endocrinology'],
    operadores: { clinical: 'AND' } },
  { id: 'termino-ya-trending', termino: 'trending[sb]' },
];

// --- Servidor estático del repositorio (las rutas de la página son absolutas: /assets/...) ---
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const servidor = createServer((req, res) => {
  let ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let fichero = join(ROOT, ruta);
  if (!fichero.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (existsSync(fichero) && statSync(fichero).isDirectory()) fichero = join(fichero, 'index.html');
  if (!existsSync(fichero)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPOS[extname(fichero)] ?? 'application/octet-stream' });
  res.end(readFileSync(fichero));
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const ORIGEN = `http://127.0.0.1:${servidor.address().port}`;

// Sin red: los CDN (d3, tippy, intro.js, Font Awesome) se bloquean siempre, para que la prueba dé lo
// mismo en cualquier equipo y mida la lógica de la página, no la disponibilidad de un tercero.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
const terminosEutils = [];
const erroresPagina = [];
page.on('pageerror', (e) => { erroresPagina.push(e.message); if (process.env.DEBUG) console.error('pageerror:', e.message); });

await page.addInitScript(() => {
  try { localStorage.setItem('tutorial_visto_v3', 'true'); } catch {}
});
await page.route('**/pubmed-filters/filters/**', (route) => {
  const id = route.request().url().split('/').pop().replace(/\.txt$/, '');
  const cuerpo = EXCLUSIONES.has(id) ? `NOT (${id}[tw])` : `(${id}[tw])`;
  route.fulfill({ status: 200, contentType: 'text/plain', body: cuerpo });
});
await page.route('**/eutils.ncbi.nlm.nih.gov/**', (route) => {
  const req = route.request();
  const term = new URLSearchParams(req.postData() ?? new URL(req.url()).search).get('term');
  if (term) terminosEutils.push(term);
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"esearchresult":{"count":"1"}}' });
});

await page.goto(`${ORIGEN}/buscar-pubmed.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.constructQuery === 'function'
  && window.filterMap && Object.keys(window.filterMap).length > 50, null, { timeout: 30000 });

const hayTrending = await page.locator('#btn_trending').count() > 0;

// Los iconos de la barra son glifos de Font Awesome, que llega por CDN: sin red quedan con ancho cero
// y Playwright no los pulsa. Se pulsan por el DOM, que es lo que se prueba aquí, no el CDN.
const pulsar = (selector) => page.$eval(selector, (el) => el.click());

async function aplicar(estado, trending = false) {
  await pulsar('#resetButton');
  await page.fill('#searchTerm', estado.termino ?? '');
  for (const [cat, op] of Object.entries(estado.operadores ?? {})) {
    await page.selectOption(`.category-operator[data-category="${cat}"]`, op);
  }
  for (const f of estado.filtros ?? []) {
    const m = f.match(/^(.*)_(sensible|especifico)$/);
    const conToggle = m && await page.locator(`.filter-button.with-toggle[data-base="${m[1]}"]`).count();
    if (conToggle) {
      const boton = page.locator(`.filter-button.with-toggle[data-base="${m[1]}"]`);
      await boton.locator(`input[value="${m[2]}"]`).check();
      await boton.click({ position: { x: 8, y: 8 } });
    } else {
      await page.click(`.filter-button[data-type="${f}"]`);
    }
  }
  await page.selectOption('#dateRange', estado.fecha ?? '');
  if (trending) await pulsar('#btn_trending');
}
const leer = () => page.evaluate(() => ({
  consulta: window.constructQuery(document.getElementById('searchTerm').value.trim()),
  visible: document.getElementById('finalQuery').textContent,
  activos: document.getElementById('filterCount').textContent,
}));

const fallos = [];
const pasa = [];
const comprobar = (id, ok, detalle) => (ok ? pasa : fallos).push(`${id}  ${detalle}`);

// 1. No regresión con Trending apagado
const actual = {};
for (const e of ESTADOS) {
  await aplicar(e);
  const r = await leer();
  actual[e.id] = r.consulta;
  comprobar(`visible:${e.id}`, r.visible === r.consulta, 'la consulta visible coincide con la que se envía');
}
if (FIJAR) {
  writeFileSync(BASE, `${JSON.stringify(actual, null, 2)}\n`);
  console.log(`Línea base escrita: ${Object.keys(actual).length} estados en ${BASE}`);
} else {
  const base = JSON.parse(readFileSync(BASE, 'utf8'));
  for (const e of ESTADOS) {
    comprobar(`base:${e.id}`, actual[e.id] === base[e.id],
      actual[e.id] === base[e.id] ? 'igual que antes de Trending' : `CAMBIA\n      antes:   ${base[e.id]}\n      ahora:   ${actual[e.id]}`);
  }
}

// 2. Semántica de Trending
if (!hayTrending) {
  console.log('La página no tiene #btn_trending: solo se ha comprobado la línea base.');
} else {
  const T = 'trending[sb]';
  const conT = async (e) => { await aplicar(e, true); return leer(); };

  let r = await conT({});
  comprobar('T1', r.consulta === T, `sin nada más, solo ${T}: ${r.consulta}`);
  comprobar('T2', r.activos === '1', `cuenta como filtro activo: ${r.activos}`);
  comprobar('T3', await page.getAttribute('#btn_trending', 'aria-pressed') === 'true', 'aria-pressed=true al activarlo');

  r = await conT({ termino: 'heart failure' });
  comprobar('T4', r.consulta === `(heart failure) AND ${T}`, `se añade con AND al término: ${r.consulta}`);

  const ap = ESTADOS.find((e) => e.id === 'ambito-ap-y-geriatria');
  r = await conT(ap);
  comprobar('T5', r.consulta === `(${actual[ap.id]}) AND ${T}`,
    `fuera del OR de la categoría, envolviendo la consulta previa: ${r.consulta}`);

  const todo = ESTADOS.find((e) => e.id === 'todo-junto');
  r = await conT(todo);
  const sinFecha = actual[todo.id].replace(/^\((.*)\) AND \("last 30 days"\[dp\]\)$/, '$1');
  comprobar('T6', r.consulta === `((${sinFecha}) AND ${T}) AND ("last 30 days"[dp])`,
    `antes de la fecha, que sigue siendo la última: ${r.consulta}`);
  // Se compara con lo esperado y no con el contador sin Trending: sin d3 (CDN bloqueado), el cambio de
  // fecha lanza en mostrarQueryFinal antes de actualizar el contador, y ese valor queda atrasado.
  const esperados = todo.filtros.length + 1 /* fecha */ + 1 /* Trending */;
  comprobar('T7', r.activos === String(esperados), `suma uno a «Filtros activos»: ${r.activos} de ${esperados}`);

  r = await conT({ termino: 'covid AND Trending[SB]' });
  comprobar('T8', (r.consulta.match(/trending\[sb\]/gi) ?? []).length === 1,
    `no se duplica si ya está escrito: ${r.consulta}`);

  await conT({ termino: 'asthma' });
  await pulsar('#resetButton');
  r = await leer();
  comprobar('T9', r.consulta === '' && await page.getAttribute('#btn_trending', 'aria-pressed') === 'false',
    'Limpiar lo apaga');

  // Guardar y recuperar, y una búsqueda guardada antes de Trending (sin el campo)
  await page.evaluate(() => localStorage.setItem('saved_searches', JSON.stringify({
    antigua: { termino: 'asthma', filtros: [], fecha: '', orden: 'date' } })));
  await conT({ termino: 'gout' });
  await pulsar('#btn_guardar');
  await page.fill('#nombreNuevaBusqueda', 'con-trending');
  await pulsar('#guardarBusquedaConfirm');
  const guardada = await page.evaluate(() => JSON.parse(localStorage.getItem('saved_searches'))['con-trending']);
  comprobar('T10', guardada?.trending === true, `se guarda: ${JSON.stringify(guardada)}`);

  const recuperar = async (nombre) => {
    await pulsar('#btn_recuperar');
    await page.selectOption('#recuperarSelect', nombre);
    await pulsar('#recuperarBusquedaConfirm');
    // Sin d3 (CDN bloqueado) el diagrama lanza un error antes de cerrar el modal; se cierra a mano.
    await page.evaluate(() => document.getElementById('modalRecuperarFondo').classList.remove('show'));
    return leer();
  };
  await pulsar('#resetButton');
  r = await recuperar('con-trending');
  comprobar('T11', r.consulta === `(gout) AND ${T}`, `se recupera: ${r.consulta}`);
  r = await recuperar('antigua');
  comprobar('T12', r.consulta === 'asthma' && await page.getAttribute('#btn_trending', 'aria-pressed') === 'false',
    `una búsqueda guardada antes de Trending se recupera sin él: ${r.consulta}`);

  // Contadores: con Trending y una revista, el contador comparativo de revistas también lo lleva
  await pulsar('#resetButton');
  await page.fill('#searchTerm', 'statins');
  await pulsar('#btn_trending');
  terminosEutils.length = 0;
  await page.click('.filter-button[data-type="jnl_cardiology"]');
  await page.waitForTimeout(2500);
  const sinT = terminosEutils.filter((t) => !/trending\[sb\]/i.test(t));
  comprobar('T13', terminosEutils.length > 0 && sinT.length === 0,
    `las ${terminosEutils.length} consultas de los contadores llevan Trending${sinT.length ? `; sin él: ${JSON.stringify(sinT)}` : ''}`);

  // Con Trending, la API y la web de PubMed no dan la misma cifra: los recuentos se marcan con ≈
  const textos = await page.evaluate(() => ({
    principal: document.getElementById('persistentSearchCountText').textContent,
    revistas: document.getElementById('journalsCounterText').textContent,
  }));
  comprobar('T14', textos.principal.startsWith('≈') && textos.revistas.startsWith('≈'),
    `con Trending los recuentos van marcados como aproximados: «${textos.principal}» / «${textos.revistas}»`);
  await pulsar('#btn_trending');
  await page.waitForTimeout(2500);
  const principalSinT = await page.$eval('#persistentSearchCountText', (el) => el.textContent);
  comprobar('T15', !principalSinT.includes('≈'), `sin Trending, sin marca: «${principalSinT}»`);
}

// 3. Contador comparativo de revistas: su «de N en total» es la consulta real sin revistas.
// La revista va primero para que ninguna consulta intermedia del contador principal coincida ya con la
// esperada; el término es único para no leerla de la caché de contadores.
{
  const conRevista = { termino: 'gout flare', operadores: { methodology: 'AND' },
    filtros: ['jnl_cardiology', 'metaanalysis', 'gpc', 'humans'] };
  terminosEutils.length = 0;
  await aplicar(conRevista);
  await page.waitForTimeout(3000);
  const enviados = [...terminosEutils];
  await aplicar({ ...conRevista, filtros: conRevista.filtros.filter((f) => !f.startsWith('jnl_')) });
  const sinRevistas = (await leer()).consulta;
  comprobar('C1', enviados.includes(sinRevistas),
    `con AND y una exclusión NOT, el total comparado es la consulta sin revistas, y se recalcula al pulsar filtros que no son de revistas: ${sinRevistas}${
      enviados.includes(sinRevistas) ? '' : `\n      enviadas: ${JSON.stringify(enviados)}`}`);
}

await browser.close();
servidor.close();

for (const p of pasa) console.log(`  pass  ${p}`);
for (const f of fallos) console.log(`  FAIL  ${f}`);
console.log(`\n${pasa.length} pass / ${fallos.length} fail`);
process.exit(fallos.length ? 1 : 0);
