#!/usr/bin/env node
/**
 * MedCheck — una lista que CIMA entregó a medias NUNCA se pinta como completa.
 *
 * QUÉ PASÓ (revisión de Fable, 11/11/2026, hallazgos 3, 6 y 7; medido en producción el 12/11):
 *   - Suministro (h3): una sola petición a `/psuministro`. CIMA declara 919 en `totalFilas` y sirve
 *     200 por página, así que la pestaña enseñaba los 200 de inicio más reciente (el último mes)
 *     bajo «Total activos 200» y «Mostrando 200 de 200», y el índice de fechas de la insignia salía
 *     de esas mismas 200.
 *   - ATC (h6): `searchByATC` no cotejaba lo recibido con `totalDeclarado`. Una página `200 OK` con
 *     `resultados: []` o el tope de 10 páginas dejaban un grupo cortado que contaba como completo
 *     en `_consultarGruposATC`; C09 sin «Comercializado» estaba a 30 filas del tope (1.970).
 *   - Alertas (h7): `/registroCambios` declara ~12.800 cambios por semana y entrega 200, sin orden
 *     de fecha ni filtro por tipo; la pestaña pintaba 50 bajo una insignia «200» y «los últimos 7
 *     días», como si fueran todos.
 *
 * LA REGLA QUE FIJA ESTE BANCO: lo recibido se coteja con lo declarado. Suministro pagina hasta el
 * total y, si falta algo, dice «N de M» y ofrece reintentar; un grupo ATC incompleto va a
 * `fallidos` con motivo «incompleto»; Alertas dice «se muestran N de M». Un cero real sigue siendo
 * un cero y una lista entera no lleva aviso.
 *
 * CÓMO: la red se simula en `fetch`, así que las peticiones recorren el `_request`, el
 * `searchMedicamentosAll` y el `getSuministro` reales. Las pantallas se pintan con los métodos
 * reales de `MedCheckApp` sobre un DOM mínimo.
 *
 * Uso: node scripts/medcheck-test-listas-cortadas.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Red controlable ──────────────────────────────────────────────────────────────────────────
// `red(url)` devuelve { status, body } o lanza. `peticiones` cuenta lo que llegó a la red.
let red = () => { throw new TypeError('Failed to fetch'); };
let peticiones = [];
const psum = () => peticiones.filter(p => p.includes("/psuministro")).length;
const respuesta = ({ status = 200, body = '' }) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});
let cabeceras = [];
const fetchFalso = async (url, opts = {}) => {
    peticiones.push(String(url));
    cabeceras.push({ url: String(url), secundaria: opts?.headers?.['X-MC-Autocomplete'] === '1' });
    return respuesta(await red(new URL(String(url))));
};

// ── DOM mínimo ───────────────────────────────────────────────────────────────────────────────
const nodos = new Map();
const nodo = (id) => {
    if (!nodos.has(id)) nodos.set(id, { id, innerHTML: '', disabled: false, value: '', dataset: {}, classList: { add() { }, remove() { } } });
    return nodos.get(id);
};
const sandbox = {
    window: {},
    document: { addEventListener() { }, getElementById: nodo, querySelector: () => null, querySelectorAll: () => [] },
    console: { log() { }, warn() { }, error() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    fetch: fetchFalso,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, AbortSignal, TextEncoder,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${apiSrc}\n;window.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
vm.runInContext(`${appSrc}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const CimaAPI = sandbox.window.__CimaAPIClass;
const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof CimaAPI !== 'function' || typeof MedCheckApp !== 'function') {
    console.error('No se pudieron cargar CimaAPI y MedCheckApp');
    process.exit(1);
}

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok     ${nombre}`); return; }
    fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`);
};
const nuevaApi = () => { const api = new CimaAPI(); api.useProxy = false; return api; };
const nuevaApp = () => {
    const app = Object.create(MedCheckApp.prototype);
    app.api = nuevaApi();
    app.content = nodo('content');
    app.showToast = () => { };
    app.handleSearchError = (cont, err) => { cont.innerHTML = `ERROR:${err?.message}`; };
    return app;
};

// ── Datos de prueba ──────────────────────────────────────────────────────────────────────────
const DIA = 86400000;
const filaSum = (i) => ({ cn: String(600000 + i), nombre: `MEDICAMENTO ${i} 10 MG`, tipoProblemaSuministro: 1, fini: Date.now() - i * DIA, activo: true, observ: '' });
/** `/psuministro` paginado de 200. `paginas[n]` = 'CORTE' | 'VACIA' | { totalFilas } para alterar una. */
const redSuministro = (total, paginas = {}) => (u) => {
    if (!u.pathname.endsWith('/psuministro')) throw new TypeError('ruta inesperada ' + u.pathname);
    const p = Number(u.searchParams.get('pagina') || 1);
    const cambio = paginas[p];
    if (cambio === 'CORTE') throw new TypeError('Failed to fetch');
    const desde = (p - 1) * 200;
    const resultados = cambio === 'VACIA' ? [] : Array.from({ length: Math.max(0, Math.min(200, total - desde)) }, (_, k) => filaSum(desde + k));
    return { status: 200, body: { totalFilas: cambio?.totalFilas ?? total, pagina: p, tamanioPagina: 200, resultados } };
};

