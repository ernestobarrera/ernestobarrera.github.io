#!/usr/bin/env node
/**
 * MedCheck — contrato de la resolución a MedyNut
 *
 * Prueba la cadena COMPLETA tal como ocurre en el navegador: identidad de sustancia de un
 * medicamento real de CIMA -> componentes -> clave del índice -> ruta de MedyNut.
 *
 * Lo que fija, y por qué cada cosa:
 *  1. Monocomponente frecuente resuelve (metformina).
 *  2. El contraión no rompe la clave: un producto de LOSARTAN POTASICO resuelve bajo
 *     `losartan`, que es lo que produce el resolutor del repo.
 *  3. Los slugs anómalos se sirven del índice y NO se calculan: `ceftriaxona` tiene que
 *     dar `cefotaxima-copia`. Si alguien "arregla" esto derivando la URL del nombre, el
 *     enlace lleva a otro fármaco y este test lo caza.
 *  4. Una asociación resuelve POR COMPONENTE (unidad = principio activo, no producto).
 *  5. RIMSTAR (nregistro 65904, 4 tuberculostáticos) NO resuelve ninguno: es el caso que
 *     originó todo el trabajo y la sección debe quedarse oculta. Un día que MedyNut añada
 *     tuberculostáticos, este test avisará de que la expectativa cambió.
 *  6. Todas las rutas publicadas apuntan al host y la ruta de MedyNut, sin excepción.
 *
 * Uso: node scripts/medcheck-test-medynut.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CIMA = 'https://cima.aemps.es/cima/rest';

const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sin red durante la carga')),
    JSON, Math, Date, String, Object, Array, Set, Map, RegExp, Promise,
    encodeURIComponent, setTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const dict = sandbox.window.innDict;
dict.map = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8')).map;
dict.loaded = true;

const idx = JSON.parse(readFileSync(join(ROOT, 'assets/data/medynut-index.json'), 'utf8'));

let fallos = 0;
function check(nombre, ok, detalle = '') {
    console.log(`${ok ? '✓' : '✗'} ${nombre}${ok ? '' : ` — ${detalle}`}`);
    if (!ok) fallos += 1;
}

/** Misma derivación de componentes que `_substanceIdentity` en cima-app.js. */
function componentes(med) {
    const vtm = (med?.vtm?.nombre || '').trim();
    const NON_INF = /^(multicomponente|varios|asociaciones|combinaciones)$/i;
    let fuente, origen;
    if (vtm && !NON_INF.test(vtm)) { fuente = vtm; origen = 'vtm'; }
    else if (med?.principiosActivos?.length) { fuente = med.principiosActivos.map(p => p.nombre).filter(Boolean).join(' + '); origen = 'pa'; }
    else { fuente = med?.pactivos || med?.nombre || ''; origen = 'pactivos'; }
    const recorta = origen !== 'vtm';
    return String(fuente).split(/[+,/]/).map(s => s.trim()).filter(Boolean)
        .map(c => dict.toSearchTerm(c, { allowCounterionTrim: recorta }).baseEs);
}

const resuelve = med => componentes(med)
    .map(b => ({ base: b, slug: idx.indice[dict.norm(b)] || null }));

