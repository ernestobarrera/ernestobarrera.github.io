#!/usr/bin/env node
/**
 * MedCheck — test del índice ATC en el cliente
 *
 * PREGUNTA QUE RESPONDE: ¿la búsqueda por indicación deja de pedir el detalle de cada medicamento,
 * sin empezar a equivocarse?
 *
 * EL PROBLEMA, medido el 2026-09-14: buscar «hipertensión» disparaba **2.427 peticiones** y
 * «dermatitis atópica» 755, una por medicamento. No era un descuido: CIMA casa el ATC por
 * SUBCADENA —buscar `D07` devuelve códigos que lo contienen— y su listado no devuelve el ATC, así
 * que sin verificar uno a uno la lista tendría falsos positivos clínicos. Quitar la verificación
 * sin más habría cambiado lentitud por errores.
 *
 * LO QUE ESTE TEST PROTEGE, y el orden importa:
 *   1. que el índice REDUZCA las peticiones de verdad (si no, no vale para nada);
 *   2. que siga rechazando los falsos positivos por subcadena, que es su razón de ser;
 *   3. que un `nregistro` ausente del índice NO se dé por bueno ni por malo: se verifica en vivo,
 *      porque ausencia de dato no es dato;
 *   4. que un índice caducado o roto NO se use — y que entonces la búsqueda funcione igual que
 *      antes, solo que lenta. Degrada hacia lo lento, nunca hacia lo incorrecto;
 *   5. que la frescura se mida contra la fecha de la FUENTE y no contra la nuestra, que es como
 *      un índice muerto se queda en verde para siempre.
 *
 * Contrato: docs/medcheck/private/2026-09-14_contrato-indices-precompilados.md
 *
 * Uso: node scripts/medcheck-test-atc-index.mjs
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

const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

/**
 * Monta una CimaAPI con la red simulada y CUENTA las peticiones de detalle, que es la magnitud
 * que este trabajo existe para bajar.
 */
const respuesta = (cuerpo) => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: () => Promise.resolve(cuerpo),
    text: () => Promise.resolve(JSON.stringify(cuerpo)),
});

function montar({ indice, meta, listado, detalles, indiceRoto = false } = {}) {
    const contador = { detalle: 0, listado: 0, indice: 0 };
    const sandbox = {
        window: {}, document: { addEventListener() {} },
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Number, Array, Object,
        navigator: { onLine: true }, location: { search: '', href: '' },
        AbortSignal: { timeout: () => undefined },
        fetch: (url) => {
            const u = String(url);
            if (u.includes('atc-index.json')) {
                contador.indice += 1;
                if (indiceRoto) return Promise.resolve({ ok: false, status: 404 });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ _meta: meta, atc: indice }) });
            }
            if (u.includes('/medicamentos')) {
                contador.listado += 1;
                return Promise.resolve(respuesta({ resultados: listado, totalFilas: listado.length }));
            }
            if (u.includes('/medicamento?nregistro=')) {
                contador.detalle += 1;
                const nreg = u.split('nregistro=')[1];
                return Promise.resolve(respuesta(detalles[nreg] || {}));
            }
            return Promise.reject(new Error(`petición no prevista: ${u}`));
        },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${apiSrc}\n;window.__API = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    const api = new sandbox.window.__API();
    api.useCloudflareProxy = false;
    return { api, contador };
}

// Escenario: seis medicamentos que CIMA devuelve para «D07» y ninguno trae `atcs` en el listado,
// que es exactamente lo que pasa en producción. Tres son D07 de verdad, dos son falsos positivos
// por subcadena (el código CONTIENE «D07» sin empezar por él) y uno no está en el índice.
const LISTADO = [
    { nregistro: '1001', nombre: 'Hidrocortisona crema' },
    { nregistro: '1002', nombre: 'Metilprednisolona aceponato' },
    { nregistro: '1003', nombre: 'Clobetasol' },
    { nregistro: '2001', nombre: 'Falso positivo por subcadena' },
    { nregistro: '2002', nombre: 'Otro falso positivo' },
    { nregistro: '3001', nombre: 'Ausente del indice' },
];
const INDICE = {
    '1001': 'D07AA02',
    '1002': 'D07AC14',
    '1003': 'D07AD01',
    '2001': 'A01AD07',   // contiene «D07», no empieza por él
    '2002': ['B02BD07'], // igual, y además en forma de lista
};
const DETALLES = {
    // El único que el índice no sabe resolver: CIMA dice que sí es D07.
    '3001': { nregistro: '3001', atcs: [{ codigo: 'D07AB11' }] },
};
const META_FRESCA = { listprescriptiondate: hace(0), nregistros: 5 };

const cuantos = (r) => r.resultados.map(m => m.nregistro).sort();

