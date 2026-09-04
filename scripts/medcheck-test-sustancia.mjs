#!/usr/bin/env node
/**
 * MedCheck — test del bloque de sustancias del autocompletado.
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm + shims mínimos) y ejercita el
 * núcleo del nivel 1: la clave canónica de sustancia, las sugerencias que se derivan de un
 * conjunto de resultados, su orden y la agrupación por principio activo. Todo es puro (no
 * toca DOM), así que se invoca sobre un `this` desnudo del prototipo.
 *
 * Doctrina que fija este test:
 *   - se OFRECE con generosidad y se EJECUTA con exactitud: tecleando `omepra` aparecen
 *     omeprazol Y esomeprazol, y ninguna se descarta por no empezar por lo tecleado;
 *   - el orden es por coincidencia, nunca alfabético — alfabético pondría esomeprazol
 *     delante de omeprazol, que es el defecto que este trabajo viene a corregir;
 *   - una asociación es una entidad propia, no un caso de su primer componente;
 *   - `vtm` manda sobre `pactivos` porque es el único que llega en los listados;
 *   - un recuento derivado de una página truncada se dice truncado, no se redondea.
 *
 * El fixture reproduce la topología MEDIDA el 04/09/2026 contra CIMA con `comerc=1`:
 *   practiv1=omepra  → 174: omeprazol 81, esomeprazol 91, esomeprazol + naproxeno 2
 *   practiv1=amoxicilina → 102: amoxicilina 44, amoxicilina + ácido clavulánico 58
 *   practiv1=paracetamol → 264 totales, 200 devueltos (página cortada)
 * Se fijan como fixture y no se consultan en vivo: lo que se prueba es la invariante, no
 * el número. Las proporciones sí se conservan para que el orden sea el real.
 *
 * Uso: node scripts/medcheck-test-sustancia.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
    CimaAPI: { ATC_CATEGORIES: [] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });

const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function') {
    console.error('No se pudo cargar la clase MedCheckApp');
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

// `this` desnudo: solo el prototipo y el estado que los métodos puros leen.
const app = Object.create(MedCheckApp.prototype);
app._recentMeds = [];
app.getRecentMeds = function () { return this._recentMeds; };

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Los listados de CIMA NO traen `pactivos`: 0 de 592 registros medidos. Traen `vtm`.
const lista = (vtm, n, prefijo) => Array.from({ length: n }, (_, i) => ({
    nregistro: `${prefijo}-${i}`,
    nombre: `${prefijo} ${i} 20 mg`,
    vtm: { nombre: vtm },
}));

const OMEPRA = [
    ...lista('omeprazol', 81, 'OMEPRAZOL CINFA'),
    ...lista('esomeprazol', 91, 'AXIAGO'),
    ...lista('esomeprazol + naproxeno', 2, 'VIMOVO'),
];

const AMOXI = [
    ...lista('amoxicilina', 44, 'AMOXICILINA NORMON'),
    ...lista('amoxicilina + ácido clavulánico', 58, 'AUGMENTINE'),
];

console.log('\n=== Clave canónica de sustancia ===\n');

check('vtm manda: es el único campo que llega en los listados',
    app._substanceKey({ vtm: { nombre: 'bisoprolol' }, pactivos: 'BISOPROLOL FUMARATO 5 mg' }),
    'bisoprolol');

check('sin vtm, cae a pactivos entero (no al primer componente)',
    app._substanceKey({ pactivos: 'amoxicilina + ácido clavulánico' }),
    'amoxicilina + ácido clavulánico');

check('sin vtm ni pactivos, une los principios activos estructurados',
    app._substanceKey({ principiosActivos: [{ nombre: 'levodopa' }, { nombre: 'carbidopa' }] }),
    'levodopa + carbidopa');

check('sin nada, cadena vacía (el bloque no se pinta)',
    app._substanceKey({ nombre: 'MARCA SIN DATOS' }),
    '');

console.log('\n=== Sugerencias: qué se ofrece ===\n');

const sOmepra = app._extractSubstanceSuggestions(OMEPRA, 'omepra');
check('tecleando "omepra" se ofrecen las TRES sustancias que hay',
    sOmepra.map(s => s.name),
    ['omeprazol', 'esomeprazol', 'esomeprazol + naproxeno']);

check('omeprazol primero por coincidencia de prefijo, no por tamaño (esomeprazol tiene más)',
    [sOmepra[0].name, sOmepra[0].count, sOmepra[1].name, sOmepra[1].count],
    ['omeprazol', 81, 'esomeprazol', 91]);

// El defecto que se corrige: alfabético pondría esomeprazol antes que omeprazol.
const alfabetico = [...sOmepra].map(s => s.name).sort((a, b) => a.localeCompare(b, 'es'));
check('el orden NO es alfabético',
    sOmepra.map(s => s.name)[0] !== alfabetico[0],
    true);

check('la subcadena interior se ofrece aunque no empiece por lo tecleado',
    sOmepra.some(s => s.name === 'esomeprazol'),
    true);

check('tecleando el término entero, la coincidencia exacta sigue primera',
    app._extractSubstanceSuggestions(OMEPRA, 'omeprazol')[0].name,
    'omeprazol');

check('tecleando "esome", esomeprazol pasa a primero',
    app._extractSubstanceSuggestions(OMEPRA, 'esome')[0].name,
    'esomeprazol');

console.log('\n=== Sugerencias: cuándo NO se ofrecen ===\n');

check('una sola sustancia no es una elección: bloque vacío',
    app._extractSubstanceSuggestions(lista('omeprazol', 30, 'OMEPRAZOL CINFA'), 'omeprazol'),
    []);

check('sin resultados, bloque vacío',
    app._extractSubstanceSuggestions([], 'omeprazol'),
    []);

check('resultados sin identidad no inventan sustancia',
    app._extractSubstanceSuggestions([{ nregistro: '1', nombre: 'X' }, { nregistro: '2', nombre: 'Y' }], 'x'),
    []);

console.log('\n=== Asociaciones ===\n');

const sAmoxi = app._extractSubstanceSuggestions(AMOXI, 'amoxi');
check('la asociación es una fila propia, no cae dentro del monocomponente',
    sAmoxi.map(s => [s.name, s.count]),
    [['amoxicilina', 44], ['amoxicilina + ácido clavulánico', 58]]);

check('el monocomponente va primero: coincide por prefijo del nombre entero',
    sAmoxi[0].name,
    'amoxicilina');

check('se encuentra tecleando el segundo componente',
    app._extractSubstanceSuggestions(AMOXI, 'clavul').map(s => s.name),
    ['amoxicilina + ácido clavulánico', 'amoxicilina']);

console.log('\n=== Recuento truncado ===\n');

const sTrunc = app._extractSubstanceSuggestions(AMOXI, 'amoxi', { truncated: true });
check('el truncado viaja en cada sugerencia',
    sTrunc.every(s => s.truncated === true),
    true);

const htmlTrunc = app._renderSubstanceItems(sTrunc);
check('la fila truncada se pinta como mínimo, con el signo +',
    /44\+ medicamentos/.test(htmlTrunc),
    true);

const htmlExacto = app._renderSubstanceItems(sAmoxi);
check('la fila no truncada da la cifra a secas',
    /44 medicamentos/.test(htmlExacto) && !/44\+/.test(htmlExacto),
    true);

check('singular cuando hay un solo medicamento',
    /2 medicamentos/.test(app._renderSubstanceItems(sOmepra)) &&
    /1 medicamento</.test(app._renderSubstanceItems(
        app._extractSubstanceSuggestions([...lista('a', 3, 'A'), ...lista('b', 1, 'B')], 'a'))),
    true);

console.log('\n=== Render: contrato con el teclado y con el clic ===\n');

const html = app._renderSubstanceItems(sOmepra);
check('las filas llevan .autocomplete-item: el recorrido con flechas es UNA lista',
    (html.match(/class="autocomplete-item autocomplete-item--substance"/g) || []).length,
    3);

check('la cabecera de sección NO es .autocomplete-item: el teclado no se para en ella',
    /<div class="autocomplete-section">Sustancias<\/div>/.test(html) &&
    !/autocomplete-section[^>]*autocomplete-item/.test(html),
    true);

check('cada fila lleva data-substance y ninguna lleva data-nregistro',
    (html.match(/data-substance=/g) || []).length === 3 && !/data-nregistro/.test(html),
    true);

check('el nombre se escapa (una sustancia con comillas no rompe el atributo)',
    /data-substance="a&quot;b"/.test(app._renderSubstanceItems([{ name: 'a"b', count: 2, truncated: false }])),
    true);

console.log('\n=== Agrupación por principio activo ===\n');

const resumen = (grupos) => grupos.map(g => [g.name, g.meds.length]).sort((a, b) => a[0].localeCompare(b[0], 'es'));

check('la asociación NO se agrupa dentro de su primer componente',
    resumen(app.groupResultsByField(AMOXI, 'activeIngredient')),
    [['AMOXICILINA', 44], ['AMOXICILINA + ÁCIDO CLAVULÁNICO', 58]]);

check('dos sales del mismo fármaco son UN grupo, no dos',
    resumen(app.groupResultsByField([
        { nregistro: '1', nombre: 'EMCONCOR 5 mg', vtm: { nombre: 'bisoprolol' }, pactivos: 'BISOPROLOL FUMARATO 5 mg' },
        { nregistro: '2', nombre: 'BISOPROLOL CINFA 5 mg', vtm: { nombre: 'bisoprolol' }, pactivos: 'BISOPROLOL HEMIFUMARATO 5 mg' },
    ], 'activeIngredient')),
    [['BISOPROLOL', 2]]);

console.log('\n=== Invariante: lo ofrecido es lo que sale ===\n');

// La razón de que esto se pueda garantizar es que `searchBySubstance` NO reescribe la caja de
// búsqueda: acota el universo que ya trajo la consulta, con la misma clave que ofreció. Se
// comprueba contra el núcleo REAL de filtrado, no contra una réplica.
app.filterState = app._emptyFilterState();
app.initGroupingState();

for (const [universo, query] of [[OMEPRA, 'omepra'], [AMOXI, 'amoxi']]) {
    for (const sug of app._extractSubstanceSuggestions(universo, query)) {
        app.groupingState.activeIngredientFilters = new Set([sug.name]);
        const salen = app._applyResultFilters(universo, app._filterSnapshot()).length;
        check(`"${query}" → ${sug.name}: ofrece ${sug.count} y salen ${salen}`, salen, sug.count);
    }
}

// Y la criba es exacta: elegir omeprazol no deja pasar ni un esomeprazol.
app.groupingState.activeIngredientFilters = new Set(['omeprazol']);
const soloOme = app._applyResultFilters(OMEPRA, app._filterSnapshot());
check('elegir omeprazol deja 0 esomeprazol dentro',
    soloOme.filter(m => m.vtm.nombre.includes('esomeprazol')).length,
    0);
app.groupingState.activeIngredientFilters.clear();

// ─── Autoverificación: reintroducir el defecto y comprobar que se caza ────────
console.log('\n=== Autoverificación (reintroduce el defecto) ===\n');

const claveOriginal = MedCheckApp.prototype._substanceKey;
MedCheckApp.prototype._substanceKey = function (med) {
    // El defecto histórico: partir por el primer componente y tirar el resto.
    const pa = med?.vtm?.nombre || med?.pactivos || '';
    return pa.split(/\s*[+/;]\s*/)[0].trim();
};
check('con el split[0] de vuelta, la asociación se funde con el monocomponente (el test lo caza)',
    resumen(app.groupResultsByField(AMOXI, 'activeIngredient')),
    [['AMOXICILINA', 102]]);
MedCheckApp.prototype._substanceKey = claveOriginal;

check('restaurada la clave, vuelven a ser dos grupos',
    app.groupResultsByField(AMOXI, 'activeIngredient').length,
    2);

// ─── Cierre ───────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
