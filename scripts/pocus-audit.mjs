#!/usr/bin/env node
/**
 * pocus-audit.mjs — comprobador estructural del atlas POCUS.
 *
 * Nació el 18/08/2026 al construir la fase 2 de la ampliación, y se promovió al repo antes de la
 * fase 3 porque esa añade cinco fichas de una vez: es justo el tamaño de lote en el que se cuela
 * una ficha en un segmento que no existe en el maniquí, o un `refId` que no está en el JSON. Nada
 * de eso rompe la página con un error visible — simplemente deja contenido inalcanzable o una
 * ficha sin fuentes, que es peor porque no se nota.
 *
 * Contrato de tres estados, el mismo que ya usan los comprobadores del entorno:
 *   0  todo cuadra
 *   1  hay al menos un problema estructural (bloquea)
 *   2  inconcluso: no se pudo analizar (fichero ausente, `pocusData` que no se deja extraer).
 *      Un comprobador que aprueba por no encontrar nada es peor que no tenerlo.
 *
 *   node scripts/pocus-audit.mjs
 *   node scripts/pocus-audit.mjs --enlaces   (imprime además el enlace ?ficha= de cada ficha)
 */

import fs from 'fs';
import path from 'path';
import process from 'process';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const HTML = path.join(RAIZ, 'pocus.html');
const REFS = path.join(RAIZ, 'assets', 'data', 'pocus-refs.json');

const inconcluso = (msg) => {
  console.error(`[INCONCLUSO] ${msg}`);
  process.exit(2);
};

if (!fs.existsSync(HTML)) inconcluso(`no encuentro ${HTML}`);
if (!fs.existsSync(REFS)) inconcluso(`no encuentro ${REFS}`);

const html = fs.readFileSync(HTML, 'utf8');

let refs;
try {
  refs = JSON.parse(fs.readFileSync(REFS, 'utf8'));
} catch (e) {
  inconcluso(`pocus-refs.json no es JSON válido: ${e.message}`);
}

/* Extrae el literal de `pocusData` equilibrando corchetes. Hay que respetar cadenas y escapes
   porque las fichas llevan HTML con corchetes dentro de plantillas. */
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

/* Desde la fase 3, las fichas de procedimiento interpolan bloques comunes declarados antes de
   `pocusData` (p. ej. TECNICA_PROCEDIMIENTO_ECOGUIADO). Sin traerlos, el eval falla y el
   comprobador sale INCONCLUSO — que es lo correcto, pero inútil. Se recogen las constantes en
   MAYÚSCULAS declaradas con plantilla que aparezcan antes de `pocusData`. */
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
if (!literal) inconcluso('no consigo extraer `pocusData` de pocus.html (¿cambió la forma de declararlo?)');

const previas = extraerConstantesPrevias(html);

let data;
try {
  data = eval(`${previas.join('\n')}\n(${literal})`);
} catch (e) {
  inconcluso(`\`pocusData\` no evalúa: ${e.message}`
    + (previas.length ? ` (se resolvieron ${previas.length} constante(s) previa(s))` : ' (no se encontró ninguna constante previa que resolver)'));
}
if (!Array.isArray(data) || !data.length) inconcluso('`pocusData` no es un array con contenido');

const zonasSvg = new Set([...html.matchAll(/data-segment="([a-z_]+)"/g)].map((m) => m[1]));
const enMenu = new Set([...html.matchAll(/navigateToSegment\('([a-z_]+)'\)/g)].map((m) => m[1]));
const porSegmento = {};
for (const app of data) (porSegmento[app.segment] ||= []).push(app.title);
const conFicha = new Set(Object.keys(porSegmento));

if (!zonasSvg.size) inconcluso('no encuentro ninguna zona `data-segment` en el SVG');

const problemas = [];

for (const seg of conFicha)
  if (!zonasSvg.has(seg))
    problemas.push(`ficha(s) en el segmento «${seg}» sin zona en el maniquí: ${porSegmento[seg].join(', ')}`);

for (const seg of zonasSvg)
  if (!conFicha.has(seg)) problemas.push(`zona «${seg}» del maniquí sin ninguna ficha: al pulsarla no sale nada`);

for (const seg of conFicha)
  if (!enMenu.has(seg)) problemas.push(`segmento «${seg}» no alcanzable desde el menú de navegación`);

for (const app of data)
  if (app.refId && !refs[app.refId])
    problemas.push(`«${app.title}» apunta a un refId que no existe en pocus-refs.json: ${app.refId}`);

const titulos = data.map((a) => a.title);
for (const t of new Set(titulos))
  if (titulos.filter((x) => x === t).length > 1) problemas.push(`título duplicado: «${t}»`);

