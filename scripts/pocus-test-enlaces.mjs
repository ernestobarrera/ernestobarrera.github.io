#!/usr/bin/env node
/**
 * pocus-test-enlaces.mjs — prueba de los enlaces profundos del atlas POCUS.
 *
 * El resolutor de `?ficha=` / `?zona=` vive incrustado en pocus.html, dentro del <script> de la
 * página, y no hay navegador donde ejecutarlo. En vez de dejarlo sin prueba, esta se lleva el
 * bloque a un contexto `vm` con `window`, `document` e `history` fingidos y comprueba lo único
 * que importa de él: que una URL cualquiera resuelve al destino correcto y que la URL que
 * escribe de vuelta es la que se puede copiar y compartir.
 *
 * Lo que NO cubre, y conviene saberlo: el desplazamiento hasta la tarjeta, el destello y el
 * botón de copiar son DOM real y se comprueban a mano en el navegador.
 *
 * Contrato de tres estados, igual que pocus-audit.mjs:
 *   0  todas las aserciones pasan
 *   1  alguna falla
 *   2  inconcluso: no se pudo extraer el bloque de pocus.html (una prueba que aprueba por no
 *      encontrar el código es peor que no tenerla)
 *
 *   node scripts/pocus-test-enlaces.mjs
 */

import fs from 'fs';
import path from 'path';
import process from 'process';
import vm from 'vm';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const HTML = path.join(RAIZ, 'pocus.html');
const AUDIT = path.join(RAIZ, 'scripts', 'pocus-audit.mjs');

const inconcluso = (msg) => {
  console.error(`[INCONCLUSO] ${msg}`);
  process.exit(2);
};

if (!fs.existsSync(HTML)) inconcluso(`no encuentro ${HTML}`);
const html = fs.readFileSync(HTML, 'utf8');

/* ── Extracción ────────────────────────────────────────────────────────────────────────── */

// Misma lectura equilibrada que usa pocus-audit.mjs: las fichas llevan HTML con corchetes.
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

// El bloque de enlaces profundos va desde `function pocusSlug` hasta el comentario que abre la
// navegación por sistemas. Ambos extremos son literales estables; si alguno se mueve, esta
// prueba sale INCONCLUSO en vez de aprobar en falso.
const INI = html.indexOf('function pocusSlug(texto) {');
const FIN = html.indexOf('// Funciones de navegación por sistemas');
if (INI < 0 || FIN < 0 || FIN <= INI)
  inconcluso('no delimito el bloque de enlaces profundos en pocus.html (¿se reorganizó el <script>?)');

const bloque = html.slice(INI, FIN);

/* ── Sandbox ───────────────────────────────────────────────────────────────────────────── */

const replaceStates = [];

function nuevaCaja(href) {
  const caja = {
    pocusData,
    URL,
    URLSearchParams,
    console,
    setTimeout: (fn) => fn,
    navigator: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      createElement: () => ({ classList: { add() {}, remove() {} }, set innerHTML(_) {} }),
    },
    history: {
      replaceState: (_estado, _titulo, url) => replaceStates.push(url),
    },
  };
  const u = new URL(href);
  caja.window = {
    location: { href, search: u.search, hash: u.hash, pathname: u.pathname, origin: u.origin },
    history: caja.history,
    addEventListener() {},
  };
  vm.createContext(caja);
  vm.runInContext(
    bloque + '\nglobalThis.__api = { pocusSlug, resolverDestinoProfundo, leerDestinoProfundo, escribirUrlProfunda, POCUS_SLUGS, POCUS_ZONAS, window };',
    caja,
    { filename: 'pocus-enlaces.js' }
  );
  return caja.__api;
}

const BASE = 'https://ernestobarrera.github.io/pocus.html';
const api = nuevaCaja(BASE);

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

function destinoDe(href) {
  return nuevaCaja(href).leerDestinoProfundo();
}

// 1. Normalización del slug
comprobar('slug con acentos y paréntesis',
  api.pocusSlug('Ecografía Cardíaca Focalizada (FoCUS)'), 'ecografia-cardiaca-focalizada-focus');
comprobar('slug con barra y puntuación',
  api.pocusSlug('Hidronefrosis / Cólico Renal'), 'hidronefrosis-colico-renal');
comprobar('slug sin guiones sobrantes en los extremos',
  api.pocusSlug('  ¡Lipoma!  '), 'lipoma');
comprobar('slug de entrada vacía', api.pocusSlug(''), '');

// 2. El mapa cubre todas las fichas y ningún slug se repite
comprobar('el mapa tiene una entrada por ficha', api.POCUS_SLUGS.size, pocusData.length);

// 3. El cardId derivado coincide con el que compone createContentCard
let cardIdsOk = true;
for (const [slug, destino] of api.POCUS_SLUGS) {
  const enSegmento = pocusData.filter((d) => d.segment === destino.segment);
  if (enSegmento[destino.index]?.title !== destino.title) {
    cardIdsOk = false;
    console.log(`  FALLA  «${slug}» apunta a card-${destino.segment}-${destino.index}, que no es su tarjeta`);
  }
}
comprobar('cada slug resuelve al índice real de su tarjeta', cardIdsOk, true);

// 4. Formas de URL aceptadas
const FICHA = 'colelitiasis-y-colecistitis';
comprobar('?ficha=slug', destinoDe(`${BASE}?ficha=${FICHA}`), { tipo: 'ficha', slug: FICHA });
comprobar('#ficha=slug', destinoDe(`${BASE}#ficha=${FICHA}`), { tipo: 'ficha', slug: FICHA });
comprobar('#slug desnudo', destinoDe(`${BASE}#${FICHA}`), { tipo: 'ficha', slug: FICHA });
comprobar('?ficha= con acentos y espacios codificados',
  destinoDe(`${BASE}?ficha=${encodeURIComponent('Colelitiasis y Colecistitis')}`), { tipo: 'ficha', slug: FICHA });
