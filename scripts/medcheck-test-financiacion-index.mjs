#!/usr/bin/env node
/**
 * MedCheck — test del índice de financiación en la LISTA de resultados
 *
 * La financiación llega ahora a la lista por un camino distinto del de la ficha: la ficha
 * consulta el Worker CN a CN y clasifica TEXTO de BIFIMED (`_classifyFinSit`); la lista lee
 * `financiacion-index.json` y clasifica CÓDIGOS de lista oficial. Dos caminos, un solo veredicto:
 * ambos desembocan en `_financingSummaryFromCounts`.
 *
 * Lo que fija este test, y por qué cada cosa:
 *   - los dos caminos coinciden. Es el riesgo central del diseño: si divergen, la tarjeta y la
 *     ficha del mismo medicamento dirían cosas distintas, que es exactamente lo que el índice
 *     existe para evitar;
 *   - la ausencia de dato NUNCA se lee como "no financiado". Hay 1.331 medicamentos visibles sin
 *     ficha en BIFIMED (medido 2026-09-08), 993 de ellos importaciones paralelas;
 *   - la faceta falla en CERRADO: sin índice utilizable, el predicado no filtra. Mostrar de menos
 *     sin avisar esconde resultados sin que nadie pueda notarlo;
 *   - el orden de las columnas del índice es contrato con el ETL. Reordenarlas no rompe nada
 *     visible, y por eso hay que fijarlo aquí.
 *
 * Uso: node scripts/medcheck-test-financiacion-index.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
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
const app = Object.create(MedCheckApp.prototype);

let failures = 0;
function check(name, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) {
        console.log(`✓ ${name}`);
    } else {
        failures += 1;
        console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
    }
}

// Fila del índice: [total comercializadas, si, si_det, no_incluido, excluido, no_fin_resol, estudio]
const fila = (...v) => v;
const estadoDesdeIndice = (f) => app._financingSummaryFromIndexRow(f)?.estado ?? null;
// El camino de la ficha: Map cn -> {found, sit} con los textos literales del Excel de BIFIMED.
const estadoDesdeFicha = (sits) => app._computeFinancingSummary(new Map(
    sits.map((s, i) => [String(i), s === null ? { found: false, sit: '' } : { found: true, sit: s }])
)).estado;

// --- El contrato con el ETL ---------------------------------------------------
console.log('— Orden de las columnas (contrato con scripts/etl-financiacion) —');
check('los seis códigos, en el orden del ETL',
    MedCheckApp.FIN_INDEX_CODES, ['1', '2', '5', '6', '7', '666']);
check('código 1 → financiado', MedCheckApp.FIN_CODE_TO_CLASS['1'], 'fin');
check('código 2 → condicionado', MedCheckApp.FIN_CODE_TO_CLASS['2'], 'cond');
check('códigos 5, 6 y 7 → no financiado (son los tres estados negativos)',
    [5, 6, 7].map(c => MedCheckApp.FIN_CODE_TO_CLASS[String(c)]), ['nofin', 'nofin', 'nofin']);
check('código 666 → en estudio o sin petición, NO "no financiado"',
    MedCheckApp.FIN_CODE_TO_CLASS['666'], 'estudio');

// --- Los dos caminos dan el mismo veredicto -----------------------------------
// Es la aserción que sostiene todo el diseño. Cada caso se expresa dos veces: como fila del
// índice (códigos) y como respuesta del Worker (textos del Excel, con su mojibake real).
console.log('\n— Índice y ficha coinciden —');
const pares = [
    ['todo financiado', fila(2, 2, 0, 0, 0, 0, 0), ['Si', 'Si']],
    ['todo condicionado', fila(1, 0, 1, 0, 0, 0, 0), ['Si para determinadas indicaciones/condiciones']],
    ['no financiado por resolución', fila(1, 0, 0, 0, 0, 1, 0), ['No financiado por resolución']],
    ['no incluido', fila(1, 0, 0, 1, 0, 0, 0), ['No incluido']],
    ['excluido', fila(1, 0, 0, 0, 1, 0, 0), ['Excluido']],
    ['en estudio o sin petición', fila(1, 0, 0, 0, 0, 0, 1), ['Estudio o sin petición financiación']],
    ['YASMIN: una negativa y una en estudio', fila(2, 0, 0, 0, 0, 1, 1),
        ['No financiado por resolución', 'Estudio o sin petición financiación']],
    ['financiación parcial', fila(3, 1, 0, 0, 0, 2, 0),
        ['Si', 'No financiado por resolución', 'No financiado por resolución']],
    ['financiado con una presentación sin dato', fila(2, 1, 0, 0, 0, 0, 0), ['Si', null]],
    ['ningún dato', fila(2, 0, 0, 0, 0, 0, 0), [null, null]],
];
for (const [nombre, f, sits] of pares) {
    check(`${nombre} — mismo veredicto por los dos caminos`,
        estadoDesdeIndice(f), estadoDesdeFicha(sits));
}

// --- La ausencia de dato no es una negativa -----------------------------------
console.log('\n— Lo que no se sabe no se convierte en "no financiado" —');
check('sin ningún CN en BIFIMED → sin datos', estadoDesdeIndice(fila(2, 0, 0, 0, 0, 0, 0)), 'sindato');
check('sin datos NO es "no financiado"', estadoDesdeIndice(fila(2, 0, 0, 0, 0, 0, 0)) === 'no', false);
check('sin presentaciones comercializadas → sin datos, no negativa',
    estadoDesdeIndice(fila(0, 0, 0, 0, 0, 0, 0)), 'sindato');
check('una financiada y una sin dato → NO asciende a "financiado" a secas',
    estadoDesdeIndice(fila(2, 1, 0, 0, 0, 0, 0)), 'parcial');

console.log('\n— La importación paralela explica su hueco en vez de callar —');
check('nregistro con sufijo IP se reconoce', app._esImportacionParalela('04276007IP1'), true);
check('IP sin dígito también', app._esImportacionParalela('113882002IP'), true);
check('un nregistro ordinario no', app._esImportacionParalela('63575'), false);
check('la heurística vieja por prefijo 24 ya no decide',
    app._esImportacionParalela('2490401'), false);
const tagIP = app._financingTagFromRow(fila(2, 0, 0, 0, 0, 0, 0), '04276007IP1');
check('su etiqueta dice que no está publicada, no que no esté financiada',
    tagIP.short, 'Financiación no publicada');
check('y el detalle lo explica', /no publica/.test(tagIP.title), true);
const tagSinEnvases = app._financingTagFromRow(fila(0, 0, 0, 0, 0, 0, 0), '63575');
check('sin envases comercializados tiene mensaje propio',
    tagSinEnvases.short, 'Sin envases comercializados');

// --- Filas que no se pueden interpretar ---------------------------------------
console.log('\n— Una fila ilegible no produce marca —');
check('fila ausente', app._financingSummaryFromIndexRow(undefined), null);
check('fila de longitud incorrecta', app._financingSummaryFromIndexRow([2, 1, 0]), null);
check('fila que no es array', app._financingSummaryFromIndexRow({ total: 2 }), null);
check('sin fila no hay etiqueta', app._financingTagFromRow(undefined, '63575'), null);

// --- El predicado de la faceta ------------------------------------------------
console.log('\n— La faceta agrupa cobertura, y falla en cerrado —');
check('financiación ordinaria cuenta como cobertura',
    app._financingRowHasCoverage(fila(1, 1, 0, 0, 0, 0, 0)), true);
check('la condicionada TAMBIÉN cuenta (es lo que agrupa la casilla)',
    app._financingRowHasCoverage(fila(1, 0, 1, 0, 0, 0, 0)), true);
check('una sola presentación cubierta basta',
    app._financingRowHasCoverage(fila(3, 1, 0, 0, 0, 2, 0)), true);
check('sin cobertura', app._financingRowHasCoverage(fila(2, 0, 0, 0, 0, 1, 1)), false);
check('sin dato NO cuenta como cobertura',
    app._financingRowHasCoverage(fila(2, 0, 0, 0, 0, 0, 0)), false);
check('fila ausente no cuenta como cobertura', app._financingRowHasCoverage(undefined), false);

const snapOn = { financiado: true };
app._financingIndex = { 63575: fila(2, 0, 0, 0, 0, 1, 1), 8472008: fila(1, 1, 0, 0, 0, 0, 0) };
app._financingIndexUsable = false;
check('índice NO utilizable → el predicado no filtra (fail-open en la lista)',
    app._filterPredicate('financiacion', snapOn), null);
app._financingIndexUsable = true;
check('casilla apagada → no filtra',
    app._filterPredicate('financiacion', { financiado: false }), null);
const pred = app._filterPredicate('financiacion', snapOn);
check('casilla encendida e índice bueno → sí filtra', typeof pred, 'function');
check('deja pasar al financiado', pred({ nregistro: '8472008' }), true);
check('excluye al que no tiene cobertura', pred({ nregistro: '63575' }), false);
check('excluye al que no está en el índice (ausencia ≠ financiado)',
    pred({ nregistro: '99999999' }), false);

// --- La dimensión está en el contrato -----------------------------------------
console.log('\n— La dimensión pertenece al contrato de filtros —');
check('financiacion es una dimensión declarada',
    MedCheckApp.FILTER_DIMENSIONS.includes('financiacion'), true);
check('"Limpiar N" la cuenta', app._activeFilterCount({
    generic: false, biosimilar: false, receta: false, form: null, lab: null,
    doses: new Set(), paralelas: false, financiado: true, galenics: new Set(),
    routes: new Set(), pas: new Set(),
}), 1);
check('el estado vacío la apaga', app._emptyFilterState().financiadoOnly, false);
check('el snapshot la lee de financiadoOnly',
    app._filterSnapshot.call({ filterState: { financiadoOnly: true }, groupingState: {} }).financiado, true);
check('y por defecto está apagada',
    app._filterSnapshot.call({ filterState: {}, groupingState: {} }).financiado, false);

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
