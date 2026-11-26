#!/usr/bin/env node
/**
 * MedCheck — banco de la lista de Varias fichas: memoria de sesión, principio activo y ATC (26/11/2026)
 *
 * PREGUNTAS QUE RESPONDE:
 *   1. ¿La lista sobrevive a recargar la página y NO a cerrar el navegador? Misma regla de
 *      privacidad que «Últimos medicamentos»: sessionStorage, nunca localStorage. Una lista que
 *      durase más sería, en un PC compartido de consulta, un rastro de lo revisado con cada paciente.
 *   2. ¿Cada fila enseña su principio activo y su ATC de nivel 5 tal como los publica CIMA, y se
 *      puede ordenar por ATC sin que la pantalla señale nada? Es dato oficial, no un aviso: si dos
 *      filas comparten grupo, lo ve el médico. Por eso hay una aserción que vigila que en este
 *      código no aparezca «duplic».
 *
 * Se ejecuta el CÓDIGO REAL de assets/js/cima-app.js en un sandbox (mismo cargador que los demás
 * bancos), con un sessionStorage y un localStorage falsos que cuentan lo que se escribe en cada uno.
 *
 * Contraprueba: contra el código anterior (`ef9bde9`), las aserciones de comportamiento fallan
 * porque los métodos no existen.
 *
 * Uso: node scripts/medcheck-test-combo-lista.mjs
 */
import { fuenteApp } from './lib/cargar-app.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = fuenteApp(ROOT);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};
const intenta = (nombre, fn) => {
    try { fn(); } catch (e) { ok(nombre, false, e.message); }
};

/** Almacén falso con el contrato de Web Storage y un registro de escrituras. */
function almacen() {
    const datos = new Map();
    return {
        escrituras: 0,
        getItem(k) { return datos.has(k) ? datos.get(k) : null; },
        setItem(k, v) { this.escrituras += 1; datos.set(k, String(v)); },
        removeItem(k) { datos.delete(k); },
        get tamano() { return datos.size; },
    };
}

