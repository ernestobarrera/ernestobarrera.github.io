#!/usr/bin/env node
/**
 * MedCheck — test del canonicalizador de dosis (_canonicalDose / normalizeDosis / _displayDose)
 *
 * El campo `dosis` de CIMA es texto libre: 4.435 cadenas distintas para 16.133 productos
 * comercializados, y "1 G" / "1 g paracetamol" / "1000 mg" / "1 g / comprimido" son el
 * mismo miligramaje escrito de cuatro formas.
 *
 * `_canonicalDose` es la FUENTE ÚNICA del chip de la tarjeta, de los chips de filtro, de
 * Equivalencias y de Alternativas de suministro. Por eso cada caso se comprueba por las dos
 * puertas (`_displayDose` y `normalizeDosis`): si divergen, dos superficies mostrarían
 * dosis distintas para el mismo producto.
 *
 * Doctrina que fija este test:
 *   - se canonicaliza SOLO lo demostrable: una potencia (cifra + unidad de masa/actividad)
 *     o dos componentes con LA MISMA unidad;
 *   - todo lo demás se devuelve LITERAL — espejo por defecto;
 *   - NUNCA se inventa una unidad: era la causa de errores de 1000× en el catálogo real;
 *   - decimal con coma y SIN separador de miles ("1000 mg", "2,5 mg"): en dosis, "1.000"
 *     podría leerse como decimal anglosajón y esa ambigüedad no es aceptable;
 *   - el literal oficial queda siempre en el tooltip.
 *
 * Uso: node scripts/medcheck-test-dose.mjs
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
const app = Object.create(sandbox.window.__MedCheckAppClass.prototype);

let failures = 0;
function fail(name, got, expected) {
    failures += 1;
    console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
}
/** Comprueba por las DOS puertas: tarjeta y filtro deben coincidir. */
function dose(name, raw, expected) {
    const card = app._displayDose(raw).text;
    const filter = app.normalizeDosis(raw);
    if (card !== expected) return fail(`${name} [tarjeta]`, card, expected);
    if (filter !== expected) return fail(`${name} [filtro]`, filter, expected);
    console.log(`✓ ${name}`);
}
function plain(name, got, expected) {
    if (got === expected) console.log(`✓ ${name}`);
    else fail(name, got, expected);
}

// --- Las grafías del caso paracetamol de la captura ---------------------------
console.log('--- caso real: las grafías de paracetamol 1 g ---');
dose('"1 G"', '1 G', '1 g');
dose('"1 g paracetamol"', '1 g paracetamol', '1 g');
// Nota: "1000 mg" NO converge con "1 g". Se probó subir mg→g y cambiaba la unidad
// visible en 223 productos con resultados poco familiares (Darzalex 1800 mg → 1,8 g).
// Son dos formas legítimas de escribirlo y cada producto conserva la suya.
dose('"1000 mg" conserva su unidad', '1000 mg', '1000 mg');
dose('"1 g / comprimido"', '1 g / comprimido', '1 g');
dose('"1.000 mg" (miles con punto)', '1.000 mg', '1000 mg');
dose('"650 mg paracetamol"', '650 mg paracetamol', '650 mg');
dose('"500 mg paracetamol"', '500 mg paracetamol', '500 mg');

