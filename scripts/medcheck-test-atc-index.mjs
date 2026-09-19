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

function montar({ indice, meta, listado, detalles, indiceRoto = false, almacen = null } = {}) {
    const contador = { detalle: 0, listado: 0, indice: 0, pedidos: [] };
    const sandbox = {
        window: {}, document: { addEventListener() {} },
        console: { log() {}, warn() {}, error() {} },
        localStorage: (() => {
            // Real, no un no-op: la caché de nombres ATC vive aquí y hay que poder comprobar que
            // una segunda búsqueda no vuelve a preguntar.
            const m = almacen || {};
            return {
                getItem: (k) => (k in m ? m[k] : null),
                setItem: (k, v) => { m[k] = String(v); },
                removeItem: (k) => { delete m[k]; },
            };
        })(),
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
                contador.pedidos.push(nreg);
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
    { nregistro: '1004', nombre: 'Otra hidrocortisona del MISMO subgrupo que 1001' },
    { nregistro: '2001', nombre: 'Falso positivo por subcadena' },
    { nregistro: '2002', nombre: 'Otro falso positivo' },
    { nregistro: '3001', nombre: 'Ausente del indice' },
];
const INDICE = {
    '1001': 'D07AA02',
    '1002': 'D07AC14',
    '1003': 'D07AD01',
    '1004': 'D07AA04',   // mismo subgrupo D07AA que 1001: no debe costar otra peticion
    '2001': 'A01AD07',   // contiene «D07», no empieza por él
    '2002': ['B02BD07'], // igual, y además en forma de lista
};
const DETALLES = {
    // El único que el índice no sabe resolver: CIMA dice que sí es D07.
    '3001': { nregistro: '3001', atcs: [{ codigo: 'D07AB11' }] },
};
const META_FRESCA = { listprescriptiondate: hace(0), nregistros: 5 };

const cuantos = (r) => r.resultados.map(m => m.nregistro).sort();

// Lo que CIMA devuelve de verdad cuando se le pide un detalle: la jerarquia entera, con nivel y
// nombre. Verificado contra el servicio el 2026-09-14 en 54 medicamentos al azar: 53 traen
// [nivel 3, 4, 5] y el restante [3, 4] porque su codigo es de nivel 4.
const DETALLES_CIMA = {
    ...DETALLES,
    '1001': { nregistro: '1001', atcs: [
        { codigo: 'D07A', nombre: 'CORTICOSTEROIDES, SOLOS', nivel: 3 },
        { codigo: 'D07AA', nombre: 'Corticosteroides de baja potencia (grupo I)', nivel: 4 },
        { codigo: 'D07AA02', nombre: 'Hidrocortisona', nivel: 5 } ] },
    '1002': { nregistro: '1002', atcs: [
        { codigo: 'D07A', nombre: 'CORTICOSTEROIDES, SOLOS', nivel: 3 },
        { codigo: 'D07AC', nombre: 'Corticosteroides potentes (grupo III)', nivel: 4 },
        { codigo: 'D07AC14', nombre: 'Metilprednisolona aceponato', nivel: 5 } ] },
    '1003': { nregistro: '1003', atcs: [
        { codigo: 'D07A', nombre: 'CORTICOSTEROIDES, SOLOS', nivel: 3 },
        { codigo: 'D07AD', nombre: 'Corticosteroides muy potentes (grupo IV)', nivel: 4 },
        { codigo: 'D07AD01', nombre: 'Clobetasol', nivel: 5 } ] },
};

// ---------------------------------------------------------------------------
{
    const { api, contador } = montar({ indice: INDICE, meta: META_FRESCA, listado: LISTADO, detalles: DETALLES_CIMA });
    const r = await api.searchByATC('D07', { noTrack: true });
    const porNreg = (n) => r.resultados.find(m => m.nregistro === n);

    // Dos costes distintos que antes se contaban juntos: VERIFICAR si un medicamento es del grupo
    // (uno por medicamento, que es lo que el indice existe para evitar) y NOMBRAR un subgrupo
    // (uno por subgrupo, que es la nomenclatura y no depende de cuantos medicamentos haya).
    const verificaciones = contador.pedidos.filter(n => n === '3001').length;
    const nomenclatura = contador.pedidos.filter(n => n !== '3001').length;
    ok('verificar cuesta UNA peticion, no seis: solo el ausente del indice',
        verificaciones === 1, `verificaciones=${verificaciones}`);
    ok('nombrar cuesta una peticion por SUBGRUPO (3), no por medicamento',
        nomenclatura === 3, `nomenclatura=${nomenclatura} pedidos=${contador.pedidos.join(',')}`);

    // El defecto que Ernesto encontro en produccion el 2026-09-14: los grupos salian «Sin nombre»
    // porque el indice solo guarda el codigo y nadie reponia la nomenclatura.
    const m1 = porNreg('1001');
    ok('el resuelto por indice recupera la jerarquia de tres niveles',
        m1.atcs.map(a => a.nivel).join(',') === '3,4,5', JSON.stringify(m1.atcs));
    ok('y el nivel 4 llega CON NOMBRE, que es lo que titula el grupo',
        m1.atcs.find(a => a.nivel === 4)?.nombre === 'Corticosteroides de baja potencia (grupo I)',
        JSON.stringify(m1.atcs.find(a => a.nivel === 4)));
    ok('atcs[0] es el nivel 3, igual que lo devuelve CIMA (lo leen tarjeta, badge EML y ficha)',
        m1.atcs[0].nivel === 3 && m1.atcs[0].codigo === 'D07A', JSON.stringify(m1.atcs[0]));
    ok('el nivel 5 se puede encontrar por su nivel (es el codigo de la utilizacion observada)',
        m1.atcs.find(a => a.nivel === 5)?.codigo === 'D07AA02');
    ok('el nivel 5 que viene en esa misma respuesta se aprovecha, sin pedir nada por el',
        m1.atcs.find(a => a.nivel === 5)?.nombre === 'Hidrocortisona');

    // LA PRUEBA DE QUE SE PAGA POR SUBGRUPO Y NO POR MEDICAMENTO: 1004 comparte subgrupo con 1001
    // y NO se le pide el detalle, pero hereda de la cache el nombre que titula su grupo. Su nivel 5
    // se queda sin nombre, que es justo lo que no hace falta: es el principio activo, y la ficha
    // recarga el detalle completo de CIMA al abrirse.
    const m4 = porNreg('1004');
    ok('al que comparte subgrupo no se le pide el detalle',
        !contador.pedidos.includes('1004'), contador.pedidos.join(','));
    ok('y aun asi su nivel 4 sale nombrado, heredado de la cache',
        m4.atcs.find(a => a.nivel === 4)?.nombre === 'Corticosteroides de baja potencia (grupo I)',
        JSON.stringify(m4.atcs));
    ok('su nivel 5 se queda sin nombre, que es el precio aceptado y no un fallo',
        m4.atcs.find(a => a.nivel === 5)?.nombre === null);

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
        '1004': { atcs: [{ codigo: 'D07AA04' }] },
        '2001': { atcs: [{ codigo: 'A01AD07' }] },
        '2002': { atcs: [{ codigo: 'B02BD07' }] },
    } });
    const r = await api.searchByATC('D07', { noTrack: true });

    ok('un indice CADUCADO no se usa: se verifica todo en vivo',
        contador.detalle === 7, `detalles=${contador.detalle}`);
    ok('y el resultado sigue siendo correcto (degrada a lento, no a incorrecto)',
        JSON.stringify(cuantos(r)) === JSON.stringify(['1001', '1002', '1003', '1004', '3001']),
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
    ok('y cae al camino de siempre', contador.detalle === 7, `detalles=${contador.detalle}`);
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
    ok('un indice sin listprescriptiondate no se usa', contador.detalle === 7, `detalles=${contador.detalle}`);
}

