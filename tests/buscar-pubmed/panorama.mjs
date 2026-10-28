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
const atlas = readFileSync(join(root, 'assets/js/atlas-buscar-pubmed.js'), 'utf8');
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
async function montar({ filtrado = true, control = 0, cambios = [], lento = false, activo = 'treatment_especifico' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  paginas.push(page);
  await page.route(/^https?:\/\//, (r) => r.abort());
  const datos = [[A, 7372], [B, 413], [not(B, A), control]];
  filas.forEach(([, q, a, b]) => { datos.push([and(A, q), a], [and(B, q), b], [not(and(A, q), B), a - b]); });
  for (let i = 0; i < 20; i++) {
    const year = new Date().getFullYear() - i;
    datos.push([and(A, year + '[dp]'), i ? 100 : 1000], [and(B, year + '[dp]'), i ? 20 : 100]);
  }
  cambios.forEach(([q, v]) => { const ix = datos.findIndex(([k]) => k === q); ix < 0 ? datos.push([q,v]) : datos[ix] = [q,v]; });
  await page.setContent('<html lang="es"><head><meta charset="utf-8"></head><body style="margin:16px;background:#0a0f1a;color:#f8fafc;font-family:Arial,sans-serif"><main style="max-width:1160px;margin:auto"><button id="toggleAnalisisButton" aria-controls="analisisPanel" aria-expanded="false"><span>Análisis de resultados</span></button><section id="analisisPanel" class="analisis-panel" hidden></section></main></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate(({ datos, filtrado, lento, A, B, activo }) => {
    window._datos = new Map(datos);
    window._calls = [];
    window._pendientes = [];
    window._filtrado = filtrado;
    window._termino = A;
    window._base = A;
    window._final = B;
    window.filterMap = { qualitative: '(qualitative-fixture[tw])', treatment_especifico: '(Therapy/Narrow[filter])' };
    window.estadoBusqueda = () => ({ termino: window._termino, activos: new Set(window._filtrado ? [activo] : []),
      categorias: { clinical: [activo] }, operadores: { clinical: 'AND' }, trending: false, fecha: '' });
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
  }, { datos, filtrado, lento, A, B, activo });
  await page.addScriptTag({ content: atlas });
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
const valoresCruce = (p, valores) => p.evaluate((datos) => {
  [...document.querySelectorAll('.an-region .an-num')].forEach((el, i) => window._datos.set(el.dataset.q, datos[i]));
}, valores);

try {
  const p = await montar();
  check('P01', await nPedidos(p) === 23, '23 consultas iniciales con filtros, incluido el control de inclusión');
  check('P02', await p.locator('.an-ruta').count() === 10, 'las diez rutas están visibles sin desplegar secciones');
  const conjuntos = ['Disponibles', 'Conservados', 'Fuera'];
  check('C01', JSON.stringify((await p.locator('.an-resumen > div > .an-sub').allTextContents()).slice(0,3)) === JSON.stringify(conjuntos)
    && JSON.stringify((await p.locator('.an-rutas-cabecera [role="columnheader"]').allTextContents()).slice(-3)) === JSON.stringify(conjuntos)
    && JSON.stringify(await p.locator('.an-ruta').first().locator('.an-label-movil').allTextContents()) === JSON.stringify(conjuntos), 'cabecera, tabla y móvil nombran los mismos conjuntos de la misma forma');
  check('C02', !/\b[AB]\b/.test(await texto(p,'.an-leyenda'))
    && JSON.stringify(await p.locator('[data-cruce-universo] option').allTextContents()) === JSON.stringify(conjuntos.slice(0,2))
    && /Disponibles:.*Conservados:/.test(await texto(p,'.an-conjuntos')), 'A/B queda reservado a las lentes; los universos usan los mismos nombres y tienen definición visible');
  check('P03', /301/.test(await texto(p, ruta('aleatorizado') + ' .an-conserva')) && await texto(p, '[data-fuera="aleatorizado"]') === '0', '301 ensayos conservados y cero fuera; no se confunde proporción con ganancia');
  check('P04', await texto(p, '[data-fuera="guia"]') === '35', '35 guías fuera con esta combinación de filtros');
  check('P05', await p.locator('[data-fuera="guia"]').getAttribute('href') === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(not(and(A, filas[0][1]), B)), 'Fuera enlaza al conjunto literal A∩tipo NOT B');
  await p.click('[data-atlas-modo="conservacion"]');
  check('P06', await p.locator('[data-barra="ruta-aleatorizado"]').evaluate((e) => e.style.width) === '100%', 'en modo conservación, la barra mide la misma fila');
  await p.click('[data-atlas-modo="volumen"]');
  const volumen = await p.locator('[data-barra-base="revision"]').evaluate((e) => ({ estilo: e.style.width, ancho: e.getBoundingClientRect().width, pista: e.parentElement.getBoundingClientRect().width }));
  check('P18', volumen.estilo === '100%', 'volumen usa una escala común para las rutas: ' + JSON.stringify(volumen));
  check('P07', await p.locator('[data-fuera-total] a').getAttribute('href') === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(not(A, B)), 'el total excluido también abre su conjunto');
  const frase = await texto(p, '[data-frase]');
  check('H01', /mayor conservación en «Ensayos aleatorizados», 301 de 301/.test(frase)
    && /Mayor pérdida proporcional en «Guías de práctica clínica»: quedan fuera 35 de 35/.test(frase), 'el destacado contrapone conservación y pérdida, aunque se conserven todos los ensayos');
  check('H02', await p.locator('[data-frase] a').evaluateAll((els) => els.some((e) => new URL(e.href).searchParams.get('term') === '((apixaban) AND ((guideline[pt] OR practice guideline[pt]))) NOT ((apixaban) AND (Therapy/Narrow[filter]))')), 'la pérdida destacada abre su conjunto exacto en PubMed');
  const enlacesFuera = await p.locator('[data-fuera]').evaluateAll((els) => els.map((e) => [e.dataset.fuera, e.href]));
  check('P17', filas.every(([id,q]) => enlacesFuera.some(([i,h]) => i === id && h === 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(not(and(A,q),B)))), 'cada una de las diez diferencias abre su consulta exacta');
  await p.locator(ruta('cohortes') + ' summary').click();
  check('P08', await nPedidos(p) === 23 && /MeSH/.test(await texto(p, ruta('cohortes') + ' details')), 'aclarar qué cuenta no consulta la API');
  check('H03', /puede incluir ensayos/.test(await texto(p, ruta('cohortes') + ' .an-ruta-nombre > .an-sub'))
    && /prospectivos y de seguimiento/.test(await texto(p, ruta('cohortes') + ' details'))
    && /ensayos aleatorizados/.test(await texto(p, ruta('cohortes') + ' details')), 'cohortes advierte del solapamiento con ensayos en la fila y en su criterio');
  await p.locator(ruta('cohortes') + ' summary').click();
  check('P09', /20/.test(await texto(p, '[data-seccion="anios"] [data-coste]')), 'la serie anual anuncia sus veinte recuentos adicionales');
  await abrir(p, 'anios'); await p.waitForFunction(() => window._calls.length === 43); await listo(p);
  check('P10', await nPedidos(p) === 43, 'abrir la serie solo añade sus veinte consultas');
  const anchuras = await p.locator('[data-barra]').evaluateAll((els) => els.filter((e) => /a[BF]/.test(e.dataset.barra)).slice(0,2).map((e) => e.style.width));
  check('P11', JSON.stringify(anchuras) === JSON.stringify(['100%', '10%']), 'ambas series anuales comparten escala');
  check('T04', await p.locator('.an-grafica-anios .an-linea-final').count() === 1
    && await p.locator('.an-grafica-anios .an-linea-base').count() === 0
    && await p.locator('[data-temporal-base]').isHidden()
    && /Conservados.*escala propia desde cero/.test(await texto(p,'[data-temporal-escala]')), 'la vista inicial permite leer la evolución de conservados con un único eje propio desde cero');
  check('C03', JSON.stringify(await p.locator('.an-anios thead th').allTextContents()) === JSON.stringify(['Año','Disponibles','Conservados','% conservado']), 'la evolución mantiene la terminología de los conjuntos');
  await p.locator('[data-temporal-modo="comparar"]').focus(); await p.keyboard.press('Enter');
  check('T05', await nPedidos(p) === 43 && await p.locator('.an-grafica-anios .an-linea').count() === 2
    && /escala común desde cero/.test(await texto(p,'[data-temporal-escala]'))
    && await p.locator('[data-temporal-modo="comparar"]').evaluate(e=>e===document.activeElement && e.getAttribute('aria-pressed')==='true'), 'el teclado cambia a comparación común sin consultas y conserva el foco');
  await p.click('[data-anios="20"]'); await p.waitForFunction(() => window._calls.length === 63); await listo(p);
  await p.click('[data-anios="10"]');
  check('P12', await nPedidos(p) === 63 && await p.locator('.an-anios .an-num').evaluateAll((els) => els.every((e) => e.textContent !== '…')), 'volver a diez años reutiliza y repinta lo resuelto');
  check('P13', await p.locator('[data-anios="10"]').evaluate((e) => e === document.activeElement), 'cambiar años conserva el foco del teclado');
  check('T06', await p.locator('[data-temporal-modo="comparar"]').getAttribute('aria-pressed') === 'true'
    && await p.locator('.an-grafica-anios .an-linea').count() === 2, 'cambiar el intervalo conserva la vista temporal elegida');
  await p.click('[data-temporal-modo="conservados"]');
  check('T07', await nPedidos(p) === 63 && await p.locator('.an-grafica-anios .an-linea').count() === 1, 'volver a conservados no pide datos ni deja la serie disponible oculta en la escala');
  await p.locator('[data-seccion="anios"]').evaluate((e) => { e.open = false; });
  await abrir(p, 'anios'); await p.waitForTimeout(50);
  check('P14', await nPedidos(p) === 63, 'reabrir una sección no repite consultas');
  check('P19', await p.locator('[data-barra-base="revision"]').evaluate((e) => e.style.width) === '100%', 'abrir años no cambia la escala de volumen de las rutas');
  await p.locator('[data-seccion="anios"]').evaluate((e) => { e.open = false; });

  // Álgebra independiente: verdad de cada región para todas las asignaciones Q/A/B.
  const algebra = await p.evaluate(() => {
    const probar = (expresionA) => {
      const qs = window.PubMedAtlas.consultasCruce('Q', expresionA, 'B');
      for (let mask=0; mask<8; mask++) {
        const Q=!!(mask&4), A=!!(mask&2), B=!!(mask&1), lente=expresionA==='A'?A:!A;
        const esperadas=[Q&&lente&&B,Q&&lente&&!B,Q&&!lente&&B,Q&&!lente&&!B];
        const valores=qs.map(q=>Function('return '+q.replace(/\b(Q|A|B)\b/g,k=>String({Q,A,B}[k])).replace(/\bAND\b/g,'&&').replace(/\bOR\b/g,'||').replace(/\bNOT\b/g,'&& !'))());
        if(JSON.stringify(valores)!==JSON.stringify(esperadas)) return false;
      }
      return true;
    };
    const a=window.PubMedAtlas;
    return { positivas:probar('A'), negativas:probar('NOT A'), negativasSinEspacio:probar('NOT(A)'),
      coherente:a.evaluarCruce([8,27,366,6971],7372), incoherente:a.evaluarCruce([8,27,366,6972],7372),
      vacia:a.evaluarCruce([0,0,0,7372],7372), todasVacias:a.evaluarCruce([0,0,0,0],0),
      invalida:a.evaluarCruce([NaN,0,0,0],0), negativa:a.evaluarCruce([-1,1,0,0],0) };
  });
  check('X01', algebra.positivas, 'las cuatro regiones son una partición de Q para las ocho asignaciones booleanas');
  check('X02', algebra.negativas && algebra.negativasSinEspacio, 'una cláusula NOT conserva su sentido, con y sin espacio');
  check('X03', algebra.coherente.valido && Math.abs(algebra.coherente.jaccard - 8/401) < 1e-12, 'Jaccard usa la unión y no el universo como denominador');
  check('X04', !algebra.incoherente.valido && !algebra.invalida.valido && !algebra.negativa.valido, 'recuentos incoherentes, no finitos o negativos no certifican una partición');
  check('X05', algebra.vacia.valido && algebra.vacia.jaccard === null && algebra.todasVacias.valido, 'el universo vacío y las lentes vacías no producen un 0 % ficticio');
  const antesCruce = await nPedidos(p);
  await abrir(p, 'cruces'); await p.waitForTimeout(50);
  check('X06', await nPedidos(p) === antesCruce && /4 recuentos/.test(await texto(p, '[data-calcular-cruce]')), 'abrir cruces muestra el coste y las expresiones, sin consultar');
  await valoresCruce(p,[8,27,366,6971]);
  await p.click('[data-calcular-cruce]'); await listo(p);
  check('X07', await nPedidos(p) === antesCruce + 4, 'calcular una pareja pide exactamente cuatro regiones directas');
  check('X08', await p.locator('.an-region > .an-num').allTextContents().then(x=>JSON.stringify(x)===JSON.stringify(['8','27','366','6.971'])), 'los cuatro grupos muestran sus recuentos exactos');
  check('X09', /suman el universo/.test(await texto(p,'[data-cruce-estado]')) && /2 %/.test(await texto(p,'[data-jaccard]')), 'la partición coherente permite una coincidencia del 2 %');
  await p.locator('[data-region="2"]').focus(); await p.keyboard.press('Enter');
  check('X10', await p.locator('[data-region="2"]').getAttribute('aria-pressed') === 'true'
    && await texto(p,'[data-region-consulta]') === await p.locator('.an-region > .an-num').nth(2).getAttribute('data-q'), 'el teclado coordina la región y su inspector literal');
  check('X11', await p.locator('[data-region-enlace]').getAttribute('href') === await p.locator('.an-region > .an-num').nth(2).getAttribute('href'), 'inspector y cifra abren el mismo conjunto en PubMed');
  await p.locator('[data-seccion="cruces"]').evaluate(e=>{e.open=false;}); await abrir(p,'cruces'); await p.waitForTimeout(30);
  check('X12', await nPedidos(p) === antesCruce + 4, 'reabrir cruces y elegir regiones no añade consultas');
  await p.locator('[data-seccion="cruces"]').evaluate(e=>{e.open=false;});
  await abrir(p,'consulta');
  const esperaDescarga=p.waitForEvent('download'); await p.click('[data-exportar-registro]');
  const descarga=await esperaDescarga, registro=JSON.parse(readFileSync(await descarga.path(),'utf8'));
  check('R01', registro.formato==='buscar-pubmed-atlas/1' && registro.base===A && registro.consulta_efectiva===B, 'el registro descargado identifica universo y estrategia efectiva');
  check('R02', registro.recuentos.length===antesCruce+4 && registro.recuentos.every(r=>r.consulta && r.estado && r.dato?.traduccion), 'el registro conserva las consultas ejecutadas y sus traducciones');
  check('R03', registro.limites.some(t=>/PRISMA-S/.test(t)) && !JSON.stringify(registro).includes('api_key'), 'la exportación declara sus límites y no exporta claves');
  await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window._copiado=t;}}}));
  await p.click('[data-copiar-estrategia]');
  check('R04', await p.evaluate(()=>window._copiado.includes(window._final)) && /copiada/.test(await texto(p,'[data-exporta-estado]')), 'copiar estrategia entrega la expresión efectiva al portapapeles');
  check('R05', registro.filtros[0].expresion==='(Therapy/Narrow[filter])' && registro.recorrido.length===2, 'el registro conserva la expresión del filtro y el recorrido, no solo identificadores');
  await p.locator('[data-seccion="consulta"]').evaluate(e=>{e.open=false;});
  await abrir(p,'anios');
  check('T01', /20 recuentos/.test(await texto(p,'[data-campo-anios] option[value="crdt"]')), 'el calendario alternativo anuncia veinte recuentos antes de cambiar');
  await p.evaluate(()=>{
    for(let i=0;i<10;i++) {const a=new Date().getFullYear()-i;window._datos.set('(apixaban) AND ('+a+'[crdt])',i?100:1000);window._datos.set('((apixaban) AND (Therapy/Narrow[filter])) AND ('+a+'[crdt])',i?20:100);}
  });
  const antesCalendario=await nPedidos(p); await p.selectOption('[data-campo-anios]','crdt'); await listo(p);
  check('T02', await nPedidos(p)===antesCalendario+20 && /creación del registro/.test(await texto(p,'.an-anios caption'))
    && await p.locator('.an-grafica-anios path').count()===1
    && await p.locator('[data-temporal-modo="conservados"]').getAttribute('aria-pressed')==='true', 'el calendario de creación tiene sus consultas y conserva la vista elegida, sin confundirlo con publicación');
  await p.selectOption('[data-campo-anios]','dp'); await listo(p);
  check('T03', await nPedidos(p)===antesCalendario+20 && await p.locator('[data-campo-anios]').evaluate(e=>e===document.activeElement), 'volver a publicación reutiliza datos y conserva el foco');
  const incompleto = await p.locator('[data-grafica-anios]').evaluate(e=>{
    const punto=e.querySelector('.an-punto-incompleto'), linea=e.querySelector('.an-linea-final');
    return {hueco:getComputedStyle(punto).fill!==getComputedStyle(punto).stroke,
      separado:linea.getPointAtLength(linea.getTotalLength()).x < punto.cx.baseVal.value,
      rotulo:e.textContent.includes('en curso'), banda:!!e.querySelector('rect.an-anio-incompleto')};
  });
  check('T08', incompleto.hueco && incompleto.separado && incompleto.rotulo && incompleto.banda
    && /en curso · incompleto/.test(await texto(p,'.an-anios tbody tr:first-child th')), 'el año en curso conserva la cifra pero queda hueco, rotulado y fuera de la línea de años completos');
  await p.locator('[data-seccion="anios"]').evaluate(e=>{e.open=false;});

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
  await abrir(s,'anios'); await listo(s);
  check('T09', await nPedidos(s)===21 && await s.locator('[data-temporal-modo]').count()===0
    && await s.locator('.an-grafica-anios .an-linea').count()===1
    && /Disponibles.*escala propia desde cero/.test(await texto(s,'[data-temporal-escala]')), 'sin filtros hay una sola serie Disponible, con diez recuentos bajo demanda');
  const year = new Date().getFullYear(), serie = Array.from({length:10},(_,i)=>[
    [and(A,(year-i)+'[dp]'),470+i*16], [and(B,(year-i)+'[dp]'),i ? 17+i*2 : 12]
  ]).flat();
  const vigilancia = await montar({cambios:serie}); await abrir(vigilancia,'anios'); await listo(vigilancia);
  const amplitud = () => vigilancia.locator('.an-punto-final:not(.an-punto-incompleto)').evaluateAll(els=>{
    const ys=els.map(e=>e.cy.baseVal.value); return Math.max(...ys)-Math.min(...ys);
  });
  const propia=await amplitud(), antesVista=await nPedidos(vigilancia);
  await vigilancia.click('[data-temporal-modo="comparar"]'); const comun=await amplitud();
  check('T10', propia>50 && comun<10 && propia>comun*10 && await nPedidos(vigilancia)===antesVista,
    'una serie pequeña (19–35 frente a 470–614) gana más de diez veces amplitud visible sin alterar sus recuentos ni pedir otros');
  await vigilancia.setViewportSize({width:320,height:900});
  check('T11', await vigilancia.locator('[data-seccion="anios"]').evaluate(e=>e.scrollWidth<=e.clientWidth+1)
    && await vigilancia.locator('[data-temporal-modo="comparar"]').isVisible(), 'gráfica, etiquetas y selector temporal caben a 320 px');
  const d = await montar({ control: 5 });
  check('F01', await texto(d, '[data-fuera="guia"]') === 'Ver fuera' && await d.locator('[data-comparacion-aviso]').isVisible(), 'si B no está contenido en A, no resta ni publica una falsa pérdida');
  check('H04', await d.locator('[data-frase]').isHidden(), 'el destacado no deriva pérdidas cuando la inclusión no está verificada');
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
  check('H05', await k.locator('[data-frase]').isHidden(), 'el resumen espera a los recuentos de la primera vista');
  await k.evaluate(() => {
    window._termino = 'otra búsqueda'; window._base = 'otra'; window._final = '(otra) AND x';
    document.dispatchEvent(new CustomEvent('consulta-cambiada', { detail: { consulta: window._final } }));
    window._pendientes.splice(0).forEach((ok) => ok());
  });
  await k.waitForTimeout(100);
  check('F10', await texto(k, ruta('aleatorizado') + ' .an-conserva') === '…', 'una respuesta antigua no pinta durante la espera de recálculo, aunque ignore abort');
  const otro = await montar({ activo: 'diagnosis_especifico' });
  check('H06', await texto(otro, '[data-frase]') === frase && await nPedidos(otro) === 23, 'el mismo resultado destaca las mismas rutas con otro filtro: sin selección por id ni consultas extra');
  const pequenas = await montar({ cambios: [[and(A, filas[0][1]), 4]] });
  check('H07', /al menos cinco registros/.test(await texto(pequenas, '[data-frase]'))
    && /Mayor pérdida proporcional en «Otros ensayos clínicos»/.test(await texto(pequenas, '[data-frase]')), 'el umbral de tamaño se declara y evita destacar una ruta de cuatro registros');
  const sinGuias = await montar({ cambios: [[and(B, filas[0][1]), null]] });
  check('H08', /Mayor pérdida proporcional en «Otros ensayos clínicos»/.test(await texto(sinGuias, '[data-frase]'))
    && !/Guías de práctica clínica/.test(await texto(sinGuias, '[data-frase]')), 'un recuento fallido se excluye del destacado, sin convertirlo en pérdida total');
  const sinPerdida = await montar({ cambios: [[B,7372], ...filas.map(([,q,a]) => [and(B,q),a])] });
  check('H09', /No quedan registros fuera en estas rutas/.test(await texto(sinPerdida, '[data-frase]'))
    && !/Mayor pérdida/.test(await texto(sinPerdida, '[data-frase]')), 'si todas las rutas conservan sus registros, el resumen no inventa una pérdida');
  const ninguna = await montar({ cambios: filas.map(([,q]) => [and(B,q),0]) });
  check('H10', /ninguna conserva registros/.test(await texto(ninguna, '[data-frase]'))
    && /Mayor pérdida proporcional/.test(await texto(ninguna, '[data-frase]')), 'si todas quedan vacías, el mensaje lo dice sin una falsa conservación');
  const incoherente=await montar(); await abrir(incoherente,'cruces'); await valoresCruce(incoherente,[8,27,366,6972]);
  await incoherente.click('[data-calcular-cruce]'); await listo(incoherente);
  check('X13', /no encajan/.test(await texto(incoherente,'[data-cruce-estado]')) && /pendiente/.test(await texto(incoherente,'[data-jaccard]')), 'una suma incorrecta no cierra artificialmente la partición');
  const fallido=await montar(); await abrir(fallido,'cruces'); await valoresCruce(fallido,[null,27,366,6971]);
  await fallido.click('[data-calcular-cruce]'); await listo(fallido);
  check('X14', await texto(fallido,'.an-region:first-child > .an-num')==='fallo'
    && await fallido.locator('.an-particion > .an-sin-dato').count()===4, 'un cruce fallido no dibuja ceros ni proporciones inventadas');
  const avisado=await montar(); await abrir(avisado,'cruces'); await valoresCruce(avisado,[{count:8,traduccion:'',avisos:[],errores:[]},27,366,6971]);
  await avisado.click('[data-calcular-cruce]'); await listo(avisado);
  check('X15', /⚠/.test(await texto(avisado,'.an-region:first-child > .an-num')) && /pendiente/.test(await texto(avisado,'[data-jaccard]')), 'un aviso de integridad bloquea el Jaccard');
  const tardio=await montar({lento:true}); await abrir(tardio,'cruces'); await valoresCruce(tardio,[8,27,366,6971]);
  await tardio.click('[data-calcular-cruce]'); await tardio.selectOption('[data-lente="b"]','ruta:metaanalisis');
  await tardio.evaluate(()=>window._pendientes.splice(0).forEach(ok=>ok())); await tardio.waitForTimeout(100);
  check('X16', await tardio.locator('.an-region > .an-num').allTextContents().then(x=>x.every(t=>t==='…'))
    && await nPedidos(tardio)===27, 'cambiar de lentes invalida la vista sin disparar consultas ni pintar respuestas de la pareja anterior');
  const etiquetas = await p.locator('.an-ruta [role="rowheader"]').count();
  check('A01', etiquetas === 10 && await p.locator('[role="table"][aria-label]').count() === 1, 'filas, cabeceras y tabla tienen semántica accesible');
  check('A02', await p.locator('[data-estado][role="status"][aria-live="polite"]').count() === 1, 'el progreso se anuncia de forma no intrusiva');
} finally {
  await browser.close();
}
console.log('\n' + bien + ' pass / ' + mal + ' fail');
process.exitCode = mal ? 1 : 0;

