#!/usr/bin/env node
/**
 * MedCheck — banco de los resaltados de la pestaña Posología (sección 4.2).
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm, sin DOM) y ejercita
 * `RESALTADOS_POSOLOGIA` con `_segmentarResaltados`, la misma función pura que usa
 * `_resaltarPosologia` en el navegador. Sin red: las fichas reales salen del fixture congelado
 * de `medcheck-test-menciones-ft.mjs`.
 *
 * Doctrina que fija este banco:
 *
 *   - RESALTAR NO ES AFIRMAR. La categoría Manipulación marca la FRASE con su negación
 *     («no deben masticarse ni triturarse»), nunca el verbo suelto: resaltar solo «triturarse»
 *     en una ficha que lo prohíbe se leería al revés.
 *   - «A PARTIR DE» NO ES PARTIR. Aparece en casi todas las 4.2 hablando de edades y días; si
 *     cayera en Manipulación, la categoría sería ruido y dejaría de leerse.
 *   - DIVIDIR LA DOSIS NO ES DIVIDIR EL COMPRIMIDO. «Dividir la dosis diaria en dos dosis
 *     iguales» es posología; solo cuentan las formas de partir la unidad.
 *   - LA «U» MINÚSCULA ES UNA CONJUNCIÓN. «cada 3 u 4 horas» no es una cantidad en unidades.
 *   - NO SE PIERDE NI UN CARÁCTER. Los segmentos concatenados reproducen el texto original en
 *     todas las secciones del fixture: el resaltado envuelve, no reescribe.
 *
 * Uso: node scripts/medcheck-test-resaltado-posologia.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox);
const App = sandbox.window.__MedCheckAppClass;
const app = Object.create(App.prototype);
const categorias = App.RESALTADOS_POSOLOGIA;

let failures = 0;
function fail(name, got, expected) {
    failures += 1;
    console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
}
function cierto(name, cond, detalle) {
    if (cond) console.log(`✓ ${name}`);
    else fail(name, detalle, 'que la condición se cumpliera');
}

/** Textos resaltados con una clase, en orden. */
const marcados = (texto, clase) => app._segmentarResaltados(texto, categorias)
    .filter(s => s.clase === `posology-${clase}`).map(s => s.texto);

function caso(name, texto, clase, esperado) {
    const got = marcados(texto, clase);
    if (JSON.stringify(got) === JSON.stringify(esperado)) console.log(`✓ ${name}`);
    else fail(`${name} [${clase}]`, got, esperado);
}

// --- La tabla de categorías -------------------------------------------------------------------
console.log('--- tabla de categorías ---');
cierto('cuatro categorías, en orden de aplicación unidades → manipulación → posología → alimentos',
    JSON.stringify(categorias.map(c => c.clase)) === JSON.stringify(['posology-unit', 'posology-manip', 'posology-timing', 'posology-food']),
    categorias.map(c => c.clase));
cierto('cada categoría tiene rótulo, ayuda y un puesto de leyenda distinto',
    categorias.every(c => c.etiqueta && c.ayuda && Number.isInteger(c.leyenda))
        && new Set(categorias.map(c => c.leyenda)).size === categorias.length,
    categorias.map(c => [c.clase, c.etiqueta, c.leyenda]));
cierto('ningún rótulo de ayuda afirma que algo se pueda o no se pueda hacer con el medicamento',
    categorias.every(c => !/\b(seguro|permitid|prohibid|se puede partir|se puede triturar)\b/i.test(c.ayuda)),
    categorias.map(c => c.ayuda));

// --- Manipulación: lo que tiene que resaltar ----------------------------------------------------
console.log('--- manipulación: frases que la ficha usa ---');
caso('negación con verbos coordinados (pellets de omeprazol)', 'Los pellets no deben masticarse ni triturarse.', 'manip', ['no deben masticarse ni triturarse']);
caso('negación pasiva con participios', 'Los comprimidos no deben ser masticados ni triturados.', 'manip', ['no deben ser masticados ni triturados']);
caso('lista con comas y «ni»', 'No se deben partir, masticar ni triturar.', 'manip', ['No se deben partir, masticar ni triturar']);
caso('tragar entero', 'Los comprimidos deben tragarse enteros con agua.', 'manip', ['tragarse enteros']);
caso('«sin masticar»', 'Los comprimidos se tragan sin masticar.', 'manip', ['sin masticar']);
caso('frase QRD de divisibilidad', 'El comprimido se puede dividir en dosis iguales.', 'manip', ['dividir en dosis iguales']);
caso('frase QRD de ranura no divisible', 'La ranura sirve únicamente para fraccionar y facilitar la deglución pero no para dividir en dosis iguales.', 'manip',
    ['ranura', 'fraccionar', 'dividir en dosis iguales']);
