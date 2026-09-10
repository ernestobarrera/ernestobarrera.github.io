#!/usr/bin/env node
/**
 * MedCheck — test del habilitado de los botones fármaco–síntoma (pestaña Fármacos)
 *
 * PREGUNTA QUE RESPONDE: escribir un síntoma y no pulsar Enter, ¿deja usable la botonera?
 *
 * Nació el 2026-09-10 de un parte suyo: «en la pestaña farmacos, los botones de ia
 * farmaco-sintoma no se activan cuando escribo ttos y sintomas». La causa no era un listener
 * suelto sino DOS CUENTAS DISTINTAS del mismo hecho, y solo una alcanzable:
 *
 *   · `_validateComboAi` y `performSymptomAnalysis` ya recogían el texto pendiente del input
 *     («incluir texto pendiente en el input como un síntoma más antes de validar»).
 *   · `_syncComboSymptomButtons` exigía chip, así que los cuatro botones estaban `disabled`
 *     y esa recogida NO PODÍA EJECUTARSE NUNCA.
 *
 * Es la clase de defecto de R65/R71 del cuaderno del entorno: una salvaguarda escrita, en verde,
 * y jamás alcanzada. Por eso este test no comprueba solo la condición nueva: comprueba también
 * que el camino que la usa sigue cableado.
 *
 * Se ejecuta el CUERPO REAL de las funciones extraído de assets/js/cima-app.js. Una copia
 * tecleada aquí se quedaría atrás en silencio y el test seguiría verde sobre código muerto.
 *
 * Uso: node scripts/medcheck-test-combo-symptom.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(ROOT, 'assets', 'js', 'cima-app.js'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};

/** Extrae un bloque `{...}` equilibrado a partir de la posición de una firma. */
function bloqueDesde(src, firma) {
    const i = src.indexOf(firma);
    if (i === -1) throw new Error(`no se encontró "${firma}" en el fuente`);
    const j = src.indexOf('{', i);
    let prof = 0;
    for (let k = j; k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (!prof) return src.slice(i, k + 1); }
    }
    throw new Error(`bloque sin cerrar para "${firma}"`);
}

// --- Las dos funciones reales, sobre un DOM mínimo -------------------------------------------
const IDS = ['combo-symptom-btn', 'combo-ai-symptom-perplexity', 'combo-ai-symptom-chatgpt', 'combo-ai-symptom-copy'];

function montar({ farmacos = 0, chips = [], tecleado = '' } = {}) {
    const botones = Object.fromEntries(IDS.map(id => [id, { disabled: null }]));
    const input = { value: tecleado };
    const documentFalso = {
        getElementById: id => (id === 'symptom-search' ? input : (botones[id] || null)),
    };
    const app = {
        comboDrugList: Array.from({ length: farmacos }, (_, i) => ({ nombre: `F${i}` })),
        _comboSymptoms: [...chips],
    };
    const fabricar = firma => {
        const cuerpo = bloqueDesde(appSrc, firma);
        // eslint-disable-next-line no-new-func
        return new Function('document', `return function(){ const o = { ${cuerpo} }; return o; }`)(documentFalso);
    };
    const metodos = {
        ...fabricar('_pendingComboSymptom() {')(),
        ...fabricar('_syncComboSymptomButtons() {')(),
    };
    Object.assign(app, metodos);
    return { app, botones, input };
}

const habilitados = botones => IDS.every(id => botones[id].disabled === false);
const deshabilitados = botones => IDS.every(id => botones[id].disabled === true);

// 1. EL CASO DEL PARTE: un fármaco y un síntoma tecleado sin Enter.
{
    const { app, botones } = montar({ farmacos: 1, chips: [], tecleado: 'tos' });
    app._syncComboSymptomButtons();
    ok('texto tecleado sin Enter habilita los cuatro botones', habilitados(botones),
        JSON.stringify(Object.fromEntries(IDS.map(i => [i, botones[i].disabled]))));
}

