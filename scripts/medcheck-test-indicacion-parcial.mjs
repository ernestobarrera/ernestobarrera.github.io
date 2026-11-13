#!/usr/bin/env node
/**
 * MedCheck — una búsqueda por indicación DICE qué grupos ATC no respondieron.
 *
 * POR QUÉ EXISTE. Hasta el 2026-11-02, si la consulta de un grupo ATC fallaba (CIMA colgado, un
 * 503 del Worker), `_executeIndicationSearch` lo atrapaba con un `console.warn` y seguía: la lista
 * salía sin ese grupo y sin ningún rastro de que faltara. Si fallaban todos, la pantalla decía
 * «Sin resultados». Lo reprodujo Codex en la revisión del 1102 (A4): A falla en la página 2, B
 * responde, y la lista final trae solo B. Por el camino de las sugerencias pasaba lo contrario:
 * un grupo que fallaba tumbaba la búsqueda entera y se perdía lo que sí había llegado.
 *
 * El defecto es de los que nadie reporta: el clínico no echa de menos lo que no sabe que falta.
 *
 * LO QUE ESTE BANCO FIJA:
 *   1. la consulta de varios grupos devuelve qué respondió y qué no, y un grupo que falla a mitad
 *      cuenta como fallido;
 *   2. si no responde ninguno, es un error de consulta (`CONSULTA_FALLIDA`), nunca un cero, y un
 *      cero real sigue siendo un cero;
 *   3. los dos caminos de la app (teclear y sugerencia) pasan por la misma consulta;
 *   4. la pantalla lo dice de forma persistente (en el render, no en un toast): cabecera con el
 *      grupo tachado, aviso con reintento, recuento como «recuperados», y «Resultados incompletos»
 *      en vez de «Sin resultados»;
 *   5. el prompt de IA no presenta como consultado lo que no respondió;
 *   6. el reintento suma solo lo nuevo y no escribe si la búsqueda cambió mientras tanto.
 *
 * Uso: node scripts/medcheck-test-indicacion-parcial.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');

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

function sandboxBase(extra = {}) {
    const sandbox = {
        window: {},
        document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: () => Promise.reject(new Error('sin red en tests')),
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
        AbortSignal, AbortController,
        navigator: { onLine: true }, location: { search: '', href: '' },
        ...extra,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    return sandbox;
}

/** Un medicamento con la forma de CIMA y su ATC ya nombrado (así no se pide nada más). */
const med = (nregistro, atc5) => ({
    nregistro: String(nregistro),
    nombre: `MED ${nregistro}`,
    atcs: [
        { codigo: atc5.slice(0, 4), nombre: 'GRUPO', nivel: 4 },
        { codigo: atc5, nombre: 'SUSTANCIA', nivel: 5 },
    ],
});

const respuestaJson = (cuerpo) => ({
    ok: true, status: 200, statusText: 'OK',
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(cuerpo),
});
const respuesta503 = () => ({
    ok: false, status: 503, statusText: 'Service Unavailable',
    headers: { get: () => 'text/plain' },
    text: async () => 'error code: 1102',
});

/**
 * CIMA de mentira. `plan[atc]` = lista de páginas; cada página es un array de medicamentos o
 * `'fallo'`. `totalFilas` se declara como la suma, para que se pidan todas.
 */
