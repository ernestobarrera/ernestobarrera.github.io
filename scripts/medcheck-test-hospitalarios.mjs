#!/usr/bin/env node
/**
 * MedCheck — test del filtro de ámbito hospitalario (H y DH)
 *
 * Es el primer filtro de MedCheck que OCULTA por defecto de nadie y que además RECUERDA la
 * elección entre búsquedas. Las dos cosas son peligrosas por el mismo motivo: lo que no se ve no
 * se echa de menos. Un médico que no encuentra un fármaco no piensa «lo tendré filtrado», piensa
 * «no está». Por eso aquí no basta con que el filtro funcione; tiene que ser imposible que oculte
 * en silencio.
 *
 * Lo que fija este test:
 *   - H y DH son dimensiones SEPARADAS y no se funden en «hospitalarios». El Nomenclátor publica
 *     dos indicadores distintos: uso hospitalario NO se dispensa en oficina de farmacia,
 *     diagnóstico hospitalario SÍ, solo que la prescripción se inicia en el hospital;
 *   - el estado por defecto MUESTRA todo, incluido un `filterState` a medio inicializar;
 *   - la memoria solo existe si el usuario eligió: sin preferencia escrita, se muestra todo;
 *   - «Limpiar N» cuenta las exclusiones y las deshace de verdad, también en la memoria;
 *   - la clasificación es la MISMA que la de la insignia de la tarjeta (`_utilCanal`), para que no
 *     pueda haber un medicamento con insignia H que el filtro no reconozca como H.
 *
 * Uso: node scripts/medcheck-test-hospitalarios.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// localStorage simulado: la memoria es media funcionalidad, así que se ejercita de verdad.
const store = new Map();
const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
    `${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__App = MedCheckApp;`,
    sandbox, { filename: 'cima-app.js' }
);
const MedCheckApp = sandbox.window.__App;
if (typeof MedCheckApp !== 'function') { console.error('No se pudo cargar MedCheckApp'); process.exit(1); }

const app = Object.create(MedCheckApp.prototype);

let failures = 0;
function check(name, got, expected) {
    if (JSON.stringify(got) === JSON.stringify(expected)) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`); }
}

// Textos de `cpresc` tal como los devuelve CIMA.
const UH = 'Medicamento Sujeto A Prescripción Médica - Uso Hospitalario';
const DH = 'Medicamento Sujeto A Prescripción Médica - Diagnóstico Hospitalario';
const NORMAL = 'Medicamento Sujeto A Prescripción Médica';

const universo = [
    { nregistro: '1', cpresc: UH },
    { nregistro: '2', cpresc: UH },
    { nregistro: '3', cpresc: DH },
    { nregistro: '4', cpresc: NORMAL },
    { nregistro: '5', cpresc: null },
];
const snapDe = (filterState) => app._filterSnapshot.call({ filterState, groupingState: {} });
const visibles = (filterState) => app._applyResultFilters(universo, snapDe(filterState),
    { only: 'hospital' }).map(m => m.nregistro);

// --- Clasificación: una sola fuente ------------------------------------------
console.log('— H y DH se clasifican con la MISMA función que pinta la insignia —');
check('uso hospitalario', app._utilCanal(UH), 'H');
check('diagnóstico hospitalario', app._utilCanal(DH), 'DH');
check('con acento o sin él', app._utilCanal('Diagnostico Hospitalario'), 'DH');
check('un medicamento ordinario no es ninguno', app._utilCanal(NORMAL), null);
check('sin cpresc tampoco', app._utilCanal(null), null);
// Si esto se rompe, la tarjeta enseñaría una insignia H que el filtro no reconoce.
const fuente = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
check('la insignia deriva de _utilCanal y no reimplementa la detección',
    /const canalHosp = this\._utilCanal\(med\.cpresc\)/.test(fuente), true);

// --- Por defecto se muestra TODO ---------------------------------------------
console.log('\n— Por defecto no se oculta nada —');
check('estado limpio: se ven los cinco', visibles(app._emptyFilterState()), ['1', '2', '3', '4', '5']);
check('estado vacío declara mostrar H', app._emptyFilterState().mostrarH, true);
check('y mostrar DH', app._emptyFilterState().mostrarDH, true);
// El caso feo: un filterState a medio inicializar no puede esconder nada.
check('un filterState incompleto MUESTRA, no oculta', visibles({}), ['1', '2', '3', '4', '5']);
check('el snapshot lo resuelve con !== false, no con === true',
    [snapDe({}).mostrarH, snapDe({}).mostrarDH], [true, true]);
check('sin exclusión, el predicado no filtra',
    app._filterPredicate('hospital', snapDe(app._emptyFilterState())), null);

// --- Excluir, y solo lo que se pide -------------------------------------------
console.log('\n— H y DH son dimensiones separadas —');
check('ocultar H deja fuera SOLO los de uso hospitalario',
    visibles({ mostrarH: false, mostrarDH: true }), ['3', '4', '5']);
check('ocultar DH deja fuera SOLO los de diagnóstico hospitalario',
    visibles({ mostrarH: true, mostrarDH: false }), ['1', '2', '4', '5']);
check('ocultar ambos conserva los no hospitalarios',
    visibles({ mostrarH: false, mostrarDH: false }), ['4', '5']);
check('ocultar H nunca se lleva por delante un DH',
    visibles({ mostrarH: false, mostrarDH: true }).includes('3'), true);

// --- "Limpiar N" cuenta lo que limpia ----------------------------------------
console.log('\n— «Limpiar N» cuenta exactamente lo que deshace —');
check('sin exclusiones no cuenta nada',
    app._activeFilterCount(snapDe(app._emptyFilterState())), 0);
check('una exclusión cuenta 1',
    app._activeFilterCount(snapDe({ ...app._emptyFilterState(), mostrarH: false })), 1);
check('dos exclusiones cuentan 2',
    app._activeFilterCount(snapDe({ ...app._emptyFilterState(), mostrarH: false, mostrarDH: false })), 2);

// --- La memoria: solo si el usuario eligió ------------------------------------
console.log('\n— La memoria nace de una elección, nunca de la inercia —');
store.clear();
check('sin nada guardado, no hay preferencia', app._hospPrefRead(), null);
app.filterState = app._emptyFilterState();
app._hospPrefApply();
check('y aplicarla no cambia nada', [app.filterState.mostrarH, app.filterState.mostrarDH], [true, true]);

app.filterState.mostrarH = false;
app._hospPrefWrite();
app.filterState = app._emptyFilterState();   // simula la búsqueda siguiente
app._hospPrefApply();
check('una elección explícita sobrevive a la búsqueda siguiente',
    [app.filterState.mostrarH, app.filterState.mostrarDH], [false, true]);

// Limpiar tiene que deshacerla DE VERDAD: si no, volvería sola y el botón habría mentido.
app._clearAllResultFilters();
check('«Limpiar» devuelve el estado a mostrar todo',
    [app.filterState.mostrarH, app.filterState.mostrarDH], [true, true]);
app.filterState = app._emptyFilterState();
app._hospPrefApply();
check('y la exclusión NO resucita en la búsqueda siguiente',
    [app.filterState.mostrarH, app.filterState.mostrarDH], [true, true]);

// Una preferencia corrupta o a medias no puede acabar ocultando resultados.
store.set('medcheck:hosp-pref', '{"mostrarH":');
check('preferencia ilegible → ninguna preferencia', app._hospPrefRead(), null);
store.set('medcheck:hosp-pref', '{"mostrarH":false}');
check('preferencia incompleta → ninguna preferencia', app._hospPrefRead(), null);
store.set('medcheck:hosp-pref', '{"mostrarH":"no","mostrarDH":false}');
check('preferencia con tipos raros → ninguna preferencia', app._hospPrefRead(), null);
app.filterState = app._emptyFilterState();
app._hospPrefApply();
check('y con cualquiera de ellas se sigue mostrando todo',
    [app.filterState.mostrarH, app.filterState.mostrarDH], [true, true]);

// --- La dimensión pertenece al contrato --------------------------------------
console.log('\n— La dimensión está en el contrato de filtros —');
check('hospital es una dimensión declarada',
    MedCheckApp.FILTER_DIMENSIONS.includes('hospital'), true);
check('el aviso de lo oculto se pinta en la barra',
    /filtro-oculto-aviso/.test(fuente), true);
check('el aviso desglosa H y DH por separado',
    /de uso hospitalario.*de diagn|de diagn[\s\S]{0,80}hospitalario/.test(fuente), true);
check('y ofrece deshacerlo en un clic',
    /mostrar-hosp-todos/.test(fuente), true);

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