comprobar('?ficha= en mayúsculas', destinoDe(`${BASE}?ficha=COLELITIASIS-Y-COLECISTITIS`), { tipo: 'ficha', slug: FICHA });

// 5. Zonas
comprobar('?zona=ruq', destinoDe(`${BASE}?zona=ruq`), { tipo: 'zona', segmento: 'ruq' });
comprobar('?zona= con guion bajo', destinoDe(`${BASE}?zona=neck_lateral`), { tipo: 'zona', segmento: 'neck_lateral' });
comprobar('?zona= con guion medio', destinoDe(`${BASE}?zona=neck-lateral`), { tipo: 'zona', segmento: 'neck_lateral' });
comprobar('?ficha= con un id de zona cae a la zona', destinoDe(`${BASE}?ficha=ruq`), { tipo: 'zona', segmento: 'ruq' });

// 6. Lo que NO debe capturar
comprobar('sin parámetros no hay destino', destinoDe(BASE), null);
comprobar('#ref-… pertenece a las citas, no a las fichas',
  destinoDe(`${BASE}#ref-ocular_pocus101_guide`), null);
comprobar('slug inexistente se reporta como desconocido',
  destinoDe(`${BASE}?ficha=ficha-que-no-existe`), { tipo: 'desconocido', valor: 'ficha-que-no-existe' });

// Una URL mal copiada no puede tumbar el arranque: `%` suelto rompe decodeURIComponent.
let sobrevive = true;
try {
  destinoDe(`${BASE}?ficha=100%25%zz`);
  destinoDe(`${BASE}#%e0%a4%a`);
} catch (e) {
  sobrevive = false;
  console.log(`         (lanzó ${e.name}: ${e.message})`);
}
comprobar('una URL mal formada no lanza excepción', sobrevive, true);

// 7. Precedencia: la query manda sobre el hash
comprobar('la query gana al hash',
  destinoDe(`${BASE}?ficha=${FICHA}#ficha=lipoma`), { tipo: 'ficha', slug: FICHA });
comprobar('ficha gana a zona en la misma URL',
  destinoDe(`${BASE}?zona=ruq&ficha=lipoma`), { tipo: 'ficha', slug: 'lipoma' });

// 8. La URL que se escribe de vuelta
function urlEscrita(href, destino) {
  replaceStates.length = 0;
  nuevaCaja(href).escribirUrlProfunda(destino);
  return replaceStates[replaceStates.length - 1];
}
comprobar('escribe ?ficha=', urlEscrita(BASE, { ficha: 'lipoma' }), '/pocus.html?ficha=lipoma');
comprobar('escribe ?zona=', urlEscrita(BASE, { zona: 'ruq' }), '/pocus.html?zona=ruq');
comprobar('limpiar deja la ruta desnuda', urlEscrita(`${BASE}?ficha=lipoma`, null), '/pocus.html');
comprobar('abrir una ficha borra la zona anterior',
  urlEscrita(`${BASE}?zona=ruq`, { ficha: 'lipoma' }), '/pocus.html?ficha=lipoma');
comprobar('el hash no sobrevive a la reescritura',
  urlEscrita(`${BASE}#ficha=lipoma`, { ficha: 'lipoma' }), '/pocus.html?ficha=lipoma');
comprobar('un ?code= ajeno no se pierde al reescribir',
  urlEscrita(`${BASE}?code=X`, { ficha: 'lipoma' }), '/pocus.html?code=X&ficha=lipoma');

// 9. El enlace que copia el botón
comprobar('enlace absoluto de una ficha',
  nuevaCaja(`${BASE}?ficha=lipoma`).window.enlaceDeFicha('lipoma'),
  'https://ernestobarrera.github.io/pocus.html?ficha=lipoma');

/* 10. Deriva entre las dos normalizaciones. pocus-audit.mjs reimplementa `pocusSlug` para poder
   bloquear los slugs duplicados sin cargar la página; si las dos copias divergen, el
   comprobador estaría validando algo distinto de lo que hace el navegador. */
if (fs.existsSync(AUDIT)) {
  const auditSrc = fs.readFileSync(AUDIT, 'utf8');
  const m = auditSrc.match(/const slugDe = \(t\) =>[\s\S]*?replace\(\/\^-\+\|-\+\$\/g, ''\);/);
  if (!m) {
    console.log('  FALLA  no encuentro `slugDe` en pocus-audit.mjs para comparar la normalización');
    fallos++;
  } else {
    const slugDe = eval(`(${m[0].replace(/^const slugDe = /, '').replace(/;$/, '')})`);
    const casos = [
      ...pocusData.map((a) => a.title),
      'Ecografía Cardíaca Focalizada (FoCUS)',
      'Hidronefrosis / Cólico Renal',
      '  ¡Lipoma!  ',
      'Niño con muñeca ÁÉÍÓÚ',
      '',
    ];
    const divergen = casos.filter((t) => slugDe(t) !== api.pocusSlug(t));
    comprobar('pocus-audit.mjs y pocus.html normalizan igual', divergen, []);
  }
}

/* ── Informe ───────────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`Enlaces profundos POCUS — ${pasadas + fallos} comprobaciones sobre ${pocusData.length} fichas`);
if (fallos) {
  console.log(`${fallos} fallo(s).`);
  process.exit(1);
}
console.log('Todas pasan.');
process.exit(0);
