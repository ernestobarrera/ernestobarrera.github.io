#!/usr/bin/env node
/**
 * MedCheck — test de la lectura y la composición de los filtros de pubmed-filters
 * (pestaña Evidencia y zona de Evidencia de combinaciones).
 *
 * Por qué existe (2026-10-20). MedCheck lee los filtros EN DIRECTO de la web de pubmed-filters,
 * sin ninguna prueba propia, y reconocía una exclusión solo si la consulta empezaba por «NOT »
 * (mayúsculas y un espacio). El contrato de pubmed-filters es más ancho: su comprobación K3 usa
 * `isNegation()`, que acepta cualquier NOT inicial. Si `humans.txt` se reescribía como `NOT(`,
 * `not (` o con el NOT en su propia línea, el repo seguía en verde y MedCheck componía
 * `fármaco AND (NOT(...))`, que PubMed lee como `fármaco AND (...)`. Medido en ESearch el
 * 20/10/2026: `metformin NOT(...)` y `metformin not (...)` dan 33.353; `metformin AND (NOT (...))`
 * da 4.963, que son justo los estudios en animales. El único aviso viaja en `outputmessages`, y
 * con `rettype=count` (lo que piden las filas) no llega. Una cifra plausible, sin error.
 *
 * Doctrina que fija este test:
 *   - la consulta se extrae como `parseFilter()` de pubmed-filters: corte en la LÍNEA exacta del
 *     marcador (no en la subcadena: la plantilla lo menciona en comentarios), sin líneas vacías
 *     ni comentarios, unidas por un espacio;
 *   - una consulta que empieza por la PALABRA NOT, en cualquier caja y con lo que sea detrás, es
 *     una exclusión y se añade SIN `AND` en los cuatro sitios que componen: recuento y enlace de
 *     la fila, barra de combinar y Evidencia de combinaciones. `NOTCH1[tiab]` no lo es;
 *   - con el formato de hoy (una línea, «NOT ») la consulta compuesta es la misma de antes, así
 *     que ni la caché de recuentos ni los enlaces cambian.
 *
 * `--canonico` añade la paridad con el parser real de `../pubmed-filters` y con sus ficheros
 * (solo en local). Sin el repositorio al lado sale INCONCLUSO y exit 2: no se aprueba lo que no
 * se ha podido comparar. Sin la opción no se intenta, y el banco del CI no lo declara cubierto.
 *
 * Uso: node scripts/medcheck-test-filtro-pubmed.mjs [--canonico]
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo; exit 2 si no se pudo comparar.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://ernestobarrera.github.io/pubmed-filters/filters/';

// ─── Sandbox: la clase REAL, con un DOM mínimo que registra lo que se escribe ─────────────────
let servidos = {};          // url -> texto que devuelve el fetch simulado
let elementos = {};         // id -> elemento simulado
let temporizadoresRapidos = false;
const elemento = (props = {}) => ({
    value: '', checked: false, dataset: {}, innerHTML: '', textContent: '', href: '', className: '',
    isConnected: true, classList: { add() {}, remove() {}, toggle() {} }, ...props,
});
const sandbox = {
    window: {},
    document: {
        addEventListener() {},
        getElementById: id => elementos[id] ?? null,
        querySelector: () => null,
        querySelectorAll: () => [],
    },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async url => (url in servidos
        ? { ok: true, status: 200, text: async () => servidos[url] }
        : { ok: false, status: 404, text: async () => '' }),
    AbortSignal,
    setTimeout: (fn, ms, ...a) => setTimeout(fn, temporizadoresRapidos ? 0 : ms, ...a),
    clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    encodeURIComponent, decodeURIComponent,
    navigator: { onLine: true },
    location: { search: '', href: '' },
    CimaAPI: { ATC_CATEGORIES: [] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function') {
    console.error('No se pudo cargar MedCheckApp');
    process.exit(1);
}

let failures = 0;
function check(name, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.log(`  FALLO  ${name}\n         esperado: ${JSON.stringify(expected)}\n         obtenido: ${JSON.stringify(got)}`);
    } else {
        console.log(`  ok     ${name}`);
    }
}
const nuevaApp = () => Object.create(MedCheckApp.prototype);
const decodificar = href => decodeURIComponent(String(href).replace(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/, ''));
// La firma del error: una exclusión colocada detrás de un AND, con los paréntesis que sean.
const exclusionTrasAnd = q => /\bAND\s*\(+\s*NOT\b/i.test(q);

// ─── Fixtures ───────────────────────────────────────────────────────────────────────────────
const EXCLUSION = '(((animals[mh]) NOT humans[mh]))';
const cabecera = '# Filtro: Estudios en Humanos v.1.\n# Referencia completa: Elaboración propia.\n\n';
const meta = '\n\n@@@FILTER_METADATA@@@\n{\n  "validation": { "reference": "Elaboración propia" }\n}\n';
const VARIANTES_HUMANOS = [
    { nombre: 'formato de hoy (NOT y espacio)', txt: `${cabecera}NOT ${EXCLUSION}${meta}`, query: `NOT ${EXCLUSION}` },
    { nombre: 'NOT( sin espacio', txt: `${cabecera}NOT${EXCLUSION}${meta}`, query: `NOT${EXCLUSION}` },
    { nombre: 'not en minúscula', txt: `${cabecera}not ${EXCLUSION}${meta}`, query: `not ${EXCLUSION}` },
    { nombre: 'NOT en su propia línea', txt: `${cabecera}NOT\n${EXCLUSION}${meta}`, query: `NOT ${EXCLUSION}` },
    { nombre: 'CRLF y tabulador', txt: `${cabecera}NOT\t${EXCLUSION}${meta}`.replace(/\n/g, '\r\n'), query: `NOT\t${EXCLUSION}` },
];
// Filtro positivo multilínea cuyo comentario MENCIONA el marcador: el corte por subcadena lo
// trunca ahí y deja la consulta vacía.
const META_TXT = [
    '# Filtro: Revisiones sistemáticas (prueba)',
    '# El bloque de validación va tras la línea @@@FILTER_METADATA@@@ (esta mención no corta)',
    '',
    '(systematic[sb] OR',
    'meta-analysis[pt])',
    '',
    '@@@FILTER_METADATA@@@',
    '{"validation":{"reference":"CADTH","metrics":{"sensitivity":90}}}',
].join('\n');
const META_QUERY = '(systematic[sb] OR meta-analysis[pt])';
const DEFS = [
    { id: 'metaanalysis', cat: 'methodology', label: 'RS', icon: 'fa-layer-group' },
    { id: 'humans', cat: 'scope', label: 'Humanos', icon: 'fa-user', defaultChecked: true },
];
const servir = humanosTxt => {
    servidos = {
        [`${BASE_URL}methodology/metaanalysis.txt`]: META_TXT,
        [`${BASE_URL}scope/humans.txt`]: humanosTxt,
    };
};

// ─── 1. Reconocer una exclusión ────────────────────────────────────────────────────────────
console.log('\n1. Qué es una exclusión');
{
    const app = nuevaApp();
    const casos = [
        ['NOT (x[mh])', true], ['NOT(x[mh])', true], ['not (x[mh])', true], ['  NOT\t(x[mh])', true],
        ['NOT\n(x[mh])', true], ['NOT x[mh]', true],
        ['NOTCH1[tiab] OR x', false], ['note[tiab]', false], ['(x) NOT y', false], ['humans[mh]', false],
        ['', false], [null, false], [undefined, false],
    ];
    for (const [q, esperado] of casos) check(`${JSON.stringify(q)} → ${esperado}`, app._isEvidenceExclusion(q), esperado);
}

// ─── 2. Leer el fichero como el parser canónico ────────────────────────────────────────────
console.log('\n2. Lectura del fichero');
{
    const app = nuevaApp();
    const r = app._parseEvidenceFilter(META_TXT);
    check('multilínea: líneas unidas por espacio', r.query, META_QUERY);
    check('la mención del marcador en un comentario no corta', r.query !== '', true);
    check('los metadatos se leen tras la línea exacta', r.meta?.validation?.reference, 'CADTH');
    check('sin marcador: todo es consulta', app._parseEvidenceFilter('# c\nfoo[tiab]\n\nbar[tiab]').query, 'foo[tiab] bar[tiab]');
    check('sin marcador: sin metadatos', app._parseEvidenceFilter('foo[tiab]').meta, null);
    check('solo comentarios: consulta vacía', app._parseEvidenceFilter('# a\n# b\n').query, '');
    check('marcador con espacios alrededor', app._parseEvidenceFilter('x[tiab]\n  @@@FILTER_METADATA@@@  \n{"a":1}').query, 'x[tiab]');
    check('JSON roto: consulta intacta, metadatos null', app._parseEvidenceFilter('x[tiab]\n@@@FILTER_METADATA@@@\n{roto').meta, null);
    for (const v of VARIANTES_HUMANOS) check(`humanos, ${v.nombre}`, app._parseEvidenceFilter(v.txt).query, v.query);
}

// ─── 3. Los cuatro sitios que componen ─────────────────────────────────────────────────────
console.log('\n3. Composición en la pestaña, la barra de combinar y combinaciones');
for (const v of VARIANTES_HUMANOS) {
    console.log(`   · ${v.nombre}`);
    servir(v.txt);
    const app = nuevaApp();
    const enviados = [];
    app._fetchPubmedCount = async (q, _valido, opts) => { enviados.push(q); return opts?.diagnostico ? { count: 1, diag: null } : 1; };

    // 3a. Fila de la pestaña: recuento y enlace.
    elementos = {
        'evidence-content': elemento(),
        'evlink-total': elemento(), 'evlink-metaanalysis': elemento(), 'evlink-humans': elemento(),
    };
    await app._loadEvidenceFiltersAndCount('metformin', DEFS, 0);
    const filaHumanos = app._evidenceCountRequests?.humans?.query;
    check('  fila: recuento sin AND delante de la exclusión', filaHumanos, `metformin ${v.query}`);
    check('  fila: enlace igual que el recuento', decodificar(elementos['evlink-humans'].href), `metformin ${v.query}`);
    check('  fila: el filtro positivo sigue con AND', app._evidenceCountRequests?.metaanalysis?.query, `metformin AND (${META_QUERY})`);
    check('  fila: tooltip desde los metadatos', app._evidenceFilterQueryCache.get('metaanalysis')?.tooltip, 'Sensibilidad: 90% · Fuente: CADTH');
    check('  fila: nada salió con AND (NOT', enviados.some(exclusionTrasAnd), false);

    // 3b. Barra de combinar (reutiliza las consultas que dejó la carga de la fila).
    elementos = {
        'evidence-combine-bar': elemento(), 'evidence-combine-n': elemento(),
        'evidence-drug-input': elemento({ value: 'metformin' }), 'evidence-acotar-input': elemento(),
        'evidence-date-slider': elemento({ dataset: { days: '0' } }),
        'evidence-combine-link': elemento(), 'evidence-combine-result': elemento(),
    };
    app._evSelectedFilters = new Set(['metaanalysis', 'humans']);
    app._evCombineMode = 'AND';
    app._evCombineCycle = 0;
    await app._updateEvidenceCombineBar();
    check('  combinar: la exclusión va al final y sin AND',
        decodificar(elementos['evidence-combine-link'].href), `metformin AND (${META_QUERY}) ${v.query}`);

    // 3c. Evidencia de combinaciones.
    const base = '(metformin) AND (sitagliptin)';
    elementos = {
        'combo-ev-grid': elemento(), 'combo-ev-query': elemento({ value: base }),
        'combo-evlink-total': elemento(), 'combo-evlink-metaanalysis': elemento(), 'combo-evlink-humans': elemento(),
    };
    app._evidenceFilterDefs = () => DEFS;
    app._evidenceCountCache = new Map();
    enviados.length = 0;
    temporizadoresRapidos = true;
    await app.loadComboEvidenceCounts();
    temporizadoresRapidos = false;
    check('  combinaciones: enlace sin AND delante de la exclusión', decodificar(elementos['combo-evlink-humans'].href), `${base} ${v.query}`);
    check('  combinaciones: recuento igual que el enlace', enviados.includes(`${base} ${v.query}`), true);
    check('  combinaciones: nada salió con AND (NOT', enviados.some(exclusionTrasAnd), false);
}

// ─── 4. --canonico: paridad con pubmed-filters (solo en local) ─────────────────────────────
let inconcluso = false;
if (process.argv.includes('--canonico')) {
    console.log('\n4. Paridad con el parser canónico de pubmed-filters');
    const repo = join(ROOT, '..', 'pubmed-filters');
    const parser = join(repo, 'scripts', 'parse-filter.mjs');
    if (!existsSync(parser)) {
        console.log(`INCONCLUSO: no está pubmed-filters en ${repo}; la paridad no se ha comparado.`);
        inconcluso = true;
    } else {
        const { parseFilter, isNegation } = await import(pathToFileURL(parser).href);
        const catalogo = JSON.parse(readFileSync(join(repo, 'filters', 'catalog.json'), 'utf8'));
        const exclusionDe = new Map([...(catalogo.filters || []), ...(catalogo.journal_lists || [])].map(f => [f.path, f.exclusion === true]));
        const app = nuevaApp();
        for (const f of MedCheckApp.prototype._evidenceFilterDefs.call(app)) {
            const path = `filters/${f.cat}/${f.id}.txt`;
            const fichero = join(repo, path);
            if (!existsSync(fichero)) { check(`${path} existe en pubmed-filters`, false, true); continue; }
            const txt = readFileSync(fichero, 'utf8');
            const q = app._parseEvidenceFilter(txt).query;
            check(`${f.id}: misma consulta que parseFilter()`, q, parseFilter(txt));
            check(`${f.id}: misma exclusión que isNegation()`, app._isEvidenceExclusion(q), isNegation(q));
            if (exclusionDe.has(path)) check(`${f.id}: exclusión coherente con el catálogo`, app._isEvidenceExclusion(q), exclusionDe.get(path));
        }
        for (const v of [...VARIANTES_HUMANOS.map(x => x.txt), META_TXT]) {
            check('fixture: misma consulta que parseFilter()', app._parseEvidenceFilter(v).query, parseFilter(v));
        }
    }
}

console.log(failures ? `\n${failures} fallo(s)` : (inconcluso ? '\nSin fallos, con paridad INCONCLUSA' : '\nTodo en verde'));
process.exit(failures ? 1 : (inconcluso ? 2 : 0));