function cargarAPI(plan, detalle = {}) {
    const pedidas = [];
    const fetchImpl = async (url) => {
        const u = new URL(url, 'https://cima.test');
        pedidas.push(u.pathname + u.search);
        // Detalle de un medicamento (verificación en vivo del ATC). `detalle[nregistro]`:
        // 'fallo' (503), '204' (CIMA no lo expone) o el ATC5 que trae la ficha.
        if (u.pathname.endsWith('/medicamento')) {
            const nreg = u.searchParams.get('nregistro');
            const d = detalle[nreg];
            if (d === 'fallo') return respuesta503();
            if (d === '204') return { ok: true, status: 204, statusText: 'No Content', headers: { get: () => '' }, text: async () => '' };
            return respuestaJson(d ? med(nreg, d) : {});
        }
        if (u.pathname.endsWith('/medicamentos')) {
            const atc = u.searchParams.get('atc');
            const pagina = Number(u.searchParams.get('pagina') || 1);
            const paginas = plan[atc] || [[]];
            const pag = paginas[pagina - 1];
            if (pag === 'fallo') return respuesta503();
            const totalFilas = paginas.reduce((s, p) => s + (Array.isArray(p) ? p.length : 200), 0);
            return respuestaJson({ totalFilas, resultados: pag || [] });
        }
        return respuestaJson({});
    };
    const sandbox = sandboxBase({ fetch: fetchImpl });
    vm.runInContext(`${apiSrc}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    const api = new sandbox.window.__CimaAPI();
    return { api, pedidas };
}

const doscientos = (desde, atc5) => Array.from({ length: 200 }, (_, i) => med(desde + i, atc5));

// --- 1. La consulta dice qué respondió ---------------------------------------------------------
console.log('— 1. Qué grupos respondieron —');
{
    // El caso de Codex: A trae 200 en la página 1 y falla en la 2; B responde con uno.
    const { api } = cargarAPI({
        A10A: [doscientos(1000, 'A10AB01'), 'fallo'],
        A10B: [[med(5000, 'A10BA02')]],
    });
    const r = await api._executeIndicationSearch({ atc: ['A10A', 'A10B'], label: 'diabetes', term: 'diabetes' }, {});
    ok('la lista trae solo lo del grupo que respondió', r.resultados.length === 1 && r.resultados[0].nregistro === '5000', r.resultados.length);
    ok('A10A, que falló a mitad, consta como fallido entero', r.consulta?.fallidos?.length === 1 && r.consulta.fallidos[0].atc === 'A10A', JSON.stringify(r.consulta?.fallidos));
    ok('A10B consta como completo', JSON.stringify(r.consulta?.completos) === '["A10B"]', JSON.stringify(r.consulta?.completos));
    ok('se declaran los intentados', JSON.stringify(r.consulta?.intentados) === '["A10A","A10B"]');
    ok('los candidatos son lo recibido de los grupos completos', JSON.stringify(r.consulta?.candidatos) === '["5000"]');
}

// --- 2. Fallo total ≠ cero ---------------------------------------------------------------------
console.log('— 2. Un fallo total es un error, y un cero real es un cero —');
{
    const { api } = cargarAPI({ A10A: ['fallo'], A10B: ['fallo'] });
    let err = null;
    try { await api._executeIndicationSearch({ atc: ['A10A', 'A10B'], label: 'diabetes' }, {}); } catch (e) { err = e; }
    ok('si no responde ningún grupo, lanza CONSULTA_FALLIDA', err?.code === 'CONSULTA_FALLIDA', err?.message || 'no lanzó');
    ok('el error lleva qué falló', err?.consulta?.fallidos?.length === 2);
}
{
    const { api } = cargarAPI({ A10A: [[]], A10B: [[]] });
    const r = await api._executeIndicationSearch({ atc: ['A10A', 'A10B'], label: 'diabetes' }, {});
    ok('dos grupos que responden con cero dan cero, sin error y sin fallidos', r.resultados.length === 0 && r.consulta.fallidos.length === 0);
}
{
    // Con criba 4.1: el estado viaja también por esa rama.
    const { api } = cargarAPI({ L01A: ['fallo'], L01B: [[med(7000, 'L01BA01')]] });
    api._filterIndicationResultsBySection = async (meds) => ({
        resultados: meds, summary: { section: '4.1', candidates: meds.length, checked: meds.length, matched: meds.length, errors: 0 },
    });
    const r = await api._executeIndicationSearch({ atc: ['L01A', 'L01B'], label: 'leucemia', section41Filter: { includeAny: ['leucemia'] } }, {});
    ok('con criba 4.1, el grupo que falló también consta', r.consulta?.fallidos?.[0]?.atc === 'L01A' && !!r.matchedIndication?.filterSummary);
}

// --- 3. Los dos caminos de la app usan la misma consulta ---------------------------------------
console.log('— 3. Un solo camino —');
{
    const exec = bloqueDesde(apiSrc, 'async _executeIndicationSearch(');
    ok('_executeIndicationSearch pasa por _consultarGruposATC', exec.includes('this._consultarGruposATC('));
    ok('_executeIndicationSearch ya no tiene su propio bucle con catch', !/catch\s*\(/.test(exec));
    const multi = bloqueDesde(appSrc, 'async _searchMultipleATCs(');
    ok('_searchMultipleATCs (sugerencias) pasa por _consultarGruposATC', multi.includes('this.api._consultarGruposATC('));
    ok('_searchMultipleATCs ya no recorre searchByATC por su cuenta', !multi.includes('this.api.searchByATC('));
    ok('_searchMultipleATCs guarda el estado de la consulta en los datos', /consulta,\s*\n\s*\};/.test(multi));
}

// --- 4-6. La app --------------------------------------------------------------------------------
const appBox = sandboxBase();
vm.runInContext(`${appSrc}\n;window.__C = MedCheckApp;`, appBox, { filename: 'cima-app.js' });
const MedCheckApp = appBox.window.__C;
const nuevaApp = () => {
    const app = Object.create(MedCheckApp.prototype);
    app._describeATCCode = (c) => ({ A10A: 'Insulinas', A10B: 'Hipoglucemiantes orales' }[c] || '');
    app.showToast = () => {};
    app.lastSearchFilters = { comerc: true };
    return app;
};
const datosParciales = () => ({
    resultados: [med(5000, 'A10BA02')],
    totalFilas: 1,
    matchedIndication: { label: 'diabetes', term: 'diabetes', atc: ['A10A', 'A10B'] },
    consulta: { intentados: ['A10A', 'A10B'], completos: ['A10B'], fallidos: [{ atc: 'A10A', motivo: 'error' }], candidatos: ['5000'] },
});

console.log('— 4. La pantalla lo dice —');
{
    const app = nuevaApp();
    const html = app._indicacionParcialHtml(datosParciales(), 1);
    ok('aviso «Lista incompleta» con el grupo que falta', html.includes('Lista incompleta') && html.includes('A10A') && html.includes('Insulinas'));
    ok('el aviso dice cuántos de cuántos', html.includes('1 de 2 grupos ATC'));
    ok('el aviso ofrece reintentar', html.includes('_reintentarGruposFallidos()'));
    const sinFallo = { ...datosParciales(), consulta: { intentados: ['A10B'], completos: ['A10B'], fallidos: [], candidatos: ['5000'] } };
    ok('sin grupos fallidos no hay aviso', app._indicacionParcialHtml(sinFallo, 1) === '');
    ok('datos sin estado de consulta (árbol ATC, enlaces viejos) no pintan aviso', app._indicacionParcialHtml({ resultados: [] }, 0) === '');
}
{
    // Render con cero y un grupo fallido: «Resultados incompletos», nunca «Sin resultados».
    const cont = { innerHTML: '' };
    appBox.document.getElementById = (id) => (id === 'indication-results' ? cont : null);
    const app = nuevaApp();
    const vacio = { ...datosParciales(), resultados: [], totalFilas: 0 };
    app.displayGroupedIndicationResults(vacio, 'diabetes');
    ok('cero con un grupo fallido → «Resultados incompletos»', cont.innerHTML.includes('Resultados incompletos') && !cont.innerHTML.includes('Sin resultados'), cont.innerHTML.slice(0, 120));
    cont.innerHTML = '';
    app.displayGroupedIndicationResults({ resultados: [], matchedIndication: { label: 'x', atc: ['A10A'] }, consulta: { intentados: ['A10A'], completos: ['A10A'], fallidos: [], candidatos: [] } }, 'x');
    ok('cero real → «Sin resultados»', cont.innerHTML.includes('Sin resultados'));
    appBox.document.getElementById = () => null;
}
{
    // El camino de teclear + Enter, de verdad: un cero con fallidos no cae en «Sin resultados».
    const cont = { innerHTML: '' };
    const elementos = {
        'indication-input': { value: 'diabetes' },
        'autocomplete-results': { classList: { add() {} } },
        'indication-results': cont,
    };
    appBox.document.getElementById = (id) => elementos[id] || null;
    const app = nuevaApp();
    app._enterIndicationUniverse = () => {};
    app._commitIndicationURL = () => {};
    app.api = { searchByIndication: async () => ({ ...datosParciales(), resultados: [], totalFilas: 0 }) };
    await app.performIndicationSearch();
    ok('performIndicationSearch: cero con fallidos → «Resultados incompletos»', cont.innerHTML.includes('Resultados incompletos') && !cont.innerHTML.includes('Sin resultados'), cont.innerHTML.slice(0, 160));
    ok('y conserva los datos para poder reintentar', app.lastIndicationResults?.consulta?.fallidos?.length === 1);
    appBox.document.getElementById = () => null;
}
{
    const cont = { innerHTML: '' };
    const app = nuevaApp();
    const err = new Error('No se pudo consultar ninguno de los 2 grupos ATC');
    err.code = 'CONSULTA_FALLIDA';
    err.consulta = { fallidos: [{ atc: 'A10A' }, { atc: 'A10B' }] };
    app.handleSearchError(cont, err);
    ok('fallo total → «No se pudo consultar CIMA»', cont.innerHTML.includes('No se pudo consultar CIMA'));
    ok('…y dice que no significa que no haya medicamentos', cont.innerHTML.includes('No significa que no haya medicamentos') && !cont.innerHTML.includes('Sin resultados'));
}
{
    const app = nuevaApp();
    app.initGroupingState();
    const bar = app.renderResultsControlBar(1, { resultados: [] }, { resultados: [] }, { showDoses: false, parcial: true });
    ok('la barra cuenta «recuperados» y dice «lista incompleta»', bar.includes('resultados recuperados') && bar.includes('lista incompleta'));
    const barNormal = app.renderResultsControlBar(1, { resultados: [] }, { resultados: [] }, { showDoses: false });
    ok('sin parcial, la barra dice «resultados» a secas', !barNormal.includes('lista incompleta'));
    const disp = bloqueDesde(appSrc, 'displayGroupedIndicationResults(data, searchQuery) {');
    ok('la cabecera tacha el grupo fallido', disp.includes("is-fallido") && disp.includes('sin respuesta'));
    ok('el aviso va en el render (persistente), no en un toast', disp.includes('this._indicacionParcialHtml(data, universe.length)'));
}

console.log('— 5. El prompt de IA —');
{
    const app = nuevaApp();
    const data = datosParciales();
    const scope = app._consultScopeFromResults(data, data.resultados);
    ok('el grupo que no respondió no va como «consultado»', !scope.consultados.some(c => c.codigo === 'A10A') && scope.consultados.some(c => c.codigo === 'A10B'));
    ok('va aparte, como no consultado', scope.noConsultados.length === 1 && scope.noConsultados[0].codigo === 'A10A');
    const prompt = app._composeConsultPrompt(scope, { selected: ['guias'] });
    ok('el prompt avisa de la lista incompleta y de que no concluya que no existen', prompt.includes('LISTA INCOMPLETA') && prompt.includes('A10A') && prompt.includes('no concluyas que no existen'));
    ok('la línea «Sobre:» también lo dice', app._consultScopeLabel(scope).includes('lista incompleta'));
    const completo = { ...data, consulta: { ...data.consulta, completos: ['A10A', 'A10B'], fallidos: [] } };
    const prompt2 = app._composeConsultPrompt(app._consultScopeFromResults(completo, completo.resultados), { selected: ['guias'] });
    ok('sin fallidos, el prompt no lo menciona', !prompt2.includes('LISTA INCOMPLETA'));
}

console.log('— 6. El reintento —');
{
    const app = nuevaApp();
    const data = datosParciales();
    // El reintento trae A10A: dos nuevos, uno de ellos ya en lista (un medicamento en dos grupos).
    app._fusionarReintentoIndicacion(data,
        { completos: ['A10A'], fallidos: [] },
        { candidatos: [med(1000, 'A10AB01'), med(1001, 'A10AB05')], resultados: [med(1000, 'A10AB01'), med(1001, 'A10AB05')] });
    ok('suma lo nuevo', data.resultados.length === 3 && data.totalFilas === 3);
    ok('A10A pasa a completo y no queda ningún fallido', JSON.stringify(data.consulta.completos) === '["A10B","A10A"]' && data.consulta.fallidos.length === 0);
    ok('el aviso desaparece cuando ya no falta nada', app._indicacionParcialHtml(data, 3) === '');
    const dup = datosParciales();
    app._fusionarReintentoIndicacion(dup, { completos: ['A10A'], fallidos: [] }, { candidatos: [], resultados: [med(5000, 'A10BA02')] });
    ok('no duplica lo que ya estaba en la lista', dup.resultados.length === 1);
    const conCriba = { ...datosParciales(), matchedIndication: { label: 'x', atc: ['A10A', 'A10B'], filterSummary: { candidates: 4, checked: 4, matched: 1, errors: 0 } } };
    app._fusionarReintentoIndicacion(conCriba, { completos: ['A10A'], fallidos: [] },
        { candidatos: [med(1000, 'A10AB01'), med(1001, 'A10AB05')], resultados: [med(1000, 'A10AB01')] },
        { candidates: 2, checked: 2, matched: 1, errors: 0 });
    ok('la criba 4.1 suma sus cuentas («verificados: 2 de 6»)', conCriba.matchedIndication.filterSummary.matched === 2 && conCriba.matchedIndication.filterSummary.candidates === 6);
}
{
    // Reintento de verdad, con una API de mentira: el grupo vuelve a responder.
    const app = nuevaApp();
    const data = datosParciales();
    app.lastIndicationResults = data;
    app.lastIndicationQuery = 'diabetes';
    let repintados = 0;
    app.displayIndicationResults = () => { repintados += 1; };
    let pedidos = null;
    app.api = {
        _consultarGruposATC: async (codigos, opts) => { pedidos = { codigos, opts }; return { resultados: [med(1000, 'A10AB01')], consulta: { intentados: codigos, completos: codigos, fallidos: [], candidatos: ['1000'] } }; },
    };
    await app._reintentarGruposFallidos();
    ok('reintenta SOLO los grupos que fallaron', JSON.stringify(pedidos?.codigos) === '["A10A"]', JSON.stringify(pedidos?.codigos));
    ok('…sin contarlo como búsqueda en la analítica', pedidos?.opts?.noTrack === true);
    ok('y la lista queda completa', data.resultados.length === 2 && data.consulta.fallidos.length === 0);
    ok('repinta al empezar y al acabar', repintados === 2, repintados);
}
{
    // Si la búsqueda cambió mientras volaba el reintento, no se toca nada.
    const app = nuevaApp();
    const data = datosParciales();
    app.lastIndicationResults = data;
    app.displayIndicationResults = () => {};
    app.api = {
        _consultarGruposATC: async () => {
            app.lastIndicationResults = { resultados: [], consulta: { fallidos: [] } }; // otra búsqueda
            return { resultados: [med(1000, 'A10AB01')], consulta: { intentados: ['A10A'], completos: ['A10A'], fallidos: [], candidatos: ['1000'] } };
        },
    };
    await app._reintentarGruposFallidos();
    ok('con la búsqueda cambiada, el reintento no escribe en los datos viejos', data.resultados.length === 1 && data.consulta.fallidos.length === 1);
}
{
    // Si los reintentados siguen sin responder, la lista se queda como estaba y marcada.
    const app = nuevaApp();
    const data = datosParciales();
    app.lastIndicationResults = data;
    app.displayIndicationResults = () => {};
    app.api = { _consultarGruposATC: async () => { const e = new Error('x'); e.code = 'CONSULTA_FALLIDA'; throw e; } };
    await app._reintentarGruposFallidos();
    ok('reintento fallido: sigue incompleta y sigue diciéndolo', data.consulta.fallidos.length === 1 && app._indicacionParcialHtml(data, 1).includes('Lista incompleta'));
    ok('…y se puede volver a reintentar', app._indReintentando === false);
}

// --- 7. Verificación en vivo que falla (hallazgo 5 de Fable, punto 17 de la cola) -------------
// CIMA devuelve medicamentos sin `atcs`, el índice ATC no sirve (caducado: en el sandbox no hay
// índice) y la ficha de uno no responde. Antes se contaba como falso positivo y el grupo constaba
// como completo. Ahora va a `sin-verificar`, sin perder lo verificado.
console.log('— 7. Un medicamento que no se pudo verificar no es un falso positivo —');
const sinAtc = (nregistro) => ({ nregistro: String(nregistro), nombre: `MED ${nregistro}` });
{
    const { api } = cargarAPI(
        { C09AA: [[sinAtc(100), sinAtc(101), sinAtc(102), sinAtc(103)]] },
        { 100: 'C09AA01', 101: 'fallo', 102: 'S01BC10', 103: '204' });
    const r = await api.searchByATC('C09AA', { noTrack: true });
    ok('searchByATC conserva el verificado', JSON.stringify(r.resultados.map(m => m.nregistro)) === '["100"]', JSON.stringify(r.resultados.map(m => m.nregistro)));
    ok('…y declara el que no se pudo verificar', JSON.stringify(r.sinVerificar) === '["101"]', JSON.stringify(r.sinVerificar));
    ok('un falso positivo real (S01BC10) y un 204 siguen descartándose, no van a sinVerificar', !(r.sinVerificar || []).includes('102') && !(r.sinVerificar || []).includes('103'));
}
{
    const { api } = cargarAPI(
        { C09AA: [[sinAtc(100), sinAtc(101)]], C09CA: [[med(200, 'C09CA01')]] },
        { 100: 'C09AA01', 101: 'fallo' });
    const r = await api._executeIndicationSearch({ atc: ['C09AA', 'C09CA'], label: 'hipertensión', term: 'hipertension' }, {});
    ok('el grupo con un sin verificar NO consta como completo', JSON.stringify(r.consulta.completos) === '["C09CA"]', JSON.stringify(r.consulta.completos));
    ok('va a fallidos con motivo «sin-verificar» y cuántos', r.consulta.fallidos.length === 1 && r.consulta.fallidos[0].atc === 'C09AA'
        && r.consulta.fallidos[0].motivo === 'sin-verificar' && r.consulta.fallidos[0].sinVerificar === 1, JSON.stringify(r.consulta.fallidos));
    ok('lo verificado de ese grupo SÍ está en la lista', r.resultados.some(m => m.nregistro === '100') && r.resultados.some(m => m.nregistro === '200'));
    ok('el sin verificar no se pinta', !r.resultados.some(m => m.nregistro === '101'));
    ok('ni entra en candidatos: el reintento podrá sumarlo', !r.consulta.candidatos.includes('101'));
}
{
    // Un solo grupo, que respondió a medias: no es un fallo total.
    const { api } = cargarAPI({ C09AA: [[sinAtc(100), sinAtc(101)]] }, { 100: 'C09AA01', 101: 'fallo' });
    let err = null, r = null;
    try { r = await api._consultarGruposATC(['C09AA'], {}); } catch (e) { err = e; }
    ok('un grupo «sin-verificar» solo NO lanza CONSULTA_FALLIDA', !err && r?.resultados?.length === 1, err?.message);
}
{
    // Con la verificación al día, nada cambia.
    const { api } = cargarAPI({ C09AA: [[sinAtc(100), sinAtc(102)]] }, { 100: 'C09AA01', 102: 'S01BC10' });
    const r = await api._consultarGruposATC(['C09AA'], {});
    ok('sin fallos de verificación, el grupo es completo y no hay fallidos', JSON.stringify(r.consulta.completos) === '["C09AA"]' && !r.consulta.fallidos.length);
}
{
    // Las entradas de la vista Indicaciones que no pasaban por `_consultarGruposATC`.
    // La firma lleva `options = {}`: el bloque se corta en el cierre del método, no en la primera llave.
    const iArbol = appSrc.indexOf('async searchByATCCode(');
    const arbol = appSrc.slice(iArbol, appSrc.indexOf('\n    }\n', iArbol));
    ok('el árbol ATC pasa por _consultarGruposATC', arbol.includes('this.api._consultarGruposATC(') && !arbol.includes('this.api.searchByATC('));
    const porIndicacion = bloqueDesde(apiSrc, 'async searchByIndication(');
    ok('el código ATC tecleado pasa por _executeIndicationSearch', !porIndicacion.includes('this.searchByATC('));
}

const datosSinVerificar = () => ({
    resultados: [med(100, 'C09AA01'), med(200, 'C09CA01')],
    totalFilas: 2,
    matchedIndication: { label: 'hipertensión', term: 'hipertension', atc: ['C09AA', 'C09CA'] },
    consulta: { intentados: ['C09AA', 'C09CA'], completos: ['C09CA'], fallidos: [{ atc: 'C09AA', motivo: 'sin-verificar', sinVerificar: 2 }], candidatos: ['100', '200'] },
});
{
    const app = nuevaApp();
    const html = app._indicacionParcialHtml(datosSinVerificar(), 2);
    ok('el aviso dice «Lista incompleta» y cuántos sin verificar', html.includes('Lista incompleta') && html.includes('C09AA') && html.includes('2 medicamentos') && html.includes('(2 sin verificar)'), html);
    ok('…no dice que los medicamentos del grupo no están (lo verificado sí está)', !html.includes('no están.') && html.includes('Se muestran los 2 medicamentos que sí se pudieron comprobar'));
    ok('…y ofrece reintentar', html.includes('_reintentarGruposFallidos()'));
    const mixto = datosSinVerificar();
    mixto.consulta.intentados.push('C09DA');
    mixto.consulta.fallidos.push({ atc: 'C09DA', motivo: 'error' });
    const htmlMixto = app._indicacionParcialHtml(mixto, 2);
    ok('mezclado con un grupo caído, dice los dos casos', htmlMixto.includes('1 de 3 grupos ATC') && htmlMixto.includes('C09DA') && htmlMixto.includes('sus medicamentos no están') && htmlMixto.includes('(2 sin verificar)'), htmlMixto);
    const sinCero = app._indicacionParcialHtml({ ...datosSinVerificar(), resultados: [] }, 0);
    ok('con cero comprobados, no dice «sin resultados»: entre los que faltan puede haberlos', sinCero.includes('entre los que faltan puede haberlos'));
}
{
    const app = nuevaApp();
    const data = datosSinVerificar();
    const scope = app._consultScopeFromResults(data, data.resultados);
    ok('IA: el grupo sin verificar cuenta como consultado, no como «no consultado»', scope.consultados.some(c => c.codigo === 'C09AA') && !scope.noConsultados.length);
    ok('IA: …y va en sinVerificar con su número', scope.sinVerificar?.length === 1 && scope.sinVerificar[0].codigo === 'C09AA' && scope.sinVerificar[0].n === 2);
    const prompt = app._composeConsultPrompt(scope, { selected: ['guias'] });
    ok('el prompt dice LISTA INCOMPLETA y que no concluya que no existen', prompt.includes('LISTA INCOMPLETA') && prompt.includes('no se pudo comprobar el ATC de 2') && prompt.includes('no concluyas que no existen'), prompt);
    ok('la línea «Sobre:» también lo dice', app._consultScopeLabel(scope).includes('sin verificar en C09AA'));
}
{
    // Reintento: vuelve a pedir el grupo y suma solo el que ahora sí se verificó.
    const app = nuevaApp();
    const data = datosSinVerificar();
    app.lastIndicationResults = data;
    app.lastIndicationQuery = 'hipertensión';
    app.displayIndicationResults = () => {};
    let pedidos = null;
    app.api = {
        _consultarGruposATC: async (codigos) => { pedidos = codigos; return { resultados: [med(100, 'C09AA01'), med(101, 'C09AA02')], consulta: { intentados: codigos, completos: codigos, fallidos: [], candidatos: ['100', '101'] } }; },
    };
    await app._reintentarGruposFallidos();
    ok('el reintento pide el grupo sin verificar', JSON.stringify(pedidos) === '["C09AA"]', JSON.stringify(pedidos));
    ok('…suma el nuevo sin duplicar y la lista queda completa', data.resultados.length === 3 && !data.consulta.fallidos.length && data.consulta.completos.includes('C09AA'));
}
{
    // Cabecera: el grupo no se tacha, se marca.
    const disp = bloqueDesde(appSrc, 'displayGroupedIndicationResults(data, searchQuery) {');
    ok('la cabecera marca «N sin verificar» sin tacharlo', disp.includes('_indicacionSinVerificar(data)') && disp.includes('sin verificar</span>'));
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\nOK');
process.exit(fallos ? 1 : 0);