// --- Los errores de 1000× que había en los chips de filtro --------------------
console.log('--- regresión: errores de 1000x del normalizador anterior ---');
dose('fentanilo "400 microgramos" (antes: 400 mg)', '400 microgramos', '400 mcg');
dose('"100 microgramos" (antes: 100 mg)', '100 microgramos', '100 mcg');
dose('"1 microgramo" en singular', '1 microgramo', '1 mcg');
dose('enoxaparina "10.000 UI" (antes: 10 ui)', '10.000 UI', '10000 UI');
dose('"2.000 UI" (antes: 2 ui)', '2.000 UI', '2000 UI');
dose('"10.000 u.i" sin punto final (antes: 10000 U)', '10.000 u.i', '10000 UI');
dose('"500 miligramos" con letra', '500 miligramos', '500 mg');
dose('"1 gramo" con letra', '1 gramo', '1 g');
dose('insulina "100 U/ml" (antes: 100 mg)', '100 U/ml', '100 U/ml');
dose('"100 unidades/ml" (antes: 100 mg)', '100 unidades/ml', '100 unidades/ml');
dose('"0,5 ml" (antes: 0.5 mg)', '0,5 ml', '0,5 ml');
dose('"10 % acetilcisteina" (antes: 10 mg)', '10 % acetilcisteina', '10 % acetilcisteina');
dose('"6,14 ml glicerol" (antes: 6.1 mg)', '6,14 ml glicerol', '6,14 ml glicerol');
dose('"250 mg/5 ml" (antes: 250/5 mg)', '250 mg/5 ml', '250 mg/5 ml');

// --- Ambigüedad del punto decimal (hallazgo bloqueante de Codex) --------------
// "N.NNN" puede ser millares o decimal. Solo son decidibles el 0.xxx (decimal) y el
// .000 (millares); el resto se muestra literal en vez de arriesgar un 1000x.
console.log('--- punto ambiguo: 0.xxx decimal, .000 millares, resto literal ---');
dose('0.625 no puede ser millares → decimal', '2 mg / 0.625 mg', '2 mg/0,625 mg');
dose('0.075/0.030 → decimales', '0.075 mg/0.030 mg', '0,075 mg/0,03 mg');
dose('20.645 es indecidible → literal', '20.645 mg/cápsula', '20.645 mg/cápsula');
dose('12.500 es indecidible → literal', '12.500 UI', '12.500 UI');
dose('2.063 es indecidible → literal', '2.063 mg', '2.063 mg');
dose('1.000 termina en 000 → millares', '1.000 UI', '1000 UI');
dose('coma presente: el punto es millares', '2.081,8 mg', '2081,8 mg');

// --- Escala g<->mg sin umbral (hallazgo de Codex) ------------------------------
// El umbral `g < 10` daba 9 g -> 9000 mg pero 10 g -> 10 g, y 18 principios activos
// tienen dosis a ambos lados (povidona yodada mostraba "1000 mg" junto a "10 g").
console.log('--- escala g<->mg, sin umbral ---');
dose('povidona 1 g', '1 g povidona iodada', '1 g');
dose('povidona 10 g — misma unidad que la anterior', '10 g', '10 g');
dose('combinación en gramos NO se reescala', '2 g / 15 g', '2 g/15 g');
dose('ni al revés', '10 g / 2,12 g', '10 g/2,12 g');
dose('combinación en mg conserva su unidad', '50 mg/1000 mg', '50 mg/1000 mg');

// --- Millares con varios puntos (P0 de la 2ª revisión de Codex) ---------------
// `parseFloat("1.200.000")` se para en el segundo punto y devuelve 1,2. Sin validar que
// la cifra se consume entera, Farmaproina salía como "1,2 UI": un error de 1.000.000×.
console.log('--- millares con varios separadores ---');
dose('Farmaproina 1.200.000 UI', '1.200.000 UI', '1200000 UI');
dose('Colobreathe 1.662.500 UI', '1.662.500 UI', '1662500 UI');
dose('1.000.000 UI', '1.000.000 UI', '1000000 UI');
dose('unidades no reconocidas siguen literales', '100.000.000 UFC', '100.000.000 UFC');
plain('el parser rechaza lo que no consume entero', app._parseDoseNumber('1.200.000x'), null);
plain('y acepta el millar múltiple', app._parseDoseNumber('1.200.000'), 1200000);
plain('un solo punto de 3 sigue siendo ambiguo', app._parseDoseNumber('12.500'), null);

