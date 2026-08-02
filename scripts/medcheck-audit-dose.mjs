#!/usr/bin/env node
/**
 * MedCheck — auditoría del canonicalizador de dosis contra el catálogo real de CIMA.
 *
 * Complementa a `medcheck-test-dose.mjs`: ese fija el comportamiento caso a caso con cadenas
 * escogidas; este mide el comportamiento agregado sobre los ~16.000 medicamentos
 * comercializados. Las dos cosas hacen falta, y por un motivo concreto: en la revisión de S40
 * se decidió dejar de ordenar razones a partir de una estimación hecha a mano de cuántos
 * productos afectaba (2.093). La cifra real era 2.895. Una decisión de diseño se apoyó en un
 * número que el revisor no podía reproducir porque el catálogo no está en el repo. Este script
 * existe para que eso no vuelva a pasar.
 *
 * Comprueba tres INVARIANTES (si fallan, sale con código 1):
 *   1. La etiqueta de la tarjeta y la del filtro coinciden en todos los productos.
 *   2. Los ilegibles quedan al final del orden por dosis, en ambos sentidos.
 *   3. Un mismo criterio de orden da la misma secuencia por cualquier ruta de llegada.
 *
 * Y publica MÉTRICAS descriptivas, que no fallan pero conviene vigilar: cuántos productos no
 * tienen valor de orden y por qué, cuántos pares de misma unidad se ordenan por su primer
 * componente, y cuántos chips de dosis se fusionarían si la clave de agrupación fuese numérica.
 * Más una COLA DE REVISIÓN humana con los pares cuyo nombre declara una razón que la dosis no.
 *
 * Códigos de salida, porque "no lo sé" no es "está bien":
 *   0  los invariantes se cumplen
 *   1  algún invariante roto — sabemos que está mal
 *   2  INCONCLUSO — catálogo truncado, caché caducada, esquema inválido o CIMA inaccesible.
 *      No se emiten cifras: unas métricas sobre un catálogo incompleto describen otra cosa.
 *
 * Uso:
 *   node scripts/medcheck-audit-dose.mjs                     descarga el catálogo y audita
 *   node scripts/medcheck-audit-dose.mjs --cache              reutiliza/crea una copia local
 *   node scripts/medcheck-audit-dose.mjs --catalog=ruta.json  audita un volcado concreto
 *   node scripts/medcheck-audit-dose.mjs --json               salida legible por máquina
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CIMA_BASE = 'https://cima.aemps.es/cima/rest';
const MAX_PAGES = 200;              // tope de seguridad (hoy hacen falta ~81)
const CACHE_PATH = join(ROOT, '.cache', 'cima-comercializados.json');
// El catálogo de CIMA cambia a diario, así que la caché caduca en un día: una copia más vieja
// presentaría cifras antiguas como si describieran el catálogo de hoy, que es exactamente el
// error que motivó este script. El coste de acortarlo es solo tiempo (volver a bajar ~81
// páginas); no hay contrapartida de correción, así que no hay motivo para ser laxo.
// Solo afecta a la caché implícita: un volcado pasado a mano con --catalog= se acepta a
// cualquier edad, porque su propósito es reproducir una medición concreta.
const CACHE_MAX_DIAS = 1;

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');
const useCache = args.has('--cache');
const catalogArg = [...args].find(a => a.startsWith('--catalog='))?.slice('--catalog='.length);

// --- El módulo real, en un sandbox: misma técnica que medcheck-test-dose.mjs ---------------
const sandbox = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en la auditoría')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
    `${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__MedCheckAppClass = MedCheckApp;`,
    sandbox
);
const MedCheckApp = sandbox.window.__MedCheckAppClass;
const app = Object.create(MedCheckApp.prototype);
const UNK = MedCheckApp.DOSE_SORT_UNKNOWN;

// --- Catálogo -----------------------------------------------------------------------------
//
// Un catálogo truncado, rancio o con esquema raro NO puede terminar en "OK": daría por buenas
// unas cifras que describen otra cosa. Todo lo que impide auditar con garantías devuelve
// INCONCLUSO (código 2), que es distinto de un invariante roto (código 1).
class AuditoriaInconclusa extends Error {}

/** Envoltorio con procedencia: sin esto, una copia local no acredita de qué catálogo habla. */
function envolver(registros, fuente, totalDeclarado) {
    return {
        esquema: 1,
        fuente,
        fecha: new Date().toISOString(),
        totalDeclarado,
        registros,
    };
}

