#!/usr/bin/env node
/**
 * MedCheck — las marcas vivas de los favoritos (suministro, alertas, materiales) no se congelan.
 *
 * QUÉ PASABA (revisión de Fable, 11/11/2026, hallazgo 8; leído en código): `psum`, `notas` y
 * `materialesInf` se copiaban al guardar el favorito y nadie las volvía a leer. Un favorito de junio
 * que entra en desabastecimiento en octubre seguía sin insignia en Mi Perfil, la insignia atribuía el
 * dato a CIMA sin decir de cuándo era, y «Reunir materiales» consultaba solo los marcados al guardar:
 * un material publicado después no se encontraba nunca.
 *
 * LA REGLA QUE FIJA ESTE BANCO: al abrir Mi Perfil se releen las marcas que no estén al día; lo que
 * no se pudo releer se dice con su fecha, nunca como si estuviera al día; y materiales consulta
 * también los favoritos sin comprobar.
 *
 * CÓMO: la red pasa por el `_request` real de `CimaAPI` (fetch falso); `localStorage` es un mapa en
 * memoria; las pantallas se pintan con los métodos reales de `MedCheckApp` sobre un DOM mínimo.
 *
 * Uso: node scripts/medcheck-test-favoritos-estado.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Red controlable ──────────────────────────────────────────────────────────────────────────
let red = () => { throw new TypeError('Failed to fetch'); };
let peticiones = [];
const respuesta = ({ status = 200, body = '' }) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});
const fetchFalso = async (url, opts = {}) => {
    peticiones.push({ url: String(url), headers: opts.headers || {} });
    return respuesta(await red(String(url)));
};

// ── DOM y almacenamiento mínimos ─────────────────────────────────────────────────────────────
const nodos = new Map();
const nodo = (id) => {
    if (!nodos.has(id)) nodos.set(id, { id, innerHTML: '', disabled: false, value: '', dataset: {}, classList: { add() { }, remove() { }, toggle() { } } });
    return nodos.get(id);
};
const almacen = new Map();
const sandbox = {
    window: {},
    document: {
        addEventListener() { },
        getElementById: (id) => nodo(id),
        querySelector: () => null,
        querySelectorAll: () => [],
    },
    console: { log() { }, warn() { }, error() { } },
    localStorage: {
        getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
        setItem: (k, v) => almacen.set(k, String(v)),
        removeItem: (k) => almacen.delete(k),
    },
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

// ── Datos de prueba ──────────────────────────────────────────────────────────────────────────
const JUNIO = '2026-06-10T09:00:00.000Z';
const fav = (nregistro, nombre, marcas = {}, extra = {}) => ({
    nregistro, nombre, principioActivo: nombre.split(' ')[0], atcNivel1: 'C', cns: ['600000'],
    psum: false, notas: false, materialesInf: false, addedAt: JUNIO, tags: ['mía'], viewCount: 3,
    ...marcas, ...extra,
});
/** CIMA de hoy: `detalles[nregistro]` → objeto, `'CORTE'` sin red, `'204'` no expuesto. */
const cimaHoy = (detalles) => (url) => {
    const m = url.match(/\/medicamento\?nregistro=(\d+)/);
    const mm = url.match(/\/materiales\/(\d+)/);
    if (mm) {
        const d = detalles[`mat:${mm[1]}`];
        if (d === undefined || d === 'CORTE') throw new TypeError('Failed to fetch');
        if (d === '204') return { status: 204, body: '' };
        return { status: 200, body: d };
    }
    if (!m) throw new TypeError('Failed to fetch');
    const d = detalles[m[1]];
    if (d === undefined || d === 'CORTE') throw new TypeError('Failed to fetch');
    if (d === '204') return { status: 204, body: '' };
    return { status: 200, body: { nregistro: m[1], nombre: `MED ${m[1]}`, ...d } };
};
const nuevaApp = (favs) => {
    almacen.clear(); nodos.clear(); peticiones = [];
    const api = new CimaAPI(); api.useProxy = false;
    const app = Object.create(MedCheckApp.prototype);
    app.api = api;
    app.FAVORITES_KEY = 'medcheck_favorites_v1';
    app.currentView = 'profile';
    app._profileSection = 'favorites';
    app.showToast = () => { };
    app._saveFavorites(favs);
    // El repintado completo de la sección necesita ATC, EML y otras piezas: aquí basta saber que se pidió.
    app._repintes = 0;
    app._refreshFavoritesSection = function () { this._repintes++; };
    return app;
};
const marcasDe = (app, nreg) => {
    const f = app.getFavorites().find(x => x.nregistro === nreg);
    return f && { psum: f.psum, notas: f.notas, materialesInf: f.materialesInf, estadoAt: f.estadoAt, tags: f.tags, viewCount: f.viewCount };
};
const esperarRonda = async (app) => {
    // La ronda y su repintado posterior: dos vueltas de microtareas bastan, pero se espera a la promesa.
    if (app._favEstadoEnCurso) { try { await app._favEstadoEnCurso; } catch (_) { } }
    await new Promise(r => setTimeout(r, 0));
};