// --- Ordenación sensible a la unidad (P2 de Codex) ----------------------------
// Ordenar por el número a secas colocaba "1 g" antes que "500 mg".
console.log('--- ordenación por unidad base ---');
plain('500 mg < 650 mg', app._doseSortValue('500 mg') < app._doseSortValue('650 mg'), true);
plain('650 mg < 1 g', app._doseSortValue('650 mg') < app._doseSortValue('1 g'), true);
plain('1 g < 10 g', app._doseSortValue('1 g') < app._doseSortValue('10 g'), true);
plain('500 mcg < 1 mg', app._doseSortValue('500 mcg') < app._doseSortValue('1 mg'), true);
// El ejemplo era "12.500 UI (sin unidad base)", que R1 rescata a propósito desde S40
// (en actividad los millares sí son decidibles). En masa siguen sin serlo.
plain('lo ilegible va al final',
    app._doseSortValue('12.500 mg (sin unidad base)') === Number.MAX_SAFE_INTEGER, true);

// --- Precisión: canonicalizar no puede redondear una dosis --------------------
// `toFixed(3)` convertía 0,0242 mg en 0,024 mg. Cazado por la auditoría de magnitud
// sobre el catálogo completo (criterio 2 de Codex). Casos reales.
console.log('--- precisión: sin redondeo ---');
dose('4 decimales se conservan', '2500 mg/0,0242 mg', '2500 mg/0,0242 mg');
dose('y en el primer componente', '0,0165 mg / 72 mg', '0,0165 mg/72 mg');
dose('sin ruido binario', '1,5 mg', '1,5 mg');

// --- Denominador = forma farmacéutica (benigno) vs magnitud (peligroso) --------
console.log('--- "por comprimido" no es un ratio ---');
dose('"/cápsula" sin espacios', '20 mg/cápsula', '20 mg');
dose('"/sobres" en plural', '600 mg / sobres', '600 mg');
dose('"/parche"', '5 mg/parche', '5 mg');
dose('PERO "/dosis" es magnitud', '20 mg/dosis', '20 mg/dosis');
dose('PERO "/ml" es magnitud', '1 mg/ml', '1 mg/ml');
dose('PERO "/g" es magnitud', '50 mg/g', '50 mg/g');
dose('denominador desconocido', '10 mg/aplicador', '10 mg/aplicador');

// --- Combinaciones: misma unidad se canonicaliza; distinta, literal -----------
console.log('--- combinaciones ---');
dose('unidad solo en la segunda', '875-125 mg', '875 mg/125 mg');
dose('ambas con unidad', '875 mg/125 mg', '875 mg/125 mg');
dose('espacios alrededor de la barra', '37.5 mg / 325 mg', '37,5 mg/325 mg');
dose('ya canónica', '37,5 mg/325 mg', '37,5 mg/325 mg');
dose('separador "+"', '600 mg + 300 mg', '600 mg/300 mg');
dose('microgramos en ambas', '50 microgramos/250 microgramos', '50 mcg/250 mcg');
dose('unidades DISTINTAS → literal', '2800 UI / 70 mg', '2800 UI / 70 mg');
dose('concentración masa/masa NO es combinación', '10 mg/2 g', '10 mg/2 g');
dose('triple → literal', '267 mg/40 mg/133 mg', '267 mg/40 mg/133 mg');