// 2. Lo que ya funcionaba sigue funcionando: chip confirmado, input vacío.
{
    const { app, botones } = montar({ farmacos: 1, chips: ['edema'], tecleado: '' });
    app._syncComboSymptomButtons();
    ok('un chip confirmado sigue habilitando', habilitados(botones));
}

// 3. La otra mitad de la condición NO se afloja: sin fármacos no hay botonera, se teclee lo que
//    se teclee. El prompt necesita los dos lados; habilitar aquí solo movería el fallo al clic.
{
    const { app, botones } = montar({ farmacos: 0, chips: [], tecleado: 'tos' });
    app._syncComboSymptomButtons();
    ok('sin fármacos sigue deshabilitado aunque haya síntoma tecleado', deshabilitados(botones));
}

// 4. Ni fármaco ni síntoma: deshabilitado.
{
    const { app, botones } = montar({ farmacos: 0, chips: [], tecleado: '' });
    app._syncComboSymptomButtons();
    ok('sin nada, deshabilitado', deshabilitados(botones));
}

// 5. Espacios en blanco no son un síntoma. Sin esto, un espacio accidental abriría la botonera y
//    el prompt saldría con un síntoma vacío.
{
    const { app, botones } = montar({ farmacos: 2, chips: [], tecleado: '   ' });
    app._syncComboSymptomButtons();
    ok('solo espacios NO cuenta como síntoma', deshabilitados(botones));
}

// 6. El texto pendiente se lee del DOM en el momento, no de una copia guardada al renderizar:
//    si se cacheara, teclear no cambiaría nada hasta el siguiente repintado.
{
    const { app, botones, input } = montar({ farmacos: 1, chips: [], tecleado: '' });
    app._syncComboSymptomButtons();
    const antes = deshabilitados(botones);
    input.value = 'edema';
    app._syncComboSymptomButtons();
    ok('el pendiente se relee del DOM en cada sincronización', antes && habilitados(botones));
}

// --- Aserciones de FUENTE: el camino tiene que seguir cableado -------------------------------
// Sin esto, quitar el listener dejaría el test 1 en verde (llama a la función a mano) mientras la
// pantalla real vuelve a no reaccionar al teclear. Es justo el fallo que este test persigue.
ok('el campo de síntoma escucha `input` y sincroniza',
    /symptomInput\.addEventListener\('input',\s*\(\)\s*=>\s*this\._syncComboSymptomButtons\(\)\)/.test(appSrc));

// El listener NO puede re-renderizar: `renderCombination` reconstruye el HTML del campo, así que
// llamarlo desde `input` borraría lo que se está escribiendo en cada tecla.
{
    const cuerpoListener = /symptomInput\.addEventListener\('input',([^;]*);/.exec(appSrc)?.[1] || '';
    ok('el listener de `input` no re-renderiza (no destruye lo tecleado)',
        !/renderCombination/.test(cuerpoListener), cuerpoListener.trim());
}

// La recogida del texto pendiente al pulsar debe seguir existiendo EN LAS DOS puertas —la
// botonera de IA y el análisis 4.8—: es lo que convierte lo tecleado en síntoma de verdad. Sin
// ella el botón queda habilitado y no hace nada, que es peor que estar apagado.
//
// Se comprueba DENTRO del cuerpo de cada función, no sobre el fichero entero. La primera versión
// de esta aserción buscaba el patrón en todo `appSrc` y por eso SOBREVIVÍA al mutante que lo
// borraba de una de las dos: la otra ocurrencia lo tapaba. Dos puertas, dos comprobaciones.
for (const [firma, nombre] of [
    ['_validateComboAi(kind) {', '_validateComboAi'],
    ['async performSymptomAnalysis(', 'performSymptomAnalysis'],
]) {
    const cuerpo = bloqueDesde(appSrc, firma);
    ok(`\`${nombre}\` recoge el texto pendiente antes de validar`,
        /getElementById\('symptom-search'\)\?\.value/.test(cuerpo)
        && /addComboSymptom\(\s*pending\s*\)|_comboSymptoms\.push/.test(cuerpo),
        'no aparece la recogida del input dentro de esta función');
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
