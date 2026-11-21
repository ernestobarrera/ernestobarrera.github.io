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
import { fuenteApp } from './lib/cargar-app.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = fuenteApp(ROOT);

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
// Seis desde el 2026-11-02: el reintento de los grupos ATC que no respondieron
// (`_reintentarGruposFallidos`) también consulta CIMA y tiene que pedir lo mismo que la búsqueda.
ok('las seis rutas de Indicaciones lo leen del estado', usos === 6, `encontradas ${usos}`);

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
// Desde el 21/11/2026 Buscar tiene también su manejador de esta casilla (antes no tenía ninguno y
// la casilla no hacía nada allí), y va antes en el fichero: se busca el de INDICACIONES, que es el
// que examina este banco, dentro de su propio enganche.
const iniListener = appSrc.indexOf("getElementById('comerc-filter')", appSrc.indexOf('    setupGroupingEventListeners(data, searchQuery) {'));
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

// --- 6. El selector se pliega cuando hay lista (mejora 4 de la revisión de claridad, 21/11) -------
// Vive en este banco porque es la misma vista y el mismo relanzador: la casilla «Comercializado»
// repinta la lista y NO debe cerrar un selector que el usuario acaba de abrir.
console.log('\n— El selector se pliega cuando hay lista —');
function domSelector({ coarse = false } = {}) {
    const clases = (ini = []) => {
        const s = new Set(ini);
        return { has: (c) => s.has(c), toggle: (c, on) => { if (on) s.add(c); else s.delete(c); return on; } };
    };
    const etiqueta = { textContent: '' };
    const input = { enfocado: false, seleccionado: false, focus() { this.enfocado = true; }, select() { this.seleccionado = true; } };
    const layout = { classList: clases() };
    const resumen = { classList: clases(['hidden']), querySelector: (s) => (s === '.indication-selector-label' ? etiqueta : null) };
    sandbox.document.querySelector = (s) => (s === '.indications-two-col-layout' ? layout : null);
    sandbox.document.getElementById = (id) => ({ 'indication-selector-summary': resumen, 'indication-input': input }[id] || null);
    sandbox.window.matchMedia = (q) => ({ matches: coarse && /coarse/.test(q) });
    return { layout, resumen, etiqueta, input };
}
const plegado = (d) => d.layout.classList.has('is-folded') && !d.resumen.classList.has('hidden');
const abierto = (d) => !d.layout.classList.has('is-folded') && d.resumen.classList.has('hidden');
{
    const d = domSelector();
    const a = Object.create(MedCheckApp.prototype);
    Object.assign(a, { lastATCCode: null, lastIndicationQuery: 'Hipertensión <b>' });
    a._plegarSelectorIndicacion(true);
    ok('plegar oculta el selector y enseña la línea', plegado(d));
    ok('la línea dice lo elegido, como texto y no como HTML', d.etiqueta.textContent === 'Hipertensión <b>', d.etiqueta.textContent);
    a._plegarSelectorIndicacion(false);
    ok('desplegar hace lo contrario', abierto(d));
    Object.assign(a, { lastATCCode: 'C09A', lastATCLabel: 'IECA, monofármacos' });
    ok('por el árbol ATC, la línea dice código y nombre', a._etiquetaSelectorIndicacion() === 'C09A · IECA, monofármacos');
    a.lastATCLabel = '';
    ok('y sin nombre, solo el código', a._etiquetaSelectorIndicacion() === 'C09A');
}
{
    const d = domSelector();
    const a = Object.create(MedCheckApp.prototype);
    a._plegarSelectorIndicacion(true);
    a._abrirSelectorIndicacion();
    ok('«Cambiar indicación» abre el selector y lo recuerda', abierto(d) && a._selectorIndAbierto === true);
    ok('en escritorio, foco en la caja con el texto seleccionado', d.input.enfocado && d.input.seleccionado);
    const t = domSelector({ coarse: true });
    a._abrirSelectorIndicacion();
    ok('en pantalla táctil, sin foco (el teclado taparía atajos y categorías)', !t.input.enfocado);
    const g = domSelector();
    a._abrirSelectorIndicacion({ foco: false });
    ok('la guía lo abre sin foco', abierto(g) && !g.input.enfocado);
}
{
    // Se EJECUTA el render de la lista hasta justo después del pliegue: `initGroupingState` corta.
    const PARA = new Error('alto');
    const render = (resultados, abiertoAntes) => {
        const d = domSelector();
        const a = Object.create(MedCheckApp.prototype);
        const cont = { innerHTML: '' };
        const getEl = sandbox.document.getElementById;
        sandbox.document.getElementById = (id) => (id === 'indication-results' ? cont : getEl(id));
        Object.assign(a, {
            lastATCCode: null, lastIndicationQuery: 'Diabetes', _selectorIndAbierto: abiertoAntes, groupingState: null,
            _indicacionFallidos: () => [], initGroupingState: () => { throw PARA; },
        });
        if (!abiertoAntes) a._plegarSelectorIndicacion(false);
        else a._abrirSelectorIndicacion({ foco: false });
        try { a.displayGroupedIndicationResults({ resultados }, 'Diabetes'); } catch (e) { if (e !== PARA) throw e; }
        return d;
    };
    ok('con lista, se pliega', plegado(render([{ nregistro: '1' }], false)));
    ok('si el usuario lo abrió, repintar la lista (una faceta) no se lo cierra', abierto(render([{ nregistro: '1' }], true)));
    const vacio = render([], false);
    ok('sin resultados se queda abierto: lo siguiente es elegir otra cosa', abierto(vacio));
}
{
    // Elegir otra cosa borra la marca; relanzar la misma (la casilla «Comercializado») no.
    const a = Object.create(MedCheckApp.prototype);
    Object.assign(a, { _indAiAlCambiarUniverso() {}, _indAiUniverso() {}, _resetResultFilters() {} });
    a._selectorIndAbierto = true;
    a._enterIndicationUniverse({ atcCode: null, query: 'asma' });
    ok('un universo nuevo vuelve a plegar con la lista nueva', a._selectorIndAbierto === false);
    a._selectorIndAbierto = true;
    a._enterIndicationUniverse({ atcCode: null, query: 'asma', preserveFilters: true });
    ok('relanzar la misma búsqueda conserva el selector abierto', a._selectorIndAbierto === true);
}
{
    // Bajar por el árbol ATC despliega (no hay lista y la línea rotularía el grupo que se dejó).
    const d = domSelector();
    const a = Object.create(MedCheckApp.prototype);
    const PARA = new Error('alto');
    Object.assign(a, { _resetResultFilters() {}, findStaticATCCategory: () => { throw PARA; } });
    a._plegarSelectorIndicacion(true);
    try { await a.showATCSubcategories('C09'); } catch (e) { if (e !== PARA) throw e; }
    ok('al bajar por el árbol ATC el selector vuelve a verse', abierto(d));
}
{
    const miga = Object.create(MedCheckApp.prototype).renderResultsBreadcrumb([], '');
    ok('la casa de la miga de pan abre el selector', /onclick="app\._abrirSelectorIndicacion\(\)"/.test(miga), miga.slice(0, 160));
    ok('la casa del árbol ATC pinta con el selector abierto',
        /onclick="app\.renderIndications\(\{ abierto: true \}\)"/.test(appSrc)
        && /renderIndications\(\{ abierto = false \} = \{\}\) \{\s*if \(abierto\) this\._selectorIndAbierto = true;/.test(appSrc));
    const pasos = ['#indication-input', '.indications-categories-panel', '#open-indication-catalog']
        .filter((t) => new RegExp(`target: '${t.replace(/[.#]/g, '\\$&')}',\\s*action: \\{ type: 'indicationSelector' \\}`).test(appSrc));
    ok('los tres pasos de la guía que señalan el selector lo abren antes', pasos.length === 3, pasos.join(', '));
    const accion = bloqueDesde(appSrc, 'async _runGuideStepAction(step) {');
    ok('y la acción lo abre sin foco',
        /type === 'indicationSelector'[\s\S]{0,300}_abrirSelectorIndicacion\(\{ foco: false \}\)/.test(accion));
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
