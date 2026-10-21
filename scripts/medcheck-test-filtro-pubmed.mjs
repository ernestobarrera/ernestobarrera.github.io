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

// ─── 5. Fila de revistas: especialidad por ATC y unión de categorías ───────────────────────
console.log('\n5. Revistas: especialidad por ATC y unión de categorías');
{
    const app = nuevaApp();
    const conAtc = (...codigos) => ({ atcs: codigos.map(c => ({ codigo: c, nivel: c.length >= 7 ? 5 : c.length === 5 ? 4 : c.length === 4 ? 3 : c.length === 3 ? 2 : 1 })) });
    check('metformina (A10BA02) → diabetes y endocrinología', app._evidenceJournalSpecialties(conAtc('A10', 'A10BA', 'A10BA02')),
        { prefijo: 'A10', ids: ['jnl_diabetes', 'jnl_endocrinology'] });
    check('se mira el ATC de nivel 5, no atcs[0]', app._evidenceJournalSpecialties(conAtc('A10', 'N06AB04'))?.prefijo, 'N06A');
    check('gana el prefijo más largo (N02CC → N02C, no N02 ni N)', app._evidenceJournalSpecialties(conAtc('N02CC01'))?.prefijo, 'N02C');
    check('sin entrada en la tabla → null', app._evidenceJournalSpecialties(conAtc('V07AB01')), null);
    check('sin ATC → null', app._evidenceJournalSpecialties({}), null);
    check('por defecto: Top, especialidad y AP, sin repetir', app._evidenceJournalDefault(conAtc('A10BA02')),
        ['jnl_top_publications', 'jnl_diabetes', 'jnl_endocrinology', 'jnl_primary_health_care']);
    check('sin especialidad: Top y AP', app._evidenceJournalDefault(conAtc('V07AB01')), ['jnl_top_publications', 'jnl_primary_health_care']);
    const ids = [...new Set([...Object.values(MedCheckApp._EV_REVISTAS_ATC).flat(), ...MedCheckApp._EV_REVISTAS_GENERALES])];
    check('todos los ids de la tabla tienen forma de lista de revistas', ids.filter(id => !/^jnl_[a-z0-9_]+$/.test(id)), []);

    const lista = id => `# Filtro: journals/${id}\n\n(${id.slice(4)}A[JO]|${id.slice(4)}B[JO])\n\n@@@FILTER_METADATA@@@\n{"type":"journals"}\n`;
    const consulta = id => `(${id.slice(4)}A[JO]|${id.slice(4)}B[JO])`;
    servidos = Object.fromEntries(['jnl_top_publications', 'jnl_diabetes', 'jnl_primary_health_care']
        .map(id => [`${BASE_URL}journals/${id}.txt`, lista(id)]));
    const uno = await app._fetchEvidenceFilter({ id: 'journals', cat: 'journals' });
    check('sin lists: Top tal cual (combinaciones no cambia)', uno.query, consulta('jnl_top_publications'));
    const tres = await app._fetchEvidenceFilter({ id: 'journals', cat: 'journals', lists: ['jnl_top_publications', 'jnl_diabetes', 'jnl_primary_health_care'] });
    check('varias: unión con OR', tres.query,
        `((${consulta('jnl_top_publications')}) OR (${consulta('jnl_diabetes')}) OR (${consulta('jnl_primary_health_care')}))`);
    check('el ⓘ nombra las categorías y dice qué mide', /Top Publications, Diabetes, Primary Health Care.*no calidad/.test(tres.tooltip), true);
    const rota = await app._fetchEvidenceFilter({ id: 'journals', cat: 'journals', lists: ['jnl_top_publications', 'jnl_oncology'] });
    check('si falla una lista, la fila no se cuenta con las demás', rota.query, null);
    servidos[`${BASE_URL}journals/jnl_oncology.txt`] = lista('jnl_oncology');
    const reintento = await app._fetchEvidenceFilter({ id: 'journals', cat: 'journals', lists: ['jnl_top_publications', 'jnl_oncology'] });
    check('el fallo no queda en caché: el reintento la recupera', !!reintento.query, true);

    // Por el camino real de la pestaña: la fila cuenta y enlaza la unión.
    const enviados = [];
    app._fetchPubmedCount = async (q, _v, opts) => { enviados.push(q); return opts?.diagnostico ? { count: 1, diag: null } : 1; };
    elementos = { 'evidence-content': elemento(), 'evlink-total': elemento(), 'evlink-journals': elemento(), 'evinfo-journals': elemento() };
    await app._loadEvidenceFiltersAndCount('metformin', [{ id: 'journals', cat: 'journals', label: 'Revistas', icon: 'fa-star', lists: ['jnl_top_publications', 'jnl_diabetes'] }], 0);
    const esperado = `metformin AND (((${consulta('jnl_top_publications')}) OR (${consulta('jnl_diabetes')})))`;
    check('fila: el recuento es el de la unión', app._evidenceCountRequests?.journals?.query, esperado);
    check('fila: el enlace abre la misma unión', decodificar(elementos['evlink-journals'].href), esperado);

    // Panel: lo marcado sale marcado y lo sugerido no se repite en «Todas».
    const catalogo = ['jnl_top_publications', 'jnl_diabetes', 'jnl_endocrinology', 'jnl_primary_health_care', 'jnl_health_medical_sciences_general', 'jnl_oncology']
        .map(id => ({ id, name: app._evidenceJournalNombre(id) }));
    const html = app._evidenceJournalPanelHtml(catalogo, new Set(['jnl_top_publications', 'jnl_diabetes']), { prefijo: 'A10', ids: ['jnl_diabetes', 'jnl_endocrinology'] });
    check('panel: cada categoría aparece una sola vez', (html.match(/data-jid="jnl_diabetes"/g) || []).length, 1);
    check('panel: lo elegido sale marcado', /data-jid="jnl_diabetes" checked/.test(html) && !/data-jid="jnl_endocrinology" checked/.test(html), true);
    check('panel: «Todas» lleva solo lo no sugerido ni general', /Todas las categorías \(6\)[\s\S]*data-jid="jnl_oncology"/.test(html), true);
    check('panel: sin catálogo lo dice y ofrece sugeridas y generales', /No se ha podido cargar el catálogo/.test(app._evidenceJournalPanelHtml(null, new Set(), null)), true);
}

