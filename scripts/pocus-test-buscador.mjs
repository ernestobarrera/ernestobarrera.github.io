#!/usr/bin/env node
/**
 * pocus-test-buscador.mjs — prueba del buscador del atlas POCUS.
 *
 * El buscador vive incrustado en pocus.html. Su parte pura (plegado de acentos, texto plano,
 * índice y puntuación) está delimitada en la página entre `function pocusPlegar` y el marcador
 * `Fin de la parte pura del buscador`, y esta prueba la ejecuta en un contexto `vm` contra el
 * `pocusData` real, igual que pocus-test-enlaces.mjs hace con el resolutor de enlaces.
 *
 * Lo que NO cubre: el desplegable, el teclado y el salto a la ficha son DOM real y se
 * comprueban a mano en el navegador.
 *
 * Contrato de tres estados, igual que pocus-audit.mjs:
 *   0  todas las aserciones pasan
 *   1  alguna falla
 *   2  inconcluso: no se pudo extraer el código de pocus.html (una prueba que aprueba por no
 *      encontrar el código es peor que no tenerla)
 *
 *   node scripts/pocus-test-buscador.mjs
 */

import fs from 'fs';
import path from 'path';
import process from 'process';
import vm from 'vm';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const HTML = path.join(RAIZ, 'pocus.html');

const inconcluso = (msg) => {
  console.error(`[INCONCLUSO] ${msg}`);
  process.exit(2);
};

if (!fs.existsSync(HTML)) inconcluso(`no encuentro ${HTML}`);
const html = fs.readFileSync(HTML, 'utf8');

/* ── Extracción ────────────────────────────────────────────────────────────────────────── */

// Misma lectura equilibrada que pocus-audit.mjs: las fichas llevan HTML con corchetes.
function extraerPocusData(src) {
  const ini = src.indexOf('const pocusData = [');
  if (ini < 0) return null;
  let i = src.indexOf('[', ini);
  let prof = 0, enStr = null, esc = false;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (enStr) { if (c === enStr) enStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { enStr = c; continue; }
    if (c === '[') prof++;
    else if (c === ']') { prof--; if (prof === 0) return src.slice(i, k + 1); }
  }
  return null;
}

function extraerConstantesPrevias(src) {
  const hasta = src.indexOf('const pocusData = [');
  const trozo = hasta < 0 ? src : src.slice(0, hasta);
  const out = [];
  for (const m of trozo.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*`/g)) {
    let k = m.index + m[0].length, esc = false;
    for (; k < trozo.length; k++) {
      const c = trozo[k];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '`') break;
    }
    if (k < trozo.length) out.push(trozo.slice(m.index, k + 1) + ';');
  }
  return out;
}

const literal = extraerPocusData(html);
if (!literal) inconcluso('no consigo extraer `pocusData` de pocus.html');

let pocusData;
try {
  pocusData = eval(`${extraerConstantesPrevias(html).join('\n')}\n(${literal})`);
} catch (e) {
  inconcluso(`\`pocusData\` no evalúa: ${e.message}`);
}

// pocusSlug: desde su declaración hasta el comentario del mapa de slugs, que la sigue.
const SLUG_INI = html.indexOf('function pocusSlug(texto) {');
const SLUG_FIN = html.indexOf('/* Mapa slug → posición.');
if (SLUG_INI < 0 || SLUG_FIN <= SLUG_INI) inconcluso('no delimito `pocusSlug` en pocus.html');

// La parte pura arranca en la constante de diacríticos, que pocusPlegar necesita.
const BUS_INI = html.indexOf('var POCUS_DIACRITICOS');
const BUS_FIN = html.indexOf('/* ── Fin de la parte pura del buscador ── */');
if (BUS_INI < 0 || BUS_FIN <= BUS_INI)
  inconcluso('no delimito la parte pura del buscador en pocus.html (¿se movió el marcador de fin?)');