// --- Unidades y formato numérico ----------------------------------------------
console.log('--- unidades y formato ---');
dose('decimal con coma española', '2,5 mg', '2,5 mg');
dose('decimal en punto se normaliza a coma', '2.5 mg', '2,5 mg');
dose('1500 mg conserva su unidad', '1500 mg', '1500 mg');
dose('sub-gramo sí baja a mg (familiar)', '0,25 g', '250 mg');
dose('sin separador de miles en la salida', '2500 UI', '2500 UI');
dose('gramos grandes se quedan en g', '50 g', '50 g');
dose('gramos pequeños tambien (sin umbral)', '9 g', '9 g');
dose('sub-gramo baja a mg', '0,5 g', '500 mg');
dose('mg no entero NO sube a g (perdería precisión)', '2081,8 mg', '2081,8 mg');
dose('mcg', '500 mcg', '500 mcg');
dose('µg se unifica a mcg', '25 µg', '25 mcg');
dose('UI en mayúsculas', '2800 ui', '2800 UI');
dose('U.I. con puntos', '400 U.I.', '400 UI');
dose('espaciado irregular', '  1   g   paracetamol ', '1 g');
plain('cadena vacía en tarjeta', app._displayDose('').text, '');
plain('nulo en tarjeta', app._displayDose(null).text, '');
plain('vacío en filtro es "Sin dosis"', app.normalizeDosis(''), 'Sin dosis');
plain('la "g" de glicerol no se toma por gramos',
    app.normalizeDosis('5 glicerol'), '5 glicerol');

// --- Literales: íntegros, sin recortar en JS ----------------------------------
// Recortar ocultaría estructura clínica (el "/ml" de una concentración) con un umbral
// arbitrario. El ancho es un problema de layout, no de datos.
console.log('--- literales largos: íntegros ---');
const largo = '37.5 MG TRAMADOL HIDROCLORURO + 325 MG PARACETAMOL POR COMPRIMIDO RECUBIERTO';
dose('el literal desmesurado se entrega completo', largo, largo);
dose('la concentración conserva el denominador',
    '1 mg cetirizina dihidrocloruro/ml', '1 mg cetirizina dihidrocloruro/ml');
dose('masa por volumen con nombre de PA',
    '900 mg sodio cloruro/ 100 ml', '900 mg sodio cloruro/ 100 ml');
dose('dos concentraciones tópicas', '5 mg/g + 100 mg/g', '5 mg/g + 100 mg/g');
dose('por dosis, combinación', '60 microgramos/dosis + 60 microgramos/dosis',
    '60 microgramos/dosis + 60 microgramos/dosis');

// --- Centinela del condensador descartado (S39) -------------------------------
// Se midió condensar quitando el nombre de la sustancia; convertía "19,2 mg fentanilo
// (100 µg/h)" en "19,2 mg 100 g/h" (µg → g: error de 1000× en un parche de fentanilo).
console.log('--- centinela del condensador descartado ---');
dose('parche de fentanilo: literal, sin tokenizar',
    '19,2 mg fentanilo (100 µg/h)', '19,2 mg fentanilo (100 µg/h)');
dose('parche con superficie en cm2',
    '16.5mg/30cm2 que liberan 100mcg de Fentanilo/h',
    '16.5mg/30cm2 que liberan 100mcg de Fentanilo/h');

// --- Puerta del valor de orden (S40) ------------------------------------------
// El valor de orden nunca se muestra, pero SÍ decide qué se ve: la vista "Sin agrupar"
// recorta, así que el orden elige quién entra en el recorte. Por eso tiene puerta propia.
const UNK = app.constructor.DOSE_SORT_UNKNOWN;
console.log('--- centinela: ilegibles al final en AMBOS sentidos ---');
plain('el centinela tiene nombre', UNK, Number.MAX_SAFE_INTEGER);
plain('ascendente: ilegible después de una masa',
    app._compareByDose('500 mg', 'Desconocida', 'asc') < 0, true);
plain('DESCENDENTE: el ilegible sigue al final',
    app._compareByDose('500 mg', 'Desconocida', 'desc') < 0, true);
plain('descendente: y por el otro lado también',
    app._compareByDose('Desconocida', '500 mg', 'desc') > 0, true);
plain('dos ilegibles empatan (orden estable)',
    app._compareByDose('Desconocida', '-', 'desc'), 0);
plain('descendente ordena de mayor a menor', app._compareByDose('1 g', '500 mg', 'desc') < 0, true);

