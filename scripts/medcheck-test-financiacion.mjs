#!/usr/bin/env node
/**
 * MedCheck — test del veredicto de financiación SNS (_classifyFinSit + _computeFinancingSummary)
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm + shims mínimos) y ejercita las dos
 * funciones que deciden lo que el médico lee en la línea "Financiación SNS" de la ficha. Ambas son
 * puras (no tocan DOM ni red), así que se invocan sobre un `this` desnudo del prototipo.
 *
 * Doctrina que fija este test:
 *   - los seis estados oficiales de BIFIMED se clasifican, incluido "Estudio o sin petición
 *     financiación" (financiado=666), que NO es lo mismo que "no tenemos el dato";
 *   - la clasificación usa marcadores ASCII: el dataset del Ministerio llega con mojibake por doble
 *     UTF-8 y los acentos no son fiables;
 *   - el denominador del resumen es SIEMPRE el total de presentaciones consultadas. Una presentación
 *     sin dato no puede desaparecer del cálculo y ascender el medicamento a "Financiado por el SNS";
 *   - "sin petición" se nombra aparte de "no financiado": el efecto para prescribir es el mismo,
 *     pero no existe resolución denegatoria y atribuirla sería falsear la fuente.
 *
 * Textos de situación tomados literalmente del Excel de BIFIMED (sondeo 2026-09-06).
 *
 * Uso: node scripts/medcheck-test-financiacion.mjs
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

const clasificar = (sit, found = true) => app._classifyFinSit(sit, found);
// Atajo: resumen(['Si', 'Excluido']) construye el Map cn -> {found, sit} que espera la función.
// `null` representa un CN que BIFIMED no devuelve (found: false).
const resumen = (sits) => app._computeFinancingSummary(new Map(
    sits.map((s, i) => [String(i), s === null ? { found: false, sit: '' } : { found: true, sit: s }])
));

let failures = 0;
function check(name, got, expected) {
    if (got === expected) {
        console.log(`✓ ${name}`);
    } else {
        failures += 1;
        console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
    }
}

// --- Los seis estados oficiales ----------------------------------------------
console.log('— Clasificación de los seis estados oficiales de BIFIMED —');
check('financiado=1 "Si"', clasificar('Si'), 'fin');
check('financiado=2 "Si para determinadas indicaciones"',
    clasificar('Si para determinadas indicaciones/condiciones'), 'cond');
check('financiado=5 "No incluido"', clasificar('No incluido'), 'nofin');
check('financiado=6 "Excluido"', clasificar('Excluido'), 'nofin');
check('financiado=7 "No financiado por resolución"', clasificar('No financiado por resolución'), 'nofin');
check('financiado=666 "Estudio o sin petición financiación"',
    clasificar('Estudio o sin petición financiación'), 'estudio_sin_peticion');

// El Ministerio sirve el Excel con doble codificación UTF-8. La clasificación no puede depender
// de los acentos ni de que el ETL haya corregido el mojibake.
check('666 con mojibake sigue clasificando igual',
    clasificar('Estudio o sin peticiÃ³n financiaciÃ³n'), 'estudio_sin_peticion');
check('estado 2 con mojibake sigue clasificando igual',
    clasificar('Si para determinadas indicaciones/condiciones'), 'cond');

check('CN que BIFIMED no devuelve → sindato', clasificar('Si', false), 'sindato');
check('situación vacía → sindato', clasificar(''), 'sindato');

// --- Denominador honesto ------------------------------------------------------
console.log('\n— El denominador incluye las presentaciones sin dato —');
check('todas financiadas → si', resumen(['Si', 'Si']).estado, 'si');
check('todas no financiadas → no', resumen(['Excluido', 'No financiado por resolución']).estado, 'no');
check('todas en el estado 666 → estudio_sin_peticion',
    resumen(['Estudio o sin petición financiación', 'Estudio o sin petición financiación']).estado, 'estudio_sin_peticion');
check('...y conserva literalmente la disyunción oficial, sin elegir una de las dos ramas',
    resumen(['Estudio o sin petición financiación']).label, 'En estudio o sin petición de financiación');
check('ninguna con dato → sindato', resumen([null, null]).estado, 'sindato');

// El defecto corregido el 2026-09-06: dos CN financiados y uno sin dato NO son "Financiado por el
// SNS". Es el caso real de YASMIN, cuyos dos CN tienen situación distinta.
check('2 financiadas + 1 sin dato NO es "si"', resumen(['Si', 'Si', null]).estado, 'parcial');
check('...y lo dice con el total real, no con el de los que tienen dato',
    resumen(['Si', 'Si', null]).label, 'Financiación parcial (2 de 3 presentaciones · 1 sin dato)');
check('1 no financiada + 1 sin dato sigue siendo "no", con la fracción a la vista',
    resumen(['Excluido', null]).label, 'No financiado por el SNS (1 de 2 presentaciones · 1 sin dato)');
check('mezcla financiada/no financiada → parcial sobre el total',
    resumen(['Si', 'Excluido']).label, 'Financiación parcial (1 de 2 presentaciones)');
check('condicionada cuenta como financiada pero se nombra aparte',
    resumen(['Si para determinadas indicaciones/condiciones', 'Si']).estado, 'cond');
// "No financiado" se reserva a los tres estados negativos, que son resoluciones del Ministerio.
// El 666 no lo es: en la mezcla se descompone en vez de colapsar ambas cosas bajo una etiqueta falsa.
check('666 mezclado con una denegación no se llama "no financiado"',
    resumen(['Estudio o sin petición financiación', 'Excluido']).estado, 'sin_cobertura');
check('...y la etiqueta dice de qué se compone',
    resumen(['Estudio o sin petición financiación', 'Excluido']).label,
    'Sin cobertura SNS actual: 1 no financiada · 1 en estudio/sin petición');

// --- Contraste con el algoritmo anterior --------------------------------------
// Un detector que nunca ha demostrado detectar nada no es una red de seguridad, es decoración
// (lección de S39). ALCANCE REAL de esta sección, para que no prometa de más: NO es una prueba de
// mutación sobre el código de producción. Ejecuta reimplementaciones de los algoritmos viejos y
// comprueba que producían el defecto, es decir, que las aserciones de arriba distinguen de verdad
// una versión correcta de una incorrecta. Quien caza la regresión si vuelve son esas aserciones.
console.log('\n— Contraste: los algoritmos anteriores producían el defecto —');

// 1. Denominador viejo: conDato = fin + cond + nofin, dejando fuera las presentaciones sin dato.
const resumenViejo = (sits) => {
    let fin = 0, cond = 0, nofin = 0;
    for (const s of sits) {
        const c = s === null ? 'sindato' : app._classifyFinSit(s, true);
        if (c === 'fin') fin++; else if (c === 'cond') cond++; else if (c === 'nofin') nofin++;
    }
    const financiadas = fin + cond, conDato = financiadas + nofin;
    if (conDato === 0) return 'sindato';
    if (nofin === 0) return cond === 0 ? 'si' : 'cond';
    if (financiadas === 0) return 'no';
    return 'parcial';
};
check('el denominador viejo ascendería "2 financiadas + 1 sin dato" a "si"',
    resumenViejo(['Si', 'Si', null]), 'si');

// 2. Clasificador viejo: sin la regla del 666, el estado oficial caía en "sindato" y se confundía
//    con un fallo de cobertura nuestro.
const clasificarViejo = (sit) => {
    const s = (sit || '').trim().toLowerCase();
    if (!s) return 'sindato';
    if (s.includes('no incluid') || s.includes('no financiad') || s.includes('excluid')) return 'nofin';
    if (s.includes('determinad') || s.includes('condicion') || s.includes('restring') || s.includes('restricci')) return 'cond';
    if (s.startsWith('si') || s.includes('financiad')) return 'fin';
    return 'sindato';
};
check('el clasificador viejo degradaba el estado 666 a "sindato"',
    clasificarViejo('Estudio o sin petición financiación'), 'sindato');

// --- La nota del modal cuando no hay Nomenclátor ------------------------------
// `loadSnsFinancing` toca DOM y red, así que esta parte se comprueba sobre el fuente: es un
// detector ESTRUCTURAL, no funcional, y se declara como tal.
//
// El defecto que vigila: la cadena de `else if` terminaba en `else if (bifimedDrugStatus)` con el
// texto de farmacia hospitalaria. Al incorporar las 22.116 presentaciones del estado 666, un
// medicamento sin datos en el Nomenclátor habría caído ahí y MedCheck habría afirmado que su
// financiación se gestiona por farmacia de hospital. Es falso y clínicamente peor que callar.
console.log('\n— Nota del modal sin Nomenclátor (detector estructural) —');
const fuente = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');

const iEstudio = fuente.indexOf("st.includes('estudio')");
const iHosp = fuente.indexOf('su financiación SNS se gestiona a través de farmacia hospitalaria');
check('existe una rama propia para el estado 666 en la nota del modal', iEstudio > -1, true);
check('esa rama se evalúa ANTES que la nota hospitalaria', iEstudio > -1 && iEstudio < iHosp, true);
check('la nota hospitalaria exige marcadores de ámbito hospitalario (UH/DH/ECM)',
    /bifimedDrugStatus\s*&&\s*bifimedHospitalario/.test(fuente), true);
check('bifimedHospitalario se deriva de uh/dh/ecm del registro BIFIMED',
    /bifimedHospitalario\s*=\s*!!\(bifimedDrugRecord\?\.uh\s*\|\|\s*bifimedDrugRecord\?\.dh\s*\|\|\s*bifimedDrugRecord\?\.ecm\)/.test(fuente), true);

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
