#!/usr/bin/env node
/**
 * MedCheck — test del agrupado del catálogo de indicaciones (`_catalogGroupsOf`)
 *
 * PREGUNTA QUE RESPONDE: ¿un término que cruza aparatos aparece en TODOS sus dominios, y no
 * solo en el primero? Nació el 2026-09-08: «probióticos» cubre A07F (orales) y G01AX14
 * (vaginales), pero el catálogo lo pintaba solo bajo Digestivo, así que buscándolo por
 * Ginecología no existía. El pie del propio catálogo ya prometía lo contrario —«una indicación
 * puede pertenecer a varias»— y era falso en la práctica.
 *
 * Se ejecuta el CUERPO REAL de la función, extraído de assets/js/cima-app.js, no una copia
 * tecleada aquí: una copia se queda atrás en silencio y el test seguiría verde sobre código
 * muerto (es la clase de fallo de R65/R71 en el cuaderno del entorno).
 *
 * Lo que exige:
 *   1. `catalogGroup` como cadena sigue funcionando igual que antes (no se rompe lo existente).
 *   2. `catalogGroup` como lista devuelve TODOS sus dominios, sin duplicados.
 *   3. Sin `catalogGroup` cae a la letra del ATC, que es el contrato viejo.
 *   4. TODO dominio usado en la ontología real existe en GROUP_ORDER (cima-app.js) y en
 *      allowedCatalogGroups (el auditor). Son dos listas escritas a mano en dos ficheros: si
 *      divergen, un término desaparece del catálogo o el auditor lo rechaza.
 *   5. `openIndicationCatalog` USA la función. Sin esto, alguien puede volver a leer
 *      `entry.catalogGroup` directo y el test seguiría en verde sobre una función huérfana.
 *   6. Los casos reales que motivaron esto (probióticos, candidiasis) están en varios dominios.
 *
 * Uso: node scripts/medcheck-test-catalogo.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(ROOT, 'assets', 'js', 'cima-app.js'), 'utf8');
const auditSrc = readFileSync(join(ROOT, 'scripts', 'medcheck-audit-ontology.mjs'), 'utf8');
const ontology = JSON.parse(readFileSync(join(ROOT, 'assets', 'data', 'clinical-ontology.json'), 'utf8'));

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};

/** Extrae un bloque `{...}` equilibrado a partir de la posición de una firma. */
function bloqueDesde(src, firma) {
    const i = src.indexOf(firma);
    if (i === -1) throw new Error(`no se encontró "${firma}" en el fuente`);
    let j = src.indexOf('{', i);
    let prof = 0;
    for (let k = j; k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (!prof) return src.slice(i, k + 1); }
    }
    throw new Error(`bloque sin cerrar para "${firma}"`);
}

/** Literal de array equilibrado a partir de la posición de una firma. */
function arrayDesde(src, firma) {
    const i = src.indexOf(firma);
    if (i === -1) throw new Error(`no se encontró "${firma}" en el fuente`);
    let j = src.indexOf('[', i);
    let prof = 0;
    for (let k = j; k < src.length; k++) {
        if (src[k] === '[') prof++;
        else if (src[k] === ']') { prof--; if (!prof) return src.slice(j, k + 1); }
    }
    throw new Error(`array sin cerrar para "${firma}"`);
}

// --- La función real, con la mínima API que necesita (solo el fallback por letra) -------------
const cuerpo = bloqueDesde(appSrc, '_catalogGroupsOf(entry) {');
if (!cuerpo.includes('catalogGroup')) throw new Error('la extracción no trajo la función esperada');
const getATCCategoryName = (code) => ({ A: 'Ap. Digestivo y Metabolismo', G: 'Sistema Genitourinario y Hormonas Sexuales' }[code] || code);
// eslint-disable-next-line no-eval
const app = eval(`({ api: { getATCCategoryName }, ${cuerpo} })`);
const grupos = (entry) => app._catalogGroupsOf(entry);

// 1 · cadena
ok('cadena → un solo dominio',
    JSON.stringify(grupos({ catalogGroup: 'Digestivo', atc: ['A07F'] })) === '["Digestivo"]');

// 2 · lista
ok('lista → todos los dominios, en orden',
    JSON.stringify(grupos({ catalogGroup: ['Digestivo', 'Ginecología y obstetricia'] }))
    === '["Digestivo","Ginecología y obstetricia"]');