async function descargarCatalogo() {
    const out = [];
    let pagina = 1;
    let total = null;
    let truncadoPorTope = false;
    while (true) {
        if (pagina > MAX_PAGES) { truncadoPorTope = true; break; }
        const r = await fetch(`${CIMA_BASE}/medicamentos?comerc=1&pagina=${pagina}`);
        if (!r.ok) {
            throw new AuditoriaInconclusa(`CIMA devolvió HTTP ${r.status} en la página ${pagina}`);
        }
        const d = await r.json();
        total = d.totalFilas ?? total;
        for (const m of d.resultados || []) {
            out.push({
                nregistro: m.nregistro,
                nombre: m.nombre,
                dosis: m.dosis ?? null,
                // `vtm` es el principio activo virtual: la unidad correcta para simular "una
                // búsqueda real", porque una búsqueda por PA devuelve justo ese conjunto.
                vtm: m.vtm?.nombre ?? null,
                forma: m.formaFarmaceutica?.nombre ?? null,
            });
        }
        if (!d.resultados?.length || (total && out.length >= total)) break;
        pagina += 1;
    }
    if (truncadoPorTope) {
        throw new AuditoriaInconclusa(
            `se alcanzó el tope de ${MAX_PAGES} páginas con ${out.length} registros`
            + ` (declarados ${total ?? '?'}): sube MAX_PAGES`);
    }
    if (total === null) throw new AuditoriaInconclusa('CIMA no declaró totalFilas');
    if (out.length !== total) {
        throw new AuditoriaInconclusa(
            `descargados ${out.length} de ${total} declarados por CIMA`);
    }
    return envolver(out, `${CIMA_BASE}/medicamentos?comerc=1`, total);
}

/**
 * Valida forma y contenido. Cualquier duda sobre la procedencia deja la auditoría inconclusa.
 *
 * `exigirFrescura` distingue dos usos que no son el mismo:
 *   - la caché implícita (`--cache`) pretende describir el catálogo de HOY, así que caducar es
 *     un fallo: presentaría cifras viejas como actuales, que es el error que motivó el script;
 *   - un volcado explícito (`--catalog=`) es un acto deliberado para REPRODUCIR una medición
 *     concreta. Exigirle frescura rompería el propósito del script: mañana ya no se podría
 *     verificar el volcado de hoy. Se acepta a cualquier edad, pero la salida la declara y
 *     marca `describeCatalogoActual: false`.
 */
