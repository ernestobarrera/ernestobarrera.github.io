#!/usr/bin/env node
/**
 * MedCheck — test del veredicto de financiación SNS (_classifyFinSit + _computeFinancingSummary)
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm + shims mínimos) y ejercita las dos
 * funciones que deciden lo que el médico lee en la línea "Financiación SNS" de la ficha. Ambas son
 * puras (no tocan DOM ni red), así que se invocan sobre un `this` desnudo del prototipo.
 *
 * Doctrina que fija este test:
 *   - los seis estados oficiales de BIFIMED se clasifican, incluido "Estudio o sin petición
 *     financiación" (financiado=666), que NO es lo mismo que "no tenemos el dato";
 *   - la clasificación usa marcadores ASCII: el dataset del Ministerio llega con mojibake por doble
 *     UTF-8 y los acentos no son fiables;
 *   - el denominador del resumen es SIEMPRE el total de presentaciones consultadas. Una presentación
 *     sin dato no puede desaparecer del cálculo y ascender el medicamento a "Financiado por el SNS";
 *   - "sin petición" se nombra aparte de "no financiado": el efecto para prescribir es el mismo,
 *     pero no existe resolución denegatoria y atribuirla sería falsear la fuente.
 *
 * Textos de situación tomados literalmente del Excel de BIFIMED (sondeo 2026-09-06).
 *
 * Uso: node scripts/medcheck-test-financiacion.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval, AbortSignal,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });

const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function') {
    console.error('No se pudo cargar la clase MedCheckApp');
    process.exit(1);
}
const app = Object.create(MedCheckApp.prototype);

const clasificar = (sit, found = true) => app._classifyFinSit(sit, found);
// Atajo: resumen(['Si', 'Excluido']) construye el Map cn -> {found, sit} que espera la función.
// `null` representa un CN que BIFIMED no devuelve (found: false).
const resumen = (sits) => app._computeFinancingSummary(new Map(
    sits.map((s, i) => [String(i), s === null ? { found: false, sit: '' } : { found: true, sit: s }])
));

let failures = 0;
function check(name, got, expected) {
    if (got === expected) {
        console.log(`✓ ${name}`);
    } else {
        failures += 1;
        console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
    }
}

// --- Los seis estados oficiales ----------------------------------------------
console.log('— Clasificación de los seis estados oficiales de BIFIMED —');
check('financiado=1 "Si"', clasificar('Si'), 'fin');
check('financiado=2 "Si para determinadas indicaciones"',
    clasificar('Si para determinadas indicaciones/condiciones'), 'cond');
check('financiado=5 "No incluido"', clasificar('No incluido'), 'nofin');
check('financiado=6 "Excluido"', clasificar('Excluido'), 'nofin');
check('financiado=7 "No financiado por resolución"', clasificar('No financiado por resolución'), 'nofin');
check('financiado=666 "Estudio o sin petición financiación"',
    clasificar('Estudio o sin petición financiación'), 'estudio_sin_peticion');

// El Ministerio sirve el Excel con doble codificación UTF-8. La clasificación no puede depender
// de los acentos ni de que el ETL haya corregido el mojibake.
check('666 con mojibake sigue clasificando igual',
    clasificar('Estudio o sin peticiÃ³n financiaciÃ³n'), 'estudio_sin_peticion');
check('estado 2 con mojibake sigue clasificando igual',
    clasificar('Si para determinadas indicaciones/condiciones'), 'cond');

check('CN que BIFIMED no devuelve → sindato', clasificar('Si', false), 'sindato');
check('situación vacía → sindato', clasificar(''), 'sindato');

// --- Denominador honesto ------------------------------------------------------
console.log('\n— El denominador incluye las presentaciones sin dato —');
check('todas financiadas → si', resumen(['Si', 'Si']).estado, 'si');
check('todas no financiadas → no', resumen(['Excluido', 'No financiado por resolución']).estado, 'no');
check('todas en el estado 666 → estudio_sin_peticion',
    resumen(['Estudio o sin petición financiación', 'Estudio o sin petición financiación']).estado, 'estudio_sin_peticion');
check('...y conserva literalmente la disyunción oficial, sin elegir una de las dos ramas',
    resumen(['Estudio o sin petición financiación']).label, 'En estudio o sin petición de financiación');
check('ninguna con dato → sindato', resumen([null, null]).estado, 'sindato');

// El defecto corregido el 2026-09-06: dos CN financiados y uno sin dato NO son "Financiado por el
// SNS". Es el caso real de YASMIN, cuyos dos CN tienen situación distinta.
check('2 financiadas + 1 sin dato NO es "si"', resumen(['Si', 'Si', null]).estado, 'parcial');
check('...y lo dice con el total real, no con el de los que tienen dato',
    resumen(['Si', 'Si', null]).label, 'Financiación parcial (2 de 3 presentaciones · 1 sin dato)');
check('1 no financiada + 1 sin dato sigue siendo "no", con la fracción a la vista',
    resumen(['Excluido', null]).label, 'No financiado por el SNS (1 de 2 presentaciones · 1 sin dato)');
check('mezcla financiada/no financiada → parcial sobre el total',
    resumen(['Si', 'Excluido']).label, 'Financiación parcial (1 de 2 presentaciones)');
check('condicionada cuenta como financiada pero se nombra aparte',
    resumen(['Si para determinadas indicaciones/condiciones', 'Si']).estado, 'cond');
// "No financiado" se reserva a los tres estados negativos, que son resoluciones del Ministerio.
// El 666 no lo es: en la mezcla se descompone en vez de colapsar ambas cosas bajo una etiqueta falsa.
check('666 mezclado con una denegación no se llama "no financiado"',
    resumen(['Estudio o sin petición financiación', 'Excluido']).estado, 'sin_cobertura');
check('...y la etiqueta dice de qué se compone',
    resumen(['Estudio o sin petición financiación', 'Excluido']).label,
    'Sin cobertura SNS actual: 1 no financiada · 1 en estudio/sin petición');

// --- Contraste con el algoritmo anterior --------------------------------------
// Un detector que nunca ha demostrado detectar nada no es una red de seguridad, es decoración
// (lección de S39). ALCANCE REAL de esta sección, para que no prometa de más: NO es una prueba de
// mutación sobre el código de producción. Ejecuta reimplementaciones de los algoritmos viejos y
// comprueba que producían el defecto, es decir, que las aserciones de arriba distinguen de verdad
// una versión correcta de una incorrecta. Quien caza la regresión si vuelve son esas aserciones.
console.log('\n— Contraste: los algoritmos anteriores producían el defecto —');

// 1. Denominador viejo: conDato = fin + cond + nofin, dejando fuera las presentaciones sin dato.
const resumenViejo = (sits) => {
    let fin = 0, cond = 0, nofin = 0;
    for (const s of sits) {
        const c = s === null ? 'sindato' : app._classifyFinSit(s, true);
        if (c === 'fin') fin++; else if (c === 'cond') cond++; else if (c === 'nofin') nofin++;
    }
    const financiadas = fin + cond, conDato = financiadas + nofin;
    if (conDato === 0) return 'sindato';
    if (nofin === 0) return cond === 0 ? 'si' : 'cond';
    if (financiadas === 0) return 'no';
    return 'parcial';
};
check('el denominador viejo ascendería "2 financiadas + 1 sin dato" a "si"',
    resumenViejo(['Si', 'Si', null]), 'si');

// 2. Clasificador viejo: sin la regla del 666, el estado oficial caía en "sindato" y se confundía
//    con un fallo de cobertura nuestro.
const clasificarViejo = (sit) => {
    const s = (sit || '').trim().toLowerCase();
    if (!s) return 'sindato';
    if (s.includes('no incluid') || s.includes('no financiad') || s.includes('excluid')) return 'nofin';
    if (s.includes('determinad') || s.includes('condicion') || s.includes('restring') || s.includes('restricci')) return 'cond';
    if (s.startsWith('si') || s.includes('financiad')) return 'fin';
    return 'sindato';
};
check('el clasificador viejo degradaba el estado 666 a "sindato"',
    clasificarViejo('Estudio o sin petición financiación'), 'sindato');

// --- La nota del modal cuando no hay Nomenclátor ------------------------------
// `loadSnsFinancing` toca DOM y red, así que esta parte se comprueba sobre el fuente: es un
// detector ESTRUCTURAL, no funcional, y se declara como tal.
//
// El defecto que vigila: la cadena de `else if` terminaba en `else if (bifimedDrugStatus)` con el
// texto de farmacia hospitalaria. Al incorporar las 22.116 presentaciones del estado 666, un
// medicamento sin datos en el Nomenclátor habría caído ahí y MedCheck habría afirmado que su
// financiación se gestiona por farmacia de hospital. Es falso y clínicamente peor que callar.
console.log('\n— Nota del modal sin Nomenclátor (detector estructural) —');
const fuente = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');

const iEstudio = fuente.indexOf("st.includes('estudio')");
const iHosp = fuente.indexOf('su financiación SNS se gestiona a través de farmacia hospitalaria');
check('existe una rama propia para el estado 666 en la nota del modal', iEstudio > -1, true);
check('esa rama se evalúa ANTES que la nota hospitalaria', iEstudio > -1 && iEstudio < iHosp, true);
check('la nota hospitalaria exige marcadores de ámbito hospitalario (UH/DH/ECM)',
    /bifimedDrugStatus\s*&&\s*bifimedHospitalario/.test(fuente), true);
check('bifimedHospitalario se deriva de uh/dh/ecm del registro BIFIMED',
    /bifimedHospitalario\s*=\s*!!\(bifimedDrugRecord\?\.uh\s*\|\|\s*bifimedDrugRecord\?\.dh\s*\|\|\s*bifimedDrugRecord\?\.ecm\)/.test(fuente), true);

// El enlace a la ficha oficial de BIFIMED se construía dentro del bloque de indicaciones
// centralizadas, así que faltaba en la mayoría de medicamentos —los que no las tienen—, que son
// justo aquellos en los que la ficha no puede enseñar precio ni aportación.
const iLink = fuente.indexOf('const bifimedLink');
const iSection = fuente.indexOf('let bifimedSection');
check('el enlace a BIFIMED se construye fuera del bloque de indicaciones', iLink > -1 && iLink < iSection, true);
check('la nota de financiación lo incluye', /notaTexto\}\$\{bifimedLink\}/.test(fuente), true);
check('la sección del Nomenclátor también lo incluye', /Ver ficha en Nomenclátor<\/a>\$\{bifimedLink\}/.test(fuente), true);
check('el enlace usa ?cn= y no el ?prod= del Nomenclátor',
    /medicamentos\.do\?metodo=verDetalle&cn=\$\{cnToProd\(bifimedCn\)\}/.test(fuente), true);

// --- Ausencia frente a fallo de consulta (2026-11-02) ---------------------------
// RIVAROXABAN AUROVITAS 10 MG (CN 725293) salió «Sin datos de financiación SNS — no figura en el
// Nomenclátor ni en BIFIMED» estando financiado: el Worker corta a veces con 503 «error code:
// 1102» (texto plano) y el `.catch` lo convertía en `found:false`.
console.log('\n— Ausencia frente a fallo de consulta —');
const respuesta = (status, cuerpo) => Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => (typeof cuerpo === 'string' ? Promise.reject(new SyntaxError('no JSON')) : Promise.resolve(cuerpo)),
});
const conFetch = async (secuencia) => {
    let llamadas = 0;
    sandbox.fetch = () => secuencia[Math.min(llamadas++, secuencia.length - 1)]();
    const r = await app._consultarFinanciacionCn('https://x/sns-catalog/by-cn/725293', {});
    return { r, llamadas };
};
const registro = { found: true, cn: '0725293', estado: 'ALTA' };

let caso = await conFetch([() => respuesta(200, registro)]);
check('200 con registro → el registro, sin reintento', caso.r.found === true && caso.llamadas === 1, true);
caso = await conFetch([() => respuesta(404, { cn: '0725293', found: false })]);
check('404 con found:false → ausencia real, sin marca de error', caso.r.found === false && !caso.r.error && caso.llamadas === 1, true);
caso = await conFetch([() => respuesta(503, 'error code: 1102'), () => respuesta(200, registro)]);
check('503 «1102» y luego 200 → el reintento recupera el registro', caso.r.found === true && caso.llamadas === 2, true);
caso = await conFetch([() => respuesta(503, 'error code: 1102')]);
check('503 dos veces → error, NUNCA ausencia', caso.r.error === true && caso.llamadas === 2, true);
caso = await conFetch([() => Promise.reject(new Error('timeout'))]);
check('red caída o timeout → error, NUNCA ausencia', caso.r.error === true, true);
caso = await conFetch([() => respuesta(200, { found: false })]);
check('200 sin registro (respuesta anómala) → error, no ausencia', caso.r.error === true, true);

// MUTANTE: el comportamiento anterior (`.catch(() => ({found:false}))`) tiene que fallar el contrato.
const consultaVieja = (p) => p.then(r => r.json()).catch(() => ({ found: false }));
const vieja = await consultaVieja(respuesta(503, 'error code: 1102'));
check('MUTANTE: la consulta vieja convertía el 1102 en ausencia sin marca de error',
    vieja.found === false && !vieja.error, true);

check('la pestaña pinta «No se pudo consultar» ANTES de cualquier nota de ausencia',
    fuente.indexOf('No se pudo consultar la financiación') > -1
    && fuente.indexOf('No se pudo consultar la financiación') < fuente.indexOf('Sin datos de financiación SNS'), true);
check('loadSnsFinancing ya no traga el fallo con `.catch(() => ({ found: false, cn }))`',
    fuente.includes('.catch(() => ({ found: false, cn }))'), false);

// --- El visado es un eje aparte (2026-11-02) ------------------------------------
// BIFIMED publica «Situación de financiación» y «Condiciones financiación restringidas: Visado» como
// campos independientes. RIVAROXABAN AUROVITAS 10 MG (84006, CN 725293) es «Si» CON visado y salía
// «Financiado por el SNS» a secas; RIVAROXABAN ALMUS 15 MG es «Sí para determinadas
// indicaciones/condiciones» con visado. El código 2 sin visado salía «con visado».
console.log('\n— El visado, eje aparte de la situación —');
const desdeConteos = (c) => app._financingSummaryFromCounts(c);
check('«Si» con visado → la etiqueta lo añade',
    desdeConteos({ fin: 1, visado: 1 }).label, 'Financiado por el SNS · Visado');
check('«Si» sin visado → sin visado', desdeConteos({ fin: 1 }).label, 'Financiado por el SNS');
check('código 2 sin visado → rótulo de BIFIMED, sin visado',
    desdeConteos({ cond: 1 }).label, 'Financiado para determinadas indicaciones/condiciones');
check('código 2 con visado → rótulo de BIFIMED + visado',
    desdeConteos({ cond: 2, visado: 2 }).label, 'Financiado para determinadas indicaciones/condiciones · Visado');
check('visado en parte de las financiadas → dice cuántas',
    desdeConteos({ fin: 2, visado: 1 }).label, 'Financiado por el SNS · Visado (1 de 2 presentaciones)');
check('una no financiada no hereda el visado', desdeConteos({ nofin: 1, visado: 1 }).label, 'No financiado por el SNS');
check('el visado no cambia el estado (la faceta no se mueve)', desdeConteos({ fin: 1, visado: 1 }).estado, 'si');

const enVivo = app._computeFinancingSummary(new Map([
    ['0725293', { found: true, sit: 'Si', visado: true }],
]));
check('camino en vivo: el CN de Aurovitas 10 mg lleva visado', enVivo.label, 'Financiado por el SNS · Visado');
const enVivoExcluido = app._computeFinancingSummary(new Map([
    ['1', { found: true, sit: 'Excluido', visado: true }],
]));
check('camino en vivo: el visado de una excluida no cuenta', enVivoExcluido.visado, undefined);

// Índice: el visado llega en un mapa aparte, y la tarjeta lo añade a su rótulo corto.
app._financingVisado = { 84006: 1 };
check('tarjeta: Aurovitas 10 mg (índice) → «Financiado por el SNS · Visado»',
    app._financingTagFromRow([1, 1, 0, 0, 0, 0, 0, 0], '84006')?.short, 'Financiado por el SNS · Visado');
check('tarjeta: código 2 sin visado → rótulo de BIFIMED',
    app._financingTagFromRow([1, 0, 1, 0, 0, 0, 0, 0], '88050')?.short, 'Financiado: determinadas indicaciones/condiciones');
app._financingVisado = null;
check('índice sin mapa de visado (anterior al 02/11) → no afirma nada del visado',
    app._financingTagFromRow([1, 1, 0, 0, 0, 0, 0, 0], '84006')?.short, 'Financiado por el SNS');

check('MUTANTE: ya no queda «Financiado con visado» deducido del código 2',
    fuente.includes("cond: 'Financiado con visado'"), false);
check('la pestaña pinta el visado con el rótulo de BIFIMED',
    fuente.includes("campo('Condiciones financiación restringidas', visadoHtml)"), true);
check('la pestaña pinta las indicaciones financiadas en texto',
    fuente.includes("campo('Indicaciones financiadas', r.indicaciones_financiadas"), true);

// --- La línea de Información, camino en vivo: fallo frente a ausencia (2026-11-07) ---------
// Punto 9 de la cola integrada. `_fetchFinancingByCns` convertía cualquier fallo en `found:false`:
// el 1102 en texto plano por el `.catch`, y el 503 con JSON del Worker (`{error:'bifimed no
// disponible'}`) porque `!!j.found` es false — y ese lo GUARDABA 24 h. La línea decía «Sin datos de
// financiación», o «Financiación parcial (… · 1 sin dato)» de un medicamento financiado entero.
console.log('\n— Línea de Información en vivo: fallo frente a ausencia —');
app.api = { cloudflareProxy: 'https://x' };
const almacen = {};
sandbox.localStorage = {
    getItem: (k) => (k in almacen ? almacen[k] : null),
    setItem: (k, v) => { almacen[k] = String(v); },
    removeItem: (k) => { delete almacen[k]; },
};
const cacheGuardada = () => JSON.parse(almacen.medcheck_fin_summary_cache_v3 || '{}');
const vaciarCache = () => { for (const k of Object.keys(almacen)) delete almacen[k]; };
// Respuesta por CN; cada CN tiene su propia secuencia (para el reintento interno).
const porCn = async (rutas, cns) => {
    const llamadas = {};
    sandbox.fetch = (url) => {
        const cn = String(url).split('/').pop();
        const n = (llamadas[cn] = (llamadas[cn] || 0) + 1);
        const seq = rutas[cn];
        return seq[Math.min(n - 1, seq.length - 1)]();
    };
    const map = await app._fetchFinancingByCns(cns);
    return { map, llamadas };
};
const bifSi = { found: true, cn: '0725293', situacion_financiacion: 'Si', visado: true };
const caido503 = () => respuesta(503, { error: 'bifimed no disponible', detail: 'KV vacío' });
const caido1102 = () => respuesta(503, 'error code: 1102');
const ausente = () => respuesta(404, { cn: '0000001', found: false });

vaciarCache();
let vivo = await porCn({ '725293': [caido503] }, ['725293']);
check('503 con JSON del Worker → error, NUNCA ausencia', vivo.map.get('725293')?.error, true);
check('…y se reintenta una vez', vivo.llamadas['725293'], 2);
check('…y NO se guarda en la caché', '725293' in cacheGuardada(), false);

vaciarCache();
vivo = await porCn({ '725293': [caido1102] }, ['725293']);
check('1102 en texto plano → error, NUNCA ausencia', vivo.map.get('725293')?.error, true);
check('…y NO se guarda en la caché', '725293' in cacheGuardada(), false);

vaciarCache();
vivo = await porCn({ '1': [ausente] }, ['1']);
check('404 con found:false → ausencia real, sin error', vivo.map.get('1')?.found === false && !vivo.map.get('1')?.error, true);
check('…y la ausencia real sí se guarda', cacheGuardada()['1']?.d?.found, false);

vaciarCache();
vivo = await porCn({ '725293': [caido1102, () => respuesta(200, bifSi)] }, ['725293']);
check('1102 y luego 200 → el reintento recupera la situación y el visado',
    JSON.stringify(vivo.map.get('725293')), JSON.stringify({ found: true, sit: 'Si', visado: true }));
check('…y se guarda', cacheGuardada()['725293']?.d?.sit, 'Si');

// «Reintentar»: lo que salió bien viene de la caché y solo se vuelve a preguntar por lo que falló.
vaciarCache();
await porCn({ '725293': [() => respuesta(200, bifSi)], '725294': [caido503] }, ['725293', '725294']);
vivo = await porCn({ '725293': [() => respuesta(200, bifSi)], '725294': [() => respuesta(200, { ...bifSi, cn: '0725294' })] },
    ['725293', '725294']);
check('al reintentar, el CN que ya respondió sale de la caché (0 peticiones)', vivo.llamadas['725293'], undefined);
check('…y el que falló se vuelve a preguntar y ahora responde', vivo.map.get('725294')?.found, true);

// El veredicto, con fallos.
const conFallos = (filas) => app._computeFinancingSummary(new Map(filas.map((f, i) => [String(i),
    f === 'error' ? { found: false, sit: '', error: true }
        : f === null ? { found: false, sit: '' }
            : { found: true, sit: f }])));
let rf = conFallos(['error']);
check('todas sin consultar → «No se pudo consultar la financiación»', rf.label, 'No se pudo consultar la financiación');
check('…con estado propio, no «sindato»', rf.estado, 'error');
check('…y lleva el recuento para el aviso', `${rf.error}/${rf.total}`, '1/1');
rf = conFallos(['Si', 'error']);
check('una financiada y una sin consultar → lo dice, sin llamarlo «sin dato»',
    rf.label, 'Financiación parcial (1 de 2 presentaciones · 1 sin consultar)');
rf = conFallos(['Excluido', 'error']);
check('una excluida y una sin consultar → «no financiado» con la que falta a la vista',
    rf.label, 'No financiado por el SNS (1 de 2 presentaciones · 1 sin consultar)');
rf = conFallos([null, 'error']);
check('una sin dato y una sin consultar → no se emite veredicto (nunca «0 de 2»)', rf.estado, 'error');
rf = conFallos(['Si', 'Si']);
check('sin fallos, nada cambia: «Financiado por el SNS» y sin campo error',
    `${rf.label}|${rf.error}`, 'Financiado por el SNS|undefined');
check('la tarjeta (índice) no conoce el estado de fallo: los conteos sin error no lo producen',
    desdeConteos({ sindato: 2 }).estado, 'sindato');

// El aviso de la ficha.
check('sin fallos, el aviso no pinta nada', app._financingRetryHtml(conFallos(['Si'])), '');
const avisoTotal = app._financingRetryHtml(conFallos(['error', 'error']));
check('todas sin consultar → dice que no significa «no financiado» y ofrece Reintentar',
    avisoTotal.includes('Esto no significa que el medicamento no esté financiado')
    && avisoTotal.includes('_reintentarResumenFinanciacion()'), true);
check('una de dos sin consultar → «No se pudo consultar 1 de 2 presentaciones»',
    app._financingRetryHtml(conFallos(['Si', 'error'])).includes('No se pudo consultar 1 de 2 presentaciones'), true);

// MUTANTES: el camino viejo tiene que fallar este contrato.
const fetchViejo = (p) => p.then(r => r.json())
    .then(j => ({ found: !!j.found, sit: j.situacion_financiacion || '' }))
    .catch(() => ({ found: false, sit: '' }));
const viejo503 = await fetchViejo(caido503());
check('MUTANTE: el camino viejo leía el 503 con JSON como ausencia (y lo habría guardado)',
    viejo503.found === false && !viejo503.error, true);
check('MUTANTE: con el camino viejo, un 1102 en todas las presentaciones decía «Sin datos de financiación»',
    app._computeFinancingSummary(new Map([['0', await fetchViejo(caido1102())]])).label, 'Sin datos de financiación');
const metodoFetch = fuente.slice(fuente.indexOf('async _fetchFinancingByCns('), fuente.indexOf('_classifyFinSit(sit, found) {'));
check('_fetchFinancingByCns consulta con _consultarFinanciacionCn', metodoFetch.includes('this._consultarFinanciacionCn('), true);
check('_fetchFinancingByCns ya no traga el fallo como found:false',
    /\.catch\(\(\) => \{ result\.set\(cn, \{ found: false/.test(metodoFetch), false);
check('la caché de la ficha cambia de clave (las entradas _v2 pudieron guardar un fallo)',
    fuente.includes("'medcheck_fin_summary_cache_v2'"), false);
sandbox.fetch = () => Promise.reject(new Error('sin red en tests'));

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