// Etiquetas de zona: la misma lectura que hace iniciarBuscadorPocus() sobre el menú.
const etiquetas = {};
for (const m of html.matchAll(/<button[^>]*onclick="navigateToSegment\('([a-z_]+)'\)"[^>]*>([^<]+)<\/button>/g))
  if (!etiquetas[m[1]]) etiquetas[m[1]] = m[2].replace(/▾/g, '').trim();
if (!Object.keys(etiquetas).length) inconcluso('no encuentro las etiquetas de zona del menú de navegación');

const caja = { pocusData, etiquetas, console };
vm.createContext(caja);
try {
  vm.runInContext(
    html.slice(SLUG_INI, SLUG_FIN) + '\n' + html.slice(BUS_INI, BUS_FIN) +
      '\nglobalThis.__api = { pocusSlug, pocusPlegar, pocusTextoPlano, pocusTerminos, pocusFrase, pocusPasajes, construirIndicePocus, buscarEnPocus };',
    caja,
    { filename: 'pocus-buscador.js' }
  );
} catch (e) {
  inconcluso(`el bloque del buscador no evalúa fuera del navegador: ${e.message}`);
}
const api = caja.__api;
const indice = api.construirIndicePocus(pocusData, etiquetas);
const buscar = (q, max) => JSON.parse(JSON.stringify(api.buscarEnPocus(indice, q, max)));
const primero = (q) => (buscar(q)[0] || {}).slug || null;

/* ── Aserciones ────────────────────────────────────────────────────────────────────────── */

let fallos = 0;
let pasadas = 0;

function comprobar(nombre, real, esperado) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) { pasadas++; return; }
  fallos++;
  console.log(`  FALLA  ${nombre}`);
  console.log(`         esperaba ${b}`);
  console.log(`         obtuvo   ${a}`);
}

const DUPUYTREN = 'enfermedad-de-dupuytren-fibromatosis-palmar';

// 1. Plegado: sin acentos, en minúsculas y con la MISMA longitud (el resaltado depende de ello)
const conTildes = 'Túnel Carpiano · Ñandú ÁÉÍÓÚ ü';
comprobar('plegado quita acentos y pasa a minúsculas', api.pocusPlegar(conTildes), 'tunel carpiano · nandu aeiou u');
comprobar('plegado conserva la longitud', api.pocusPlegar(conTildes).length, conTildes.length);

// 2. Texto plano desde el HTML de una pestaña
comprobar('texto plano: etiquetas fuera y entidades decodificadas',
  api.pocusTextoPlano('<p>a &lt; b &amp; c&nbsp;d <strong>&ge;</strong> &#9888; &#x2713;</p>'), 'a < b & c d ≥ ⚠ ✓');

// 3. Troceo en pasajes: un bloque por pasaje, titulares como contexto, y el contexto se acaba
//    al cerrar el contenedor del titular
const pas = api.pocusPasajes(
  '<ul><li><strong>Sonda:</strong> lineal.</li><li>Gel <em>abundante</em>.</li></ul>' +
  '<div class="pearls-section"><h5>Cuándo derivar</h5><p>Prueba de la mesa.</p></div><p>Fuera.</p>'
);
comprobar('pasajes: uno por bloque, sin etiquetas de línea', pas.map((p) => p.texto),
  ['Sonda: lineal.', 'Gel abundante.', 'Cuándo derivar', 'Prueba de la mesa.', 'Fuera.']);
comprobar('pasajes: el titular es contexto de lo que cuelga de él', pas.map((p) => p.contexto),
  ['', '', '', 'Cuándo derivar', '']);
comprobar('pasajes: lista anidada no se funde con su padre',
  api.pocusPasajes('<ul><li>Clasificación:<ul><li>Grado I</li><li>Grado II</li></ul></li></ul>').map((p) => p.texto),
  ['Clasificación:', 'Grado I', 'Grado II']);

// 4. Términos y frase
comprobar('palabras vacías fuera de los términos', api.pocusTerminos('prueba de la mesa'), ['prueba', 'mesa']);
comprobar('la frase entera se conserva', api.pocusFrase('Prueba  de la Mesa'), 'prueba de la mesa');
comprobar('una sola palabra no es frase', api.pocusFrase('mesa'), '');

