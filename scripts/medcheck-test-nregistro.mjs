#!/usr/bin/env node
/**
 * MedCheck — test de la búsqueda por número: código nacional (CN) o número de registro.
 *
 * EL FALLO, visto por Codex en producción el 03/10/2026: buscar «67605» daba «Sin resultados».
 * Es el nregistro de ALFUZOSINA STADA 10 mg. El buscador solo reconocía como identificador un
 * número de 6-7 dígitos (CN); el resto iba a nombre/principio activo, donde CIMA no lo encuentra.
 *
 * LO QUE ESTE TEST PROTEGE:
 *   1. un número que no tiene forma de CN se busca como nregistro (exacto) y, si no lo es, sigue
 *      por texto como antes;
 *   2. un número de 6-7 dígitos se busca como CN Y como nregistro, y se unen con el CN delante.
 *      Hay 62 nregistros con forma de CN (1191360 es WAYLIVRA); si un número llega a ser las dos
 *      cosas, salen los dos medicamentos, no se esconde uno;
 *   3. la analítica no se duplica: la petición por nregistro va siempre marcada como secundaria;
 *   4. el reintento sin «Comercializado» pregunta lo mismo que la búsqueda (antes un CN se
 *      reintentaba como texto);
 *   5. un 204 de CIMA no se pinta como error en consola ni marca la API como caída, y un fallo
 *      de verdad sí.
 *
 * Uso: node scripts/medcheck-test-nregistro.mjs
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

const json = (cuerpo) => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: () => Promise.resolve(JSON.stringify(cuerpo)),
});
const vacio204 = () => ({ ok: true, status: 204, headers: { get: () => null }, text: () => Promise.resolve('') });
const listado = (...meds) => json({ totalFilas: meds.length, pagina: 1, resultados: meds });

/**
 * CimaAPI real con la red simulada. `responder(params)` recibe los parámetros de la petición y
 * devuelve la respuesta; se registran todas, con si iban marcadas como secundarias.
 */