function validarVolcado(v, origen, { exigirFrescura = true } = {}) {
    if (Array.isArray(v)) {
        throw new AuditoriaInconclusa(
            `${origen} es un array desnudo, sin fuente ni fecha: no acredita de qué catálogo`
            + ' habla. Regenéralo con --cache.');
    }
    if (!v || v.esquema !== 1 || !Array.isArray(v.registros)) {
        throw new AuditoriaInconclusa(`${origen} no tiene el esquema esperado (esquema: 1)`);
    }
    if (!v.fecha || Number.isNaN(Date.parse(v.fecha))) {
        throw new AuditoriaInconclusa(`${origen} no lleva fecha válida`);
    }
    if (typeof v.totalDeclarado === 'number' && v.registros.length !== v.totalDeclarado) {
        throw new AuditoriaInconclusa(
            `${origen} está truncado: ${v.registros.length} registros de ${v.totalDeclarado}`);
    }
    const dias = (Date.now() - Date.parse(v.fecha)) / 86_400_000;
    if (exigirFrescura && dias > CACHE_MAX_DIAS) {
        throw new AuditoriaInconclusa(
            `${origen} tiene ${dias.toFixed(1)} días (máximo ${CACHE_MAX_DIAS}).`
            + ' El catálogo de CIMA cambia a diario, así que estas cifras describirían otro'
            + ` catálogo. Borra ${CACHE_PATH} o ejecuta sin --cache para descargar de nuevo.`);
    }
    // Unicidad: un `nregistro` repetido inflaría recuentos y podría falsear un invariante.
    const vistos = new Set();
    const repetidos = [];
    for (const m of v.registros) {
        if (vistos.has(m.nregistro)) repetidos.push(m.nregistro);
        vistos.add(m.nregistro);
    }
    if (repetidos.length) {
        throw new AuditoriaInconclusa(
            `${origen} tiene ${repetidos.length} nregistro repetidos (p. ej. ${repetidos[0]})`);
    }
    if (v.registros.some(m => typeof m.nregistro !== 'string' && typeof m.nregistro !== 'number')) {
        throw new AuditoriaInconclusa(`${origen} tiene registros sin nregistro`);
    }
    return {
        ...v,
        diasDeAntiguedad: Number(dias.toFixed(2)),
        unicos: vistos.size,
        describeCatalogoActual: dias <= CACHE_MAX_DIAS,
    };
}

async function obtenerCatalogo() {
    if (catalogArg) {
        const ruta = resolve(catalogArg);
        // Sin exigir frescura: reproducir una medición pasada es el motivo de existir de --catalog.
        return validarVolcado(JSON.parse(readFileSync(ruta, 'utf8')), ruta, { exigirFrescura: false });
    }
    if (useCache && existsSync(CACHE_PATH)) {
        return validarVolcado(JSON.parse(readFileSync(CACHE_PATH, 'utf8')), 'la caché local');
    }
    const v = await descargarCatalogo();
    if (useCache) {
        mkdirSync(dirname(CACHE_PATH), { recursive: true });
        writeFileSync(CACHE_PATH, JSON.stringify(v));
    }
    return validarVolcado(v, 'la descarga en vivo');
}

// --- Utilidades ---------------------------------------------------------------------------
const porVtm = (cat) => {
    const m = new Map();
    for (const med of cat) {
        const k = (med.vtm || '').trim().toLowerCase();
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(med);
    }
    return m;
};

/** Clave numérica en unidad base de una potencia simple. `null` si no la hay. */
const claveNumerica = (dosis) => {
    const canon = app.normalizeDosis(dosis);
    const re = new RegExp(`^(\\d[\\d.,]*)\\s*(${app._doseUnitAlternation()})(?![a-záéíóúñ0-9])$`, 'i');
    const m = re.exec(canon);
    if (!m) return null;
    const v = app._parseDoseNumber(m[1]);
    if (v === null) return null;
    const u = app._canonicalDoseUnit(m[2]);
    const EN_MG = { mcg: 1e-3, mg: 1, g: 1e3 };
    return EN_MG[u] ? `masa:${v * EN_MG[u]}` : `${u}:${v}`;
};

const ordenar = (lista, sortBy) => {
    app.groupingState = { sortBy };
    return app._applySortState([...lista]);
};

// --- Auditoría ----------------------------------------------------------------------------
let volcado;
try {
    volcado = await obtenerCatalogo();
} catch (e) {
    const inconcluso = e instanceof AuditoriaInconclusa;
    const msg = `INCONCLUSO — no se pudo auditar: ${e.message}`;
    if (asJson) console.log(JSON.stringify({ estado: 'inconclusive', motivo: e.message }, null, 2));
    else console.error(msg);
    // 2 = inconcluso (no sabemos), distinto de 1 = invariante roto (sabemos que está mal).
    process.exit(inconcluso ? 2 : 2);
}

