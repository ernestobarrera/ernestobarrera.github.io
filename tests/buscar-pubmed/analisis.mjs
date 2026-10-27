#!/usr/bin/env node
/**
 * Prueba del panel de análisis de resultados y de los dos defectos que lo preceden.
 *
 *   node tests/buscar-pubmed/analisis.mjs
 *
 * Requisitos: los de constructquery.mjs (Node 18+ y Playwright con Chromium; con Playwright global,
 * NODE_PATH="$(npm root -g)").
 *
 * QUÉ PRUEBA, con la página real en Chromium y PubMed simulado:
 *   A. El contador de un botón pide la consulta que da ACTIVAR ese filtro (la compone constructQuery),
 *      también con OR dentro de la categoría. Antes pedía «consulta actual AND filtro», que con OR
 *      estrecha en vez de ampliar.
 *   B. Un filtro cuyo fichero no carga se marca, se avisa junto a la consulta si está activo, y su
 *      contador dice «?»; nunca desaparece de la consulta en silencio.
 *   C. El panel: cada cifra enlaza a PubMed con su consulta literal; la cascada sigue el orden del
 *      constructor; un fallo se pinta «fallo» y no 0; un aviso de PubMed (errorlist) se marca ⚠;
 *      el último cambio compara la consulta estable anterior con la actual (salen / entran).
 *   D. La página ya no pide d3 ni venn.js.
 *
 * QUÉ NO PRUEBA: recuentos reales de PubMed (las cifras son ficticias y deterministas), el aspecto
 * visual ni lectores de pantalla.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const EXCLUSIONES = new Set(['humans', 'adults', 'ocde']);
const FILTRO_ROTO = 'qualitative';

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const servidor = createServer((req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let fichero = join(ROOT, ruta);
  if (!fichero.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (existsSync(fichero) && statSync(fichero).isDirectory()) fichero = join(fichero, 'index.html');
  if (!existsSync(fichero)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TIPOS[extname(fichero)] ?? 'application/octet-stream' });
  res.end(readFileSync(fichero));
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const ORIGEN = `http://127.0.0.1:${servidor.address().port}`;

let fallos = 0;
let pasan = 0;
function comprobar(id, ok, texto) {
  if (ok) { pasan++; console.log(`  pass  ${id}  ${texto}`); } else { fallos++; console.log(`  FAIL  ${id}  ${texto}`); }
}

// Recuento ficticio y determinista por consulta; algunas consultas fallan o traen avisos a propósito.
const recuento = (t) => 1 + [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);

const browser = await chromium.launch();
const page = await browser.newPage();
const pedidosTerceros = [];
const terminos = [];
const erroresPagina = [];
page.on('pageerror', (e) => erroresPagina.push(e.stack || e.message));
page.on('request', (r) => { if (/d3js\.org|venn\.js/.test(r.url())) pedidosTerceros.push(r.url()); });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
await page.addInitScript(() => { try { localStorage.setItem('tutorial_visto_v3', 'true'); } catch {} });
await page.route('**/pubmed-filters/filters/**', (route) => {
  const id = route.request().url().split('/').pop().replace(/\.txt$/, '');
  if (id === FILTRO_ROTO) return route.fulfill({ status: 404, body: '' });
  route.fulfill({ status: 200, contentType: 'text/plain', body: EXCLUSIONES.has(id) ? `NOT (${id}[tw])` : `(${id}[tw])` });
});
await page.route('**/eutils.ncbi.nlm.nih.gov/**', (route) => {
  const req = route.request();
  const term = new URLSearchParams(req.postData() ?? new URL(req.url()).search).get('term') ?? '';
  terminos.push(term);
  if (term.includes('case reports[pt]')) return route.fulfill({ status: 500, body: 'error' });
  const r = { count: String(recuento(term)), querytranslation: `TRAD(${term})` };
  if (term.includes('zzzz')) r.errorlist = { phrasesnotfound: ['zzzz'], fieldsnotfound: [] };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ esearchresult: r }) });
});

await page.goto(`${ORIGEN}/buscar-pubmed.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.constructQuery === 'function'
  && window.filterMap && Object.keys(window.filterMap).length > 50 && window.PubMedConsultas, null, { timeout: 30000 });
await page.waitForTimeout(500);

const pulsar = (sel) => page.$eval(sel, (el) => el.click());
const consultaFinal = () => page.$eval('#finalQuery', (el) => el.textContent);

// ---- D
comprobar('D1', pedidosTerceros.length === 0, `no se pide d3 ni venn.js (${pedidosTerceros.length} peticiones)`);
comprobar('D2', await page.locator('.venn-container, #venn-diagram').count() === 0, 'ya no existe el contenedor del Venn');

// ---- A: contador con OR
await page.fill('#searchTerm', 'asthma');
await pulsar('.filter-button[data-type="gpc"]');
await page.waitForTimeout(200);
terminos.length = 0;
await page.waitForFunction(() => { const b = document.getElementById('toggleCountersBtn'); return b && !b.disabled; }, null, { timeout: 15000 });
await pulsar('#toggleCountersBtn');
const esperado = '(asthma) AND ((gpc[tw]) OR (metaanalysis[tw]))';
const viejo = '((asthma) AND ((gpc[tw]))) AND ((metaanalysis[tw]))';
const t0 = Date.now();
while (Date.now() - t0 < 60000 && !terminos.includes(esperado)) await page.waitForTimeout(250);
comprobar('A1', terminos.includes(esperado), `con OR, el contador de «metaanalysis» pide ${esperado}`);
comprobar('A2', !terminos.includes(viejo), 'y no la consulta antigua «actual AND filtro»');
const contRoto = await page.$eval(`.filter-button[data-type="${FILTRO_ROTO}"] .result-counter`, (el) => el.textContent).catch(() => null);
comprobar('B3', contRoto === '?', `el contador del filtro que no cargó dice «?» (dice ${JSON.stringify(contRoto)})`);
await pulsar('#toggleCountersBtn'); // apagar contadores: no compiten con el panel en lo que sigue

// ---- B: filtro que no carga
comprobar('B1', await page.$eval(`.filter-button[data-type="${FILTRO_ROTO}"]`, (el) => el.classList.contains('filter-failed')), 'el botón del filtro que no cargó queda marcado');
await pulsar(`.filter-button[data-type="${FILTRO_ROTO}"]`);
await page.waitForTimeout(150);
const aviso = await page.$eval('#filtrosNoAplicados', (el) => ({ hidden: el.hidden, texto: el.textContent }));
comprobar('B2', !aviso.hidden && /NO forma parte de la consulta/.test(aviso.texto), `aviso visible: «${aviso.texto.slice(0, 70)}…»`);
await pulsar(`.filter-button[data-type="${FILTRO_ROTO}"]`);
await page.waitForTimeout(150);
comprobar('B4', await page.$eval('#filtrosNoAplicados', (el) => el.hidden), 'al desactivarlo, el aviso desaparece');

// ---- C: panel
await pulsar('#resetButton');
await page.fill('#searchTerm', 'asthma zzzz');
await page.$eval('#searchTerm', (el) => el.dispatchEvent(new Event('input', { bubbles: true })));
await pulsar('.filter-button[data-type="gpc"]');
await page.waitForTimeout(1500); // la consulta se mantiene: pasa a ser el «antes»
await pulsar('.filter-button[data-type="metaanalysis"]');
await page.selectOption('.category-operator[data-category="methodology"]', 'AND');
await page.waitForTimeout(100);
await pulsar('.filter-button[data-base="treatment"]');
await page.waitForTimeout(1500);
await pulsar('#toggleAnalisisButton');
await page.waitForFunction(() => {
  const n = [...document.querySelectorAll('#analisisPanel .an-num')];
  return n.length > 20 && n.every((el) => el.textContent !== '…');
}, null, { timeout: 120000 });

const panel = await page.evaluate(() => {
  const nums = [...document.querySelectorAll('#analisisPanel .an-num')].map((el) => ({ q: el.dataset.q, href: el.getAttribute('href'), t: el.textContent, cls: el.className }));
  const pasos = [...document.querySelectorAll('#analisisPanel .an-cascada tbody th')].map((th) => th.childNodes[0].textContent.trim());
  return { nums, pasos, final: document.getElementById('finalQuery').textContent, cambio: document.querySelector('#analisisPanel .an-cambio')?.textContent || '',
    composicion: [...document.querySelectorAll('#analisisPanel .an-composicion li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
    traduccion: document.querySelector('#analisisPanel [data-traduccion]')?.textContent || '' };
});

comprobar('C1', panel.nums.every((n) => n.href === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(n.q)), `las ${panel.nums.length} cifras enlazan a PubMed con su consulta literal`);
comprobar('C2', JSON.stringify(panel.pasos) === JSON.stringify(['Solo tus términos', '+ Metodología', '+ Clínico']), `cascada en el orden del constructor: ${panel.pasos.join(' → ')}`);
const casos = panel.nums.filter((n) => n.q.includes('case reports[pt]'));
comprobar('C3', casos.length > 0 && casos.every((n) => n.t === 'fallo' && /an-fallo/.test(n.cls)), `un recuento fallido se pinta «fallo», nunca 0 (${casos.length} celdas)`);
const finalNum = panel.nums.find((n) => n.q === panel.final);
comprobar('C4', finalNum && /⚠/.test(finalNum.t), 'la cifra con errorlist de PubMed lleva ⚠');
comprobar('C5', finalNum && finalNum.t.replace(/[^\d]/g, '') === String(recuento(panel.final)), `la cifra final es la que devolvió PubMed (${finalNum?.t})`);
const antes = '(asthma zzzz) AND ((gpc[tw]))';
comprobar('C6', panel.nums.some((n) => n.q === `(${antes}) NOT (${panel.final})`) && panel.nums.some((n) => n.q === `(${panel.final}) NOT (${antes})`), 'el último cambio compara la consulta estable anterior con la actual (salen y entran)');
comprobar('C7', panel.composicion.some((l) => /^Y ?\(.+ Y .+\) ?Metodología$/.test(l)), `la composición muestra el operador elegido: ${panel.composicion.join(' | ')}`);
comprobar('C8', panel.traduccion === `TRAD(${panel.final})`, 'muestra lo que ejecutó PubMed (querytranslation)');
comprobar('C9', panel.nums.some((n) => n.q === `(${panel.final}) AND (${new Date().getFullYear()}[dp])`), 'la serie anual usa la consulta final con [dp]');

// Con el panel ABIERTO se cambia un filtro: el panel recalcula antes de que la consulta nueva se dé por
// estable, y el «antes» tiene que ser la consulta que había justo antes del cambio, no la previa a ella.
const previa = panel.final;
await pulsar('.filter-button[data-type="horizon"]');
await page.waitForFunction((p) => {
  const n = [...document.querySelectorAll('#analisisPanel .an-num')];
  const f = document.getElementById('finalQuery').textContent;
  return f !== p && n.length > 20 && n.every((el) => el.textContent !== '…') && n.some((el) => el.dataset.q === `(${p}) NOT (${f})`);
}, previa, { timeout: 120000 }).then(() => true, () => false).then((ok) => comprobar('C11', ok, 'con el panel abierto, el último cambio compara con la consulta de justo antes'));

// Sin términos ni filtros, el panel no consulta y lo explica.
await pulsar('#resetButton');
await page.waitForTimeout(1200);
comprobar('C10', await page.locator('#analisisPanel .an-vacio').count() === 1, 'sin búsqueda, el panel explica qué mostrará y no consulta');

// Dos errores PREVIOS a este cambio, ya en main (27/10/2026): .search-tips-header y #nombreNuevaBusqueda
// no existen y su addEventListener lanza al cargar. No son de este panel; se excluyen por su mensaje y
// se exige que ningún error venga de los módulos tocados aquí.
const previos = (e) => /reading 'addEventListener'/.test(e) && !/analisis-buscar-pubmed|counters-buscar-pubmed/.test(e);
const nuevos = erroresPagina.filter((e) => !previos(e));
comprobar('E1', nuevos.length === 0, `sin errores de JavaScript nuevos${nuevos.length ? ': ' + nuevos.join(' | ') : ''} (${erroresPagina.length - nuevos.length} previos, conocidos)`);

await browser.close();
servidor.close();
console.log(`\n${pasan} pass / ${fallos} fail`);
process.exit(fallos ? 1 : 0);