function montarAPI(responder) {
    const peticiones = [];
    const errores = [];
    const sandbox = {
        window: {}, document: { addEventListener() {} },
        console: { log() {}, warn() {}, info() {}, debug() {}, error: (...a) => errores.push(a.join(' ')) },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Number, Array, Object, String, Error,
        navigator: { onLine: true }, location: { search: '', href: '' },
        AbortSignal: { timeout: () => undefined },
        fetch: (url, opts = {}) => {
            const u = new URL(String(url));
            if (!u.pathname.endsWith('/medicamentos') && !u.pathname.endsWith('/medicamento')) {
                return Promise.reject(new Error(`petición no prevista: ${u}`));
            }
            const params = Object.fromEntries(u.searchParams);
            params._ruta = u.pathname.split('/').pop();
            peticiones.push({ params, secundaria: opts.headers?.['X-MC-Autocomplete'] === '1' });
            return Promise.resolve(responder(params));
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${apiSrc}\n;window.__API = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    const api = new sandbox.window.__API();
    return { api, peticiones, errores };
}

const ALFUZOSINA = { nregistro: '67605', nombre: 'ALFUZOSINA STADA 10 mg COMPRIMIDOS DE LIBERACION PROLONGADA EFG' };
const WAYLIVRA = { nregistro: '1191360', nombre: 'WAYLIVRA 285 MG SOLUCION INYECTABLE' };
const POR_CN = { nregistro: '70000', nombre: 'MEDICAMENTO CON ESE CN' };

// ── 1. El caso de Codex: 5 dígitos, nregistro ────────────────────────────────────────────────
{
    const { api, peticiones } = montarAPI(p => (p.nregistro === '67605' ? listado(ALFUZOSINA) : listado()));
    const r = await api.searchByNumber('67605', { comerc: 1 });
    ok('«67605» encuentra ALFUZOSINA STADA por nregistro', r?.resultados?.[0]?.nregistro === '67605', JSON.stringify(r));
    ok('«67605» no se pregunta como CN', !peticiones.some(p => 'cn' in p.params));
    ok('la petición por nregistro va marcada como secundaria (sin analítica)',
        peticiones.every(p => p.secundaria), JSON.stringify(peticiones));
    ok('se respeta el filtro «Comercializado»', peticiones[0]?.params.comerc === '1');
}

// ── 2. Número sin forma de CN que no es registro: decide quien llama (texto, como antes) ─────
{
    const { api } = montarAPI(() => listado());
    ok('«1000» sin registro devuelve null para seguir por texto', (await api.searchByNumber('1000', {})) === null);
}

// ── 3. Texto: ni una petición ────────────────────────────────────────────────────────────────
{
    const { api, peticiones } = montarAPI(() => listado());
    ok('una consulta de texto no es un número', (await api.searchByNumber('alfuzosina', {})) === null);
    ok('…y no dispara peticiones', peticiones.length === 0);
}

// ── 4. 6-7 dígitos: CN y nregistro a la vez ──────────────────────────────────────────────────
{
    const { api, peticiones } = montarAPI(p => (p.nregistro === '1191360' ? listado(WAYLIVRA) : listado()));
    const r = await api.searchByNumber('1191360', {});
    ok('un nregistro con forma de CN (WAYLIVRA, 1191360) se encuentra', r?.resultados?.[0]?.nregistro === '1191360');
    const cn = peticiones.find(p => 'cn' in p.params);
    const nr = peticiones.find(p => 'nregistro' in p.params);
    ok('se pregunta como CN y como nregistro', cn && nr);
    ok('la del CN cuenta en analítica y la del nregistro no', cn && !cn.secundaria && nr?.secundaria);
}
{
    const { api } = montarAPI(p => (p.cn === '712729' ? listado(POR_CN) : listado()));
    const r = await api.searchByNumber('712729', { comerc: 1 });
    ok('un CN normal sigue encontrándose igual', r?.resultados?.length === 1 && r.resultados[0].nregistro === '70000');
}
{
    // La colisión que hoy no existe pero puede existir: CN de un medicamento, nregistro de otro.
    const { api } = montarAPI(p => (p.cn ? listado(POR_CN) : listado(WAYLIVRA)));
    const r = await api.searchByNumber('1191360', {});
    const ids = (r?.resultados || []).map(m => m.nregistro);
    ok('si un número es las dos cosas salen los dos, CN primero',
        ids.join(',') === '70000,1191360', ids.join(','));
    ok('totalFilas cuenta la unión', r?.totalFilas === 2);
}
{
    const { api } = montarAPI(() => listado(POR_CN));
    const r = await api.searchByNumber('1191360', {});
    ok('el mismo registro por las dos vías sale una vez', r?.resultados?.length === 1);
}

// ── 5. Fallos ────────────────────────────────────────────────────────────────────────────────
{
    const { api } = montarAPI(p => (p.cn ? { ok: false, status: 500, statusText: 'Error' } : listado()));
    let lanzado = false;
    try { await api.searchByNumber('712729', {}); } catch { lanzado = true; }
    ok('si falla el CN, el error sube como antes', lanzado);
}
{
    const { api } = montarAPI(p => (p.nregistro ? { ok: false, status: 500, statusText: 'Error' } : listado(POR_CN)));
    const r = await api.searchByNumber('712729', {});
    ok('si falla solo el nregistro, el CN sale igual', r?.resultados?.[0]?.nregistro === '70000');
}

// ── 6. Un 204 no es un error ─────────────────────────────────────────────────────────────────
{
    const { api, errores } = montarAPI(() => vacio204());
    let codigo = null;
    try { await api.getMedicamento('99999'); } catch (e) { codigo = e.code; }
    ok('un 204 sigue llegando al llamador como NO_CONTENT', codigo === 'NO_CONTENT');
    ok('un 204 no se pinta como error en consola', errores.length === 0, errores.join(' | '));
    ok('un 204 no marca la API como caída', api.isOnline === true);
}
{
    const { api, errores } = montarAPI(() => ({ ok: false, status: 500, statusText: 'Error' }));
    try { await api.getMedicamento('67605'); } catch { /* esperado */ }
    ok('un fallo real sí se registra como error', errores.length === 1);
}

// ── 7. El buscador: búsqueda y reintento por el mismo despacho ──────────────────────────────
{
    const sandbox = {
        window: {}, document: { addEventListener() {}, getElementById: () => null },
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: () => Promise.reject(new Error('sin red en tests')),
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
        navigator: { onLine: true }, location: { search: '', href: '' },
        CimaAPI: { ATC_CATEGORIES: [] },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${appSrc}\n;window.__App = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
    const proto = sandbox.window.__App.prototype;

    const llamadas = [];
    const app = Object.create(proto);
    app.api = {
        searchByNumber: async (q, filters, opts) => {
            llamadas.push({ via: 'numero', q, secundaria: opts?.headers?.['X-MC-Autocomplete'] === '1' });
            return q === '67605' ? { resultados: [ALFUZOSINA], totalFilas: 1 } : null;
        },
    };
    app._performSmartSearch = async (q, filters, { trackPrimary } = {}) => {
        llamadas.push({ via: 'texto', q, trackPrimary });
        return { resultados: [], totalFilas: 0 };
    };

    const r = await app._buscarConsulta('67605', { comerc: 1 });
    ok('el buscador encuentra «67605» sin pasar por texto',
        r.resultados[0]?.nregistro === '67605' && !llamadas.some(l => l.via === 'texto'));

    llamadas.length = 0;
    await app._buscarConsulta('tamsulosina', { comerc: 1 });
    ok('el texto sigue yendo a la búsqueda combinada', llamadas.some(l => l.via === 'texto' && l.trackPrimary === true));

    llamadas.length = 0;
    await app._buscarConsulta('712729', {}, { trackPrimary: false });
    ok('el reintento marca la búsqueda por número como secundaria', llamadas[0]?.via === 'numero' && llamadas[0].secundaria);

    // `performSearch` no se ejecuta aquí (DOM completo); se fija que ninguna de sus dos
    // búsquedas salte el despacho, que es justo como el CN acababa reintentándose como texto.
    const cuerpo = proto.performSearch.toString();
    ok('performSearch no llama a la búsqueda de texto por su cuenta', !cuerpo.includes('_performSmartSearch('));
    ok('performSearch usa el despacho en la búsqueda y en el reintento',
        (cuerpo.match(/_buscarConsulta\(/g) || []).length === 2);

    llamadas.length = 0;
    app._performSmartSearch = async () => { llamadas.push({ via: 'texto' }); return { resultados: [] }; };
    const picker = await app._smartFindMeds('67605');
    ok('los selectores (combo, interacciones…) también encuentran por nregistro',
        picker.resultados?.[0]?.nregistro === '67605' && !llamadas.some(l => l.via === 'texto'));
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
