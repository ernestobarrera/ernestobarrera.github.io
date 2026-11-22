#!/usr/bin/env node
/**
 * MedCheck — una búsqueda por indicación tiene UN presupuesto de peticiones y UN plazo total.
 *
 * POR QUÉ EXISTE (R5 de la revisión de Codex, 22/11/2026). La búsqueda pide a CIMA en tres niveles
 * anidados: grupos ATC (4 a la vez), verificación del ATC de lo que llega sin él (lotes de 20 por
 * grupo) y criba 4.1 (lotes de 12). Cada nivel tenía su tope y se multiplicaban: con el índice ATC
 * ausente o caducado (`loadAtcIndex` lo descarta a los 3 días), 4 × 20 = 80 peticiones a la vez. Y
 * no había plazo total: 297 fichas con CIMA colgado eran 25 tandas de 15 s. El banco anterior (§8
 * de medcheck-test-indicacion-parcial) sustituía `searchByATC` y solo medía el nivel de fuera.
 *
 * LO QUE ESTE BANCO FIJA, con el `searchByATC` y la criba REALES y la red simulada:
 *   1. el pico de peticiones simultáneas de TODA la búsqueda no pasa de
 *      `CimaAPI.INDICACION_MAX_PETICIONES`, con el índice ausente y con el índice caducado;
 *   2. agotado el plazo durante la criba, las fichas sin leer ENTRAN como no verificables por
 *      tiempo: nunca un cero;
 *   3. agotado durante los grupos, el grupo colgado consta como `timeout` y los demás llegan;
 *   4. una cancelación de quien llama se propaga (no se convierte en «sin verificar»);
 *   5. el limitador: como mucho N a la vez, y un turno cancelado en la cola no llega a pedir.
 *
 * Uso: node scripts/medcheck-test-presupuesto-indicacion.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};

const POR_GRUPO = 30;
const GRUPOS = ['A01', 'B01', 'C01', 'D01'];
const respuesta = (cuerpo, status = 200) => ({
    ok: status >= 200 && status < 300, status, statusText: String(status),
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(cuerpo),
});
const espera = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

/**
 * @param {object} o
 * @param {'ausente'|'caducado'|'fresco'} o.indice
 * @param {boolean} o.conAtcs - si /medicamentos trae ya los ATC (no hace falta verificar)
 * @param {Set<string>} o.cuelgan - tipos de petición que no responden nunca: 'ficha', o un grupo ATC
 */