// 5. Consultas vacías, cortas o solo de palabras vacías no devuelven nada
comprobar('consulta vacía', buscar(''), []);
comprobar('consulta de una letra', buscar('a'), []);
comprobar('consulta solo con signos', buscar(' ¿?/ '), []);
comprobar('consulta solo con palabras vacías', buscar('de la'), []);

// 6. El caso que motivó la granularidad: «prueba de la mesa» lleva al párrafo, no a la ficha
const mesa = buscar('prueba de la mesa')[0] || {};
comprobar('«prueba de la mesa»: la ficha es la de Dupuytren', mesa.slug, DUPUYTREN);
comprobar('«prueba de la mesa»: el primer pasaje está en Perlas, bajo «Cuándo derivar»',
  [mesa.pasajes?.[0]?.tab, mesa.pasajes?.[0]?.contexto], ['pearls', 'Cuándo derivar']);
comprobar('«prueba de la mesa»: también señala el pasaje del informe',
  (mesa.pasajes || []).some((p) => p.tab === 'report'), true);
comprobar('«prueba de la mesa»: la frase entera se resalta como una sola marca',
  (() => { const p = mesa.pasajes?.[0]; const m = p?.marcas?.[0]; return m ? api.pocusPlegar(p.texto.slice(m[0], m[1])) : null; })(),
  'prueba de la mesa');
comprobar('«prueba de la mesa»: la consulta no nombra la ficha, así que Intro irá al pasaje', mesa.enTitulo, false);

// 6b. La frase exacta pesa más que las mismas palabras sueltas, aunque estas vayan antes
const sintetico = api.construirIndicePocus([{
  segment: 'x', title: 'Ficha sintética', system: '',
  content: {
    findings: '<p>La mesa está aquí y la prueba más abajo.</p>',
    pearls: '<p>Prueba de la mesa positiva.</p>',
  },
}], {});
const sint = JSON.parse(JSON.stringify(api.buscarEnPocus(sintetico, 'prueba de la mesa')))[0] || {};
comprobar('la frase exacta encabeza los pasajes aunque esté en una pestaña posterior',
  sint.pasajes?.[0]?.tab, 'pearls');

// 6c. El informe aporta su checklist y sus campos como pasajes propios
const informe = api.construirIndicePocus([{
  segment: 'x', title: 'Ficha de informe', system: '',
  content: {
    reportChecklist: ['Comprobación contralateral hecha'],
    reportFields: [{ id: 'a', label: 'Grosor del zócalo', type: 'number' }],
  },
}], {});
const pasInf = (q) => {
  const r = JSON.parse(JSON.stringify(api.buscarEnPocus(informe, q)))[0] || {};
  const p = (r.pasajes || [])[0] || {};
  return [p.tab, p.contexto];
};
comprobar('un elemento del checklist es un pasaje del informe', pasInf('contralateral'), ['report', 'Checklist']);
comprobar('el nombre de un campo es un pasaje del informe', pasInf('zocalo'), ['report', 'Campos del informe']);

// 7. Por nombre de ficha
comprobar('«dupuytren» abre la ficha de Dupuytren', primero('dupuytren'), DUPUYTREN);
comprobar('«dupuytren»: la consulta nombra la ficha', buscar('dupuytren')[0]?.enTitulo, true);
comprobar('sin distinguir mayúsculas', primero('DUPUYTREN'), DUPUYTREN);
comprobar('sin distinguir tildes mal puestas', primero('dupúytren'), DUPUYTREN);
comprobar('por sinónimo de las palabras clave', primero('fibromatosis palmar'), DUPUYTREN);
comprobar('por palabra clave sin tilde', primero('nodulo palmar'), DUPUYTREN);
comprobar('«tunel carpiano»', primero('tunel carpiano'), 'sindrome-del-tunel-carpiano');
comprobar('«quiste baker» da una ficha de Baker', /baker/.test(primero('quiste baker') || ''), true);
comprobar('«vesicula» da una ficha de vía biliar',
  buscar('vesicula').some((r) => r.slug === 'colelitiasis-y-colecistitis'), true);