const cat = volcado.registros;
const procedencia = {
    fuente: volcado.fuente,
    fecha: volcado.fecha,
    diasDeAntiguedad: volcado.diasDeAntiguedad,
    // false = las cifras describen el catálogo de esa fecha, no el de hoy. Solo puede pasar
    // con --catalog=, que se acepta a cualquier edad para poder reproducir mediciones.
    describeCatalogoActual: volcado.describeCatalogoActual,
    totalDeclarado: volcado.totalDeclarado,
    registros: cat.length,
    nregistroUnicos: volcado.unicos,
};
const conDosis = cat.filter(m => m.dosis && String(m.dosis).trim());
const grupos = porVtm(cat);
const fallos = [];
const metricas = { productos: cat.length, conDosis: conDosis.length };

// INVARIANTE 1 — la tarjeta y el filtro no pueden mostrar dosis distintas.
const divergentes = conDosis.filter(m => app._displayDose(m.dosis).text !== app.normalizeDosis(m.dosis));
metricas.etiquetasDivergentes = divergentes.length;
if (divergentes.length) {
    fallos.push(`${divergentes.length} productos muestran dosis distinta en tarjeta y filtro`
        + ` (p. ej. ${JSON.stringify(divergentes[0].dosis)})`);
}

// INVARIANTE 2 — los ilegibles al final, en ambos sentidos. Importa porque la vista plana
// recorta: si un ilegible se cuela delante, desplaza a un legible fuera del primer tramo.
const sinCentinelaAlFinal = [];
for (const [pa, meds] of grupos) {
    if (meds.length < 2) continue;
    for (const dir of ['doseAsc', 'doseDesc']) {
        const ord = ordenar(meds, dir);
        const primerUnk = ord.findIndex(m => app._doseSortValue(m.dosis) === UNK);
        const ultimoLegible = ord.reduce((acc, m, i) => app._doseSortValue(m.dosis) !== UNK ? i : acc, -1);
        if (primerUnk !== -1 && primerUnk < ultimoLegible) sinCentinelaAlFinal.push(`${pa} (${dir})`);
    }
}
metricas.gruposConCentinelaMalColocado = sinCentinelaAlFinal.length;
if (sinCentinelaAlFinal.length) {
    fallos.push(`ilegibles delante de legibles en ${sinCentinelaAlFinal.length} casos`
        + ` (p. ej. ${sinCentinelaAlFinal[0]})`);
}

// INVARIANTE 3 — el mismo criterio da la misma secuencia por cualquier ruta. Sin desempate
// total, `Array.sort` es estable y arrastra el orden anterior: una URL compartida con
// `sortBy=doseDesc` no reproducía lo que veía quien la compartió.
const CRITERIOS = ['nameAsc', 'nameDesc', 'doseAsc', 'doseDesc'];
const inestables = [];
for (const [pa, meds] of grupos) {
    if (meds.length < 2) continue;
    for (const c of CRITERIOS) {
        const directo = ordenar(meds, c).map(m => m.nregistro).join(',');
        const rutas = [
            ...CRITERIOS.map(previo => ordenar(ordenar(meds, previo), c)),
            ordenar([...meds].reverse(), c),
        ].map(l => l.map(m => m.nregistro).join(','));
        if (rutas.some(r => r !== directo)) inestables.push(`${pa} (${c})`);
    }
}
metricas.combinacionesInestables = inestables.length;
if (inestables.length) {
    fallos.push(`el orden depende de la ruta de llegada en ${inestables.length} casos`
        + ` (p. ej. ${inestables[0]})`);
}

// MÉTRICA — sin valor de orden, y por qué.
const sinOrden = conDosis.filter(m => app._doseSortValue(m.dosis) === UNK);
const porMotivo = { formaNoComparable: 0, cifraIndecidible: 0 };
for (const m of sinOrden) {
    const canon = app.normalizeDosis(m.dosis);
    if (!app._isComparableDoseShape(canon)) porMotivo.formaNoComparable += 1;
    else porMotivo.cifraIndecidible += 1;
}
metricas.sinValorDeOrden = sinOrden.length;
metricas.sinValorDeOrdenPct = Number((100 * sinOrden.length / conDosis.length).toFixed(1));
metricas.motivos = porMotivo;