// R1: la lectura de millares solo se rescata en unidades de ACTIVIDAD.
console.log('--- R1: millares indecidibles, solo en UI/U ---');
plain('12.500 UI ya tiene valor de orden', app._doseSortValue('12.500 UI') !== UNK, true);
plain('y ordena entre sus hermanas',
    app._doseSortValue('10.000 UI') < app._doseSortValue('12.500 UI')
    && app._doseSortValue('12.500 UI') < app._doseSortValue('15.000 UI'), true);
plain('Fragmin completo en orden', ['12.500 UI', '2.500 UI', '18.000 UI', '7.500 UI', '5.000 UI',
    '15.000 UI', '10.000 UI'].sort((a, b) => app._compareByDose(a, b)).join(' '),
    '2.500 UI 5.000 UI 7.500 UI 10.000 UI 12.500 UI 15.000 UI 18.000 UI');
// En masa el punto es ambiguo DE VERDAD: el catálogo tiene 8 cadenas mg que son millares y
// 7 que son decimales. Leerlas como millares ordenaría "6.563 g" como 6,5 kg.
plain('1.500 mg sigue SIN valor de orden', app._doseSortValue('1.500 mg'), UNK);
plain('2.063 mg (parche) sigue sin valor', app._doseSortValue('2.063 mg'), UNK);
plain('6.563 g sigue sin valor', app._doseSortValue('6.563 g'), UNK);
plain('R1 no toca la etiqueta visible', app.normalizeDosis('12.500 UI'), '12.500 UI');
plain('ni el parser de la etiqueta', app._parseDoseNumber('12.500'), null);

// R2 descartada: la cadena no distingue contenido total de potencia. Casos reales.
console.log('--- R2 descartada: contenido total no es potencia ---');
plain('Buprenorfina 20 mg (TRANSTEC 35 mcg/h)', app._doseSortValue('Buprenorfina 20 mg'), UNK);
plain('Fentanilo 23,12 mg (parche 100 mcg/h)', app._doseSortValue('Fentanilo 23,12 mg'), UNK);
plain('Estradiol 6,4 mg (EVOPAD 100 mcg/24 h)', app._doseSortValue('Estradiol 6,4 mg'), UNK);
plain('Ibuprofeno 4 g (APIROFENO 40 mg/ml)', app._doseSortValue('Ibuprofeno 4 g'), UNK);
plain('umbral, no valor', app._doseSortValue('Mayor o igual que 2,5 UI'), UNK);
plain('concentración con PA delante', app._doseSortValue('GALANTAMINA (HIDROBROMURO) 4 mg/ml'), UNK);

// Bandas: masa y actividad no son comparables, no deben entrelazarse.
console.log('--- bandas ---');
plain('toda masa por debajo de toda actividad',
    app._doseSortValue('50 g') < app._doseSortValue('0,6 UI'), true);
plain('la actividad ordena dentro de su banda',
    app._doseSortValue('2800 UI') < app._doseSortValue('1.200.000 UI'), true);

// Idempotencia: Equivalencias y Alternativas pasan cadenas YA canónicas.
console.log('--- idempotencia sobre la cadena canónica ---');
for (const raw of ['1 g paracetamol', '0,25 g', '875-125 mg', '12.500 UI', '400 microgramos',
    '1.200.000 UI', '10 % acetilcisteína', 'Buprenorfina 20 mg', '2 mg / 0.625 mg']) {
    plain(`sort(raw) === sort(canónica): ${JSON.stringify(raw)}`,
        app._doseSortValue(raw), app._doseSortValue(app.normalizeDosis(raw)));
}

// --- Tooltip ------------------------------------------------------------------
console.log('--- tooltip ---');
plain('normalizada: el tooltip declara el literal de CIMA',
    app._displayDose('1 g paracetamol').title, 'Dosis según CIMA: 1 g paracetamol');
plain('literal: el tooltip también lo declara',
    app._displayDose('650 mg').title, 'Dosis según CIMA: 650 mg');

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