// ---------------------------------------------------------------------------
// El índice REAL que se publica: se comprueba contra el fichero de verdad, no contra un mock.
// --- La jerarquia se DERIVA del codigo, y solo cuando el codigo lo permite -----
// Verificado contra CIMA el 2026-09-14 en 54 medicamentos al azar: la forma es [3, 4, 5] salvo
// cuando el codigo es de nivel 4. La estructura ATC es posicional por definicion de la OMS, asi
// que esto es aritmetica sobre el codigo, no una suposicion sobre el dato.
{
    const { api } = montar({ indice: {}, meta: META_FRESCA, listado: [], detalles: {} });
    const API = api.constructor;
    const forma = (c) => API.atcJerarquia(c).map(a => `${a.nivel}:${a.codigo}`).join(' ');

    ok('un codigo de nivel 5 se descompone en los tres niveles de CIMA',
        forma('A10BJ06') === '3:A10B 4:A10BJ 5:A10BJ06', forma('A10BJ06'));
    ok('uno de nivel 4 se queda en dos, como CIMA hace con R05X_',
        forma('R05X_') === '3:R05X 4:R05X_', forma('R05X_'));
    ok('uno de nivel 3 se emite solo a si mismo, sin inventarle descendencia',
        forma('A13A') === '3:A13A', forma('A13A'));
    ok('minusculas y espacios no cambian el resultado',
        forma(' a10bj06 ') === '3:A10B 4:A10BJ 5:A10BJ06', forma(' a10bj06 '));
    ok('el nombre NUNCA se inventa: se deja vacio y lo repone quien pueda',
        API.atcJerarquia('A10BJ06').every(a => a.nombre === null));

    // El Nomenclator trae `XXXXXX` en 5 registros (medido 2026-09-14). No es un ATC: darle
    // jerarquia seria fabricar un grupo terapeutico que no existe.
    const basura = API.atcJerarquia('XXXXXX');
    ok('un codigo que no es ATC no se descompone', basura.length === 1 && basura[0].codigo === 'XXXXXX');
    ok('y no se le inventa un nivel', basura[0].nivel === undefined, JSON.stringify(basura[0]));
    ok('tampoco se descompone un codigo de longitud imposible',
        API.atcJerarquia('A10BJ0').length === 1);
    ok('vacio no produce nada', API.atcJerarquia('').length === 0 && API.atcJerarquia(null).length === 0);
}

