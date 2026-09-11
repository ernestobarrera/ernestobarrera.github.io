#!/usr/bin/env node
/**
 * MedCheck — test del filtro «Comercializado» en la pestaña Indicaciones
 *
 * PREGUNTA QUE RESPONDE: ¿la búsqueda por indicación dice que está filtrando, y deja quitarlo?
 *
 * Hasta el 2026-09-11 la respuesta era NO a las dos cosas: las cinco rutas que alimentan esa
 * pantalla pasaban `comercializados: true` FIJO, y no había ningún control ni aviso. Es decir,
 * esa pestaña mostraba solo comercializados, el usuario no podía saberlo y no tenía forma de ver
 * lo demás.
 *
 * CÓMO SE DESTAPÓ, que es lo que le da la medida: Ernesto quiso comprobar por su cuenta si un
 * corticoide tópico del grupo II estaba realmente comercializado en España —después de que dos
 * asistentes le dijeran que sí y este le dijera que no— y descubrió que por esa pantalla no
 * podía. **El filtro invisible le impedía verificar justo lo que un agente le había afirmado.**
 * Encargo suyo, textual: «la filosofía es que tenga los mismos filtros que la de búsqueda».
 *
 * LO QUE ESTE TEST PROTEGE:
 *   1. que el estado sea UNO solo, compartido con el buscador (dos casillas con el mismo nombre
 *      y distinta memoria son dos criterios, y esta casa ya pagó eso con la financiación);
 *   2. que NINGUNA de las cinco rutas vuelva a fijarlo a `true`;
 *   3. que la casilla se pinte SIEMPRE, también cuando no haya ninguna otra —es cuando más falta
 *      hace: un universo pequeño parece completo—;
 *   4. que al cambiarla se REPITA la consulta y no se filtre en cliente, porque lo que no se pidió
 *      a CIMA no está en memoria y ninguna faceta puede devolverlo.
 *
 * Uso: node scripts/medcheck-test-comercializados-indicaciones.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');

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
vm.runInContext(`${appSrc}\n;window.__C = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const MedCheckApp = sandbox.window.__C;
const app = Object.create(MedCheckApp.prototype);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};

/** Extrae un bloque `{...}` equilibrado a partir de una firma. */
function bloqueDesde(src, firma) {
    const i = src.indexOf(firma);
    if (i === -1) throw new Error(`no se encontró "${firma}"`);
    const j = src.indexOf('{', i);
    let prof = 0;
    for (let k = j; k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (!prof) return src.slice(i, k + 1); }
    }
    throw new Error(`bloque sin cerrar para "${firma}"`);
}

// --- 1. El estado: uno solo, y por defecto filtrando ------------------------------------------
console.log('— Un solo estado, compartido con el buscador —');
app.lastSearchFilters = { comerc: true };
ok('marcado → solo comercializados', app._soloComercializados() === true);
app.lastSearchFilters = { comerc: false };
ok('desmarcado → también los no comercializados', app._soloComercializados() === false);
// Por defecto se filtra: es lo que hace la web de CIMA y lo que espera un clínico.
app.lastSearchFilters = {};
ok('sin estado guardado, el defecto es filtrar', app._soloComercializados() === true);
app.lastSearchFilters = undefined;
ok('sin `lastSearchFilters` siquiera, tampoco revienta', app._soloComercializados() === true);

// Es el MISMO campo que lee el buscador. Si alguien lo duplicara en `filterState`, las dos
// pestañas divergirían y cada una mostraría un universo distinto con la misma casilla marcada.
ok('lee `lastSearchFilters.comerc`, que es el del buscador',
    /_soloComercializados\(\) \{\s*return this\.lastSearchFilters\?\.comerc !== false;/.test(appSrc));
ok('el buscador escribe en ese mismo campo',
    /comerc: document\.getElementById\('filter-comerc'\)\.checked/.test(appSrc));

// --- 2. Ninguna ruta puede volver a fijarlo -----------------------------------------------------
console.log('\n— Ninguna de las cinco rutas lo fija a `true` —');
const rutasFijas = appSrc.match(/comercializados:\s*true/g) || [];
ok('no queda ningún `comercializados: true` en la vista de indicaciones',
    rutasFijas.length <= 1, `quedan ${rutasFijas.length} (se admite 1: el de Alternativas del modal, que es otra pantalla)`);
const usos = (appSrc.match(/comercializados:\s*this\._soloComercializados\(\)/g) || []).length;
ok('las cinco rutas de Indicaciones lo leen del estado', usos === 5, `encontradas ${usos}`);

// --- 3. La casilla se pinta SIEMPRE -------------------------------------------------------------
console.log('\n— La casilla se ve siempre, también sin ninguna otra —');
ok('existe la casilla en el panel de indicaciones', /id="comerc-filter"/.test(appSrc));
// Las demás casillas cuelgan de su recuento (`efgCount > 0` y similares). Esta NO puede.
const bloqueCasilla = appSrc.slice(appSrc.indexOf('id="comerc-filter"') - 900, appSrc.indexOf('id="comerc-filter"') + 120);
ok('no está condicionada a ningún recuento',
    !/\$\{\s*(showEFG|efgCount|recetaCount|biosimilarCount)[^}]*\?[^}]*id="comerc-filter"/.test(bloqueCasilla));