/* ── Enlaces profundos (?ficha=) ───────────────────────────────────────────────────────────
   El slug de cada ficha se DERIVA del título en la propia página; no hay campo que mantener.
   Eso hace que dos títulos distintos puedan colapsar en el mismo slug —«Lipoma» y «lipoma.»,
   por ejemplo— y entonces uno de los dos enlaces abre la ficha equivocada, en silencio. Aquí
   se reproduce la misma normalización que usa `pocusSlug()` en pocus.html: si las dos dejan de
   coincidir, esta comprobación deja de valer, así que van juntas. */
const slugDe = (t) =>
  String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const slugs = data.map((a) => slugDe(a.title));
for (const s of new Set(slugs)) {
  if (slugs.filter((x) => x === s).length > 1)
    problemas.push(
      `slug duplicado «${s}»: ${data.filter((a) => slugDe(a.title) === s).map((a) => `«${a.title}»`).join(' y ')} ` +
      `comparten enlace ?ficha=, y uno de los dos abrirá la ficha equivocada`
    );
}
data.forEach((a, i) => {
  if (!slugs[i]) problemas.push(`«${a.title}» produce un slug vacío: no se puede enlazar con ?ficha=`);
});

/* Un slug de ficha no puede coincidir con un id de zona, porque el resolutor prueba primero
   como ficha y la zona quedaría inalcanzable por ?zona=. */
for (const s of slugs)
  if (conFicha.has(s.replace(/-/g, '_')))
    problemas.push(`el slug «${s}» choca con la zona «${s.replace(/-/g, '_')}»: ?zona= dejaría de alcanzarla`);

// Contrato de la página: si desaparece el resolutor, todos los enlaces repartidos mueren.
for (const simbolo of ['function pocusSlug', 'window.abrirFicha', 'window.aplicarEnlaceProfundo'])
  if (!html.includes(simbolo))
    problemas.push(`pocus.html ya no define \`${simbolo}\`: los enlaces profundos ?ficha= dejarían de resolver`);

for (const app of data) {
  const falta = ['technique', 'findings', 'evidence', 'pearls'].filter((k) => !(app.content || {})[k]);
  if (falta.length) problemas.push(`«${app.title}» sin ${falta.join(', ')}`);
}

/* Contrato D-2 de la ampliación: la fuente se cita UNA vez, de forma general, al inicio. Ninguna
   ficha lleva etiqueta de nivel/prioridad/año objetivo ni nombra el método de consenso. */
const prohibido = /\b(tier\s*[1-5]|nivel\s*[1-5]\b|prioridad\s*[1-5]\b|delphi|grupo de trabajo de consenso)\b/i;
for (const app of data)
  if (prohibido.test(JSON.stringify(app.content || {})))
    problemas.push(`«${app.title}» parece incumplir el contrato de cita (etiqueta de nivel o método de consenso)`);

/* Los campos de informe se referencian por [[id]] en la plantilla: un id que no existe sale como
   literal en el texto que el usuario copia a la historia clínica. */
for (const app of data) {
  const plantilla = app.content?.reportTemplate;
  if (!plantilla) continue;
  const ids = new Set((app.content.reportFields || []).map((f) => f.id));
  for (const m of plantilla.matchAll(/\[\[([a-z0-9_]+)\]\]/g))
    if (!ids.has(m[1])) problemas.push(`«${app.title}»: la plantilla usa [[${m[1]}]] y no hay campo con ese id`);
}

/* `visibleWhen` se consume como { fieldId, equals }. Escribirlo como { field, value } no rompe
   nada visiblemente: el atributo sale como "undefined" y la fila condicional queda muerta, así que
   el campo simplemente no aparece nunca. Se cazó así, a mano, en la primera ficha de procedimiento
   de la fase 3; con cuatro más por venir, la comprobación sale más barata que volver a mirarlo. */
for (const app of data) {
  for (const f of app.content?.reportFields || []) {
    if (!f.visibleWhen) continue;
    const { fieldId, equals } = f.visibleWhen;
    if (!fieldId || equals === undefined) {
      problemas.push(`«${app.title}» campo «${f.id}»: visibleWhen debe ser { fieldId, equals } y llegó ${JSON.stringify(f.visibleWhen)}`);
      continue;
    }
    const ids = new Set((app.content.reportFields || []).map((x) => x.id));
    if (!ids.has(fieldId))
      problemas.push(`«${app.title}» campo «${f.id}»: visibleWhen apunta a «${fieldId}», que no es ningún campo de esta ficha`);
    else {
      const ctrl = app.content.reportFields.find((x) => x.id === fieldId);
      const vals = new Set((ctrl.options || []).map((o) => o.value));
      if (ctrl.options && !vals.has(equals))
        problemas.push(`«${app.title}» campo «${f.id}»: visibleWhen espera «${equals}», que no es una opción de «${fieldId}»`);
    }
  }
}