// ── 1. El alta guarda la fecha de lectura solo si el origen trae las tres marcas ─────────────
console.log('\n— Alta de un favorito —');
{
    const app = nuevaApp([]);
    const con = app._buildFavoriteRecord({ nregistro: '1', nombre: 'A', psum: true, notas: false, materialesInf: false });
    ok('con las tres marcas en el origen: `estadoAt` es de ahora', Number.isFinite(Date.parse(con.estadoAt)) && Date.now() - Date.parse(con.estadoAt) < 5000, con.estadoAt);
    const sin = app._buildFavoriteRecord({ nregistro: '2', nombre: 'B', psum: true });
    ok('sin alguna marca en el origen: `estadoAt` null (no se finge al día)', sin.estadoAt === null, String(sin.estadoAt));
    ok('un registro sin `estadoAt` no está vigente', !app._favEstadoVigente(sin));
    ok('la fecha de un registro antiguo es la del alta', app._favEstadoFecha({ addedAt: JUNIO }) === JUNIO);
}

// ── 2. Refresco con red: las marcas cambian en los dos sentidos y se conserva lo del usuario ──
console.log('\n— Refresco al abrir Mi Perfil, con red —');
{
    const app = nuevaApp([
        fav('100', 'ATORVASTATINA 40', {}),                      // entra en desabastecimiento
        fav('200', 'RAMIPRIL 5', { psum: true }),                // se resolvió
        fav('300', 'METFORMINA 850', {}),                        // publica un material
    ]);
    red = cimaHoy({ '100': { psum: true, notas: false, materialesInf: false }, '200': { psum: false, notas: false, materialesInf: false }, '300': { psum: false, notas: true, materialesInf: true } });
    const res = await app._refrescarEstadoFavoritos();
    await esperarRonda(app);
    ok('comprobados 3, cambiados 3, sin fallidos', res.comprobados === 3 && res.cambiados === 3 && res.fallidos.length === 0, JSON.stringify(res));
    ok('ATORVASTATINA gana la insignia de suministro', marcasDe(app, '100').psum === true);
    ok('RAMIPRIL la pierde', marcasDe(app, '200').psum === false);
    ok('METFORMINA gana alertas y materiales', marcasDe(app, '300').notas === true && marcasDe(app, '300').materialesInf === true);
    ok('etiquetas y vistas del usuario intactas', marcasDe(app, '100').tags?.[0] === 'mía' && marcasDe(app, '100').viewCount === 3);
    ok('todos quedan vigentes', app.getFavorites().every(f => app._favEstadoVigente(f)));
    const medPeticiones = peticiones.filter(p => /\/medicamento\?/.test(p.url));
    ok('las peticiones son secundarias (X-MC-Autocomplete: sin analítica)', medPeticiones.length === 3 && medPeticiones.every(p => p.headers['X-MC-Autocomplete'] === '1'), JSON.stringify(medPeticiones.map(p => p.headers)));
    ok('con cambios, se repinta la sección', app._repintes === 1, String(app._repintes));
    ok('al día: sin aviso', app._favEstadoAvisoHtml(app.getFavorites()) === '');

    peticiones = [];
    const res2 = await app._refrescarEstadoFavoritos();
    ok('reabrir enseguida no vuelve a pedir nada', res2.comprobados === 0 && peticiones.length === 0, JSON.stringify(res2));
    const res3 = await app._refrescarEstadoFavoritos({ forzar: true });
    ok('forzar sí vuelve a pedir, y sin cambios no cuenta cambiados', res3.comprobados === 3 && res3.cambiados === 0, JSON.stringify(res3));
}