const medATC = (atc, i) => ({ nregistro: `${atc}-${i}`, nombre: `${atc} ${i}`, atcs: [{ codigo: `${atc}AA0${i % 9 + 1}`, nivel: 5 }] });
/** `/medicamentos?atc=X` paginado de 200. `grupos[X]` = { total, vacia?: n, sinTotal?: true, corte?: n } */
const redATC = (grupos) => (u) => {
    if (u.pathname.endsWith('/maestras')) return { status: 200, body: { resultados: [] } };
    if (!u.pathname.endsWith('/medicamentos')) throw new TypeError('ruta inesperada ' + u.pathname);
    const atc = u.searchParams.get('atc');
    const g = grupos[atc];
    if (!g) throw new TypeError('grupo inesperado ' + atc);
    const p = Number(u.searchParams.get('pagina') || 1);
    if (g.corte === p) throw new TypeError('Failed to fetch');
    const desde = (p - 1) * 200;
    const resultados = g.vacia === p ? [] : Array.from({ length: Math.max(0, Math.min(200, g.total - desde)) }, (_, k) => medATC(atc, desde + k));
    const body = { pagina: p, tamanioPagina: 200, resultados };
    if (!g.sinTotal) body.totalFilas = g.total;
    return { status: 200, body };
};

// ── 1. Suministro, capa de datos ─────────────────────────────────────────────────────────────
console.log('\n— Suministro (h3), capa de datos —');
{
    red = redSuministro(919); peticiones = []; cabeceras = [];
    const api = nuevaApi();
    const d = await api.getSuministro();
    ok('919 declarados: llegan los 919 activos, completo', d.length === 919 && d.completo === true && d.declaradas === 919, `${d.length} ${d.completo}`);
    ok("5 páginas pedidas, ni una más", psum() === 5, peticiones.join(" "));
    const sum = cabeceras.filter(c => c.url.includes('/psuministro'));
    ok('analítica: solo la primera página cuenta; las demás van como secundarias',
        sum.length === 5 && !sum[0].secundaria && sum.slice(1).every(c => c.secundaria), JSON.stringify(sum));
    peticiones = [];
    await api.getSuministro();
    ok("la lista completa se cachea (segunda llamada sin red)", psum() === 0);

    red = redSuministro(919, { 3: 'CORTE' }); peticiones = [];
    const api2 = nuevaApi();
    const d2 = await api2.getSuministro();
    ok('página 3 caída: llegan 719 de 919, completo false', d2.length === 719 && d2.completo === false && d2.recibidas === 719 && d2.declaradas === 919, `${d2.length} ${d2.completo}`);
    peticiones = [];
    red = redSuministro(919);
    const d2b = await api2.getSuministro();
    ok('la lista incompleta NO se cachea: el reintento vuelve a red y completa', psum() === 5 && d2b.completo === true && d2b.length === 919);

    red = redSuministro(919, { 2: 'VACIA' });
    const d3 = await nuevaApi().getSuministro();
    ok('página 2 con 200 OK y vacía: incompleto', d3.completo === false && d3.length === 719);

    red = redSuministro(919, { 4: { totalFilas: 921 } });
    const d4 = await nuevaApi().getSuministro();
    ok('el total cambia a mitad: incompleto', d4.completo === false);

    red = redSuministro(150); peticiones = [];
    const d5 = await nuevaApi().getSuministro();
    ok('150 declarados: una sola petición, completo', d5.length === 150 && d5.completo === true && psum() === 1);

    red = redSuministro(0);
    const d6 = await nuevaApi().getSuministro();
    ok('cero REAL: vacío y completo', d6.length === 0 && d6.completo === true);

    red = redSuministro(919, { 1: 'CORTE' });
    let lanzo = false;
    try { await nuevaApi().getSuministro(); } catch { lanzo = true; }
    ok('primera página caída: el error sube (no es «sin problemas»)', lanzo);

    // Una fila que CIMA corre de página entre dos peticiones aparece dos veces: no se cuenta doble.
    red = (u) => {
        const p = Number(u.searchParams.get('pagina') || 1);
        const filas = p === 1 ? Array.from({ length: 200 }, (_, k) => filaSum(k)) : [filaSum(199), filaSum(200)];
        return { status: 200, body: { totalFilas: 201, resultados: filas } };
    };
    const d7 = await nuevaApi().getSuministro();
    ok('duplicado entre páginas: un CN, una fila', d7.length === 201 && d7.completo === true, String(d7.length));

    red = redSuministro(919, { 5: 'CORTE' }); peticiones = [];
    const api8 = nuevaApi();
    const idx = await api8.getSuministroIndex();
    ok('índice con lista incompleta: lo dice y no se cachea', idx.completo === false && idx.size === 800);
    red = redSuministro(919); peticiones = [];
    const idx2 = await api8.getSuministroIndex();
    ok('índice: el siguiente intento completa', idx2.completo === true && idx2.size === 919 && psum() === 5);
}