async function ficha(nregistro) {
    const r = await fetch(`${CIMA}/medicamento?nregistro=${nregistro}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`CIMA HTTP ${r.status} para ${nregistro}`);
    return r.json();
}

// 6 · Invariante del índice entero: host y ruta fijos, sin escapes.
check('6 · base_url es el host y la ruta de MedyNut',
    idx._meta?.base_url === 'https://www.medynut.com/medicamentos/', `es ${idx._meta?.base_url}`);
const sucios = Object.entries(idx.indice).filter(([, s]) => typeof s !== 'string' || /[/:?#]|^\s|\s$/.test(s));
check('6b · ningún slug lleva barra, esquema ni espacios', sucios.length === 0,
    sucios.slice(0, 3).map(([k, s]) => `${k}=${s}`).join(', '));

// 7 · La segunda pasada (contención única) NO puede reabrir la puerta al fallo conocido.
// `ácido gadotérico` y `gadoteridol` son dos medios de contraste distintos que solo
// comparten prefijo: ninguno contiene al otro en frontera de palabra, así que la regla no
// los junta. Si alguien relaja `contieneEnFrontera` a subcadena, esto se pone en rojo.
const gado = idx.indice['acido gadoterico'];
check('7 · gadotérico no acaba en una ruta de gadoteridol',
    !gado || !/gadoteridol/i.test(gado), `da ${gado}`);

// 8 · La exactitud gana a la contención. `/glicerol` casa exacto y `/glicerol-enema`
// entra por contención: sin esta regla la colisión tumbaba las dos y se perdía el enlace
// bueno. Fija que una contención nunca desplace ni empate a una igualdad.
check('8 · exactitud gana a contención (glicerol, no glicerol-enema)',
    idx.indice['glicerol'] === 'glicerol', `da ${idx.indice['glicerol']}`);

// 9 · Las variantes de VÍA no se resuelven al azar: la repercusión nutricional de un
// corticoide sistémico y la de un colirio no son la misma, así que elegir sería decidir
// por el médico. Esas claves se retiran enteras.
check('9 · dexametasona no enlaza a una variante de vía elegida al azar',
    idx.indice['dexametasona'] === undefined, `da ${idx.indice['dexametasona']}`);

// 10 · Una clave con TRES candidatas se resuelve mirándolas todas, no de dos en dos.
// `hidrocortisona` tenía /imiquimod-via-topica-copia, /hidrocortisona y
// /hidrocortisona-oftalmologico. Resolviendo por pares ganaba la última escrita y un
// producto sistémico acababa enlazando al colirio. Se retira entera.
check('10 · hidrocortisona (3 candidatas, una oftálmica) se retira',
    idx.indice['hidrocortisona'] === undefined, `da ${idx.indice['hidrocortisona']}`);

// 11 · Las rutas con calificador de vía SIGUEN publicándose cuando son la única ficha de
// MedyNut para esa sustancia — retirarlas perdería enlaces correctos (bimatoprost solo
// existe oftálmico). Lo que no puede pasar es que la vía quede oculta: la interfaz la
// muestra en la etiqueta. Esto fija que el caso existe y que no se ha "limpiado" el
// índice a espaldas de la interfaz que lo advierte.
const VIA_EN_SLUG = /-(oftalmolog\w*|oftalmic\w*|iny|oral|topic\w*|enema|nasal|rectal)$/i;
const conVia = Object.values(idx.indice).filter(s => VIA_EN_SLUG.test(s));
check('11 · hay rutas con vía y se publican (la interfaz las etiqueta)',
    conVia.length > 0, 'ninguna: si se han retirado, la etiqueta de vía sobra');

// 1-3 · Claves directas del índice (no dependen de red).
check('1 · metformina resuelve', idx.indice['metformina'] === 'metformina', `da ${idx.indice['metformina']}`);
check('2 · losartan resuelve bajo la clave sin contraión',
    idx.indice['losartan'] === 'losartan-potasico', `da ${idx.indice['losartan']}`);
check('3 · ceftriaxona usa el slug ANÓMALO del índice, no uno calculado',
    idx.indice['ceftriaxona'] === 'cefotaxima-copia',
    `da ${idx.indice['ceftriaxona']} — si es "ceftriaxona", alguien está derivando la URL y el enlace va a otro fármaco`);

// 4-5 · Cadena completa contra medicamentos reales.
try {
    const rimstar = await ficha('65904');
    const r = resuelve(rimstar);
    check('5 · RIMSTAR (4 tuberculostáticos) no resuelve ninguno: sección oculta',
        r.length === 4 && r.every(x => !x.slug),
        r.map(x => `${x.base}=${x.slug}`).join(', '));

    // Una asociación real, buscada por sus DOS principios activos en vez de fijar un
    // nregistro que puede dejar de comercializarse. `pactivos` viene vacío en la lista,
    // por eso se filtra con practiv1/practiv2 y se lee el detalle.
    const lista = await (await fetch(`${CIMA}/medicamentos?practiv1=metformina&practiv2=sitagliptina&pagesize=3`, { headers: { accept: 'application/json' } })).json();
    const combo = (lista.resultados || [])[0];
    if (combo) {
        const det = await ficha(combo.nregistro);
        const r2 = resuelve(det);
        check('4 · una asociación resuelve POR COMPONENTE (unidad = principio activo)',
            r2.length > 1 && r2.some(x => x.slug),
            `${det.nombre}: ${r2.map(x => `${x.base}=${x.slug || '—'}`).join(', ')}`);
        console.log(`    ${det.nombre} → ${r2.map(x => `${x.base}: ${x.slug || 'no está'}`).join(' · ')}`);
    } else {
        console.log('· 4 · sin asociación metformina+sitagliptina comercializada hoy; INCONCLUSO');
    }
} catch (err) {
    console.log(`· 4-5 INCONCLUSO (red): ${err.message}`);
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
