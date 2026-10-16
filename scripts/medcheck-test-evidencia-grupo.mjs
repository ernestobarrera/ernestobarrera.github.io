#!/usr/bin/env node
/**
 * MedCheck — test del término PubMed de GRUPO (ATC4) de la pestaña Evidencia.
 *
 * Carga la clase REAL de assets/js/cima-app.js y el diccionario INN REAL (inn-dict.js +
 * inn-es-en.json) en Node, y ejercita `_evidenceGroupTerm`, que es puro.
 *
 * Doctrina que fija este test:
 *   - el grupo es la OR de los principios monocomponente, cada uno con las MISMAS variantes que
 *     usa el modo principio activo (`_substanceIdentity`): un fármaco no se escribe de dos maneras;
 *   - el principio del medicamento abierto va primero; el resto, en orden alfabético;
 *   - un principio repetido en varios medicamentos entra una vez;
 *   - las asociaciones no aportan término propio, y un grupo hecho solo de asociaciones no da OR;
 *   - un grupo de un solo principio no se ofrece como grupo: la búsqueda sería la misma;
 *   - por encima del máximo no se construye término (la consulta deja de ser manejable);
 *   - lo que pasa sin traducción comprobada se declara, no se calla;
 *   - NO aparece ningún término MeSH: la equivalencia ATC→MeSH no existe como fuente.
 *
 * El fixture reproduce la forma de los listados de CIMA (traen `vtm`, no `pactivos`). Los
 * nombres son los de G04BD; se fijan como fixture y no se consultan en vivo.
 *
 * Uso: node scripts/medcheck-test-evidencia-grupo.mjs
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
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });

const MedCheckApp = sandbox.window.__MedCheckAppClass;
const dict = sandbox.window.innDict;
if (typeof MedCheckApp !== 'function' || !dict) {
    console.error('No se pudo cargar MedCheckApp o innDict');
    process.exit(1);
}
// Mismo camino que `load()`, sin red: claves normalizadas, solo valores de texto.
const data = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8'));
for (const [k, v] of Object.entries(data.map || {})) if (typeof v === 'string') dict.map[dict.norm(k)] = v;
dict.loaded = true;

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

const app = Object.create(MedCheckApp.prototype);
const med = (vtm, i = 0) => ({ nregistro: `${vtm}-${i}`, nombre: `${vtm.toUpperCase()} ${i} mg`, vtm: { nombre: vtm } });

// ─── G04BD con repetidos y una asociación ─────────────────────────────────────
const g04bd = [
    med('oxibutinina'), med('oxibutinina', 1),
    med('tolterodina'), med('solifenacina'), med('solifenacina', 1),
    med('fesoterodina'), med('mirabegron'), med('propiverina'),
    med('solifenacina + tamsulosina'),
];
const g = app._evidenceGroupTerm(g04bd, ['mirabegron']);
check('estado ok', g.estado, 'ok');
check('principio abierto primero, resto alfabético, sin repetidos', g.principios,
    ['mirabegron', 'fesoterodina', 'oxibutinina', 'propiverina', 'solifenacina', 'tolterodina']);
check('asociación contada y fuera del OR', g.asociaciones, 1);
check('término = OR de las variantes de _substanceIdentity, en orden', g.term,
    ['mirabegron', 'fesoterodina', 'oxibutinina', 'propiverina', 'solifenacina', 'tolterodina']
        .flatMap(p => app._substanceIdentity(med(p)).components[0].variants).join(' OR '));
check('incluye la forma inglesa (PubMed indexa en inglés)', /\boxybutynin\b/.test(g.term) && /\bsolifenacin\b/.test(g.term), true);
check('sin comillas (rompen el ATM)', g.term.includes('"'), false);
check('sin MeSH ni etiquetas de campo', /\[(pa|mh|mesh|tiab)\]/i.test(g.term), false);
check('la asociación no cuela tamsulosina', /tamsulosin/.test(g.term), false);
// `trospio` no está en el diccionario (16/10/2026): pasa tal cual y la nota tiene que decirlo.
const conHueco = app._evidenceGroupTerm([med('trospio'), med('oxibutinina')], []);
check('se declara lo que pasa sin traducción comprobada', conHueco.sinVerificar, ['trospio']);
check('lo curado (diccionario o regla) no se declara', g.sinVerificar, []);

// ─── Casos sin término de grupo ───────────────────────────────────────────────
check('vacío', app._evidenceGroupTerm([], []).estado, 'vacio');
check('solo asociaciones', app._evidenceGroupTerm([med('enalapril + hidroclorotiazida'), med('lisinopril + hidroclorotiazida')], []).estado, 'asociaciones');
check('un único principio (varios medicamentos)', app._evidenceGroupTerm([med('paracetamol'), med('paracetamol', 1), med('paracetamol + codeina')], ['paracetamol']).estado, 'unico');
const muchos = Array.from({ length: 16 }, (_, i) => med(`farmaco${String.fromCharCode(97 + i)}`));
const amplio = app._evidenceGroupTerm(muchos, []);
check('por encima del máximo', amplio.estado, 'amplio');
check('por encima del máximo no se construye término', amplio.term, '');
check('en el máximo sí', app._evidenceGroupTerm(muchos.slice(0, 15), []).estado, 'ok');

// ─── La nota dice el perímetro ────────────────────────────────────────────────
app._escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nota = app._evidenceGroupNoteHtml(g, { codigo: 'G04BD', nombre: 'ANTIESPASMÓDICOS URINARIOS' });
check('la nota nombra el perímetro (comercializados en España)', nota.includes('comercializados en España'), true);
check('la nota dice que REec y ClinicalTrials siguen con el principio', nota.includes('REec y ClinicalTrials.gov siguen con el principio activo'), true);
check('la nota de un grupo inviable da el motivo', app._evidenceGroupNoteHtml(amplio, { codigo: 'L01XX', nombre: '' }).includes('máximo 15'), true);

if (failures) {
    console.log(`\n${failures} fallo(s)`);
    process.exit(1);
}
console.log('\nTodo en orden');
