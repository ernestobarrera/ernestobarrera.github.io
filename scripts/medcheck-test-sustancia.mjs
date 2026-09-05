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

console.log('\n=== Monotonía: teclear más nunca quita información ===\n');

// El caso que él cazó en producción: `denos` daba tres sustancias y `denosu` ninguna, porque
// la primera versión exigía dos para pintar el bloque. Cifras reales del 04/09/2026.
const DENOS = [
    ...lista('denosumab', 28, 'WYOST'),
    ...lista('adenosina', 5, 'ADENOSINA ALTAN'),
    ...lista('regadenosón', 1, 'RAPISCAN'),
];
check('"denos" ofrece las tres sustancias que contienen esa cadena',
    app._extractSubstanceSuggestions(DENOS, 'denos').map(s => [s.name, s.count]),
    [['denosumab', 28], ['adenosina', 5], ['regadenosón', 1]]);

check('"denosu" sigue ofreciendo denosumab: una letra más no borra la sustancia',
    app._extractSubstanceSuggestions(DENOS.filter(m => m.vtm.nombre === 'denosumab'), 'denosu')
        .map(s => [s.name, s.count]),
    [['denosumab', 28]]);

// Mismo defecto, otra cara: con Biosimilar marcado, "insulina" deja una sola sustancia
// (insulina glargina, 3 de las 10 familias tiene biosimilar comercializado) y el bloque
// desaparecía entero.
check('un subconjunto de una sola sustancia sigue mostrando su fila',
    app._extractSubstanceSuggestions(lista('insulina glargina', 3, 'ABASAGLAR'), 'insulina')
        .map(s => [s.name, s.count]),
    [['insulina glargina', 3]]);

console.log('\n=== Sugerencias: cuándo NO se ofrecen ===\n');

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

console.log('\n=== No comercializados ===\n');

// Medido el 04/09/2026: `practiv1=omeprazol` SIN `comerc=1` devuelve las dos poblaciones
// mezcladas — omeprazol 69/30, esomeprazol 65/30, esomeprazol + naproxeno 2/4. La última es la
// que enseña por qué importa: 6 registros y solo 2 dispensables.
const MEZCLA = [
    ...lista('omeprazol', 69, 'OMEPRAZOL CINFA'),
    ...lista('omeprazol', 30, 'OMEPRAZOL VIEJO').map(m => ({ ...m, comerc: false })),
    ...lista('esomeprazol + naproxeno', 2, 'VIMOVO'),
    ...lista('esomeprazol + naproxeno', 4, 'VIMOVO RETIRADO').map(m => ({ ...m, comerc: false })),
];

const sMezcla = app._extractSubstanceSuggestions(MEZCLA, 'omepra');
check('cada sustancia cuenta aparte los no comercializados',
    sMezcla.map(s => [s.name, s.count, s.noComerc]),
    [['omeprazol', 99, 30], ['esomeprazol + naproxeno', 6, 4]]);

const htmlMezcla = app._renderSubstanceItems(sMezcla);
check('la fila avisa de cuántos no se pueden dispensar',
    /99 medicamentos<span class="autocomplete-substance-off">30 sin comercializar<\/span>/.test(htmlMezcla),
    true);

check('el caso engañoso queda a la vista: 6 registros, 4 sin comercializar',
    /6 medicamentos<span class="autocomplete-substance-off">4 sin comercializar<\/span>/.test(htmlMezcla),
    true);

check('sin mezcla no se pinta el aviso: el dato decide, no el estado de la casilla',
    /autocomplete-substance-off/.test(app._renderSubstanceItems(sOmepra)),
    false);

check('`_retirado` también cuenta, para las rutas que lo marquen',
    app._extractSubstanceSuggestions([
        ...lista('a', 2, 'A'),
        ...lista('b', 2, 'B').map(m => ({ ...m, _retirado: true })),
    ], 'a').map(s => [s.name, s.noComerc]),
    [['a', 0], ['b', 2]]);

console.log('\n=== Render: contrato con el teclado y con el clic ===\n');

