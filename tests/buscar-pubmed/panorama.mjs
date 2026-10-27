#!/usr/bin/env node
/**
 * Contrato del panorama: cifras y conjuntos, consultas bajo demanda, fallos y móvil.
 * Usa el módulo real con un adaptador de búsqueda fijo y recuentos simulados.
 * La integración con el constructor/cola reales se comprueba en los otros dos tests.
 * No hace llamadas a PubMed. --capturas <carpeta> guarda vistas de QA opcionales.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const js = readFileSync(join(root, 'assets/js/analisis-buscar-pubmed.js'), 'utf8');
const css = readFileSync(join(root, 'assets/css/analisis-buscar-pubmed.css'), 'utf8');
const capturas = process.argv.includes('--capturas') ? resolve(process.argv[process.argv.indexOf('--capturas') + 1]) : null;
if (capturas) mkdirSync(capturas, { recursive: true });
const A = 'apixaban', B = '(apixaban) AND (Therapy/Narrow[filter])';
const and = (a, b) => '(' + a + ') AND (' + b + ')';
const not = (a, b) => '(' + a + ') NOT (' + b + ')';
const filas = [
  ['guia', '(guideline[pt] OR practice guideline[pt])', 35, 0],
  ['sistematica', 'systematic review[pt]', 374, 22],
  ['metaanalisis', 'meta-analysis[pt]', 392, 25],
  ['aleatorizado', 'randomized controlled trial[pt]', 301, 301],
  ['otros-ensayos', '(clinical trial[pt] NOT randomized controlled trial[pt])', 72, 0],
  ['observacional', 'observational study[pt]', 302, 4],
  ['cohortes', '("cohort studies"[mh] OR "case-control studies"[mh])', 1367, 92],
  ['cualitativo', '(qualitative-fixture[tw])', 55, 2],
  ['revision', 'review[pt]', 2100, 57],
  ['caso', 'case reports[pt]', 954, 1],
];
let bien = 0, mal = 0;
function check(id, ok, mensaje) { console.log((ok ? '  pass  ' : '  FAIL  ') + id + '  ' + mensaje); ok ? bien++ : mal++; }
const browser = await chromium.launch();
const paginas = [];
async function montar({ filtrado = true, control = 0, cambios = [], lento = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 }, reducedMotion: 'reduce' });
  paginas.push(page);
  await page.route('**/*', (r) => r.abort());
  const datos = [[A, 7372], [B, 413], [not(B, A), control]];
  filas.forEach(([, q, a, b]) => { datos.push([and(A, q), a], [and(B, q), b], [not(and(A, q), B), a - b]); });
  for (let i = 0; i < 20; i++) {
    const year = new Date().getFullYear() - i;
    datos.push([and(A, year + '[dp]'), i ? 100 : 1000], [and(B, year + '[dp]'), i ? 20 : 100]);
  }
  cambios.forEach(([q, v]) => { const ix = datos.findIndex(([k]) => k === q); ix < 0 ? datos.push([q,v]) : datos[ix] = [q,v]; });
  await page.setContent('<html lang="es"><head><meta charset="utf-8"></head><body style="margin:16px;background:#0a0f1a;color:#f8fafc;font-family:Arial,sans-serif"><main style="max-width:1160px;margin:auto"><button id="toggleAnalisisButton" aria-controls="analisisPanel" aria-expanded="false"><span>Análisis de resultados</span></button><section id="analisisPanel" class="analisis-panel" hidden></section></main></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate(({ datos, filtrado, lento, A, B }) => {
    window._datos = new Map(datos);
    window._calls = [];
    window._pendientes = [];
    window._filtrado = filtrado;
    window._termino = A;
    window._base = A;
    window._final = B;
    window.filterMap = { qualitative: '(qualitative-fixture[tw])' };
    window.estadoBusqueda = () => ({ termino: window._termino, activos: new Set(window._filtrado ? ['treatment_especifico'] : []),
      categorias: { clinical: ['treatment_especifico'] }, operadores: { clinical: 'AND' }, trending: false, fecha: '' });
    window.constructQuery = (term, o) => o?.activos?.size === 0 || !window._filtrado ? window._base : window._final;
    window.etiquetaFiltro = () => 'Tratamiento-CQ (E)';
    window.filtrosNoAplicados = () => [];
    window.PubMedConsultas = { contar: async (q) => {
      window._calls.push(q);
      if (lento) await new Promise((ok) => window._pendientes.push(ok)); // ignora abort a propósito
      const d = window._datos.get(q);
      if (d === null || d === undefined) throw new Error('Fallo de fixture');
      return typeof d === 'number' ? { count: d, traduccion: q, avisos: [], errores: [] } : d;
    }};
  }, { datos, filtrado, lento, A, B });
  await page.addScriptTag({ content: js });
  await page.evaluate(() => document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.click('#toggleAnalisisButton');
  if (!lento) await listo(page);
  return page;
}
const listo = (p) => p.waitForFunction(() => /recuentos ·/.test(document.querySelector('[data-estado]')?.textContent || ''));
const nPedidos = (p) => p.evaluate(() => window._calls.length);
const texto = (p, sel) => p.locator(sel).textContent();
const ruta = (id) => '[data-ruta="' + id + '"]';
const abrir = (p, id) => p.locator('[data-seccion="' + id + '"]').evaluate((e) => { e.open = true; });