// ── 2. Suministro, pantalla ──────────────────────────────────────────────────────────────────
console.log('\n— Suministro (h3), pantalla —');
{
    red = redSuministro(919);
    const app = nuevaApp();
    await app.renderSupply();
    const h = app.content.innerHTML;
    ok('completa: sin aviso y «de 919 problemas»', !h.includes('Lista incompleta') && h.includes('de 919 problemas') && !h.includes('CIMA declara'), h.slice(0, 200));

    red = redSuministro(919, { 2: 'CORTE', 4: 'CORTE' });
    const app2 = nuevaApp();
    await app2.renderSupply();
    const h2 = app2.content.innerHTML;
    ok('incompleta: «Lista incompleta», 519 de 919 y Reintentar', h2.includes('Lista incompleta') && h2.includes('declara 919') && h2.includes('solo han llegado 519') && h2.includes('app.renderSupply()'), h2.slice(0, 400));
    ok('incompleta: el contador dice «recibidos (CIMA declara 919)»', h2.includes('recibidos (CIMA declara 919)'));

    red = (u) => ({ status: 200, body: { totalFilas: 400, resultados: [] } });
    const app3 = nuevaApp();
    await app3.renderSupply();
    const h3 = app3.content.innerHTML;
    ok('vacía con 400 declarados: NO dice «Sin problemas de suministro»', !h3.includes('Sin problemas de suministro') && h3.includes('Lista incompleta'), h3.slice(0, 300));

    red = redSuministro(0);
    const app4 = nuevaApp();
    await app4.renderSupply();
    ok('cero REAL: «Sin problemas de suministro»', app4.content.innerHTML.includes('Sin problemas de suministro'));
}

// ── 3. Búsqueda por ATC ──────────────────────────────────────────────────────────────────────
console.log('\n— Paginación ATC (h6) —');
{
    red = redATC({ C09: { total: 600 } });
    const r = await nuevaApi().searchByATC('C09');
    ok('600 declarados y 600 recibidos: sin error', r.resultados.length === 600);

    red = redATC({ C09: { total: 600, vacia: 2 } });
    let err = null;
    try { await nuevaApi().searchByATC('C09'); } catch (e) { err = e; }
    ok('página 2 vacía con 200 OK: LISTA_INCOMPLETA (400 de 600)', err?.code === 'LISTA_INCOMPLETA' && err.recibidos === 400 && err.declarados === 600, String(err?.message));
    ok('el mensaje lo dice en claro', /400 de 600/.test(err?.message || ''));

    red = redATC({ C09: { total: 600, sinTotal: true } });
    err = null;
    try { await nuevaApi().searchByATC('C09'); } catch (e) { err = e; }
    ok('sin `totalFilas`: no se afirma completo', err?.code === 'LISTA_INCOMPLETA' && err.declarados === null);

    red = redATC({ C09: { total: 2100 } }); peticiones = [];
    const r2 = await nuevaApi().searchByATC('C09', { comercializados: false });
    ok('2.100 filas (por encima del tope viejo de 2.000): llegan enteras', r2.resultados.length === 2100, String(r2.resultados.length));
    ok('11 páginas de medicamentos, ni una más', peticiones.filter(p => p.includes('/medicamentos')).length === 11);

    red = redATC({ C09: { total: 4200 } });
    err = null;
    try { await nuevaApi().searchByATC('C09', { comercializados: false }); } catch (e) { err = e; }
    ok('por encima del tope nuevo (4.200): incompleto, no cortado en silencio', err?.code === 'LISTA_INCOMPLETA' && err.recibidos === 4000);

    red = redATC({ C09: { total: 0 } });
    const r3 = await nuevaApi().searchByATC('C09');
    ok('cero REAL: vacío sin error', r3.resultados.length === 0);

    red = redATC({ C09: { total: 300 }, C03: { total: 500, vacia: 3 } });
    const c = await nuevaApi()._consultarGruposATC(['C09', 'C03']);
    ok('grupo incompleto va a `fallidos` con motivo «incompleto»', c.consulta.completos.join() === 'C09'
        && c.consulta.fallidos.length === 1 && c.consulta.fallidos[0].atc === 'C03' && c.consulta.fallidos[0].motivo === 'incompleto', JSON.stringify(c.consulta));
    ok('lo recibido del grupo incompleto no se cuela en la lista', c.resultados.length === 300 && c.resultados.every(m => m.nregistro.startsWith('C09')));

    red = redATC({ C09: { total: 300 }, C03: { total: 500, corte: 2 } });
    const c2 = await nuevaApi()._consultarGruposATC(['C09', 'C03']);
    ok('una página caída sigue siendo «error», no «incompleto»', c2.consulta.fallidos[0]?.motivo === 'error');

    const app = nuevaApp();
    app._describeATCCode = (code) => (code === 'C03' ? 'Diuréticos' : '');
    const html = app._indicacionParcialHtml({ consulta: c.consulta }, 300);
    ok('el aviso de Indicaciones nombra el grupo y dice «llegó incompleto»', html.includes('Lista incompleta') && html.includes('C03') && html.includes('llegó incompleto'), html);
    const html2 = app._indicacionParcialHtml({ consulta: c2.consulta }, 300);
    ok('un grupo caído no lleva la nota «llegó incompleto»', html2.includes('C03') && !html2.includes('llegó incompleto'));
}