/* ── Solapes entre zonas del maniquí ───────────────────────────────────────────────────────
   Dos zonas de segmentos distintos que se pisan se roban el clic: en SVG gana la última del
   documento, así que una zona nueva puede dejar muda a otra sin que nada falle.

   Se cazó así una regresión real el 19/08: al recolocar la pierna, la zona de TVP subió a y=300
   y se metió bajo las de vejiga y escrotal, que llegan hasta y=335.

   Los cuatro pares de abajo son ANTERIORES a esta comprobación, pequeños y deliberados (el
   corazón entre los pulmones, el cuello lateral junto al tiroides, la vejiga sobre el escroto).
   Se aceptan como base para que el comprobador no nazca en rojo — un gate siempre rojo se acaba
   ignorando— pero cualquier par NUEVO bloquea. Si se corrige alguno, quítalo de aquí. */
const SOLAPES_ACEPTADOS = new Set([
  'cardiac|lung',
  'neck|neck_lateral',
  'scrotal|suprapubic'
]);

function cajasDeZonas(src) {
  const ini = src.indexOf('<g id="interactive-zones">');
  if (ini < 0) return null;
  const bloque = src.slice(ini, src.indexOf('</g>', ini));
  const num = (t, k) => {
    const m = t.match(new RegExp(`${k}="(-?[\\d.]+)"`));
    return m ? parseFloat(m[1]) : null;
  };
  const out = [];
  for (const t of bloque.split(/(?=<rect|<circle|<ellipse|<path)/)) {
    const seg = (t.match(/data-segment="([a-z_]+)"/) || [])[1];
    if (!seg) continue;
    let caja = null;
    if (t.startsWith('<rect')) {
      const x = num(t, 'x'), y = num(t, 'y'), w = num(t, 'width'), h = num(t, 'height');
      if (x !== null && w !== null) caja = [x, y, x + w, y + h];
    } else if (t.startsWith('<circle')) {
      const cx = num(t, 'cx'), cy = num(t, 'cy'), r = num(t, 'r');
      if (cx !== null && r !== null) caja = [cx - r, cy - r, cx + r, cy + r];
    } else if (t.startsWith('<ellipse')) {
      const cx = num(t, 'cx'), cy = num(t, 'cy'), rx = num(t, 'rx'), ry = num(t, 'ry');
      if (cx !== null && rx !== null) caja = [cx - rx, cy - ry, cx + rx, cy + ry];
    } else if (t.startsWith('<path')) {
      const d = (t.match(/d="([^"]+)"/) || [])[1];
      const ps = d ? [...d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]) : [];
      if (ps.length) caja = [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])),
                             Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];
    }
    if (caja) out.push({ seg, caja });
  }
  return out;
}

const cajas = cajasDeZonas(html);
if (!cajas || !cajas.length) inconcluso('no consigo leer las cajas de las zonas del maniquí');

const sePisan = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const vistos = new Set();
for (let i = 0; i < cajas.length; i++) {
  for (let j = i + 1; j < cajas.length; j++) {
    if (cajas[i].seg === cajas[j].seg) continue;
    if (!sePisan(cajas[i].caja, cajas[j].caja)) continue;
    const par = [cajas[i].seg, cajas[j].seg].sort().join('|');
    if (SOLAPES_ACEPTADOS.has(par) || vistos.has(par)) { vistos.add(par); continue; }
    vistos.add(par);
    problemas.push(`las zonas «${cajas[i].seg}» y «${cajas[j].seg}» se solapan en el maniquí: una robará el clic a la otra`);
  }
}

const verificadas = Object.values(refs).filter((r) => r.verified).length;

console.log(`Atlas POCUS — ${data.length} fichas en ${conFicha.size} segmentos`);
console.log(`Referencias: ${Object.keys(refs).length} (${verificadas} verificadas)`);
console.log('');

/* Con `--enlaces` sale el mapa completo de enlaces profundos, listo para pegar donde haga
   falta. Se imprime aparte del informe de problemas para que la salida normal siga siendo
   corta: cincuenta líneas de slugs esconderían el único aviso que importa. */
if (process.argv.includes('--enlaces')) {
  const BASE = 'https://ernestobarrera.github.io/pocus.html?ficha=';
  const ancho = Math.max(...data.map((a) => a.title.length));
  console.log('Enlaces profundos por ficha:');
  data
    .map((a, i) => ({ titulo: a.title, seg: a.segment, slug: slugs[i] }))
    .sort((a, b) => a.seg.localeCompare(b.seg) || a.titulo.localeCompare(b.titulo))
    .forEach((f) => console.log(`  ${f.titulo.padEnd(ancho)}  ${BASE}${f.slug}`));
  console.log('');
  console.log(`Zonas completas: ${[...conFicha].sort().map((z) => '?zona=' + z).join(' · ')}`);
  console.log('');
}

if (problemas.length) {
  console.log(`${problemas.length} problema(s):`);
  for (const p of problemas) console.log(`  - ${p}`);
  process.exit(1);
}

console.log('Sin problemas estructurales.');
process.exit(0);