// --- La nomenclatura se pregunta UNA vez y se recuerda -------------------------
{
    const almacen = {};
    const uno = montar({ indice: INDICE, meta: META_FRESCA, listado: LISTADO, detalles: DETALLES_CIMA, almacen });
    await uno.api.searchByATC('D07', { noTrack: true });
    const primera = uno.contador.pedidos.filter(n => n !== '3001').length;

    // Sesion nueva (otra instancia), mismo navegador: la cache de nombres sigue ahi.
    const dos = montar({ indice: INDICE, meta: META_FRESCA, listado: LISTADO, detalles: DETALLES_CIMA, almacen });
    const r2 = await dos.api.searchByATC('D07', { noTrack: true });
    const segunda = dos.contador.pedidos.filter(n => n !== '3001').length;

    ok('la primera busqueda paga la nomenclatura', primera === 3, `primera=${primera}`);
    ok('una sesion posterior ya NO la paga', segunda === 0, `segunda=${segunda}`);
    ok('y los grupos siguen saliendo con nombre',
        r2.resultados.find(m => m.nregistro === '1001').atcs.find(a => a.nivel === 4)?.nombre
            === 'Corticosteroides de baja potencia (grupo I)');
}

{
    const real = JSON.parse(readFileSync(join(ROOT, 'assets/data/atc-index.json'), 'utf8'));
    ok('el indice publicado declara la fecha de la FUENTE, no solo la nuestra',
        typeof real._meta?.listprescriptiondate === 'string');
    ok('y sus dos sellos', !!real._meta?.zip_sha256 && !!real._meta?.projection_sha256);
    ok('con mas de 20.000 medicamentos', (real._meta?.nregistros || 0) > 20000, real._meta?.nregistros);
    // LA FRESCURA DE LA FUENTE NO PINTA ROJO: ES UN INCONCLUSO. Cambiado el 19/09/2026, al meter
    // el gate de bancos dentro de los ETL.
    //
    // Esta comprobación no mide el código ni el índice: mide el reloj de AEMPS. Cuando el
    // Nomenclátor se retrasa —un fin de semana basta— el banco se ponía rojo SOLO, sin que nadie
    // tocara nada, y a partir de hoy ese rojo ya no es un aviso: es un gate que bloquea la
    // publicación de los otros cuatro ETL. Un índice de MedyNut correcto se quedaría sin publicar
    // porque el Ministerio no ha subido el ZIP de prescripción. Eso no es fallar en cerrado, es
    // fallar en el sitio equivocado.
    //
    // NO SE PIERDE LA VIGILANCIA, que es la única razón por la que esto se puede hacer: el
    // desfase está declarado en `assets/data/_fuentes.json` (`desfase_dato_max_days: 3`) y lo
    // vigila el watchdog diario, que tiene su propio canal y le manda un email. Dejarlo también
    // aquí en rojo eran dos alarmas por una causa, y dos alarmas por una causa enseñan a ignorar
    // las dos.
    const dias = (Date.now() - Date.parse(`${real._meta.listprescriptiondate}T00:00:00Z`)) / 86400000;
    if (dias <= 3) {
        console.log(`✓ y la fuente dentro de su desfase declarado de 3 dias — ${dias.toFixed(1)} dias`);
    } else {
        console.log(`INCONCLUSO: la fuente lleva ${dias.toFixed(1)} dias sin actualizarse (desfase declarado: 3). No es un fallo del indice ni del codigo; lo vigila el watchdog de frescura, que avisa por email.`);
    }
}

console.log(fallos === 0 ? '\nTodo en verde' : `\n${fallos} fallo(s)`);
process.exit(fallos === 0 ? 0 : 1);