// Y el contenedor tampoco puede estar condicionado, o la casilla se iría con él.
ok('el contenedor del panel ya no es condicional',
    !/\|\|\s*hayCasillasPropias\s*\?/.test(appSrc));
ok('la bandera muerta se retiró en vez de quedarse sin uso',
    (appSrc.match(/hayCasillasPropias/g) || []).length <= 1);

// --- 4. Cambiarla REPITE la consulta, no filtra en cliente ---------------------------------------
console.log('\n— Cambiarla repite la consulta —');
// La ventana se corta en el cierre del PROPIO listener. La primera versión cogía 600 caracteres
// a bulto y se comía el listener siguiente —el de «Genérico»—, que sí llama a
// `_applyIndicationFacet`: el test fallaba señalando código que no era el que examinaba.
const iniListener = appSrc.indexOf("getElementById('comerc-filter')");
const finListener = appSrc.indexOf('});', iniListener);
const listener = appSrc.slice(iniListener, finListener + 3);
ok('el listener llama a la búsqueda, no a la faceta de cliente',
    /_relanzarIndicacion\(\)/.test(listener) && !/_applyIndicationFacet/.test(listener), listener.slice(0, 200));
ok('escribe en el estado compartido', /this\.lastSearchFilters\.comerc = e\.target\.checked/.test(listener));
ok('avisa de que va a tardar más al ampliar el universo', /tarda más/.test(listener));

// El relanzador tiene que distinguir las dos formas de haber llegado: por término o por ATC.
//
// SE EJECUTA, no se lee. La primera versión comprobaba que las cadenas `this.lastATCCode` y
// `searchByATCCode(` aparecieran en el cuerpo, y por eso SOBREVIVÍA al mutante que cambiaba la
// condición por `if (false)`: el texto seguía ahí, la rama ya no se alcanzaba. Es la diferencia
// entre comprobar que algo está escrito y comprobar que ocurre.
const relanzar = bloqueDesde(appSrc, '_relanzarIndicacion() {');
function espiarRelanzador({ atc = null, query = '', valorInput = '' } = {}) {
    const llamadas = [];
    const input = { value: valorInput };
    const doble = {
        lastATCCode: atc, lastATCLabel: atc ? 'Etiqueta' : '', lastATCBreadcrumb: [],
        lastIndicationQuery: query,
        searchByATCCode: (...a) => { llamadas.push(['atc', a[3]]); },
        performIndicationSearch: (o) => { llamadas.push(['termino', o]); },
    };
    const metodo = new Function('document', `return { ${relanzar} };`)(
        { getElementById: (id) => (id === 'indication-input' ? input : null) })._relanzarIndicacion;
    metodo.call(doble);
    return { llamadas, input };
}
{
    const { llamadas } = espiarRelanzador({ atc: 'D07AC' });
    ok('si se vino por ATC, se repite por ATC', llamadas[0]?.[0] === 'atc', JSON.stringify(llamadas));
    ok('y conserva las facetas', llamadas[0]?.[1]?.preserveFilters === true);
}
{
    const { llamadas } = espiarRelanzador({ query: 'dermatitis atópica', valorInput: 'dermatitis atópica' });
    ok('si se vino por término, se repite por término', llamadas[0]?.[0] === 'termino', JSON.stringify(llamadas));
    ok('y también conserva las facetas (cambia el universo, no la pregunta)',
        llamadas[0]?.[1]?.preserveFilters === true);
}
{
    // Se pudo llegar por el catálogo o por un enlace compartido: la caja está vacía y, sin
    // rellenarla, la búsqueda contestaría «introduce al menos 2 caracteres» a quien solo ha
    // marcado una casilla.
    const { llamadas, input } = espiarRelanzador({ query: 'psoriasis', valorInput: '' });
    ok('rellena el término si la caja está vacía', input.value === 'psoriasis', input.value);
    ok('y aun así relanza por término', llamadas[0]?.[0] === 'termino');
}

// --- 5. El mensaje de «sin resultados» no puede mentir -------------------------------------------
console.log('\n— El vacío dice la verdad según el universo pedido —');
ok('con el filtro puesto, se ofrece quitarlo',
    /No hay medicamentos comercializados para[^`]*desmarcar «Comercializado»/.test(appSrc));
ok('sin el filtro, no se dice «comercializados»',
    /ni comercializado ni retirado/.test(appSrc));

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
