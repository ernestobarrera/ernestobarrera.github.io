#!/usr/bin/env node
/**
 * MedCheck — test de regresión del matcher clínico (findClinicalDictionaryMatches)
 *
 * Carga la clase REAL de assets/js/cima-api.js en Node (vm + shim de window) con la
 * ontología real del repo, y verifica la doctrina de ranking del buscador:
 *
 *   100  término exacto            → ejecuta
 *    80  prefijo de palabra del término → ejecuta
 *    70  sinónimo curado           → ejecuta
 *    60  subcadena interior        → SOLO sugerencia (autocomplete); jamás en búsqueda real
 *
 * Caso emblemático: "presión" ejecutaba depresión (subcadena, 80) por delante de
 * hipertensión y glaucoma (sinónimos curados, 70).
 *
 * Uso: node scripts/medcheck-test-matcher.mjs
 * Salida: exit 0 si toda la matriz pasa; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Cargar la clase real con un window/fetch mínimos (la precarga de ontología falla
// --- en abierto por diseño; aquí la inyectamos directamente desde el JSON del repo).
const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Map, Set, RegExp,
    AbortController: class { constructor() { this.signal = null; } abort() {} },
    navigator: {},
};
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
vm.runInContext(src + '\n;window.__CimaAPIClass = CimaAPI;', sandbox, { filename: 'cima-api.js' });

const CimaAPI = sandbox.window.__CimaAPIClass;
const api = sandbox.window.cimaAPI;
const terms = JSON.parse(readFileSync(join(ROOT, 'assets/data/clinical-ontology.json'), 'utf8')).terms;
CimaAPI.CLINICAL_DICTIONARY = terms;
api._clinicalOntologyLoaded = true;

// Misma normalización que aplica searchByIndication antes de llamar al matcher.
const norm = (q) => q.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
const real = (q) => api.findClinicalDictionaryMatches(norm(q));
const sug = (q) => api.findClinicalDictionaryMatches(norm(q), { suggest: true });

let failures = 0;
function check(name, cond, detail) {
    if (cond) {
        console.log(`✓ ${name}`);
    } else {
        failures += 1;
        console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}
const top = (ms) => (ms[0] ? `${ms[0].term}=${ms[0].score}` : '(vacío)');
const has = (ms, t) => ms.some((m) => m.term === t);

// --- Matriz de casos (búsqueda real: lo que ejecuta searchByIndication con matches[0]) ---
let r = real('depresión');
check('real "depresión" → depresión (100)', r[0]?.term === 'depresión' && r[0]?.score === 100, top(r));

r = real('depre');
check('real "depre" → depresión (prefijo de palabra, 80)', r[0]?.term === 'depresión' && r[0]?.score === 80, top(r));

r = real('presión');
check('real "presión" NO contiene depresión', !has(r, 'depresión'), JSON.stringify(r.map((m) => m.term)));
check('real "presión" ofrece hipertensión y glaucoma (70)',
    has(r, 'hipertensión') && has(r, 'glaucoma') && r.every((m) => m.score === 70),
    JSON.stringify(r.map((m) => `${m.term}=${m.score}`)));

r = real('presión alta');
check('real "presión alta" → hipertensión', r[0]?.term === 'hipertensión', top(r));

r = real('presión intraocular');
check('real "presión intraocular" → glaucoma', r[0]?.term === 'glaucoma', top(r));

r = real('micosis');
check('real "micosis" → candidiasis (sinónimo curado), no onicomicosis',
    r[0]?.term === 'candidiasis' && !has(r, 'onicomicosis'), JSON.stringify(r.map((m) => `${m.term}=${m.score}`)));

// --- Autocomplete: la subcadena interior sobrevive como sugerencia degradada ---
let s = sug('presión');
{
    const dep = s.find((m) => m.term === 'depresión');
    const first70 = s.findIndex((m) => m.score === 70);
    const depIdx = s.findIndex((m) => m.term === 'depresión');
    check('suggest "presión" mantiene depresión como sugerencia (60), tras los sinónimos (70)',
        dep?.score === 60 && first70 !== -1 && depIdx > first70,
        JSON.stringify(s.map((m) => `${m.term}=${m.score}`)));
}
s = sug('micosis');
check('suggest "micosis": candidiasis (70) por delante de onicomicosis (60)',
    s.findIndex((m) => m.term === 'candidiasis') < s.findIndex((m) => m.term === 'onicomicosis') &&
    s.find((m) => m.term === 'onicomicosis')?.score === 60,
    JSON.stringify(s.map((m) => `${m.term}=${m.score}`)));

// --- Invariantes estructurales sobre TODA la ontología ---
// 1. Cada término se encuentra a sí mismo como top con 100.
let selfTopFails = 0;
for (const t of Object.keys(terms)) {
    const m = real(t);
    if (m[0]?.term !== t || m[0]?.score !== 100) selfTopFails += 1;
}
check(`invariante: cada término se resuelve a sí mismo (${Object.keys(terms).length} términos)`, selfTopFails === 0,
    `${selfTopFails} fallos`);

// 2. Barrido de subcadenas interiores: en búsqueda real nunca aparece score < 70
//    (la rama de subcadena es la única fuente de 60; si aparece, ejecutaría en silencio).
let sweepQueries = 0;
let sweepFails = [];
for (const t of Object.keys(terms)) {
    const nt = norm(t).replace(/-/g, ' ');
    for (let start = 1; start + 4 <= nt.length; start += 1) {
        for (const len of [4, 6, 8]) {
            if (start + len > nt.length) continue;
            const q = nt.slice(start, start + len).trim();
            if (q.length < 4) continue;
            sweepQueries += 1;
            const m = real(q);
            if (m.some((x) => x.score < 70)) sweepFails.push(`${q}→${top(m)}`);
        }
    }
}
check(`invariante: ninguna subcadena interior ejecuta en búsqueda real (${sweepQueries} queries)`,
    sweepFails.length === 0, sweepFails.slice(0, 5).join('; '));

// --- Resumen ---
if (failures > 0) {
    console.log(`\n${failures} caso(s) en rojo.`);
    process.exit(1);
}
console.log('\nMatriz completa en verde.');
