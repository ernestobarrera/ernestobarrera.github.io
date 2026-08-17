#!/usr/bin/env node
/**
 * MedCheck — test del contador y desglose de ClinicalTrials.gov (`_loadCtgovCount`)
 *
 * Carga la clase REAL de assets/js/cima-app.js en `vm` con un DOM mínimo y una API simulada:
 * NO toca la red. Lo que se fija aquí es el contrato de honestidad del panel, que es donde este
 * proyecto se ha hecho daño antes (sesión 40: insignias que el dato no sostenía).
 *
 * Lo que exige:
 *   1. El registro no responde → insignia estática, NUNCA un cero. Un cero no medido es mentira.
 *   2. Cero real medido → se pinta 0, y con la clase de "cero" para que no parezca un fallo.
 *   3. Desglose omitido por volumen → se DICE por qué; no se enseña un desglose parcial junto a
 *      un total exacto.
 *   4. Las fases no suman el total (solo los intervencionales declaran fase) → el aviso viaja en
 *      cada chip de fase, no se deja que el usuario deduzca que faltan estudios.
 *   5. Un valor que el registro añada mañana y no esté traducido se muestra igual, legible.
 *      Silenciarlo sería perder un dato real.
 *   6. La cola larga de estados se agrupa SIN ocultar: el chip "otros" suma lo que agrupa.
 *   7. Carreras: una respuesta que llega tarde, de una consulta ya sustituida, no repinta.
 *
 * Uso: node scripts/medcheck-test-ctgov.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// DOM mínimo: solo los dos nodos que toca _loadCtgovCount.
const nodos = new Map();
const nodo = () => ({ innerHTML: '' });
const sandbox = {
    window: {},
    document: {
        addEventListener() {},
        getElementById: (id) => nodos.get(id) || null,
        querySelectorAll: () => [],
    },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
    CimaAPI: { ATC_CATEGORIES: [] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
    `${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__App = MedCheckApp;`,
    sandbox, { filename: 'cima-app.js' }
);
const MedCheckApp = sandbox.window.__App;
if (typeof MedCheckApp !== 'function') { console.error('No se pudo cargar MedCheckApp'); process.exit(1); }

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// App mínima: solo lo que _loadCtgovCount usa de `this`.
function nuevaApp(respuesta) {
    const app = Object.create(MedCheckApp.prototype);
    app.api = { searchCtgovStudies: async () => respuesta };
    nodos.set('evcount-ct', nodo());
    nodos.set('evidence-ctgov-stats', nodo());
    return app;
}
const cuenta = () => nodos.get('evcount-ct').innerHTML;
const stats = () => nodos.get('evidence-ctgov-stats').innerHTML;

const desgloseBase = {
    analizados: 16,
    tipo: [{ clave: 'INTERVENTIONAL', n: 13 }, { clave: 'OBSERVATIONAL', n: 3 }],
    fase: [{ clave: 'PHASE4', n: 7 }, { clave: 'NA', n: 3 }],
    estado: [{ clave: 'COMPLETED', n: 8 }, { clave: 'UNKNOWN', n: 3 },
             { clave: 'RECRUITING', n: 2 }, { clave: 'TERMINATED', n: 2 }],
    nota_fase: 'un estudio puede declarar varias fases (p. ej. PHASE2/PHASE3): las fases no suman el total',
};

// 1 · el registro no responde → insignia estática, jamás un cero
let app = nuevaApp(null);
await app._loadCtgovCount('lercanidipine');
check('1 · sin respuesta → insignia estática, no un cero',
    /EEUU · FDA\/NIH/.test(cuenta()) && !/>0</.test(cuenta()), cuenta());

// 1b · respuesta con error del Worker (count null) → igual
app = nuevaApp({ ok: false, error: 'ctgov_upstream_error', count: null, desglose: null });
await app._loadCtgovCount('lercanidipine');
check('1b · error del registro → insignia estática, no un cero',
    /EEUU · FDA\/NIH/.test(cuenta()), cuenta());

// 2 · cero REAL medido → se pinta, con la clase de cero
app = nuevaApp({ ok: true, count: 0, desglose: { analizados: 0, tipo: [], fase: [], estado: [] } });
await app._loadCtgovCount('zzzqqq');
check('2 · cero medido → se pinta 0 y se marca como cero',
    /evidence-count-badge--zero/.test(cuenta()) && />0</.test(cuenta()), cuenta());

// 3 · desglose omitido por volumen → lo dice, no lo silencia ni lo aproxima
app = nuevaApp({ ok: true, count: 12345, desglose: null, desgloseOmitido: 'más de 5000 estudios: el total es exacto, el desglose no se calcula sobre una muestra' });
await app._loadCtgovCount('aspirin');
check('3 · total exacto aunque no haya desglose', /12\.345|12,345/.test(cuenta()), cuenta());
check('3b · dice por qué falta el desglose', /Desglose no disponible/.test(stats()), stats());
check('3c · y el motivo viaja en el tooltip', /el desglose no se calcula sobre una muestra/.test(stats()));

// 4 · las fases no suman el total: el aviso va en cada chip de fase
app = nuevaApp({ ok: true, count: 16, desglose: desgloseBase });
await app._loadCtgovCount('lercanidipine');
const nChipsFase = (stats().match(/fa-layer-group/g) || []).length;
check('4 · un chip por fase declarada', nChipsFase === 2, `${nChipsFase} chips`);
check('4b · cada chip de fase avisa de que no suman',
    (stats().match(/las fases no suman el total/g) || []).length === nChipsFase);

// 4c · traducciones: las etiquetas del registro llegan en inglés y se leen en español
check('4c · traduce los valores del registro',
    /Intervencionales/.test(stats()) && /Fase 4/.test(stats()) && /Completados/.test(stats()), stats());

// 5 · valor nuevo del registro, sin traducir → se muestra legible, no se descarta
app = nuevaApp({ ok: true, count: 5, desglose: { ...desgloseBase,
    tipo: [{ clave: 'NUEVO_TIPO_FUTURO', n: 5 }], fase: [], estado: [] } });
await app._loadCtgovCount('farmaco');
check('5 · un valor no traducido se muestra igual, legible',
    /Nuevo tipo futuro/.test(stats()), stats());

// 6 · cola larga de estados: se agrupa sin ocultar, y el grupo suma lo que agrupa
app = nuevaApp({ ok: true, count: 30, desglose: { ...desgloseBase, estado: [
    { clave: 'COMPLETED', n: 10 }, { clave: 'RECRUITING', n: 8 }, { clave: 'UNKNOWN', n: 5 },
    { clave: 'TERMINATED', n: 4 }, { clave: 'WITHDRAWN', n: 2 }, { clave: 'SUSPENDED', n: 1 },
] } });
await app._loadCtgovCount('farmaco');
check('6 · agrupa la cola larga', /Otros 2 estados/.test(stats()), stats());
check('6b · el grupo suma exactamente lo agrupado (2+1=3)', /Otros 2 estados: <strong>3<\/strong>/.test(stats()), stats());
check('6c · y detalla en el tooltip qué agrupó',
    /Retirados: 2/.test(stats()) && /Suspendidos: 1/.test(stats()), stats());

// 7 · carrera: una respuesta tardía de una consulta ya sustituida no repinta
app = nuevaApp(null);
let resolver;
app.api = { searchCtgovStudies: () => new Promise(r => { resolver = r; }) };
const lenta = app._loadCtgovCount('vieja');
app._ctgovCountCycle = 99;                    // otra consulta tomó el relevo
resolver({ ok: true, count: 777, desglose: desgloseBase });
await lenta;
check('7 · la respuesta tardía de una consulta sustituida no repinta',
    !/777/.test(cuenta()), cuenta());

console.log('');
if (failures) {
    console.log(`${failures} fallo(s) — el contador de ClinicalTrials.gov no cumple su contrato.`);
    process.exitCode = 1;
} else {
    console.log('Contrato del contador de ClinicalTrials.gov en verde: nunca inventa un cero,');
    console.log('dice cuándo falta el desglose y no oculta lo que agrupa.');
}