caso('cápsulas abiertas y contenido espolvoreado', 'Pueden abrirse las cápsulas y espolvorear el contenido sobre la comida.', 'manip', ['abrirse las cápsulas y espolvorear']);
caso('dispersar y sonda', 'Los comprimidos pueden dispersarse en agua y administrarse a través de una sonda nasogástrica.', 'manip', ['dispersarse', 'sonda nasogástrica']);
caso('medio comprimido', 'Se recomienda empezar con medio comprimido.', 'manip', ['medio comprimido']);

// --- Manipulación en formas no orales ------------------------------------------------------------
// La 4.2 de DYNASTAT (parecoxib inyectable) salía sin un solo resaltado: el vocabulario se había
// sacado de 12 fichas orales. Lo vio Ernesto el 2026-10-04 con la ficha delante.
console.log('--- manipulación: inyectables y parches (DYNASTAT) ---');
caso('no mezclar, con la negación', 'Dynastat no debe mezclarse con ningún otro medicamento, ni durante la reconstitución ni durante la inyección.', 'manip',
    ['no debe mezclarse', 'reconstitución']);
caso('reconstitución con disolventes', 'Después de la reconstitución con los disolventes adecuados, puede ser administrado en inyección IM o IV.', 'manip',
    ['reconstitución', 'disolventes']);
caso('precipitación y compatibilidad', 'Puede precipitar en solución; lavar la vía con una solución de compatibilidad conocida. Puede causar la precipitación de la solución.', 'manip',
    ['precipitar', 'compatibilidad', 'precipitación']);
caso('dilución', 'Debe diluirse antes de su uso. La dilución se realiza con cloruro sódico.', 'manip', ['diluirse', 'dilución']);
caso('«no» imperativo de parche', 'No cortar el parche.', 'manip', ['No cortar']);
caso('agitar el vial', 'Agitar suavemente el vial antes de usar.', 'manip', ['Agitar']);
caso('«agitación» es un síntoma, no una manipulación', 'Control rápido de la agitación en pacientes con esquizofrenia.', 'manip', []);
caso('«paciente agitado» tampoco', 'En el paciente agitado puede repetirse la inyección a las 2 horas.', 'manip', []);

// --- Manipulación: lo que NO tiene que resaltar -------------------------------------------------
console.log('--- manipulación: falsos positivos que se descartan ---');
caso('«a partir de» (edades)', 'A partir de los 12 años, 500 mg al día.', 'manip', []);
caso('«a partir del» (días)', 'Se puede aumentar a partir del día 3.', 'manip', []);
caso('dividir la dosis diaria en dosis iguales es posología', 'La dosis diaria puede dividirse en dos dosis iguales.', 'manip', []);
caso('dividir la dosis diaria en tomas es posología', 'Dividir la dosis diaria en dos tomas.', 'manip', []);

// --- Unidades y equivalencias ----------------------------------------------------------------
console.log('--- unidades y equivalencias ---');
caso('microgramos', 'Dosis inicial de 400 microgramos al día.', 'unit', ['400 microgramos']);
caso('microgramos por hora (parche)', 'Libera 25 microgramos/h.', 'unit', ['25 microgramos/h']);
caso('UI con miles', 'Administrar 10.000 UI anti-Xa.', 'unit', ['10.000 UI']);
caso('U/ml (insulina)', 'Solución de 100 U/ml.', 'unit', ['100 U/ml']);
caso('mEq', 'Contiene 8 mEq de potasio.', 'unit', ['8 mEq']);
caso('«u» minúscula es conjunción', 'Cada 3 u 4 horas.', 'unit', []);
caso('dosis expresada como base', 'Las dosis se expresan como base.', 'unit', ['se expresan como base']);
caso('equivalencia sal → base (pramipexol)', '0,125 mg de pramipexol dihidrocloruro monohidrato, equivalente a 0,088 mg de pramipexol.', 'unit', ['equivalente a 0,088 mg']);
caso('los mg siguen siendo Posología', '500 mg dos veces al día.', 'unit', []);
caso('… y se resaltan como Posología', '500 mg dos veces al día.', 'timing', ['500 mg', 'dos veces al día']);