// ─── 6. Traspaso a una IA con PubMed exacto ─────────────────────────────────────────────────
console.log('\n6. Traspaso a la IA: la búsqueda en pantalla, sus rutas y el origen de la ventana');
{
    const app = nuevaApp();
    const HUM = `NOT ${EXCLUSION}`;
    app._evFilterDefs = [...DEFS, { id: 'journals', cat: 'journals', label: 'Revistas', icon: 'fa-star', lists: ['jnl_top_publications', 'jnl_diabetes'] }];
    app._evFilterQueryById = { humans: HUM, metaanalysis: META_QUERY, journals: '((A[JO]) OR (B[JO]))' };
    app._evSelectedFilters = new Set(['humans']);
    app._evCombineMode = 'AND';
    app.currentMed = { nombre: 'DIANBEN 850 mg', vtm: { nombre: 'metformina' } };
    const pantalla = ({ days = '1825', tocado = false } = {}) => {
        elementos = {
            'evidence-drug-input': elemento({ value: 'metformin' }), 'evidence-acotar-input': elemento(),
            'evidence-date-slider': elemento({ dataset: { days, ...(tocado ? { tocado: '1' } : {}) } }),
            'evidence-date-label': elemento({ textContent: days === '0' ? 'Sin límite' : 'Últimos 5 años' }),
        };
    };

    pantalla();
    const b = app._evidenceHandoffSearch();
    check('por defecto (Humanos marcado): la consulta es la de la fila, con la exclusión sin AND',
        b.query, `metformin ${HUM} AND ("last 1825 days"[dp])`);
    check('lleva la ruta del filtro marcado', b.paths, ['filters/scope/humans.txt']);
    check('sin tocar el deslizador no es petición del clínico', b.tocado, false);

    app._evSelectedFilters = new Set(['metaanalysis', 'journals', 'humans']);
    const varios = app._evidenceHandoffSearch();
    check('varios marcados: la misma combinación que la barra de Combinar',
        varios.query, app._composeEvidenceCombination('metformin', [META_QUERY, '((A[JO]) OR (B[JO]))', HUM], 'AND', ' AND ("last 1825 days"[dp])'));
    check('revistas: una ruta por categoría elegida', varios.paths,
        ['filters/methodology/metaanalysis.txt', 'filters/journals/jnl_top_publications.txt', 'filters/journals/jnl_diabetes.txt', 'filters/scope/humans.txt']);
    check('la exclusión nunca detrás de un AND', exclusionTrasAnd(varios.query), false);

    app._evSelectedFilters = new Set(['metaanalysis', 'pediatrics']);
    check('un filtro marcado sin cargar: espera, no se lleva otra búsqueda', app._evidenceHandoffSearch(), { pendiente: true });
    app._evSelectedFilters = new Set(['humans']);

    app._evidenceCountCache = new Map([[b.query, 33353]]);
    const pDefecto = app._evidenceHandoffPrompt(app._evidenceHandoffSearch());
    check('prompt: la consulta va literal en su propia línea', pDefecto.split('\n').includes(b.query), true);
    check('prompt: declara la ruta en filters_used', /filters_used con estas rutas\): filters\/scope\/humans\.txt\./.test(pDefecto), true);
    check('prompt: ventana por defecto → agent_policy con pasada P2 sin ventana',
        /origin «agent_policy» y unrestricted_pass_id «P2»/.test(pDefecto) && /Pasada P2: la misma consulta sin la ventana/.test(pDefecto), true);
    check('prompt: trae el recuento de MedCheck para contrastarlo', /MedCheck contó 33353 registros/.test(pDefecto), true);
    check('prompt: no simula si falta el conector', /no simules la búsqueda/.test(pDefecto), true);

    pantalla({ tocado: true });
    app._evidenceCountCache = new Map();
    const pUsuario = app._evidenceHandoffPrompt(app._evidenceHandoffSearch());
    check('ventana elegida por el clínico → origin user y sin P2', /origin «user»/.test(pUsuario) && !/Pasada P2/.test(pUsuario), true);
    check('sin recuento en caché no se inventa uno', /MedCheck contó/.test(pUsuario), false);
    pantalla({ days: '0', tocado: true });
    const pSin = app._evidenceHandoffPrompt(app._evidenceHandoffSearch());
    check('sin límite de fecha → origin none', /origin «none»/.test(pSin) && !/last \d+ days/.test(pSin), true);

    // Abrir: Claude nunca recibe el prompt por URL (algún parámetro lo envía solo); ChatGPT sí, con tope.
    const abiertas = []; const avisos = [];
    sandbox.window.open = url => { abiertas.push(url); };
    sandbox.navigator.clipboard = { writeText: async () => {} };
    app.showToast = (m, t) => avisos.push(t);
    pantalla();
    app.openEvidenceAi('claude');
    app.openEvidenceAi('chatgpt');
    await new Promise(r => setTimeout(r, 0));
    check('Claude: abre claude.ai sin el prompt en la URL', abiertas[0], 'https://claude.ai/new');
    check('ChatGPT: precarga con ?q=', /^https:\/\/chatgpt\.com\/\?q=/.test(abiertas[1] || ''), true);
    elementos = {};
    app.openEvidenceAi('claude');
    check('sin término: avisa y no abre nada', abiertas.length === 2 && avisos.includes('warning'), true);

    // La guía enseña el selector y el traspaso, y sus destinos existen en la pestaña.
    const pasos = app._guideTours().evidence.steps;
    check('guía: paso del selector de revistas', pasos.some(s => s.target === '#tab-evidence #evidence-journals-toggle'), true);
    check('guía: paso del traspaso a la IA', pasos.some(s => s.target === '#tab-evidence .evidence-ia-handoff' && /PubMed exacto/.test(s.body)), true);
    check('los destinos de la guía están en la pestaña', src.includes('id="evidence-journals-toggle"') && src.includes('<div class="evidence-ia-handoff">'), true);
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
        // La fila de revistas no es un fichero: son listas del catálogo. Toda lista que MedCheck
        // pueda pedir (la tabla ATC, las generales) debe existir allí y leerse igual.
        const listas = new Map((catalogo.journal_lists || []).map(l => [l.id, l.path]));
        const pedibles = [...new Set([...Object.values(MedCheckApp._EV_REVISTAS_ATC).flat(), ...MedCheckApp._EV_REVISTAS_GENERALES])];
        check(`las ${pedibles.length} listas que MedCheck puede pedir están en el catálogo`, pedibles.filter(id => !listas.has(id)), []);
        for (const id of pedibles.filter(id => listas.has(id))) {
            const txt = readFileSync(join(repo, listas.get(id)), 'utf8');
            const q = app._parseEvidenceFilter(txt).query;
            if (q !== parseFilter(txt) || !q || app._isEvidenceExclusion(q)) check(`${id}: se lee como parseFilter() y no es exclusión`, false, true);
        }
        for (const f of MedCheckApp.prototype._evidenceFilterDefs.call(app).filter(f => f.cat !== 'journals')) {
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