// MÉTRICA — pares de misma unidad, que se ordenan por su PRIMER componente.
//
// La puerta de forma los admite a propósito: `875 mg/125 mg` es una cantidad (amoxicilina más
// clavulánico), no un cociente, y ordenarla por el componente principal es defendible. Pero la
// cadena no distingue una combinación de una concentración masa/masa: `2 g/15 g` puede ser
// cualquiera de las dos. Es la ambigüedad residual conocida de la rama de combinaciones de
// `_canonicalDose`, y esta métrica existe para vigilar que no crezca. NO es un fallo.
const esParMismaUnidad = (dosis) => {
    if (app._doseSortValue(dosis) === UNK) return false;
    return /\//.test(app.normalizeDosis(dosis));
};
const pares = conDosis.filter(m => esParMismaUnidad(m.dosis));
const cadenasPares = new Set(pares.map(m => app.normalizeDosis(m.dosis)));
metricas.paresMismaUnidad = { productos: pares.length, cadenas: cadenasPares.size };

// COLA DE REVISIÓN — pares cuyo NOMBRE declara una razón que la dosis no declara.
//
// `_doseSortValue` solo recibe la cadena `dosis`, así que no puede saber que el `100 mg/2 mg`
// de TRAMADOL KRKA es en realidad 100 mg/2 ML (CIMA escribe `mg` donde toca `ml`) ni que el
// `2,2 mg/270 mg` de AXHIDROX es 2,2 mg por pulsación. El nombre sí lo dice, y aquí sí lo
// tenemos: cruzarlos saca esos casos a la luz.
//
// Es una COLA DE REVISIÓN HUMANA, no un clasificador, y no falla la auditoría. Da falsos
// positivos por diseño: FORMODUAL `100 mcg/6 mcg` es una combinación real de beclometasona y
// formoterol cuyo nombre lleva `/PULSACION` porque la combinación se dosifica por pulsación.
// Distinguir unos de otros exige criterio clínico, que es justo lo que no se automatiza.
const RAZON_EN_NOMBRE = /\/\s*(ml|l|g|h|hora|horas|24\s*h|12\s*h|dosis|puls\w*|aplicaci\w*|cm2|m2|min|kg)\b/i;
const colaRevision = pares
    .filter(m => RAZON_EN_NOMBRE.test(m.nombre || ''))
    .map(m => ({ nregistro: m.nregistro, dosis: app.normalizeDosis(m.dosis), nombre: m.nombre }));
metricas.colaRevisionParesDudosos = colaRevision.length;

// MÉTRICA — R1: millares de actividad rescatados solo para ordenar.
const rescatadosR1 = conDosis.filter(m => {
    const canon = app.normalizeDosis(m.dosis);
    if (app._doseSortValue(m.dosis) === UNK) return false;
    const re = new RegExp(`^(\\d[\\d.,]*)\\s*(${app._doseUnitAlternation()})(?![a-záéíóúñ0-9])`, 'i');
    const mm = re.exec(canon);
    return mm && app._parseDoseNumber(mm[1]) === null;
});
metricas.rescatadosPorR1 = rescatadosR1.length;

// MÉTRICA — oportunidad de fusión de chips (la "mejora 2" que se cerró). Se mide por PA
// porque una búsqueda real devuelve un principio activo, no el catálogo entero.
let paConFusion = 0;
let chipsAntes = 0;
let chipsDespues = 0;
for (const [, meds] of grupos) {
    const etiquetas = new Set(meds.filter(m => m.dosis).map(m => app.normalizeDosis(m.dosis)));
    const claves = new Set(meds.filter(m => m.dosis).map(m => claveNumerica(m.dosis) || app.normalizeDosis(m.dosis)));
    if (claves.size < etiquetas.size) {
        paConFusion += 1;
        chipsAntes += etiquetas.size;
        chipsDespues += claves.size;
    }
}
metricas.fusionDeChips = {
    principiosActivos: grupos.size,
    paQueFusionarian: paConFusion,
    chipsAntes,
    chipsDespues,
    chipsAhorrados: chipsAntes - chipsDespues,
};