// ── 3. Red cortada: nada se da por comprobado y el aviso dice la fecha ───────────────────────
console.log('\n— Refresco con la red cortada —');
{
    const app = nuevaApp([fav('100', 'ATORVASTATINA 40', { psum: true }), fav('200', 'RAMIPRIL 5', {})]);
    red = () => { throw new TypeError('Failed to fetch'); };
    const res = await app._refrescarEstadoFavoritos();
    await esperarRonda(app);
    ok('dos fallidos con motivo «fallo», ninguno comprobado', res.comprobados === 0 && res.fallidos.length === 2 && res.fallidos.every(x => x.motivo === 'fallo'), JSON.stringify(res));
    ok('las marcas guardadas no se tocan ni se fechan', marcasDe(app, '100').psum === true && marcasDe(app, '100').estadoAt === undefined);
    const aviso = app._favEstadoAvisoHtml(app.getFavorites());
    ok('el aviso dice que no se pudo comprobar ninguno', aviso.includes('No se pudo comprobar ningún favorito'), aviso);
    ok('el aviso da la fecha de las insignias (junio)', /a fecha de <strong>10 jun/.test(aviso), aviso);
    ok('el aviso nombra los dos y ofrece Reintentar', aviso.includes('ATORVASTATINA 40') && aviso.includes('RAMIPRIL 5') && aviso.includes('_reintentarEstadoFavoritos'));
    ok('el aviso se pinta en #fav-estado aunque no haya cambios', nodo('fav-estado').innerHTML.includes('No se pudo comprobar'), nodo('fav-estado').innerHTML.slice(0, 120));
    const ins = app._favEstadoInsignia(app.getFavorites().find(f => f.nregistro === '100'));
    ok('la insignia, sin comprobar, lleva la fecha a la vista («· a 10 jun»)', /^ · a 10 jun/.test(ins.sufijo), JSON.stringify(ins));
    ok('y en el título, «comprobado el …»', /comprobado el 10 jun/.test(ins.titulo), ins.titulo);

    red = cimaHoy({ '100': { psum: false, notas: false, materialesInf: false }, '200': { psum: false, notas: false, materialesInf: false } });
    await app._reintentarEstadoFavoritos();
    await esperarRonda(app);
    ok('Reintentar con red: quedan al día y el aviso desaparece', app.getFavorites().every(f => app._favEstadoVigente(f)) && app._favEstadoAvisoHtml(app.getFavorites()) === '');
    const ins2 = app._favEstadoInsignia(app.getFavorites()[0]);
    ok('al día: la insignia no lleva sufijo de fecha', ins2.sufijo === '' && /comprobado el/.test(ins2.titulo), JSON.stringify(ins2));
}

// ── 4. Parcial y 204 ─────────────────────────────────────────────────────────────────────────
console.log('\n— Parcial y medicamento que CIMA ya no expone —');
{
    const app = nuevaApp([fav('100', 'ATORVASTATINA 40'), fav('200', 'RAMIPRIL 5'), fav('300', 'ANTIGUO RETIRADO')]);
    red = cimaHoy({ '100': { psum: true, notas: false, materialesInf: false }, '200': 'CORTE', '300': '204' });
    const res = await app._refrescarEstadoFavoritos();
    await esperarRonda(app);
    ok('1 comprobado, 2 fallidos', res.comprobados === 1 && res.fallidos.length === 2, JSON.stringify(res));
    ok('el 204 va con motivo «no_expuesto»', res.fallidos.find(x => x.nregistro === '300')?.motivo === 'no_expuesto');
    const aviso = app._favEstadoAvisoHtml(app.getFavorites());
    ok('«No se pudieron comprobar 2 de 3 favoritos»', aviso.includes('2 de 3'), aviso);
    ok('el retirado se rotula «CIMA ya no lo expone»', aviso.includes('ANTIGUO RETIRADO</strong> (CIMA ya no lo expone)'));
    ok('el comprobado no aparece en el aviso', !aviso.includes('ATORVASTATINA'));
    ok('con un fallo de red sigue habiendo Reintentar', aviso.includes('_reintentarEstadoFavoritos'));

    const app2 = nuevaApp([fav('300', 'ANTIGUO RETIRADO')]);
    red = cimaHoy({ '300': '204' });
    await app2._refrescarEstadoFavoritos();
    await esperarRonda(app2);
    const aviso2 = app2._favEstadoAvisoHtml(app2.getFavorites());
    ok('solo 204: aviso con fecha pero sin Reintentar (no cambiaría nada)', aviso2.includes('a fecha de') && !aviso2.includes('_reintentarEstadoFavoritos'), aviso2);
}