// --- Orden de aplicación ----------------------------------------------------------------------
console.log('--- solapes entre categorías ---');
caso('microgramos no caen en Posología', '400 mcg una vez al día.', 'timing', ['una vez al día']);
caso('la frase de manipulación se queda entera aunque contenga «con agua»', 'Deben tragarse enteros con agua.', 'manip', ['tragarse enteros']);
caso('… y «agua» sigue siendo Alimentos', 'Deben tragarse enteros con agua.', 'food', ['agua']);

// --- Estado de las expresiones regulares -------------------------------------------------------
console.log('--- estado entre llamadas ---');
{
    // La versión anterior comprobaba con `test()` sobre expresiones con bandera `g`, que arranca
    // donde se quedó la llamada previa: tras un texto largo, uno corto podía quedarse sin nada.
    const largo = `${'texto de relleno '.repeat(20)}tome 500 mg al día`;
    app._segmentarResaltados(largo, categorias);
    caso('un texto corto tras uno largo conserva sus resaltados', '500 mg', 'timing', ['500 mg']);
}

// --- Fichas reales del fixture -----------------------------------------------------------------
console.log('--- fichas reales (fixture de menciones) ---');
const fixture = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/medcheck-menciones-ft.json'), 'utf8')).responses;
const decodificar = h => h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
const textos = [];
for (const [nr, secciones] of Object.entries(fixture)) {
    for (const [sec, partes] of Object.entries(secciones)) {
        textos.push({ nr, sec, texto: decodificar(partes.map(p => p.contenido || '').join(' ')) });
    }
}
cierto(`el fixture trae fichas con 4.2 (${textos.filter(t => t.sec === '4.2').length})`, textos.filter(t => t.sec === '4.2').length >= 10, textos.length);

const perdidos = textos.filter(t => app._segmentarResaltados(t.texto, categorias).map(s => s.texto).join('') !== t.texto);
cierto(`ningún carácter se pierde ni se añade en las ${textos.length} secciones`, perdidos.length === 0, perdidos.map(t => `${t.nr} ${t.sec}`));

const manip42 = textos.filter(t => t.sec === '4.2').flatMap(t => marcados(t.texto, 'manip').map(m => ({ nr: t.nr, m })));
const aPartir = textos.filter(t => /a partir de/i.test(t.texto)).length;
cierto(`«a partir de» está en ${aPartir} secciones reales y nunca se resalta como manipulación`,
    aPartir > 0 && manip42.every(({ m }) => !/partir\s+de/i.test(m)), manip42.filter(({ m }) => /partir/i.test(m)));
const esta = (nr, frase) => manip42.some(x => x.nr === nr && x.m === frase);
cierto('75071: «no deben masticarse ni triturarse», entera', esta('75071', 'no deben masticarse ni triturarse'), manip42.filter(x => x.nr === '75071'));
cierto('75071: «sonda gástrica»', esta('75071', 'sonda gástrica'), manip42.filter(x => x.nr === '75071'));
cierto('70400 (gabapentina): «tragarse entero»', esta('70400', 'tragarse entero'), manip42.filter(x => x.nr === '70400'));
cierto('77073: «sin masticar»', esta('77073', 'sin masticar'), manip42.filter(x => x.nr === '77073'));
const timingConMicro = textos.flatMap(t => marcados(t.texto, 'timing')).filter(m => /microgramo|µg|μg|mcg|\bUI\b|mmol|mEq/i.test(m));
cierto('ninguna cantidad en µg, UI, mmol o mEq queda resaltada como Posología', timingConMicro.length === 0, timingConMicro);

console.log(failures ? `\n${failures} fallo(s)` : '\nTodo correcto');
process.exit(failures ? 1 : 0);