// 8. Y lógico: todos los términos tienen que estar en la ficha
comprobar('términos que no conviven en ninguna ficha', buscar('dupuytren vesicula'), []);
comprobar('término inexistente', buscar('xyzqwerty'), []);

// 9. La zona del menú también es buscable
comprobar('«muñeca» incluye fichas de la zona mano/muñeca',
  buscar('muñeca', 20).map((r) => r.slug).includes(DUPUYTREN), true);

// 10. Cada ficha es la primera al buscar su título exacto
let titulosOk = true;
for (const e of indice) {
  const p = primero(e.title);
  if (p !== e.slug) {
    titulosOk = false;
    console.log(`  FALLA  buscar «${e.title}» devuelve primero «${p}»`);
  }
}
comprobar('cada ficha encabeza la búsqueda de su propio título', titulosOk, true);

// 11. Pasajes devueltos: tope respetado, marcas exactas y cortes en límite de palabra
let pasajesOk = true;
for (const q of ['dupuytren', 'tendon flexor', 'hipoecoico', 'polea', 'doppler', 'derivar', 'prueba de la mesa']) {
  const terminos = api.pocusTerminos(q);
  const frase = api.pocusFrase(q);
  for (const r of buscar(q)) {
    if (r.pasajes.length > 3 || r.total < r.pasajes.length) {
      pasajesOk = false;
      console.log(`  FALLA  «${q}» en «${r.title}»: ${r.pasajes.length} pasajes, total ${r.total}`);
    }
    const e = indice.find((x) => x.slug === r.slug);
    for (const p of r.pasajes) {
      for (const [a, b] of p.marcas) {
        const trozo = api.pocusPlegar(p.texto.slice(a, b));
        if (!terminos.includes(trozo) && trozo !== frase) {
          pasajesOk = false;
          console.log(`  FALLA  «${q}» en «${r.title}» resalta «${p.texto.slice(a, b)}»`);
        }
      }
      const pos = p.completo.indexOf(p.texto);
      const antes = pos > 0 ? p.completo[pos - 1] : ' ';
      const despues = p.completo[pos + p.texto.length] ?? ' ';
      if (pos < 0 || (p.previo && antes !== ' ') || (p.sigue && despues !== ' ')) {
        pasajesOk = false;
        console.log(`  FALLA  «${q}» en «${r.title}» corta una palabra: «${p.texto.slice(0, 30)}…»`);
      }
      if (!e.pasajes.some((x) => x.texto === p.completo && x.tab === p.tab)) {
        pasajesOk = false;
        console.log(`  FALLA  «${q}» en «${r.title}»: el pasaje devuelto no está en el índice`);
      }
    }
  }
}
comprobar('pasajes: tope, marcas y cortes correctos', pasajesOk, true);

// 12. Ningún pasaje indexado arrastra HTML ni está vacío
const sucios = indice.flatMap((e) => e.pasajes.filter((p) => !p.texto || /<[a-z/][^>]*>/i.test(p.texto)).map(() => e.title));
comprobar('ningún pasaje vacío ni con etiquetas HTML', [...new Set(sucios)], []);

// 13. Contrato de la página: la parte de DOM existe, arranca tras el gate y dice cuándo no hay nada
comprobar('la página arranca el buscador', html.includes('iniciarBuscadorPocus();'), true);
comprobar('el buscador arranca después del gate',
  html.indexOf('iniciarBuscadorPocus();') > html.indexOf('const _hasAccess = await checkPocusGate();'), true);
comprobar('el campo de búsqueda está en la cabecera', /id="atlas-search-input"/.test(html), true);
comprobar('sin resultados lo dice', html.includes('El atlas no es exhaustivo'), true);
comprobar('abrirFicha admite ir a un pasaje sin desplazarse a la cabecera',
  /o\.desplazar !== false/.test(html) && /o\.destacar === false/.test(html), true);

console.log(`Buscador POCUS — ${pasadas + fallos} comprobaciones sobre ${pocusData.length} fichas`);
if (fallos) {
  console.log(`${fallos} fallan.`);
  process.exit(1);
}
console.log('Todas pasan.');
process.exit(0);