// ── 5. Una sola ronda en vuelo; lo añadido entretanto no se pierde ───────────────────────────
console.log('\n— Concurrencia —');
{
    const app = nuevaApp(Array.from({ length: 10 }, (_, i) => fav(String(500 + i), `MED ${i}`)));
    let enVuelo = 0, maxEnVuelo = 0;
    red = async (url) => {
        enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
        await new Promise(r => setTimeout(r, 5));
        enVuelo--;
        return cimaHoy(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(500 + i), { psum: i === 0, notas: false, materialesInf: false }])))(url);
    };
    const p1 = app._refrescarEstadoFavoritos();
    const p2 = app._refrescarEstadoFavoritos();
    ok('una segunda llamada recibe la misma ronda', p1 === p2);
    // Mientras la ronda está en vuelo, el usuario añade un favorito.
    const favs = app.getFavorites(); favs.unshift(fav('999', 'NUEVO', {}, { addedAt: new Date().toISOString(), estadoAt: new Date().toISOString() })); app._saveFavorites(favs);
    ok('mientras tanto el aviso dice «Comprobando…»', app._favEstadoAvisoHtml(app.getFavorites()).includes('Comprobando en CIMA'));
    const res = await p1;
    await esperarRonda(app);
    ok('nunca más de 4 peticiones a la vez', maxEnVuelo <= 4 && maxEnVuelo > 1, String(maxEnVuelo));
    ok('el favorito añadido durante la ronda sigue ahí', app.getFavorites().some(f => f.nregistro === '999') && app.getFavorites().length === 11);
    ok('10 comprobados, 1 cambiado', res.comprobados === 10 && res.cambiados === 1, JSON.stringify(res));
}

// ── 6. Fuera de Mi Perfil no se repinta nada ─────────────────────────────────────────────────
console.log('\n— Vista cambiada antes de terminar —');
{
    const app = nuevaApp([fav('100', 'ATORVASTATINA 40')]);
    red = cimaHoy({ '100': { psum: true, notas: false, materialesInf: false } });
    const p = app._refrescarEstadoFavoritos();
    app.currentView = 'search';
    await p; await esperarRonda(app);
    ok('se guarda el dato nuevo', marcasDe(app, '100').psum === true);
    ok('pero no se repinta Mi Perfil', app._repintes === 0);
}

// ── 7. Reunir materiales consulta también los no comprobados ────────────────────────────────
console.log('\n— Reunir materiales de mi colección —');
{
    const hoy = new Date().toISOString();
    const app = nuevaApp([
        fav('100', 'MARCADO', { materialesInf: true }, { estadoAt: hoy }),
        fav('200', 'SIN MARCA AL DIA', {}, { estadoAt: hoy }),
        fav('300', 'SIN MARCA ANTIGUO', {}),
    ]);
    red = cimaHoy({
        'mat:100': { listaDocsProfesional: [{ url: 'https://x/a.pdf', nombre: 'Guía' }] },
        'mat:300': { listaDocsProfesional: [{ url: 'https://x/b.pdf', nombre: 'Guía nueva' }] },
        'mat:200': '204',
    });
    app._renderRxBySpecialty = (items, sel, block) => items.map(block).join('');
    app.renderMaterialCard = (m) => `<a>${m.nombre}</a>`;
    await app._loadCollectionMaterials();
    const pedidos = peticiones.filter(p => /\/materiales\//.test(p.url)).map(p => p.url.match(/\/materiales\/(\d+)/)[1]).sort();
    ok('consulta el marcado y el antiguo, no el sin marca al día', JSON.stringify(pedidos) === '["100","300"]', JSON.stringify(pedidos));
    ok('el material publicado después de guardar se encuentra', nodo('materials-result').innerHTML.includes('SIN MARCA ANTIGUO'), nodo('materials-result').innerHTML.slice(0, 200));
}

console.log(fallos === 0 ? '\nTodo en verde.' : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
