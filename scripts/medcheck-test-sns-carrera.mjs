#!/usr/bin/env node
/**
 * MedCheck — en el Nomenclátor SNS, una respuesta lenta no pisa a la búsqueda siguiente.
 *
 * QUÉ PASABA (revisión de Fable, 11/11/2026, hallazgo 13; leído en código): había espera de 300 ms
 * entre teclas, pero nada comprobaba que la respuesta que llegaba fuera la de la última consulta. Se
 * teclea «ator», el Worker tarda (arranque en frío), se sigue hasta «atorvastatina 40» y esa
 * respuesta llega antes; después llega la de «ator» y sustituye la lista: el campo dice una cosa y
 * los resultados y el recuento son de otra.
 *
 * LA REGLA QUE FIJA ESTE BANCO: solo pinta la última consulta lanzada, también cuando la vieja
 * termina en error.
 *
 * CÓMO: `renderSnsCatalog` real sobre un DOM mínimo y un `fetch` falso con retardos controlados.
 *
 * Uso: node scripts/medcheck-test-sns-carrera.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

// ── Red: `plan[q]` = { ms, items } o { ms, error } ──────────────────────────────────────────
let plan = {};
const fetchFalso = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/sns-catalog/meta')) {
        return { ok: true, status: 200, json: async () => ({ total_products: 10, by_estado: { ALTA: 10 }, by_tipo: { EFECTO: 10 } }) };
    }
    const q = u.searchParams.get('q') || '';
    const p = plan[q] || { ms: 0, items: [] };
    await dormir(p.ms);
    if (p.error) return { ok: false, status: p.error, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ results: p.items, total: p.items.length }) };
};

// ── DOM mínimo ───────────────────────────────────────────────────────────────────────────────
const el = (extra = {}) => ({
    innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {},
    _h: {}, addEventListener(t, f) { this._h[t] = f; }, appendChild(c) { this.innerHTML += c.innerHTML; },
    querySelectorAll: () => [], classList: { add() { }, remove() { } }, ...extra,
});
let dom;
const sandbox = {
    window: {},
    document: { addEventListener() { }, getElementById: () => null, createElement: () => el(), querySelector: () => null, querySelectorAll: () => [] },
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
const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function') { console.error('No se pudo cargar MedCheckApp'); process.exit(1); }

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok     ${nombre}`); return; }
    fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`);
};

const item = (producto) => ({ producto, cn: '600001', estado: 'ALTA', tipo_farmaco: 'EFECTO', laboratorio: 'LAB', nombre_generico: '', aportacion: 'TSI', fecha_alta: '' });
const nuevaVista = async () => {
    dom = {
        '#sns-search': el(), '#sns-include-baja': el(), '#sns-tipo-filters': el(),
        '#sns-count-bar': el(), '#sns-list-container': el(), '#sns-stats-slot': el(),
    };
    const app = Object.create(MedCheckApp.prototype);
    app.api = { cloudflareProxy: 'https://worker.test' };
    app.content = { innerHTML: '', querySelector: (sel) => dom[sel] || null };
    plan = { '': { ms: 0, items: [] } };
    await app.renderSnsCatalog();
    await dormir(350); // la búsqueda inicial
    return app;
};
const teclear = (texto) => { dom['#sns-search'].value = texto; dom['#sns-search']._h.input(); };

console.log('\n— Respuesta vieja más lenta que la nueva —');
{
    await nuevaVista();
    plan['ator'] = { ms: 400, items: [item('ATORVASTATINA 10 MG'), item('ATORVASTATINA 20 MG'), item('ATORVASTATINA 80 MG')] };
    plan['atorvastatina 40'] = { ms: 10, items: [item('ATORVASTATINA 40 MG')] };
    teclear('ator');
    await dormir(320);                // sale la consulta de «ator»
    teclear('atorvastatina 40');
    await dormir(320 + 30);           // sale y vuelve la de «atorvastatina 40»
    const lista = dom['#sns-list-container'].innerHTML;
    ok('la consulta nueva se pinta', lista.includes('ATORVASTATINA 40 MG'), lista.slice(0, 160));
    await dormir(450);                // vuelve la de «ator»
    const final = dom['#sns-list-container'].innerHTML;
    ok('la vieja, al llegar tarde, no sustituye la lista', final.includes('ATORVASTATINA 40 MG') && !final.includes('ATORVASTATINA 10 MG'), final.slice(0, 160));
    ok('el recuento sigue siendo el de la consulta nueva', /Mostrando 1 productos/.test(dom['#sns-count-bar'].textContent), dom['#sns-count-bar'].textContent);
}

console.log('\n— La vieja termina en error —');
{
    await nuevaVista();
    plan['ibu'] = { ms: 400, error: 503 };
    plan['ibuprofeno'] = { ms: 10, items: [item('IBUPROFENO 600 MG')] };
    teclear('ibu');
    await dormir(320);
    teclear('ibuprofeno');
    await dormir(320 + 30 + 450);
    const final = dom['#sns-list-container'].innerHTML;
    ok('el error tardío de la vieja no tapa los resultados', final.includes('IBUPROFENO 600 MG') && !final.includes('Error al buscar'), final.slice(0, 160));
}

console.log('\n— Sin carrera, todo igual que antes —');
{
    await nuevaVista();
    plan['omeprazol'] = { ms: 10, items: [item('OMEPRAZOL 20 MG'), item('OMEPRAZOL 40 MG')] };
    teclear('omeprazol');
    await dormir(360);
    ok('una sola consulta se pinta', dom['#sns-list-container'].innerHTML.includes('OMEPRAZOL 40 MG'));
    ok('con su recuento', /Mostrando 2 productos/.test(dom['#sns-count-bar'].textContent), dom['#sns-count-bar'].textContent);
    plan['xyz'] = { ms: 10, error: 503 };
    teclear('xyz');
    await dormir(360);
    ok('un error de la última consulta sí se pinta', dom['#sns-list-container'].innerHTML.includes('Error al buscar'));
}

console.log(fallos === 0 ? '\nTodo en verde.' : `\n${fallos} fallo(s).`);
process.exit(fallos === 0 ? 0 : 1);