function montar({ session = almacen(), local = almacen(), detalle = null, sessionRoto = false } = {}) {
    const window = {};
    Object.defineProperty(window, 'sessionStorage', { get() { if (sessionRoto) throw new Error('SecurityError'); return session; } });
    window.localStorage = local;
    const sandbox = {
        window, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
        console: { log() {}, warn() {}, error() {} },
        localStorage: local,
        get sessionStorage() { if (sessionRoto) throw new Error('SecurityError'); return session; },
        fetch: () => Promise.reject(new Error('sin red')), setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, navigator: { onLine: true }, location: { search: '', href: '' },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${src}\n;window.__App = MedCheckApp;`, sandbox);
    const app = Object.create(sandbox.window.__App.prototype);
    // Campos de clase: Object.create no los inicializa. Se leen del propio fuente para no fijar
    // aquí un nombre que el código podría haber cambiado.
    const clave = src.match(/COMBO_LIST_KEY = '([^']+)'/)?.[1];
    const claveRecientes = src.match(/RECENT_MEDS_KEY = '([^']+)'/)?.[1];
    app.COMBO_LIST_KEY = clave;
    app.RECENT_MEDS_KEY = claveRecientes;
    app.RECENT_MEDS_MAX = 10;
    app.comboDrugList = [];
    app.currentView = 'otra';
    app.renderCombination = () => { app._repintados = (app._repintados || 0) + 1; };
    app._pintarRecientesBusqueda = () => {};
    app.showToast = () => {};
    let peticiones = 0;
    app.api = {
        getMedicamento: async () => {
            peticiones += 1;
            if (detalle instanceof Error) throw detalle;
            return detalle;
        },
    };
    return { app, session, local, clave, peticiones: () => peticiones };
}

const DETALLE_ENALAPRIL = {
    vtm: { nombre: 'enalapril' },
    principiosActivos: [{ nombre: 'ENALAPRIL MALEATO' }],
    atcs: [
        { codigo: 'C09', nombre: 'AGENTES QUE ACTUAN SOBRE EL SISTEMA RENINA-ANGIOTENSINA', nivel: 3 },
        { codigo: 'C09AA', nombre: 'Inhibidores de la ECA, monofármacos', nivel: 4 },
        { codigo: 'C09AA02', nombre: 'enalapril', nivel: 5 },
    ],
};

// --- 0. El código existe y está cableado donde debe -------------------------------------------
ok('la clave de la lista está declarada', /COMBO_LIST_KEY = 'medcheck_combo_list_v1'/.test(src));
ok('el constructor carga la lista guardada', /this\.comboDrugList = this\._cargarListaCombo\(\)/.test(src));
ok('renderCombination pinta las filas por `_filasComboOrdenadas` y con su línea de PA y ATC',
    /_filasComboOrdenadas\(\)\.map\(\(\{ med \}\)/.test(src) && /this\._metaFilaComboHtml\(med\)/.test(src));
ok('quitar y limpiar guardan la lista',
    /removeComboDrug\(index\) \{\s*this\.comboDrugList\.splice\(index, 1\);\s*this\._guardarListaCombo\(\);/.test(src)
    && /clearComboDrugs\(\) \{\s*this\.comboDrugList = \[\];\s*this\._guardarListaCombo\(\);/.test(src));

// Doctrina: el bloque nuevo muestra dato oficial y no señala. Ni «duplicidad» ni avisos.
const bloque = (() => {
    const i = src.indexOf("COMBO_LIST_KEY = '");
    const j = src.indexOf('// FÁRMACOS (lista compartida', i);
    return i === -1 || j === -1 ? '' : src.slice(i, j);
})();
ok('el bloque de la lista no habla de duplicidades ni avisa', bloque && !/duplic|showToast|alerta|warning/i.test(bloque.replace(/^\s*(\*|\/\/).*$/gm, '')));
ok('el bloque usa sessionStorage y nunca localStorage', bloque && /sessionStorage/.test(bloque) && !/localStorage\.(set|get)Item/.test(bloque));

// --- 1. Memoria de sesión ----------------------------------------------------------------------
intenta('memoria de sesión', () => {
    const { app, session, local, clave } = montar();
    app.comboDrugList = [{ nregistro: '1', nombre: 'A', atc5: [{ codigo: 'C09AA02', nombre: 'enalapril' }] }];
    app._comboOrden = 'atc';
    app._guardarListaCombo();
    ok('guardar escribe en sessionStorage', session.escrituras === 1 && !!session.getItem(clave));
    ok('guardar no escribe nada en localStorage', local.escrituras === 0);
    // «Recarga»: otra instancia sobre el mismo almacén de sesión.
    const otra = montar({ session });
    const lista = otra.app._cargarListaCombo();
    ok('tras recargar vuelve la misma lista', lista.length === 1 && lista[0].nregistro === '1' && lista[0].atc5?.[0]?.codigo === 'C09AA02');
    ok('y el orden elegido', otra.app._comboOrden === 'atc');
    // «Cerrar el navegador»: almacén de sesión nuevo.
    const nueva = montar();
    ok('con una sesión nueva la lista empieza vacía', nueva.app._cargarListaCombo().length === 0 && nueva.app._comboOrden === 'anadido');
    // Vaciar borra la clave, no deja una lista vacía guardada.
    app.comboDrugList = [];
    app._guardarListaCombo();
    ok('vaciar la lista borra la clave', session.getItem(clave) === null);
});

intenta('almacén roto o datos corruptos', () => {
    const roto = montar({ sessionRoto: true });
    ok('sin sessionStorage (modo privado) cargar da lista vacía', roto.app._cargarListaCombo().length === 0);
    roto.app.comboDrugList = [{ nregistro: '1', nombre: 'A' }];
    let lanzo = false;
    try { roto.app._guardarListaCombo(); } catch (_) { lanzo = true; }
    ok('y guardar no rompe la lista en memoria', !lanzo && roto.app.comboDrugList.length === 1);
    const s = almacen();
    const { app, clave } = montar({ session: s });
    s.setItem(clave, '{no es json');
    ok('un valor corrupto da lista vacía', app._cargarListaCombo().length === 0);
    s.setItem(clave, JSON.stringify({ lista: [{ nregistro: '1', nombre: 'A' }, { nombre: 'sin registro' }, null] }));
    ok('las entradas sin registro o nombre se descartan', app._cargarListaCombo().length === 1);
});

// --- 2. ATC de nivel 5 y principio activo ------------------------------------------------------
intenta('ATC de nivel 5', () => {
    const { app } = montar();
    const atc = app._atc5DeDetalle(DETALLE_ENALAPRIL);
    ok('se queda solo con el nivel 5, nunca con atcs[0]', atc.length === 1 && atc[0].codigo === 'C09AA02' && atc[0].nombre === 'enalapril');
    ok('una ficha sin nivel 5 da [] (distinto de no saberlo)', Array.isArray(app._atc5DeDetalle({ atcs: [{ codigo: 'C09', nivel: 3 }] })) && app._atc5DeDetalle({ atcs: [] }).length === 0);
    ok('sin detalle o sin `atcs` da null', app._atc5DeDetalle(null) === null && app._atc5DeDetalle({ nombre: 'x' }) === null);
    ok('el PA es la VTM cuando es informativa', app._principioActivoCombo({ vtm: { nombre: 'enalapril' } }) === 'enalapril');
    ok('con VTM «Multicomponente», los PA de la ficha',
        app._principioActivoCombo({ vtm: { nombre: 'Multicomponente' }, principiosActivos: [{ nombre: 'AMLODIPINO' }, { nombre: 'VALSARTAN' }] }) === 'AMLODIPINO + VALSARTAN');
});

intenta('línea de la fila', () => {
    const { app } = montar();
    app._escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const con = app._metaFilaComboHtml({ vtm: { nombre: 'enalapril' }, atc5: [{ codigo: 'C09AA02', nombre: 'enalapril' }] });
    ok('enseña el PA y el código', /combo-ficha-pa">enalapril</.test(con) && />C09AA02<\/code>/.test(con));
    ok('el nombre del ATC va en el title', /title="C09AA02 · enalapril"/.test(con));
    ok('sin ATC de nivel 5 lo dice así', /sin ATC de nivel 5 en CIMA/.test(app._metaFilaComboHtml({ atc5: [] })));
    ok('sin dato (fallo de red) lo dice distinto', /ATC no disponible/.test(app._metaFilaComboHtml({ atc5: null })));
    ok('escapa el principio activo', !/<img/.test(app._metaFilaComboHtml({ pactivos: '<img src=x>', atc5: [] })));
});

// --- 3. Orden por ATC ---------------------------------------------------------------------------
intenta('orden', () => {
    const { app } = montar();
    const m = (nr, cod) => ({ nregistro: nr, nombre: nr, atc5: cod === undefined ? null : cod ? [{ codigo: cod }] : [] });
    app.comboDrugList = [m('a', 'N02BE01'), m('b', 'C09AA02'), m('c', undefined), m('d', 'C09AA02'), m('e', ''), m('f', 'A02BC01')];
    app._comboOrden = 'anadido';
    ok('«Como los añadiste» respeta el orden de alta', app._filasComboOrdenadas().map(f => f.med.nregistro).join('') === 'abcdef');
    app._comboOrden = 'atc';
    const orden = app._filasComboOrdenadas();
    ok('«Por código ATC» ordena por código; a igual código, por alta; sin ATC al final',
        orden.map(f => f.med.nregistro).join('') === 'fbdace', orden.map(f => f.med.nregistro).join(''));
    ok('cada fila conserva su índice real (quitar va por índice)', orden.every(f => app.comboDrugList[f.i] === f.med));
    ok('la lista en memoria no se reordena', app.comboDrugList.map(x => x.nregistro).join('') === 'abcdef');
});

// --- 4. Alta con detalle de CIMA ----------------------------------------------------------------
await (async () => {
    try {
        const { app, session, clave, peticiones } = montar({ detalle: DETALLE_ENALAPRIL });
        // Un resultado de búsqueda trae VTM pero no `atcs`: hay que pedir el detalle igualmente.
        await app.addDrugToComboList({ nregistro: '62351', nombre: 'ENALAPRIL X 20 mg', vtm: { nombre: 'enalapril' } }, { silent: true });
        ok('el alta pide el detalle aunque la VTM ya sea informativa (para el ATC)', peticiones() === 1);
        ok('la fila guarda el ATC de nivel 5', app.comboDrugList[0]?.atc5?.[0]?.codigo === 'C09AA02');
        ok('y la lista queda en sessionStorage', JSON.parse(session.getItem(clave) || '{}').lista?.length === 1);
        await app.addDrugToComboList({ nregistro: '62351', nombre: 'ENALAPRIL X 20 mg' }, { silent: true });
        ok('no se duplica un medicamento', app.comboDrugList.length === 1);

        const sinRed = montar({ detalle: new Error('sin red') });
        await sinRed.app.addDrugToComboList({ nregistro: '9', nombre: 'Y', vtm: { nombre: 'y' } }, { silent: true });
        ok('sin red el alta entra igual, con ATC por saber (null)', sinRed.app.comboDrugList.length === 1 && sinRed.app.comboDrugList[0].atc5 === null);

        // Reintento al pintar: una vez por medicamento.
        const r = montar({ detalle: DETALLE_ENALAPRIL });
        r.app.currentView = 'combo';
        r.app.comboDrugList = [{ nregistro: '1', nombre: 'A', atc5: null }, { nregistro: '2', nombre: 'B', atc5: [] }];
        await r.app._completarAtcCombo();
        ok('completa solo las filas sin dato (null), no las que no tienen nivel 5', r.peticiones() === 1 && r.app.comboDrugList[0].atc5?.[0]?.codigo === 'C09AA02');
        ok('y repinta una vez', r.app._repintados === 1);
        const f = montar({ detalle: new Error('caído') });
        f.app.comboDrugList = [{ nregistro: '1', nombre: 'A', atc5: null }];
        await f.app._completarAtcCombo();
        await f.app._completarAtcCombo();
        ok('con CIMA caído lo intenta una sola vez por medicamento (sin bucle)', f.peticiones() === 1 && !f.app._repintados);
    } catch (e) {
        ok('alta con detalle de CIMA', false, e.message);
    }
})();

console.log(fallos ? `\n${fallos} fallo(s)` : '\nOK — todas las aserciones pasan');
process.exit(fallos ? 1 : 0);
