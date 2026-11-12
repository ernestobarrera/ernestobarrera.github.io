#!/usr/bin/env node
/**
 * MedCheck — el atajo desde la historia clínica no busca solo una selección con datos del paciente,
 * y la selección no viaja en la parte de la URL que llega al servidor.
 *
 * QUÉ PASABA (revisión de Fable, 11/11/2026, hallazgo 10; punto 15 de la cola):
 *   - La única red de seguridad medía longitud y palabras. «GARCIA LOPEZ, MARIA 12345678Z» (28
 *     caracteres, 4 palabras) la pasaba y se buscaba sola: al Worker, a la analítica y a CIMA.
 *   - El atajo ponía la selección en `?q=`, que el navegador envía a GitHub Pages al abrir la
 *     página, antes de que corra una línea de MedCheck. Ningún filtro de la app podía evitarlo.
 *
 * LO QUE FIJA ESTE BANCO:
 *   1. Con DNI, NIE, fecha o «APELLIDO, NOMBRE» no hay búsqueda: se precarga y se avisa.
 *      Un nombre de fármaco normal, un número de registro o un código nacional siguen buscando solos.
 *   2. El atajo real (el código que se instala) lleva la selección tras «#», nunca en la query.
 *   3. Al abrir, MedCheck lee el «#» una vez, lo borra de la barra de direcciones y conserva
 *      `source=bookmarklet` en la query para la atribución.
 *   4. El atajo antiguo (`?q=`) sigue funcionando; si se para, la selección sale de la barra.
 *
 * Uso: node scripts/medcheck-test-atajo-privacidad.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok     ${nombre}`); return; }
    fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`);
};

// ── Carga de MedCheckApp en un sandbox con location/history controlables ─────────────────────
const nav = { location: null, historial: [] };
const fijarURL = (href) => {
    const u = new URL(href);
    nav.location = { href: u.href, pathname: u.pathname, search: u.search, hash: u.hash };
};
const historyFalso = {
    replaceState(_s, _t, url) {
        const u = new URL(url, nav.location.href);
        nav.historial.push(u.pathname + u.search + u.hash);
        fijarURL(u.href);
    },
    pushState(_s, _t, url) { this.replaceState(_s, _t, url); },
};
const toasts = [];
const nodos = new Map();
const nodo = (id) => {
    if (!nodos.has(id)) nodos.set(id, { id, value: '', checked: false, focused: false, focus() { this.focused = true; }, select() { } });
    return nodos.get(id);
};
const almacen = new Map();
const sandbox = {
    console: { log() { }, warn() { }, error() { } },
    document: {
        addEventListener() { }, getElementById: nodo,
        querySelectorAll: () => [], querySelector: () => null,
        body: { classList: { add() { }, remove() { } } },
    },
    localStorage: { getItem: (k) => almacen.get(k) ?? null, setItem: (k, v) => almacen.set(k, v), removeItem: (k) => almacen.delete(k) },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
};
Object.defineProperty(sandbox, 'location', { get: () => nav.location });
sandbox.history = historyFalso;
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${appSrc}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const MedCheckApp = sandbox.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function' || typeof MedCheckApp.motivoRevisionAtajo !== 'function'
    || typeof MedCheckApp.adoptarSeleccionDelAtajo !== 'function') {
    console.error('No se pudieron cargar MedCheckApp.motivoRevisionAtajo y adoptarSeleccionDelAtajo');
    process.exit(1);
}

// ── 1. Clasificador ──────────────────────────────────────────────────────────────────────────
console.log('\n— Qué se para y qué se busca solo —');
const parar = [
    ['nombre con DNI', 'GARCIA LOPEZ, MARIA 12345678Z'],
    ['DNI suelto, minúscula', 'sintrom 12345678z'],
    ['DNI con guion', 'omeprazol 12345678-Z'],
    ['NIE', 'X1234567L enalapril'],
    ['NIE con espacios', 'Y 1234567 B'],
    ['fecha dd/mm/aaaa', 'metformina 03/04/1956'],
    ['fecha dd-mm-aa', 'ibuprofeno 3-4-56'],
    ['fecha con puntos', 'paracetamol 12.11.2026'],
    ['«APELLIDO, NOMBRE» sin más', 'MUÑOZ PÉREZ, ANA'],
    ['«APELLIDO,NOMBRE» sin espacio', 'GARCIA,MARIA'],
    ['combinación con coma en mayúsculas (falso positivo aceptado: un clic)', 'AMOXICILINA, ACIDO CLAVULANICO'],
];
for (const [caso, texto] of parar) {
    ok(`se para: ${caso}`, MedCheckApp.motivoRevisionAtajo(texto) === 'identificador', `«${texto}» → ${MedCheckApp.motivoRevisionAtajo(texto)}`);
}
ok('se para por larga (más de 80 caracteres), como antes',
    MedCheckApp.motivoRevisionAtajo('a'.repeat(81)) === 'larga');
ok('se para por larga (más de 10 palabras), como antes',
    MedCheckApp.motivoRevisionAtajo('uno dos tres cuatro cinco seis siete ocho nueve diez once') === 'larga');

const buscar = [
    ['nombre comercial', 'SINTROM 4 mg COMPRIMIDOS'],
    ['principio activo en minúscula', 'acenocumarol'],
    ['combinación con barra', 'AMOXICILINA/ACIDO CLAVULANICO'],
    ['dosis con barra', 'tramadol/paracetamol 37,5 mg/325 mg'],
    ['dosis decimal con barra (separadores mezclados)', 'salbutamol 0.1/2.5'],
    ['número de registro', '62345'],
    ['número de registro europeo', '1131061001'],
    ['código nacional', '712345'],
    ['dosis con miles', 'colecalciferol 25.000 UI'],
    ['8 cifras seguidas de unidad de dos letras', 'heparina 10000000 UI'],
    ['coma en minúsculas', 'amoxicilina, clavulánico'],
    ['vacía', ''],
];
for (const [caso, texto] of buscar) {
    ok(`se busca solo: ${caso}`, MedCheckApp.motivoRevisionAtajo(texto) === null, `«${texto}» → ${MedCheckApp.motivoRevisionAtajo(texto)}`);
}

// ── 2. El atajo real lleva la selección tras «#» ─────────────────────────────────────────────
console.log('\n— El atajo que se instala —');
const app0 = Object.create(MedCheckApp.prototype);
const codigo = app0.getBookmarkletCode();
ok('es un javascript: de una sola línea', codigo.startsWith('javascript:') && !codigo.includes('\n'));
const ejecutarAtajo = (seleccion) => {
    let abierta = null;
    const ctx = {
        window: {
            getSelection: () => ({ toString: () => seleccion }),
            open: (url) => { abierta = url; return null; },
        },
        URL, URLSearchParams,
    };
    vm.createContext(ctx);
    vm.runInContext(decodeURI(codigo.slice('javascript:'.length)), ctx);
    return abierta;
};
const SELECCION = 'GARCIA LOPEZ, MARIA 12345678Z';
const abierta = ejecutarAtajo(`  ${SELECCION}\n `);
const ua = new URL(abierta);
ok('abre medcheck.html en el sitio publicado', ua.origin + ua.pathname === 'https://ernestobarrera.github.io/medcheck.html', abierta);
ok('la query va VACÍA: nada de la selección llega al servidor', ua.search === '', abierta);
ok('la selección no aparece en ninguna parte de lo que se envía (origen + ruta + query)',
    !decodeURIComponent((ua.origin + ua.pathname + ua.search).replace(/\+/g, ' ')).includes('12345678Z'));
const enHash = new URLSearchParams(ua.hash.slice(1));
ok('el «#» lleva view, source y la selección normalizada',
    enHash.get('view') === 'search' && enHash.get('source') === 'bookmarklet' && enHash.get('q') === SELECCION, ua.hash);
const sinSeleccion = new URL(ejecutarAtajo(''));
ok('sin selección: abre igual, sin q', sinSeleccion.search === '' && !new URLSearchParams(sinSeleccion.hash.slice(1)).has('q'));
const caracteres = 'ÁCIDO ACETILSALICÍLICO 100 mg & 50% + algo';
const conRaros = new URL(ejecutarAtajo(caracteres));
ok('acentos, «&», «%» y «+» viajan intactos', new URLSearchParams(conRaros.hash.slice(1)).get('q') === caracteres, conRaros.hash);

// ── 3. MedCheck lee el «#» y lo borra ────────────────────────────────────────────────────────
console.log('\n— Lectura del «#» al abrir —');
fijarURL(abierta);
nav.historial = [];
const leida = MedCheckApp.adoptarSeleccionDelAtajo(nav.location, historyFalso);
ok('devuelve la selección', leida === SELECCION, String(leida));
ok('la barra de direcciones queda sin «#» y sin la selección',
    nav.location.hash === '' && !nav.location.search.includes('12345678'), nav.location.href);
ok('source=bookmarklet y view=search pasan a la query (atribución y router)',
    new URLSearchParams(nav.location.search).get('source') === 'bookmarklet' && new URLSearchParams(nav.location.search).get('view') === 'search', nav.location.search);
ok('una sola sustitución de historial, ninguna entrada nueva', nav.historial.length === 1, JSON.stringify(nav.historial));

fijarURL('https://ernestobarrera.github.io/medcheck.html?code=ABC#view=search&source=bookmarklet&q=sintrom');
const conCodigo = MedCheckApp.adoptarSeleccionDelAtajo(nav.location, historyFalso);
ok('conserva otros parámetros de la query (código de acceso)', conCodigo === 'sintrom' && new URLSearchParams(nav.location.search).get('code') === 'ABC', nav.location.href);

fijarURL('https://ernestobarrera.github.io/medcheck.html#seccion-recursos');
nav.historial = [];
ok('un «#» que no es del atajo no se toca', MedCheckApp.adoptarSeleccionDelAtajo(nav.location, historyFalso) === null && nav.historial.length === 0);
fijarURL('https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet&q=sintrom');
ok('el atajo antiguo (?q=) no lo adopta esta función', MedCheckApp.adoptarSeleccionDelAtajo(nav.location, historyFalso) === null);
ok('sin location no revienta', MedCheckApp.adoptarSeleccionDelAtajo(undefined, undefined) === null);

// ── 4. De punta a punta: processURLParams ───────────────────────────────────────────────────
console.log('\n— De punta a punta (processURLParams) —');
const montarApp = ({ seleccionAtajo = null, atajoAntiguo = false } = {}) => {
    const app = Object.create(MedCheckApp.prototype);
    app.modal = { classList: { contains: () => true, add() { } } };
    app.groupingState = {};
    app._seleccionAtajo = seleccionAtajo;
    app._atajoAntiguo = atajoAntiguo;
    app.busquedas = 0;
    app.loadView = async () => { };
    app.performSearch = () => { app.busquedas++; };
    app.showToast = (m, t) => toasts.push({ m, t });
    app._restoreFiltersFromURL = () => { };
    app._resetSearchScopeToMeds = () => { };
    return app;
};
const correr = async (href, opciones) => {
    fijarURL(href);
    nodos.clear(); toasts.length = 0;
    const app = montarApp(opciones);
    await app.processURLParams();
    return app;
};

// Atajo nuevo: el constructor ya adoptó el «#»; la query solo trae view y source.
let app = await correr('https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet', { seleccionAtajo: SELECCION });
ok('nuevo + DNI: NO busca', app.busquedas === 0);
ok('nuevo + DNI: precarga la selección en el buscador', nodo('search-input').value === SELECCION && nodo('search-input').focused);
ok('nuevo + DNI: avisa de datos del paciente', toasts.some(t => t.t === 'warning' && /DNI\/NIE/.test(t.m)), JSON.stringify(toasts));
ok('nuevo: la selección se consume (Atrás o recargar no la buscan)', app._seleccionAtajo === null);

app = await correr('https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet', { seleccionAtajo: 'sintrom' });
ok('nuevo + fármaco: busca solo, sin aviso', app.busquedas === 1 && nodo('search-input').value === 'sintrom' && toasts.length === 0, JSON.stringify(toasts));

app = await correr('https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet', { seleccionAtajo: '' });
ok('nuevo sin selección: ni busca ni avisa', app.busquedas === 0 && toasts.length === 0);

// Atajo antiguo: la selección viene en ?q=.
almacen.clear();
app = await correr(`https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet&q=${encodeURIComponent(SELECCION)}`, { atajoAntiguo: true });
ok('antiguo + DNI: NO busca', app.busquedas === 0);
ok('antiguo + DNI: la selección sale de la barra de direcciones', !new URLSearchParams(nav.location.search).has('q') && new URLSearchParams(nav.location.search).get('source') === 'bookmarklet', nav.location.href);
ok('antiguo: pide reinstalar el atajo', toasts.some(t => /reinstálalo/.test(t.m)), JSON.stringify(toasts));
app = await correr('https://ernestobarrera.github.io/medcheck.html?view=search&source=bookmarklet&q=sintrom', { atajoAntiguo: true });
ok('antiguo + fármaco: sigue buscando solo', app.busquedas === 1);
ok('antiguo: el aviso de reinstalar sale una sola vez por dispositivo', !toasts.some(t => /reinstálalo/.test(t.m)), JSON.stringify(toasts));

// Enlace compartido (?q= sin atajo): no cambia, se busca.
app = await correr('https://ernestobarrera.github.io/medcheck.html?view=search&q=GARCIA%2C%20MARIA', {});
ok('enlace compartido sin atajo: comportamiento de siempre (busca)', app.busquedas === 1 && toasts.length === 0);

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde.');
process.exit(fallos ? 1 : 0);