ok('lista con repetido → se deduplica',
    JSON.stringify(grupos({ catalogGroup: ['Digestivo', 'Digestivo'] })) === '["Digestivo"]');
ok('lista vacía → cae al fallback por ATC, no devuelve nada vacío',
    JSON.stringify(grupos({ catalogGroup: [], atc: ['G01AX14'] }))
    === '["Sistema Genitourinario y Hormonas Sexuales"]');

// 3 · fallback
ok('sin catalogGroup → letra del ATC',
    JSON.stringify(grupos({ atc: ['A07F'] })) === '["Ap. Digestivo y Metabolismo"]');
ok('sin catalogGroup ni atc → "Otros", nunca una lista vacía',
    JSON.stringify(grupos({})) === '["Otros"]');
ok('nunca devuelve lista vacía',
    [{}, { catalogGroup: [] }, { catalogGroup: '' }, { catalogGroup: null, atc: [] }]
        .every(e => grupos(e).length > 0));

// 4 · las dos listas escritas a mano coinciden, y la ontología real solo usa dominios válidos
// eslint-disable-next-line no-eval
const GROUP_ORDER = eval(arrayDesde(appSrc, 'const GROUP_ORDER = '));
// eslint-disable-next-line no-eval
const permitidos = eval(arrayDesde(auditSrc, 'const allowedCatalogGroups = new Set('));
const soloEnApp = GROUP_ORDER.filter(g => !permitidos.includes(g));
const soloEnAuditor = permitidos.filter(g => !GROUP_ORDER.includes(g));
ok('GROUP_ORDER (app) y allowedCatalogGroups (auditor) son la misma lista',
    !soloEnApp.length && !soloEnAuditor.length,
    `solo en app: ${soloEnApp.join(', ') || '—'} · solo en auditor: ${soloEnAuditor.join(', ') || '—'}`);

const desconocidos = [];
for (const [term, entry] of Object.entries(ontology.terms)) {
    if (!entry.catalogGroup) continue;
    for (const g of grupos(entry)) if (!GROUP_ORDER.includes(g)) desconocidos.push(`${term}→${g}`);
}
ok('todo dominio declarado en la ontología existe en GROUP_ORDER',
    !desconocidos.length, desconocidos.join(', '));

// 4b · el auditor valida CADA elemento de la lista, no solo "es un array"
ok('el auditor recorre los dominios uno a uno',
    /for \(const grupo of catalogGroups\)/.test(auditSrc));
ok('el auditor sigue rechazando un dominio desconocido',
    /allowedCatalogGroups\.has\(grupo\)/.test(auditSrc));
ok('el auditor sigue avisando cuando no hay ningún dominio',
    /if \(!catalogGroups\.length\) warnings\.push/.test(auditSrc));

// 5 · el catálogo la usa de verdad
ok('openIndicationCatalog agrupa con _catalogGroupsOf',
    /for \(const groupName of this\._catalogGroupsOf\(entry\)\)/.test(appSrc));
ok('el catálogo ya no lee entry.catalogGroup directo al agrupar',
    !/let groupName = entry\.catalogGroup/.test(appSrc));

// 6 · los casos reales que lo motivaron
const enVarios = (term) => grupos(ontology.terms[term] || {}).length > 1;
ok('«probióticos» aparece en Digestivo y en Ginecología',
    grupos(ontology.terms['probióticos'] || {}).includes('Digestivo')
    && grupos(ontology.terms['probióticos'] || {}).includes('Ginecología y obstetricia'));
ok('«candidiasis» aparece en más de un dominio', enVarios('candidiasis'));

// El total del catálogo cuenta TÉRMINOS ÚNICOS; los contadores por grupo cuentan APARICIONES.
// Se fija aquí para que nadie "arregle" la diferencia haciendo que un término solo salga una vez.
const apariciones = Object.values(ontology.terms).reduce((n, e) => n + grupos(e).length, 0);
ok('las apariciones superan al número de términos (hay términos en varios dominios)',
    apariciones > Object.keys(ontology.terms).length,
    `${apariciones} apariciones / ${Object.keys(ontology.terms).length} términos`);

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — el catálogo agrupa por todos los dominios declarados.');
process.exit(fallos ? 1 : 0);
