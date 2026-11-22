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
 *      criba, solo deja de tirar lo que no ha mirado;
 *   5. el texto se lee como en pantalla (CimaAPI.textoFT): entidades sin DOM y palabras que CIMA
 *      parte entre <span>.
 *   6. (R2, 22/11/2026) confirmado, descartado y no verificable se cuentan aparte: `matched` es
 *      solo lo confirmado, cada no verificable lleva su motivo, lo confirmado su procedencia (ficha
 *      propia u original) y una revalidación con éxito limpia la marca anterior;
 *   7. (R1) con `atcScope`, solo se lee la ficha de lo que cae bajo esos prefijos;
 *   8. (R4) las entidades nombradas (`&ntilde;`, griegas, guion blando) casan igual con DOM y sin él.
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
function cargarAPI(fichas, opciones = {}) {
    const pedidas = [];
    const fetchImpl = async (url) => {
        const u = new URL(url, 'https://cima.test');
        const nreg = u.searchParams.get('nregistro');
        if (u.pathname.includes('/docSegmentado/contenido/')) pedidas.push(nreg);
        const cuerpo = fichas[nreg];
        if (cuerpo === 204) {
            return { ok: true, status: 204, statusText: 'No Content', headers: { get: () => null }, text: async () => '' };
        }
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
    // Con `dom`, un `document` cuyo <textarea> NO decodifica nada: si la criba dependiera del DOM
    // (como antes del 22/11), el resultado cambiaría. Tiene que dar lo mismo con él y sin él.
    if (opciones.dom) sandbox.document = { createElement: () => { let v = ''; return { set innerHTML(x) { v = x; }, get value() { return v; }, get textContent() { return v; } }; } };
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
    const orig = (n) => JSON.stringify(CimaAPI._registrosOriginalesDeImportacion(n));
    ok('«97051006IP» → «97051006»', orig('97051006IP') === '["97051006"]', orig('97051006IP'));
    ok('«04276007IP1» → «04276007»', orig('04276007IP1') === '["04276007"]', orig('04276007IP1'));
    ok('«98069001AIP4» → «98069001A» y luego «98069001» (Plavix)', orig('98069001AIP4') === '["98069001A","98069001"]', orig('98069001AIP4'));
    ok('un registro normal no tiene original', orig('97051006') === '[]');
    ok('vacío o nulo no rompe', orig(null) === '[]' && orig('') === '[]');
}
{
    // El caso de Plavix: ni la IP ni «98069001A» tienen ficha; la del «98069001» sí.
    const { api, pedidas } = cargarAPI({ '98069001': seccion41('Prevención de acontecimientos aterotrombóticos tras ictus isquémico.') });
    const r = await api._filterIndicationResultsBySection([med('98069001AIP4')], { section: '4.1', includeAny: ['ictus'] });
    ok('si el número con letra no tiene ficha, se prueba sin la letra', ids(r).includes('98069001AIP4') && !r.resultados[0]._sectionUnverified, JSON.stringify(pedidas));
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
    // R2 (22/11/2026): antes `matched` sumaba lo no leído y la cabecera decía «verificados: 2 de 2».
    ok('lo no leído NO cuenta como verificado (matched = confirmados = 0)', r.summary.matched === 0 && r.summary.confirmed === 0, JSON.stringify(r.summary));
    ok('lo que queda en la lista se cuenta aparte (shown = 2)', r.summary.shown === 2, JSON.stringify(r.summary));
    ok('y dice por qué: sin texto que leer', r.summary.sinTexto === 2 && r.resultados.every(m => m._sectionMotivo === 'sin-texto'), JSON.stringify(r.summary));
}

// --- 4. El texto se lee como en pantalla (22/11/2026) ----------------------------------------
// docSegmentado manda las tildes como entidades numéricas y a veces parte una palabra entre
// <span>. La criba quitaba las etiquetas con un espacio y solo decodificaba con DOM: Botox,
// Lopresor y Sibelium, con «profilaxis de la migraña» en su 4.1, no casaban.
console.log('— 4. Entidades y palabras partidas —');
{
    const FILTRO_MIG = { section: '4.1', includeAny: ['migraña'] };
    const { api } = cargarAPI({
        E: [{ seccion: '4.1', contenido: '<p>Profilaxis de la migra&#241;a cr&#243;nica.</p>' }],
        S: [{ seccion: '4.1', contenido: '<p>Profilaxis de la <span>migra</span><span>ña</span>.</p>' }],
        X: [{ seccion: '4.1', contenido: '<p>Hipertensi&#243;n arterial.</p>' }],
    });
    const r = await api._filterIndicationResultsBySection([med('E'), med('S'), med('X')], FILTRO_MIG);
    ok('«migra&#241;a» casa con «migraña» sin DOM', ids(r).includes('E'), JSON.stringify(ids(r)));
    ok('una palabra partida entre <span> casa', ids(r).includes('S'), JSON.stringify(ids(r)));
    ok('y lo que no la nombra sigue fuera', !ids(r).includes('X'), JSON.stringify(ids(r)));
}

// --- 5. Tres destinos, y solo uno es «verificado» (R2, revisión de Codex del 22/11/2026) --------
// El caso de Codex: una candidata sin texto daba `{checked:0, matched:1, errors:1}` y la cabecera
// decía «verificados en ficha (4.1): 1 de 1».
console.log('— 5. Confirmado, descartado y no verificable se cuentan por separado —');
{
    const { api } = cargarAPI({
        C: seccion41('Tratamiento sintomático del síndrome de piernas inquietas.'),
        D: seccion41('Enfermedad de Parkinson.'),
        N: SIN_SECCIONES,
        F: 'fallo',
        V: 204,
    });
    const r = await api._filterIndicationResultsBySection([med('C'), med('D'), med('N'), med('F'), med('V')], FILTRO);
    const s = r.summary;
    ok('el caso de Codex ya no se rotula verificado: confirmed 1, matched 1', s.confirmed === 1 && s.matched === 1, JSON.stringify(s));
    ok('descartado 1 (leído y sin la indicación)', s.excluded === 1 && s.checked === 2, JSON.stringify(s));
    ok('no verificables 3, cada uno con su motivo', s.errors === 3 && s.sinTexto === 2 && s.porFallo === 1, JSON.stringify(s));
    ok('en la lista: el confirmado y los tres no verificables', JSON.stringify(ids(r)) === '["C","F","N","V"]' && s.shown === 4, JSON.stringify(ids(r)));
    const porId = Object.fromEntries(r.resultados.map(m => [m.nregistro, m]));
    ok('el confirmado no lleva marca de «sin verificar» y sí su procedencia', !porId.C._sectionUnverified && porId.C._sectionFuente === 'propia');
    ok('un 204 es «sin texto», no un fallo de red', porId.V._sectionMotivo === 'sin-texto' && porId.F._sectionMotivo === 'red', `${porId.V._sectionMotivo} / ${porId.F._sectionMotivo}`);
}
{
    // Procedencia: la importación se confirma con la ficha del ORIGINAL, y lo dice.
    const { api } = cargarAPI({ '97051006': seccion41('Síndrome de piernas inquietas.'), '97051006IP': SIN_SECCIONES });
    const r = await api._filterIndicationResultsBySection([med('97051006IP')], FILTRO);
    const m = r.resultados[0];
    ok('IP confirmada por el original: fuente «original» y qué registro', m?._sectionFuente === 'original' && m?._sectionRegistro === '97051006', JSON.stringify(m));
    ok('y cuenta en viaOriginal', r.summary.viaOriginal === 1, JSON.stringify(r.summary));
}
{
    // Revalidar con éxito LIMPIA la marca anterior: el objeto puede venir de la caché con ella.
    const objeto = med('R');
    const a = cargarAPI({ R: 'fallo' });
    await a.api._filterIndicationResultsBySection([objeto], FILTRO);
    ok('primera pasada: fallo de red → marcado sin verificar', objeto._sectionUnverified === true);
    const b = cargarAPI({ R: seccion41('Síndrome de piernas inquietas.') });
    const r2 = await b.api._filterIndicationResultsBySection([objeto], FILTRO);
    ok('segunda pasada con ficha: la marca desaparece', !objeto._sectionUnverified && !objeto._sectionMotivo && r2.summary.errors === 0, JSON.stringify(objeto));
}

// --- 6. Criba solo en parte de los ATC (`atcScope`, R1) -----------------------------------------
console.log('— 6. atcScope: solo se lee la ficha de lo que cae bajo esos prefijos —');
{
    const conAtc = (n, codigo) => ({ nregistro: n, nombre: `MED ${n}`, atcs: [{ codigo, nivel: 5 }] });
    const { api, pedidas } = cargarAPI({
        '52612': seccion41('Anticoncepción. Dismenorreas. Endometriosis. Crisis ovulatorias.'),
        '65067': seccion41('Anticoncepción oral.'),
    });
    const filtro = { section: '4.1', includeAny: ['endometriosis'], atcScope: ['G03AA07'] };
    const r = await api._filterIndicationResultsBySection(
        [conAtc('52612', 'G03AA07'), conAtc('65067', 'G03AA07'), conAtc('DIENO', 'G03DB08')], filtro);
    ok('dentro del alcance entra la que tiene la indicación (Microgynon)', ids(r).includes('52612'), JSON.stringify(ids(r)));
    ok('dentro del alcance sale la que no (Loette)', !ids(r).includes('65067'), JSON.stringify(ids(r)));
    ok('fuera del alcance entra sin leer su ficha (dienogest)', ids(r).includes('DIENO') && !pedidas.includes('DIENO'), JSON.stringify(pedidas));
    ok('el resumen cuenta solo lo cribado y aparte lo no cribado', r.summary.candidates === 2 && r.summary.sinCribar === 1 && r.summary.confirmed === 1, JSON.stringify(r.summary));
}

// --- 7. Entidades nombradas, con DOM y sin él (R4) ----------------------------------------------
// `textoFT` solo decodificaba seis entidades nombradas: `migra&ntilde;a` no casaba con «migraña».
// El DOM simulado no decodifica nada: si la criba dependiera de él, la versión con DOM fallaría.
console.log('— 7. Entidades nombradas, con DOM y sin él —');
for (const dom of [false, true]) {
    const etiqueta = dom ? 'con DOM' : 'sin DOM';
    const { api } = cargarAPI({
        N: [{ seccion: '4.1', contenido: '<p>Profilaxis de la migra&ntilde;a.</p>' }],
        U: [{ seccion: '4.1', contenido: '<p>Ping&uuml;inos y migra&Ntilde;A en may&uacute;sculas.</p>' }],
        G: [{ seccion: '4.1', contenido: '<p>Bloqueante &beta;-adren&eacute;rgico; dosis &le; 10&nbsp;mg.</p>' }],
        B: [{ seccion: '4.1', contenido: '<p>Profilaxis de la migra&shy;ña.</p>' }],
    }, { dom });
    const r = await api._filterIndicationResultsBySection([med('N'), med('U'), med('B')], { section: '4.1', includeAny: ['migraña'] });
    ok(`«migra&ntilde;a» casa con «migraña» (${etiqueta})`, ids(r).includes('N'), JSON.stringify(ids(r)));
    ok(`«&Ntilde;» mayúscula también (${etiqueta})`, ids(r).includes('U'), JSON.stringify(ids(r)));
    ok(`un guion blando no parte la palabra (${etiqueta})`, ids(r).includes('B'), JSON.stringify(ids(r)));
    const g = await api._filterIndicationResultsBySection([med('G')], { section: '4.1', includeAny: ['β-adrenérgico'] });
    ok(`letras griegas y tildes nombradas (${etiqueta})`, ids(g).includes('G'), JSON.stringify(g.summary));
}
{
    const { CimaAPI } = cargarAPI({});
    ok('textoFT decodifica las nombradas habituales', CimaAPI.textoFT('a&ntilde;o &ccedil; &ordm; &laquo;x&raquo; &mdash; &hellip;') === 'año ç º «x» — …', CimaAPI.textoFT('a&ntilde;o &ccedil; &ordm; &laquo;x&raquo; &mdash; &hellip;'));
    ok('una entidad desconocida se deja tal cual, no se inventa', CimaAPI.textoFT('&noexiste; y &amp;') === '&noexiste; y &');
    ok('las seis de siempre siguen valiendo en mayúsculas', CimaAPI.textoFT('&AMP; &NBSP;x') === '& x');
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — la criba 4.1 solo quita lo que ha leído.');
process.exit(fallos ? 1 : 0);
