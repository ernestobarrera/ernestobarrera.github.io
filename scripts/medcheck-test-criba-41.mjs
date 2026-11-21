#!/usr/bin/env node
/**
 * MedCheck — la criba por la sección 4.1 no tira lo que no ha podido leer.
 *
 * POR QUÉ EXISTE. Hasta el 21/11/2026, `_filterIndicationResultsBySection` trataba igual «leí la
 * ficha y no tiene esa indicación» que «no hay ficha que leer». CIMA no segmenta la ficha de las
 * importaciones paralelas (sufijo IP, IP1…) y responde CON ÉXITO `{"error":"No existen
 * secciones…"}`; `getDocSeccion` lo convierte en '' sin lanzar, la criba no encontraba el término y
 * quitaba la presentación sin aviso. La rama fail-open (incluir marcado como no verificado) solo
 * cubría los fallos de red. Caso real: MIRAPEXIN 0,7 MG 97051006IP fuera de «piernas inquietas»,
 * con su original 97051006 dentro. Afectaba a todas las entradas con filtro 4.1.
 *
 * LO QUE ESTE BANCO FIJA:
 *   1. una ficha con el término entra y una sin él sale (lo de siempre);
 *   2. una importación paralela se juzga por la ficha de su registro original, también con IP1;
 *   3. si no hay texto que leer (ni propio ni del original), entra como no verificada y cuenta en
 *      `errors`, que es lo que dispara el aviso de la pantalla;
 *   4. una importación cuyo original NO tiene la indicación sigue saliendo: el arreglo no abre la
 *      criba, solo deja de tirar lo que no ha mirado.
 *
 * Uso: node scripts/medcheck-test-criba-41.mjs
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

const SIN_SECCIONES = { error: 'No existen secciones para el medicamento indicado' };
const seccion41 = (texto) => [{ seccion: '4.1', titulo: 'Indicaciones terapéuticas', contenido: `<p>${texto}</p>` }];

/** `fichas[nregistro]`: cuerpo JSON de docSegmentado, o 'fallo' para un 503. */
function cargarAPI(fichas) {
    const pedidas = [];
    const fetchImpl = async (url) => {
        const u = new URL(url, 'https://cima.test');
        const nreg = u.searchParams.get('nregistro');
        if (u.pathname.includes('/docSegmentado/contenido/')) pedidas.push(nreg);
        const cuerpo = fichas[nreg];
        if (cuerpo === 'fallo') {
            return { ok: false, status: 503, statusText: 'Service Unavailable', headers: { get: () => 'text/plain' }, text: async () => 'error' };
        }
        return { ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, text: async () => JSON.stringify(cuerpo ?? SIN_SECCIONES) };
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
    const api = new CimaAPI();
    return { api, CimaAPI, pedidas };
}

const FILTRO = { section: '4.1', includeAny: ['piernas inquietas'] };
const med = (nregistro) => ({ nregistro, nombre: `MED ${nregistro}` });
const ids = (r) => r.resultados.map(m => m.nregistro).sort();

// --- 0. El marcador ------------------------------------------------------------------------------
console.log('— 0. Qué es una importación paralela —');
{
    const { CimaAPI } = cargarAPI({});
    ok('«97051006IP» → «97051006»', CimaAPI._registroOriginalDeImportacion('97051006IP') === '97051006');
    ok('«04276007IP1» → «04276007»', CimaAPI._registroOriginalDeImportacion('04276007IP1') === '04276007');
    ok('un registro normal no tiene original', CimaAPI._registroOriginalDeImportacion('97051006') === null);
    ok('vacío o nulo no rompe', CimaAPI._registroOriginalDeImportacion(null) === null && CimaAPI._registroOriginalDeImportacion('') === null);
}

// --- 1. Lo de siempre ----------------------------------------------------------------------------
console.log('— 1. Ficha leída: entra si nombra la indicación, sale si no —');
{
    const { api } = cargarAPI({
        A: seccion41('Tratamiento sintomático del síndrome de piernas inquietas idiopático.'),
        B: seccion41('Enfermedad de Parkinson idiopática.'),
    });
    const r = await api._filterIndicationResultsBySection([med('A'), med('B')], FILTRO);
    ok('entra la que tiene el término y sale la que no', JSON.stringify(ids(r)) === '["A"]', JSON.stringify(ids(r)));
    ok('las dos cuentan como leídas, sin errores', r.summary.checked === 2 && r.summary.errors === 0, JSON.stringify(r.summary));
}

// --- 2. Importación paralela: la ficha del original ---------------------------------------------
console.log('— 2. Importación paralela —');
{
    const { api, pedidas } = cargarAPI({
        '97051006': seccion41('Parkinson. Síndrome de piernas inquietas idiopático de moderado a grave.'),
        '97051006IP': SIN_SECCIONES,
        '04276007': seccion41('Síndrome de piernas inquietas.'),
        '04276007IP1': SIN_SECCIONES,
    });
    const r = await api._filterIndicationResultsBySection([med('97051006IP'), med('04276007IP1')], FILTRO);
    ok('la IP entra por la ficha de su original (el caso de MIRAPEXIN)', ids(r).includes('97051006IP'), JSON.stringify(ids(r)));
    ok('también con sufijo IP1', ids(r).includes('04276007IP1'), JSON.stringify(ids(r)));
    ok('se pidió la ficha del original', pedidas.includes('97051006') && pedidas.includes('04276007'), JSON.stringify(pedidas));
    ok('entra verificada, no como «no verificada»', r.resultados.every(m => !m._sectionUnverified) && r.summary.errors === 0, JSON.stringify(r.summary));
}
{
    const { api } = cargarAPI({ '111': seccion41('Enfermedad de Parkinson.'), '111IP': SIN_SECCIONES });
    const r = await api._filterIndicationResultsBySection([med('111IP')], FILTRO);
    ok('una IP cuyo original NO tiene la indicación sigue saliendo', r.resultados.length === 0 && r.summary.errors === 0, JSON.stringify(r.summary));
}
{
    // Si la IP tuviera ficha propia, manda la suya y no se pide la del original.
    const { api, pedidas } = cargarAPI({ '222IP': seccion41('Síndrome de piernas inquietas.'), '222': seccion41('Parkinson.') });
    const r = await api._filterIndicationResultsBySection([med('222IP')], FILTRO);
    ok('una IP con ficha propia se juzga por la suya', ids(r).includes('222IP') && !pedidas.includes('222'), JSON.stringify(pedidas));
}

// --- 3. Nada que leer: fail-open ---------------------------------------------------------------
console.log('— 3. Sin texto que leer, entra marcada y avisa —');
{
    const { api } = cargarAPI({ '333': SIN_SECCIONES, '444IP': SIN_SECCIONES, '444': SIN_SECCIONES });
    const r = await api._filterIndicationResultsBySection([med('333'), med('444IP')], FILTRO);
    ok('sin ficha segmentada (ni propia ni del original) → entra', JSON.stringify(ids(r)) === '["333","444IP"]', JSON.stringify(ids(r)));
    ok('marcadas como no verificadas', r.resultados.every(m => m._sectionUnverified === true));
    ok('cuentan en errors (dispara el aviso) y no en checked', r.summary.errors === 2 && r.summary.checked === 0, JSON.stringify(r.summary));
    ok('matched cuadra con lo devuelto', r.summary.matched === 2, JSON.stringify(r.summary));
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — la criba 4.1 solo quita lo que ha leído.');
process.exit(fallos ? 1 : 0);