try {
  const p = await montar();
  check('P01', await nPedidos(p) === 23, '23 consultas iniciales con filtros, incluido el control de inclusión');
  check('P02', await p.locator('.an-ruta').count() === 10, 'las diez rutas están visibles sin desplegar secciones');
  check('P03', /301/.test(await texto(p, ruta('aleatorizado') + ' .an-conserva')) && await texto(p, '[data-fuera="aleatorizado"]') === '0', '301 ensayos conservados y cero fuera; no se confunde proporción con ganancia');
  check('P04', await texto(p, '[data-fuera="guia"]') === '35', '35 guías fuera con esta combinación de filtros');
  check('P05', await p.locator('[data-fuera="guia"]').getAttribute('href') === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(not(and(A, filas[0][1]), B)), 'Fuera enlaza al conjunto literal A∩tipo NOT B');
  check('P06', await p.locator('[data-barra="ruta-aleatorizado"]').evaluate((e) => e.style.width) === '100%', 'la barra mide conservación dentro de la misma fila');
  check('P07', await p.locator('[data-fuera-total] a').getAttribute('href') === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(not(A, B)), 'el total excluido también abre su conjunto');
  const enlacesFuera = await p.locator('[data-fuera]').evaluateAll((els) => els.map((e) => [e.dataset.fuera, e.href]));
  check('P17', filas.every(([id,q]) => enlacesFuera.some(([i,h]) => i === id && h === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(not(and(A,q),B)))), 'cada una de las diez diferencias abre su consulta exacta');
  await p.locator(ruta('cohortes') + ' summary').click();
  check('P08', await nPedidos(p) === 23 && /MeSH/.test(await texto(p, ruta('cohortes') + ' details')), 'aclarar qué cuenta no consulta la API');
  await p.locator(ruta('cohortes') + ' summary').click();
  check('P09', /20/.test(await texto(p, '[data-seccion="anios"] [data-coste]')), 'la serie anual anuncia sus veinte recuentos adicionales');
  await abrir(p, 'anios'); await p.waitForFunction(() => window._calls.length === 43); await listo(p);
  check('P10', await nPedidos(p) === 43, 'abrir la serie solo añade sus veinte consultas');
  const anchuras = await p.locator('[data-barra]').evaluateAll((els) => els.filter((e) => /a[BF]/.test(e.dataset.barra)).slice(0,2).map((e) => e.style.width));
  check('P11', JSON.stringify(anchuras) === JSON.stringify(['100%', '10%']), 'ambas series anuales comparten escala');
  await p.click('[data-anios="20"]'); await p.waitForFunction(() => window._calls.length === 63); await listo(p);
  await p.click('[data-anios="10"]');
  check('P12', await nPedidos(p) === 63 && await p.locator('.an-anios .an-num').evaluateAll((els) => els.every((e) => e.textContent !== '…')), 'volver a diez años reutiliza y repinta lo resuelto');
  check('P13', await p.locator('[data-anios="10"]').evaluate((e) => e === document.activeElement), 'cambiar años conserva el foco del teclado');
  await p.locator('[data-seccion="anios"]').evaluate((e) => { e.open = false; });
  await abrir(p, 'anios'); await p.waitForTimeout(50);
  check('P14', await nPedidos(p) === 63, 'reabrir una sección no repite consultas');
  await p.locator('[data-seccion="anios"]').evaluate((e) => { e.open = false; });

  for (const ancho of [1366, 768, 390, 320]) {
    await p.setViewportSize({ width: ancho, height: 1000 });
    const d = await p.evaluate(() => {
      const panel = document.querySelector('#analisisPanel'), r = panel.getBoundingClientRect();
      const barras = [...panel.querySelectorAll('.an-ruta-barra .an-barra')];
      return { overflow: panel.scrollWidth > panel.clientWidth + 1 || r.right > innerWidth, barras: barras.every((b) => b.getBoundingClientRect().width > 0),
        resumen: document.querySelector('.an-panorama').getBoundingClientRect().height };
    });
    check('V' + ancho, !d.overflow && d.barras, 'sin desbordamiento y con diez barras visibles a ' + ancho + ' px (panorama ' + Math.round(d.resumen) + ' px)');
    if (capturas && [1366,390].includes(ancho)) await p.locator('#analisisPanel').screenshot({ path: join(capturas, 'panorama-' + ancho + '.png') });
  }
  const s = await montar({ filtrado: false });
  check('P15', await nPedidos(s) === 11 && await s.locator('.an-conserva').count() === 0, 'sin filtros: once consultas y una sola serie');
  check('P16', /4,1 %/.test(await texto(s, '[data-retencion="aleatorizado"]')), 'sin filtros las barras indican proporción dentro de la búsqueda');
  const d = await montar({ control: 5 });
  check('F01', await texto(d, '[data-fuera="guia"]') === 'Ver fuera' && await d.locator('[data-comparacion-aviso]').isVisible(), 'si B no está contenido en A, no resta ni publica una falsa pérdida');
  await d.setViewportSize({ width: 320, height: 844 });
  check('F11', await d.locator('#analisisPanel').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'la alternativa de cálculo manual también cabe a 320 px');
  await d.click('[data-medir-fuera="guia"]'); await listo(d);
  check('F02', await nPedidos(d) === 24 && await texto(d, '[data-fuera="guia"]') === '35', 'medir una diferencia requiere una consulta explícita adicional');
  const e = await montar({ control: null });
  check('F03', await texto(e, '[data-fuera="guia"]') === 'Ver fuera' && await e.locator('[data-medir-fuera="guia"]').isVisible(), 'un control fallido no se interpreta como inclusión');
  const f = await montar({ cambios: [[and(B, filas[9][1]), null]] });
  check('F04', await texto(f, ruta('caso') + ' .an-conserva') === 'fallo' && await texto(f, '[data-fuera="caso"]') === 'Ver fuera', 'un fallo de fila no se transforma en cero conservados ni en pérdida total');
  check('F05', await f.locator(ruta('caso') + ' .an-barra').evaluate((e) => e.classList.contains('an-sin-dato')), 'barra sin dato distinguible del cero');
  const g = await montar({ cambios: [[and(B, filas[3][1]), { count: 301, traduccion: '', avisos: [], errores: [] }]] });
  check('F06', /⚠/.test(await texto(g, ruta('aleatorizado') + ' .an-conserva')) && await texto(g, '[data-fuera="aleatorizado"]') === 'Ver fuera', 'sin traducción se conserva la cifra avisada y se impide derivar');
  const h = await montar({ cambios: [[and(B, filas[3][1]), { count: 301, traduccion: 'x', avisos: ['phrasesignored: prueba'], errores: [] }]] });
  check('F07', await texto(h, '[data-fuera="aleatorizado"]') === 'Ver fuera', 'los avisos de PubMed impiden deducciones');
  const i = await montar({ cambios: [[and(B, filas[3][1]), 302]] });
  check('F08', await texto(i, '[data-fuera="aleatorizado"]') === 'Ver fuera', 'una contradicción entre recuentos no produce pérdidas negativas');
  const j = await montar({ cambios: [[and(B, filas[0][1]), { count: 0, traduccion: 'x', avisos: ['outputmessages: No items found.'], errores: [] }]] });
  check('F09', await texto(j, '[data-fuera="guia"]') === '35', 'No items found permite tratar un cero documentado como cero');
  const k = await montar({ lento: true });
  await k.evaluate(() => {
    window._termino = 'otra búsqueda'; window._base = 'otra'; window._final = '(otra) AND x';
    document.dispatchEvent(new CustomEvent('consulta-cambiada', { detail: { consulta: window._final } }));
    window._pendientes.splice(0).forEach((ok) => ok());
  });
  await k.waitForTimeout(100);
  check('F10', await texto(k, ruta('aleatorizado') + ' .an-conserva') === '…', 'una respuesta antigua no pinta durante la espera de recálculo, aunque ignore abort');
  const etiquetas = await p.locator('.an-ruta [role="rowheader"]').count();
  check('A01', etiquetas === 10 && await p.locator('[role="table"][aria-label]').count() === 1, 'filas, cabeceras y tabla tienen semántica accesible');
  check('A02', await p.locator('[data-estado][role="status"][aria-live="polite"]').count() === 1, 'el progreso se anuncia de forma no intrusiva');
} finally {
  await browser.close();
}
console.log('\n' + bien + ' pass / ' + mal + ' fail');
process.exitCode = mal ? 1 : 0;