// ---------------------------------------------------------------------------
{
    const { api, contador } = montar({ indice: INDICE, meta: META_FRESCA, listado: LISTADO, detalles: DETALLES });
    const r = await api.searchByATC('D07', { noTrack: true });

    ok('el indice resuelve y solo queda UNA peticion de detalle, no seis',
        contador.detalle === 1, `detalles=${contador.detalle}`);
    ok('los tres D07 reales entran',
        ['1001', '1002', '1003'].every(n => cuantos(r).includes(n)), cuantos(r).join(','));
    ok('los dos falsos positivos por subcadena se rechazan',
        !cuantos(r).includes('2001') && !cuantos(r).includes('2002'), cuantos(r).join(','));
    ok('el ausente del indice se verifica en vivo y entra porque CIMA dice que es D07',
        cuantos(r).includes('3001'), cuantos(r).join(','));
    ok('el indice se descarga UNA sola vez', contador.indice === 1, `indice=${contador.indice}`);

    // Segunda búsqueda en la misma sesión: el índice ya está en memoria.
    const antes = contador.indice;
    await api.searchByATC('D07', { noTrack: true });
    ok('una segunda busqueda no vuelve a descargarlo', contador.indice === antes);
}

// ---------------------------------------------------------------------------
{
    const meta = { listprescriptiondate: hace(30), nregistros: 5 };
    const { api, contador } = montar({ indice: INDICE, meta, listado: LISTADO, detalles: {
        ...DETALLES,
        '1001': { atcs: [{ codigo: 'D07AA02' }] },
        '1002': { atcs: [{ codigo: 'D07AC14' }] },
        '1003': { atcs: [{ codigo: 'D07AD01' }] },
        '2001': { atcs: [{ codigo: 'A01AD07' }] },
        '2002': { atcs: [{ codigo: 'B02BD07' }] },
    } });
    const r = await api.searchByATC('D07', { noTrack: true });

    ok('un indice CADUCADO no se usa: se verifica todo en vivo',
        contador.detalle === 6, `detalles=${contador.detalle}`);
    ok('y el resultado sigue siendo correcto (degrada a lento, no a incorrecto)',
        JSON.stringify(cuantos(r)) === JSON.stringify(['1001', '1002', '1003', '3001']),
        cuantos(r).join(','));
}

// ---------------------------------------------------------------------------
{
    const { api, contador } = montar({
        indiceRoto: true, listado: LISTADO, detalles: {
            ...DETALLES,
            '1001': { atcs: [{ codigo: 'D07AA02' }] },
            '1002': { atcs: [{ codigo: 'D07AC14' }] },
            '1003': { atcs: [{ codigo: 'D07AD01' }] },
            '2001': { atcs: [{ codigo: 'A01AD07' }] },
            '2002': { atcs: [{ codigo: 'B02BD07' }] },
        },
    });
    const r = await api.searchByATC('D07', { noTrack: true });
    ok('un indice AUSENTE (404) no rompe la busqueda',
        JSON.stringify(cuantos(r)) === JSON.stringify(['1001', '1002', '1003', '3001']),
        cuantos(r).join(','));
    ok('y cae al camino de siempre', contador.detalle === 6, `detalles=${contador.detalle}`);
}

// ---------------------------------------------------------------------------
{
    // Un índice SIN fecha de fuente no se usa aunque el JSON esté perfecto: sin reloj de la
    // fuente no hay forma de saber si está muerto.
    const { api, contador } = montar({
        indice: INDICE, meta: { nregistros: 5 }, listado: LISTADO, detalles: {
            ...DETALLES,
            '1001': { atcs: [{ codigo: 'D07AA02' }] },
            '1002': { atcs: [{ codigo: 'D07AC14' }] },
            '1003': { atcs: [{ codigo: 'D07AD01' }] },
            '2001': { atcs: [{ codigo: 'A01AD07' }] },
            '2002': { atcs: [{ codigo: 'B02BD07' }] },
        },
    });
    await api.searchByATC('D07', { noTrack: true });
    ok('un indice sin listprescriptiondate no se usa', contador.detalle === 6, `detalles=${contador.detalle}`);
}

// ---------------------------------------------------------------------------
// El índice REAL que se publica: se comprueba contra el fichero de verdad, no contra un mock.
{
    const real = JSON.parse(readFileSync(join(ROOT, 'assets/data/atc-index.json'), 'utf8'));
    ok('el indice publicado declara la fecha de la FUENTE, no solo la nuestra',
        typeof real._meta?.listprescriptiondate === 'string');
    ok('y sus dos sellos', !!real._meta?.zip_sha256 && !!real._meta?.projection_sha256);
    ok('con mas de 20.000 medicamentos', (real._meta?.nregistros || 0) > 20000, real._meta?.nregistros);
    const dias = (Date.now() - Date.parse(`${real._meta.listprescriptiondate}T00:00:00Z`)) / 86400000;
    ok('y la fuente dentro de su desfase declarado de 3 dias', dias <= 3, `${dias.toFixed(1)} dias`);
}

console.log(fallos === 0 ? '\nTodo en verde' : `\n${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