// --- Salida -------------------------------------------------------------------------------
const estado = fallos.length === 0 ? 'ok' : 'failed';
if (asJson) {
    console.log(JSON.stringify({ estado, procedencia, fallos, metricas, colaRevision }, null, 2));
} else {
    const pct = (n) => `${(100 * n / conDosis.length).toFixed(1)} %`;
    console.log('PROCEDENCIA');
    console.log(`  fuente:    ${procedencia.fuente}`);
    console.log(`  fecha:     ${procedencia.fecha} (${procedencia.diasDeAntiguedad} días)`);
    console.log(`  registros: ${procedencia.registros} obtenidos`
        + `, ${procedencia.totalDeclarado ?? '?'} declarados por CIMA`
        + `, ${procedencia.nregistroUnicos} nregistro únicos`);
    console.log(`  con dosis no vacía: ${conDosis.length}`);
    if (!procedencia.describeCatalogoActual) {
        console.log(`  AVISO: este volcado tiene ${procedencia.diasDeAntiguedad} días.`
            + ' Las cifras describen el catálogo de esa fecha, NO el actual.');
    }
    console.log('');

    console.log('INVARIANTES');
    console.log(`  ${divergentes.length === 0 ? 'OK  ' : 'FALLO'} tarjeta y filtro coinciden`
        + `${divergentes.length ? ` — ${divergentes.length} divergencias` : ''}`);
    console.log(`  ${sinCentinelaAlFinal.length === 0 ? 'OK  ' : 'FALLO'} ilegibles al final en ambos sentidos`
        + `${sinCentinelaAlFinal.length ? ` — ${sinCentinelaAlFinal.length} casos` : ''}`);
    console.log(`  ${inestables.length === 0 ? 'OK  ' : 'FALLO'} el orden no depende de la ruta de llegada`
        + `${inestables.length ? ` — ${inestables.length} casos` : ''}`
        + ` (${grupos.size} principios activos × ${CRITERIOS.length} criterios)`);

    console.log('\nMÉTRICAS');
    console.log(`  sin valor de orden: ${sinOrden.length} (${pct(sinOrden.length)})`);
    console.log(`      forma no comparable (razón, triple, texto libre): ${porMotivo.formaNoComparable}`);
    console.log(`      cifra indecidible en una forma comparable:        ${porMotivo.cifraIndecidible}`);
    console.log(`  rescatados por R1 (millares de actividad): ${rescatadosR1.length}`);
    for (const m of rescatadosR1.slice(0, 5)) console.log(`      ${JSON.stringify(m.dosis)}`);
    console.log(`  pares de misma unidad, ordenados por su primer componente:`
        + ` ${pares.length} productos en ${cadenasPares.size} cadenas`);
    console.log('      (combinaciones legítimas y concentraciones masa/masa, indistinguibles'
        + ' por la cadena: ambigüedad conocida, no un fallo)');
    for (const c of [...cadenasPares].slice(0, 4)) console.log(`      ${c}`);
    const f = metricas.fusionDeChips;
    console.log(`  fusión de chips si la clave fuese numérica: ${f.paQueFusionarian} de ${f.principiosActivos} PA,`
        + ` ${f.chipsAntes} → ${f.chipsDespues} chips (ahorro ${f.chipsAhorrados})`);

    console.log(`\nCOLA DE REVISIÓN — ${colaRevision.length} pares cuyo nombre declara una razón`);
    console.log('  Revisión humana, no fallo. Da falsos positivos: una combinación real puede'
        + ' dosificarse por pulsación.');
    for (const r of colaRevision.slice(0, 12)) {
        console.log(`  ${String(r.dosis).padEnd(20)} ${r.nombre.slice(0, 62)}`);
    }
    if (colaRevision.length > 12) console.log(`  … y ${colaRevision.length - 12} más (usa --json)`);

    console.log(estado === 'ok' ? '\nOK — los invariantes se cumplen' : `\nFALLOS:\n  - ${fallos.join('\n  - ')}`);
}

// 0 = invariantes OK · 1 = invariante roto · 2 = inconcluso (ver el catch de obtenerCatalogo)
process.exit(estado === 'ok' ? 0 : 1);