const html = app._renderSubstanceItems(sOmepra);
check('las filas llevan .autocomplete-item: el recorrido con flechas es UNA lista',
    (html.match(/class="autocomplete-item autocomplete-item--substance"/g) || []).length,
    3);

check('la cabecera de sección NO es .autocomplete-item: el teclado no se para en ella',
    /<div class="autocomplete-section">Sustancias[^<]*<\/div>/.test(html) &&
    !/autocomplete-section[^>]*autocomplete-item/.test(html),
    true);

// Integridad: acotar es legítimo, acotar en silencio no.
check('la cabecera declara cuántas sustancias hay cuando caben todas',
    /<div class="autocomplete-section">Sustancias · 3<\/div>/.test(html),
    true);

const DIEZ = Array.from({ length: 10 }, (_, i) => lista(`insulina ${'abcdefghij'[i]}`, i + 1, `INS${i}`)).flat();
check('con más sustancias que sitio, la cabecera dice cuántas se ven y cuántas hay',
    /<div class="autocomplete-section">Sustancias · 4 de 10<\/div>/.test(
        app._renderSubstanceItems(app._extractSubstanceSuggestions(DIEZ, 'insulina'))),
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

console.log('\n=== Expansiones de principio activo ===\n');

// El diccionario existe para un problema de VOCABULARIO, no de prefijo: CIMA nombra la sal por
// el ion ("HIERRO SULFATO") y el médico la dice por el adjetivo ("sulfato ferroso"). Las
// insulinas se retiraron el 04/09/2026 tras medir que `practiv1` casa por subcadena y que las
// nueve entradas no aportaban ni una presentación. Quien vuelva a añadirlas debería medirlo
// antes; el centinela 8 (glargina) es el guardián en vivo.
const syn = app._paSynonyms;
check('conserva los iones, que sí aportan cobertura',
    Object.keys(syn).sort(),
    ['calcico', 'ferrico', 'ferroso', 'magnesico', 'magnésico', 'potasico', 'sodico'].sort());

check('ninguna clave de insulina: practiv1 ya las encuentra sola',
    Object.keys(syn).filter(k => ['glargina', 'lispro', 'aspart', 'detemir', 'degludec', 'glulisina', 'nph', 'bifasica', 'bifásica'].includes(k)),
    []);

check('toda expansión apunta al ion, que es como CIMA lo escribe',
    [...new Set(Object.values(syn))].sort(),
    ['calcio', 'hierro', 'magnesio', 'potasio', 'sodio']);

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

console.log('\n=== Duplicados: el recuento cuenta lo que la lista deja ver ===\n');

// Defecto real cazado por Codex y reproducido contra el catálogo: `insulina glargina` ofrecía 8
// y salían 7, porque uno de los registros es paralelo (sin ficha técnica seccionada) y la lista
// final lo excluye — «Incluir duplicados» viene desmarcada por defecto. El autocompletado
// aplicaba genérico/biosimilar/receta pero NO esa dimensión, que vive en el núcleo de filtrado.
const conFicha = (m) => ({ ...m, docs: [{ tipo: 1, secc: true }] });
const PARALELO = [
    ...lista('insulina glargina', 7, 'ABASAGLAR').map(conFicha),
    // Mismo perfil que uno de los anteriores, pero sin ficha seccionada: es el paralelo.
    { nregistro: 'PAR-1', nombre: 'ABASAGLAR 0 20 mg', vtm: { nombre: 'insulina glargina' }, docs: [] },
    ...lista('insulina lispro', 3, 'HUMALOG').map(conFicha),
];

app.filterState = app._emptyFilterState();
app.initGroupingState();
const snapPar = app._filterSnapshot();
const universoVisible = app._applyResultFilters(PARALELO, snapPar, { only: 'parallel' });

check('el filtro de duplicados sí retira el registro paralelo',
    [PARALELO.length, universoVisible.length],
    [11, 10]);

for (const sug of app._extractSubstanceSuggestions(universoVisible, 'insulina')) {
    app.groupingState.activeIngredientFilters = new Set([sug.name]);
    const salen = app._applyResultFilters(universoVisible, app._filterSnapshot()).length;
    check(`con duplicados fuera, ${sug.name}: ofrece ${sug.count} y salen ${salen}`, salen, sug.count);
}
app.groupingState.activeIngredientFilters.clear();

// Y la prueba de que el orden ya no depende de quién busque.
check('el orden no consulta el historial: mismas cifras con y sin recientes',
    (() => {
        const sinHist = app._extractSubstanceSuggestions(OMEPRA, 'omepra').map(s => s.name);
        app._recentMeds = [{ nregistro: '1', nombre: 'AXIAGO', pactivos: 'esomeprazol' }];
        const conHist = app._extractSubstanceSuggestions(OMEPRA, 'omepra').map(s => s.name);
        app._recentMeds = [];
        return JSON.stringify(sinHist) === JSON.stringify(conHist);
    })(),
    true);

console.log('\n=== El gesto completo: elegir no puede reutilizar la búsqueda anterior ===\n');

// El fallo que señaló Codex: `performSearch` hace `return` sin tocar `_lastSearchData` cuando no
// hay resultados o salta una excepción. Comprobar solo que ese campo existe repintaba el
// universo ANTERIOR bajo la sustancia recién elegida: resultados de otra consulta presentados
// como si fueran de esta.
function gesto({ searchOutcome }) {
    const a = Object.create(MedCheckApp.prototype);
    a.filterState = a._emptyFilterState();
    a.initGroupingState();
    a._lastSearchData = { resultados: OMEPRA, marca: 'BÚSQUEDA ANTERIOR' };
    a.lastSearchResults = { resultados: OMEPRA };
    a.autocompleteTimer = null;
    let pintado = null;
    a.displaySearchResults = (d) => { pintado = d; };
    a.updateURLWithCurrentState = () => {};
    a.performSearch = async () => {
        if (searchOutcome === 'vacio') { a.lastSearchResults = null; return; }        // `return` seco
        if (searchOutcome === 'excepcion') return;                                    // catch silencioso
        a._lastSearchData = { resultados: AMOXI, marca: 'BÚSQUEDA NUEVA' };
        a.lastSearchResults = { resultados: AMOXI };
    };
    return { app: a, run: () => a.searchBySubstance('omeprazol'), pintado: () => pintado };
}

for (const [caso, esperado] of [['vacio', null], ['excepcion', null], ['ok', 'BÚSQUEDA NUEVA']]) {
    const g = gesto({ searchOutcome: caso });
    await g.run();
    check(`búsqueda ${caso}: ${esperado ? 'repinta la nueva' : 'NO repinta nada'}`,
        g.pintado()?.marca ?? null, esperado);
}

const gOk = gesto({ searchOutcome: 'ok' });
await gOk.run();
check('cuando va bien, la faceta queda puesta con la sustancia elegida',
    [...gOk.app.groupingState.activeIngredientFilters],
    ['omeprazol']);

const gVacio = gesto({ searchOutcome: 'vacio' });
await gVacio.run();
check('cuando no hay resultados, tampoco se ensucia la faceta',
    [...gVacio.app.groupingState.activeIngredientFilters],
    []);

console.log('\n=== Identidad: la clave ofrecida es una clave que la faceta reconoce ===\n');

// `_medPrincipiosActivos` prefiere `principiosActivos` y parte `pactivos`; `_substanceKey`
// prefiere `vtm` y no parte nunca. En los listados coinciden, pero un registro enriquecido
// ofrecía una clave que la faceta no reconocía y el clic no filtraba nada.
const ENRIQUECIDO = {
    nregistro: 'E1', nombre: 'AUGMENTINE 875/125 mg',
    vtm: { nombre: 'amoxicilina + ácido clavulánico' },
    principiosActivos: [{ nombre: 'amoxicilina' }, { nombre: 'ácido clavulánico' }],
};
check('la faceta reconoce la clave canónica que ofrece el desplegable',
    app._medFacetKeys(ENRIQUECIDO).has(app._substanceKey(ENRIQUECIDO)),
    true);

check('y sigue reconociendo cada componente suelto, que es otro contrato',
    ['amoxicilina', 'ácido clavulánico'].every(p => app._medFacetKeys(ENRIQUECIDO).has(p)),
    true);

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
