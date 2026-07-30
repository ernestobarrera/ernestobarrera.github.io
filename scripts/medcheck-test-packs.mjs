#!/usr/bin/env node
/**
 * MedCheck — test del resumen de envases (_summarizePackFormats + _getPresentationFormat)
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm + shims mínimos) y ejercita
 * el formateador de la línea "Presentaciones" del modal. Ambos métodos son puros (no
 * tocan DOM), así que se invocan sobre un `this` desnudo del prototipo.
 *
 * Doctrina que fija este test:
 *   - solo se resumen envases COMERCIALIZADOS (anunciar los retirados induciría a error);
 *   - el acondicionamiento final entre paréntesis se recorta en el resumen, nunca en el
 *     detalle desplegado (el texto oficial se conserva íntegro, erratas de origen incluidas);
 *   - se colapsa la unidad solo si es la misma ("28 y 56 comprimidos"); nunca con unidades
 *     heterogéneas;
 *   - a partir de 3 formatos se muestran 2 y se cuenta el resto.
 *
 * Uso: node scripts/medcheck-test-packs.mjs
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
// `this` desnudo: los dos métodos bajo prueba son puros.
const app = Object.create(MedCheckApp.prototype);
const summarize = (medName, presentations) => app._summarizePackFormats(medName, presentations);

// Atajo: p('30 comprimidos') genera la presentación tal como la devuelve CIMA
// (nombre del medicamento + coma + envase), comercializada salvo que se diga.
const MED = 'DIAZEPAM PENSA 2,5 MG COMPRIMIDOS';
const p = (envase, comerc = true, medName = MED) => ({
    cn: '000000', comerc, nombre: `${medName}, ${envase}`,
});

let failures = 0;
function check(name, got, expected) {
    if (got === expected) {
        console.log(`✓ ${name}`);
    } else {
        failures += 1;
        console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
    }
}

// --- Casos base: 1, 2, 3 y 4+ formatos ---------------------------------------
check('1 formato',
    summarize(MED, [p('40 comprimidos')]),
    '40 comprimidos');

check('2 formatos con la misma unidad se colapsan',
    summarize(MED, [p('28 comprimidos'), p('56 comprimidos')]),
    '28 y 56 comprimidos');

check('3 formatos: 2 visibles + contador en singular',
    summarize(MED, [p('14 comprimidos'), p('28 comprimidos'), p('56 comprimidos')]),
    '14 y 28 comprimidos · +1 formato');

check('4 formatos: contador en plural',
    summarize(MED, [p('14 comprimidos'), p('28 comprimidos'), p('56 comprimidos'), p('100 comprimidos')]),
    '14 y 28 comprimidos · +2 formatos');

// --- No comercializados -------------------------------------------------------
check('las no comercializadas se excluyen del resumen',
    summarize(MED, [p('25 comprimidos', false), p('30 comprimidos', true)]),
    '30 comprimidos');

check('sin ninguna comercializada, no se anuncia formato',
    summarize(MED, [p('25 comprimidos', false), p('30 comprimidos', false)]),
    '');

check('array vacío',
    summarize(MED, []),
    '');

check('presentaciones nulas o sin nombre no rompen',
    summarize(MED, [null, { comerc: true }, p('30 comprimidos')]),
    '30 comprimidos');

// --- Acondicionamiento entre paréntesis ---------------------------------------
check('el acondicionamiento final se recorta en el resumen',
    summarize('ESOMEPRAZOL CINFA 20 MG CAPSULAS DURAS GASTRORRESISTENTES EFG', [
        p('28 cápsulas (Blister)', true, 'ESOMEPRAZOL CINFA 20 MG CAPSULAS DURAS GASTRORRESISTENTES EFG'),
        p('56 cápsulas (Blister)', true, 'ESOMEPRAZOL CINFA 20 MG CAPSULAS DURAS GASTRORRESISTENTES EFG'),
    ]),
    '28 y 56 cápsulas');

check('acondicionamiento largo con barras',
    summarize('ESOMEPRAZOL NORMOGEN 20 MG COMPRIMIDOS GASTRORRESISTENTES EFG', [
        p('28 comprimidos (Blister OPA/Al/PE-Al/PE)', true, 'ESOMEPRAZOL NORMOGEN 20 MG COMPRIMIDOS GASTRORRESISTENTES EFG'),
    ]),
    '28 comprimidos');

check('la errata de origen "(Blster)" se recorta igual que el resto',
    summarize('ESOMEPRAZOL NORMON 40 MG CAPSULAS DURAS GASTRORRESISTENTES EFG', [
        p('28 cápsulas (Blister)', true, 'ESOMEPRAZOL NORMON 40 MG CAPSULAS DURAS GASTRORRESISTENTES EFG'),
        p('56 cápsulas (Blster)', true, 'ESOMEPRAZOL NORMON 40 MG CAPSULAS DURAS GASTRORRESISTENTES EFG'),
    ]),
    '28 y 56 cápsulas');

// --- Deduplicación -------------------------------------------------------------
check('dos CN con el mismo envase cuentan como un formato',
    summarize(MED, [p('30 comprimidos'), p('30 comprimidos')]),
    '30 comprimidos');

check('deduplica también tras recortar el acondicionamiento',
    summarize('OMEPRAZOL X 20 MG', [
        p('28 cápsulas (Blister)', true, 'OMEPRAZOL X 20 MG'),
        p('28 cápsulas (Frasco)', true, 'OMEPRAZOL X 20 MG'),
    ]),
    '28 cápsulas');

// --- Unidades heterogéneas ------------------------------------------------------
check('unidades distintas NO se colapsan',
    summarize('IBUPROFENO X 40 MG/ML SUSPENSION', [
        p('30 comprimidos', true, 'IBUPROFENO X 40 MG/ML SUSPENSION'),
        p('1 frasco de 100 ml', true, 'IBUPROFENO X 40 MG/ML SUSPENSION'),
    ]),
    '30 comprimidos y 1 frasco de 100 ml');

check('formato que no empieza por número no se colapsa',
    summarize(MED, [p('envase clínico'), p('30 comprimidos')]),
    'envase clínico y 30 comprimidos');

check('caso real con "de": ampollas',
    summarize('DIAZEPAM BASI 5 MG/ML SOLUCIÓN INYECTABLE EFG', [
        p('50 ampollas de 2 ml', true, 'DIAZEPAM BASI 5 MG/ML SOLUCIÓN INYECTABLE EFG'),
        p('100 ampollas de 2 ml', true, 'DIAZEPAM BASI 5 MG/ML SOLUCIÓN INYECTABLE EFG'),
    ]),
    '50 y 100 ampollas de 2 ml');

check('decimales en la cantidad',
    summarize('X CREMA', [
        p('1 tubo de 30 g', true, 'X CREMA'),
        p('2 tubos de 30 g', true, 'X CREMA'),
    ]),
    '1 tubo de 30 g y 2 tubos de 30 g');

// --- Separadores reales de CIMA --------------------------------------------------
check('CIMA sin coma antes del envase (caso Aurovitas Spain)',
    summarize('DIAZEPAM AUROVITAS SPAIN 10 MG COMPRIMIDOS EFG', [
        { cn: '713942', comerc: true, nombre: 'DIAZEPAM AUROVITAS SPAIN 10 MG COMPRIMIDOS EFG 30 comprimidos' },
    ]),
    '30 comprimidos');

check('CIMA con coma SIN espacio (caso real Esomeprazol Cinfa, nreg 75071)',
    summarize('ESOMEPRAZOL CINFA 20 mg COMPRIMIDOS GASTRORRESISTENTES EFG', [
        { cn: '000002', comerc: true, nombre: 'ESOMEPRAZOL CINFA 20 mg COMPRIMIDOS GASTRORRESISTENTES EFG,56 comprimidos (BLISTER)' },
    ]),
    '56 comprimidos');

check('prefijo que no encaja: cae al segmento tras la coma',
    summarize('NOMBRE QUE NO COINCIDE', [
        { cn: '000001', comerc: true, nombre: 'OTRA COSA 10 MG COMPRIMIDOS, 30 comprimidos' },
    ]),
    '30 comprimidos');

check('espaciado irregular en el nombre',
    summarize('ALOPURINOL RATIOPHARM 300 mg COMPRIMIDOS EFG', [
        { cn: '674689', comerc: true, nombre: 'ALOPURINOL RATIOPHARM 300 mg  COMPRIMIDOS EFG, 30 comprimidos' },
    ]),
    '30 comprimidos');

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