function cargarAPI({ indice = 'ausente', conAtcs = false, cuelgan = new Set() } = {}) {
    const red = { enVuelo: 0, pico: 0, total: 0, fichas: 0 };
    const fetchImpl = async (url, opts = {}) => {
        const u = new URL(url, 'https://cima.test');
        if (u.pathname.endsWith('atc-index.json')) {
            if (indice === 'ausente') return respuesta({}, 404);
            const fecha = new Date(Date.now() - (indice === 'caducado' ? 10 : 0) * 86400000).toISOString().slice(0, 10);
            return respuesta({ _meta: { listprescriptiondate: fecha }, atc: {} }); // no resuelve nada
        }
        red.enVuelo += 1; red.total += 1; red.pico = Math.max(red.pico, red.enVuelo);
        try {
            if (u.pathname.endsWith('/medicamentos')) {
                const atc = u.searchParams.get('atc');
                if (cuelgan.has(atc)) await espera(1e9, opts.signal);
                await espera(5, opts.signal);
                const resultados = Array.from({ length: POR_GRUPO }, (_, i) => ({
                    nregistro: `${atc}-${i}`, nombre: `MED ${atc}-${i}`,
                    ...(conAtcs ? { atcs: [{ codigo: `${atc}AA01`, nivel: 5 }] } : {}),
                }));
                return respuesta({ totalFilas: POR_GRUPO, pagina: 1, tamanioPagina: 200, resultados });
            }
            if (u.pathname.endsWith('/medicamento')) {
                const n = u.searchParams.get('nregistro');
                await espera(15, opts.signal);
                return respuesta({ nregistro: n, atcs: [{ codigo: `${n.split('-')[0]}AA01`, nivel: 5 }] });
            }
            if (u.pathname.includes('/docSegmentado/contenido/')) {
                red.fichas += 1;
                if (cuelgan.has('ficha')) await espera(1e9, opts.signal);
                await espera(15, opts.signal);
                return respuesta([{ seccion: '4.1', contenido: '<p>Tratamiento de la indicación de prueba.</p>' }]);
            }
            return respuesta({}, 404);
        } finally {
            red.enVuelo -= 1;
        }
    };
    const sandbox = {
        window: {}, console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: fetchImpl, setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
        AbortSignal, AbortController, navigator: { onLine: true }, location: { search: '', href: '' },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${apiSrc}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    const CimaAPI = sandbox.window.__CimaAPI;
    return { api: new CimaAPI(), CimaAPI, red };
}

const MATCH = { term: 'prueba', label: 'prueba', atc: GRUPOS, section41Filter: { section: '4.1', includeAny: ['indicacion de prueba'] } };

// --- 1. Pico de peticiones con el índice no utilizable -----------------------------------------
console.log('— 1. El pico de TODA la búsqueda no pasa del presupuesto —');
for (const indice of ['ausente', 'caducado']) {
    const { api, CimaAPI, red } = cargarAPI({ indice });
    const r = await api._executeIndicationSearch(MATCH, { comercializados: true });
    const max = CimaAPI.INDICACION_MAX_PETICIONES;
    ok(`índice ${indice}: se verificó en vivo (hubo peticiones de detalle)`, red.total > GRUPOS.length * (POR_GRUPO + 1), `total ${red.total}`);
    ok(`índice ${indice}: pico ${red.pico} ≤ ${max} (antes, 4 grupos × 20 = 80)`, red.pico <= max, `pico ${red.pico}`);
    ok(`índice ${indice}: el resultado no cambia (los ${GRUPOS.length * POR_GRUPO}, confirmados)`, r.resultados.length === GRUPOS.length * POR_GRUPO && r.matchedIndication.filterSummary.confirmed === GRUPOS.length * POR_GRUPO, JSON.stringify(r.matchedIndication.filterSummary));
}

// --- 2. Plazo agotado en la criba: no verificables, nunca cero ---------------------------------
console.log('— 2. Plazo agotado leyendo fichas: entran sin verificar —');
{
    const { api, CimaAPI } = cargarAPI({ indice: 'fresco', conAtcs: true, cuelgan: new Set(['ficha']) });
    CimaAPI.INDICACION_PRESUPUESTO_MS = 300;
    const t0 = Date.now();
    const r = await api._executeIndicationSearch(MATCH, { comercializados: true });
    const ms = Date.now() - t0;
    const fs = r.matchedIndication.filterSummary;
    ok(`termina al agotar el plazo (${ms} ms), no espera a CIMA`, ms < 3000, `${ms} ms`);
    ok('las fichas sin leer ENTRAN: no es una lista vacía', r.resultados.length === GRUPOS.length * POR_GRUPO, `${r.resultados.length}`);
    ok('cuentan como no verificables por tiempo, ninguna como confirmada', fs.errors === fs.candidates && fs.porTiempo === fs.candidates && fs.confirmed === 0, JSON.stringify(fs));
    ok('cada una lleva el motivo «tiempo»', r.resultados.every(m => m._sectionUnverified && m._sectionMotivo === 'tiempo'));
}

// --- 3. Plazo agotado en los grupos: el colgado consta como timeout ----------------------------
console.log('— 3. Plazo agotado en un grupo: consta como «timeout» y los demás llegan —');
{
    const { api, CimaAPI } = cargarAPI({ indice: 'fresco', conAtcs: true, cuelgan: new Set(['B01']) });
    CimaAPI.INDICACION_PRESUPUESTO_MS = 300;
    const t0 = Date.now();
    const r = await api._executeIndicationSearch({ ...MATCH, section41Filter: undefined }, { comercializados: true });
    const ms = Date.now() - t0;
    ok(`termina al agotar el plazo (${ms} ms)`, ms < 3000, `${ms} ms`);
    ok('el grupo colgado consta como fallido por timeout', JSON.stringify(r.consulta.fallidos) === '[{"atc":"B01","motivo":"timeout"}]', JSON.stringify(r.consulta.fallidos));
    ok('los otros tres grupos sí están', r.resultados.length === 3 * POR_GRUPO && r.consulta.completos.length === 3, `${r.resultados.length}`);
}

// --- 4. La cancelación de quien llama se propaga --------------------------------------------------
console.log('— 4. Cancelar no es «sin verificar» —');
{
    const { api, red } = cargarAPI({ indice: 'fresco', conAtcs: true, cuelgan: new Set(['ficha']) });
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 100);
    let error = null;
    try { await api._executeIndicationSearch(MATCH, { comercializados: true, signal: ctrl.signal }); } catch (e) { error = e; }
    ok('la búsqueda se rechaza con AbortError', error?.name === 'AbortError', String(error?.name));
    const pedidas = red.fichas;
    await espera(50);
    ok('y no sigue pidiendo fichas después', red.fichas === pedidas, `${pedidas} → ${red.fichas}`);
}

// --- 5. El limitador ---------------------------------------------------------------------------
console.log('— 5. El limitador —');
{
    const { CimaAPI } = cargarAPI();
    const lim = CimaAPI.crearLimitador(2);
    let enVuelo = 0; let pico = 0;
    const tarea = async () => { await lim.adquirir(); enVuelo++; pico = Math.max(pico, enVuelo); await espera(10); enVuelo--; lim.soltar(); };
    await Promise.all(Array.from({ length: 6 }, tarea));
    ok('como mucho 2 a la vez', pico === 2, `pico ${pico}`);
    ok('al acabar no queda nadie dentro ni esperando', lim.activos === 0 && lim.enCola === 0, `${lim.activos}/${lim.enCola}`);
    await lim.adquirir(); await lim.adquirir();
    const ctrl = new AbortController();
    const turno = lim.adquirir(ctrl.signal).then(() => 'entró', (e) => e?.name || 'rechazado');
    ctrl.abort();
    ok('un turno cancelado en la cola sale sin entrar', (await turno) === 'AbortError');
    lim.soltar(); lim.soltar();
    ok('y no se queda con un hueco', lim.activos === 0 && lim.enCola === 0, `${lim.activos}/${lim.enCola}`);
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — presupuesto común y plazo total.');
process.exit(fallos ? 1 : 0);