// ── 4. Alertas ───────────────────────────────────────────────────────────────────────────────
console.log('\n— Alertas (h7) —');
{
    const cambio = (i, tipoCambio, fecha) => ({ nregistro: String(80000 + i), nombre: `CAMBIO ${i}`, labtitular: 'LAB', fecha, tipoCambio, cambio: ['otros'] });
    const ahora = Date.now();
    const muestra = Array.from({ length: 200 }, (_, i) => cambio(i, 3, ahora - (i % 7) * DIA));
    muestra[150] = cambio(150, 1, ahora - 6 * DIA);   // alta antigua, enterrada en el medio
    muestra[180] = cambio(180, 2, ahora - 5 * DIA);   // baja
    red = () => ({ status: 200, body: { totalFilas: 12779, pagina: 1, tamanioPagina: 200, resultados: muestra } });
    const app = nuevaApp();
    await app.renderAlerts();
    const h = app.content.innerHTML;
    ok('la insignia dice el total declarado, no lo recibido', h.includes('badge-warning">12.779<'), h.slice(0, 300));
    ok('«Se muestran 50 de los 12.779 cambios»', h.includes('Se muestran 50 de los 12.779 cambios'));
    ok('dice que es una muestra y que pueden faltar altas y bajas', h.includes('es una muestra') && h.includes('pueden faltar altas y bajas'));
    const iBaja = h.indexOf('CAMBIO 180'), iAlta = h.indexOf('CAMBIO 150'), iMod = h.indexOf('CAMBIO 0<');
    ok('la baja y el alta recibidas van primero', iBaja > -1 && iAlta > iBaja && (iMod === -1 || iMod > iAlta), `${iBaja} ${iAlta} ${iMod}`);

    const pocos = Array.from({ length: 30 }, (_, i) => cambio(i, 3, ahora));
    red = () => ({ status: 200, body: { totalFilas: 30, resultados: pocos } });
    const app2 = nuevaApp();
    await app2.renderAlerts();
    const h2 = app2.content.innerHTML;
    ok('lista entera (30 de 30): sin «Se muestran», texto de siempre', !h2.includes('Se muestran') && h2.includes('en los últimos 7 días') && h2.includes('badge-warning">30<'));

    red = () => ({ status: 200, body: { totalFilas: 12779, resultados: [] } });
    const app3 = nuevaApp();
    await app3.renderAlerts();
    const h3 = app3.content.innerHTML;
    ok('vacía con 12.779 declarados: NO dice «Sin alertas», ofrece Reintentar', !h3.includes('Sin alertas recientes') && h3.includes('No se pudo leer el registro de cambios') && h3.includes('app.renderAlerts()'), h3.slice(0, 300));

    red = () => ({ status: 200, body: { totalFilas: 0, resultados: [] } });
    const app4 = nuevaApp();
    await app4.renderAlerts();
    ok('cero REAL: «Sin alertas recientes»', app4.content.innerHTML.includes('Sin alertas recientes'));
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
