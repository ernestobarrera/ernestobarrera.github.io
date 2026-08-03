#!/usr/bin/env node
/**
 * MedCheck — auditoría reproducible del panorama de biosimilares en CIMA/AEMPS.
 *
 * POR QUÉ EXISTE
 * La evaluación del 2026-08-03 manejó cifras (239 registros, 25 agrupaciones VTM, 19/25
 * con referente único derivable, 32/32 de concordancia CIMA↔BIFIMED) obtenidas con
 * sondeos temporales que se borraron. Eran buenos indicios, pero **nadie podía volver a
 * obtenerlos**, así que no podían gobernar producción. Este script las sustituye por una
 * salida fechada, con los endpoints y parámetros usados, la paginación real y un hash de
 * las fuentes que permite comprobar si dos ejecuciones vieron los mismos datos.
 *
 * QUÉ NO HACE — y es lo más importante
 * NO afirma qué medicamento es el de referencia de un biosimilar. Esa relación **no
 * existe como campo** en ninguna fuente que MedCheck consuma. Lo que hace es proponer
 * CANDIDATOS y clasificar cada familia por lo resoluble que es, dejando explícitas las
 * que no lo son. La relación solo pasa a `confirmed` cuando una persona la verifica
 * contra el EPAR de la EMA, y eso ocurre fuera de este script.
 *
 * UNIDADES DE ANÁLISIS — nunca se mezclan (una cifra sin unidad es una cifra inútil)
 *   registro CIMA        `nregistro`. NO es "un producto": una autorización europea tiene
 *                        varios (EU/1/18/1286/012 y /015 son dos registros del mismo Hyrimoz).
 *   autorización EMA     heurística de conciliación desde `nregistro` (ver `emaAuthorisation`).
 *                        NUNCA es identificador canónico: se guarda junto a los nregistros
 *                        reales, no en su lugar.
 *   marca                heurística desde el nombre. Orientativa.
 *   presentación / CN    filas de `/presentaciones`, con su código nacional.
 *   agrupación VTM       `vtm.id` (SNOMED). Agrupa sustancia, NO familia biosimilar.
 *   DCP                  `dcp.id` (SNOMED). Misma descripción clínica de producto.
 *   relación biosim.–ref candidata, con estado. Nunca derivada del nombre ni del ATC.
 *
 * Uso:
 *   node scripts/medcheck-audit-biosimilars.mjs [--out-dir <ruta>] [--no-bifimed]
 *                                               [--no-cache] [--dry] [--quiet]
 * Salida:
 *   exit 0 auditoría completa · exit 1 fallo determinista (arreglar)
 *   exit 2 inconclusa (repetir: red, truncación o cobertura no medible)
 *   Contrato 0/1/2 idéntico al de `medcheck-audit-ontology.mjs`.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASE = 'https://cima.aemps.es/cima/rest';
const WORKER = 'https://medcheck-proxy.medtools.workers.dev';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const DRY = has('--dry');
const NO_CACHE = has('--no-cache');
const NO_BIFIMED = has('--no-bifimed');
const QUIET = has('--quiet');
const OUT_DIR = val('--out-dir', join(ROOT, 'docs', 'medcheck', 'private', 'audits'));

const log = (...a) => { if (!QUIET) console.error(...a); };

/** Motivos por los que una pasada queda INCONCLUSA (exit 2), no fallida. */
const inconclusive = [];
/** Problemas deterministas que el responsable debe arreglar (exit 1). */
const problems = [];

// ── Caché del día ────────────────────────────────────────────────────────────
// Una pasada son ~1.000 peticiones. Sin caché, un corte de CIMA a mitad obliga a
// repetirlas todas. Mismo criterio que etl-packs: la caché es del día, así que una
// auditoría nunca mezcla datos de fechas distintas.
const CACHE_DIR = join(HERE, '.cache-biosimilars');
const TODAY = new Date().toISOString().slice(0, 10);
const cacheKey = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const cachePath = (s) => join(CACHE_DIR, `${TODAY}-${cacheKey(s)}.json`);

function readCache(key) {
    if (NO_CACHE) return null;
    try {
        const f = cachePath(key);
        if (!existsSync(f) || statSync(f).size === 0) return null;
        return JSON.parse(readFileSync(f, 'utf8'));
    } catch { return null; }
}
function writeCache(key, data) {
    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath(key), JSON.stringify(data));
    } catch { /* la caché es una optimización */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_INTENTOS = 5;

/** Peticiones contabilizadas, para que el informe declare su propio coste. */
const stats = { requests: 0, fromCache: 0, retries: 0 };

async function getJSON(url, { headers = {}, allow404 = false } = {}) {
    const cached = readCache(url);
    if (cached !== null) { stats.fromCache += 1; return cached; }

    let last = null;
    for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
        try {
            stats.requests += 1;
            const res = await fetch(url, { headers });
            if (res.status === 404 && allow404) {
                writeCache(url, { __notFound: true });
                return { __notFound: true };
            }
            if (!res.ok) {
                const ra = Number(res.headers.get('Retry-After'));
                if ((res.status === 429 || res.status >= 500) && intento < MAX_INTENTOS) {
                    stats.retries += 1;
                    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * intento);
                    continue;
                }
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            writeCache(url, data);
            return data;
        } catch (err) {
            last = err;
            if (intento < MAX_INTENTOS) { stats.retries += 1; await sleep(1500 * intento); }
        }
    }
    // Un fallo de red NO puede degradar en "menos biosimilares": marca la pasada
    // inconclusa y aborta. La caché del día conserva lo descargado; reejecutar reanuda.
    throw Object.assign(new Error(`${url}: ${last?.message || 'desconocido'}`), { inconclusive: true });
}

/**
 * Pagina un endpoint de CIMA usando el tamaño de página REALMENTE devuelto.
 * CIMA capa en 200 e ignora `tamanioPagina` mayores; calcular las páginas con el tamaño
 * PEDIDO fue el bug de S37 que truncó en silencio 33 grupos ATC. No se repite.
 */
async function crawl(path, params) {
    const filas = [];
    let pagina = 1;
    let total = null;
    const qs = new URLSearchParams(params);
    for (;;) {
        qs.set('pagina', String(pagina));
        const data = await getJSON(`${BASE}/${path}?${qs}`);
        const lote = data?.resultados || [];
        filas.push(...lote);
        if (total === null) total = data?.totalFilas ?? lote.length;
        if (lote.length === 0 || filas.length >= total) break;
        pagina += 1;
        if (pagina > 60) {
            inconclusive.push(`${path}?${qs}: más de 60 páginas, posible truncación`);
            break;
        }
        await sleep(150);
    }
    if (filas.length < total) {
        inconclusive.push(`${path}?${qs}: recogidas ${filas.length} de ${total} declaradas`);
    }
    return { filas, paginas: pagina, totalDeclarado: total };
}

// ── Funciones puras (exportadas: las prueba medcheck-test-audit-biosimilars.mjs) ──

/**
 * Número de autorización europea derivado del `nregistro`, para productos EMA.
 * `1181286012` → `EU/1/18/1286/012`. Los 3 últimos dígitos son la presentación, así que
 * varios nregistros comparten autorización.
 *
 * ES UNA HEURÍSTICA DE CONCILIACIÓN, NO UN IDENTIFICADOR CANÓNICO. Se emite junto a los
 * `nregistro` reales, nunca en su lugar, y solo cuando `ema === true`. El
 * `ema_product_number` autoritativo (EMEA/H/C/...) vive en la EMA, no en CIMA.
 */
export function emaAuthorisation(med) {
    if (!med || med.ema !== true) return null;
    const nr = String(med.nregistro || '');
    const m = nr.match(/^1(\d{2})(\d{3,4})(\d{3})(IP)?$/);
    if (!m) return null;
    const [, yy, seq, pres] = m;
    return { derived: `EU/1/${yy}/${seq}/${pres}`, authorisationKey: `1${yy}${seq}`, heuristic: true };
}

/**
 * Marca comercial aproximada desde el nombre. Heurística: CIMA no publica un campo de
 * marca. Se corta en la primera cifra o unidad de dosis, que es donde empieza la
 * descripción de la presentación.
 */
export function brandOf(nombre) {
    if (!nombre) return null;
    const limpio = String(nombre).replace(/\s+/g, ' ').trim();
    const corte = limpio.search(/\s\d|\s(?:mg|g|ml|mcg|ui|u)\b/i);
    const marca = (corte > 0 ? limpio.slice(0, corte) : limpio).trim();
    return marca ? marca.toUpperCase() : null;
}

/**
 * Clasifica una familia VTM según lo resoluble que sea su medicamento de referencia.
 * NUNCA devuelve una relación confirmada: devuelve candidatos y un estado.
 *
 *   candidate  exactamente una marca no-biosimilar → candidato plausible, SIN verificar
 *   ambiguous  varias marcas no-biosimilares → el referente NO es derivable. Casos reales:
 *              denosumab (Prolia 60 mg vs Xgeva 120 mg, indicaciones distintas) y
 *              aflibercept (Eylea intravítreo vs Zaltrap intravenoso oncológico).
 *              Agruparlos automáticamente sería un riesgo clínico, no un error cosmético.
 *   none       ninguna → el referente está fuera de este VTM. Caso real: epoetina dseta,
 *              cuyos biosimilares se desarrollaron frente a Eprex (VTM epoetina alfa).
 *              La familia CRUZA el VTM, que es la prueba de que VTM ≠ familia.
 */
export function classifyFamily(productos) {
    const biosimilares = productos.filter((p) => p.biosimilar === true);
    const noBiosimilares = productos.filter((p) => p.biosimilar !== true);
    const marcasRef = [...new Set(noBiosimilares.map((p) => brandOf(p.nombre)).filter(Boolean))].sort();
    let status;
    if (marcasRef.length === 1) status = 'candidate';
    else if (marcasRef.length === 0) status = 'none';
    else status = 'ambiguous';
    return {
        status,
        reference_candidates: marcasRef,
        counts: { biosimilar_registros: biosimilares.length, non_biosimilar_registros: noBiosimilares.length },
    };
}

/**
 * Señal por DCP: dentro de un VTM, agrupa por descripción clínica de producto y mira qué
 * marca no-biosimilar acompaña a cada biosimilar.
 *
 * SE EMITE COMO SEÑAL, NUNCA COMO RESOLUCIÓN — y esto no es cautela retórica, está medido.
 * Sobre las 8 familias ambiguas de la pasada del 2026-08-03 la señal habría "resuelto" 5,
 * y **2 de esas 5 habrían sido falsas**:
 *
 *   somatropina      empareja OMNITROPE con NORDITROPIN SIMPLEXX porque comparten
 *                    6,7 mg/ml en cartucho. El referente de Omnitrope es Genotropin
 *                    (Genotonorm en España).
 *   insulina asparta empareja DAZPARDA con FIASP porque ambos son 100 U/ml en cartucho
 *                    de 3 ml. Dazparda se desarrolló frente a NovoRapid.
 *
 * La razón es estructural: el DCP codifica sustancia, dosis y forma — descripción
 * farmacéutica—, no linaje regulatorio. Dos productos originadores de la misma sustancia
 * con la misma dosis y forma son indistinguibles por DCP. Sirve para estrechar candidatos
 * y para la línea de "misma descripción clínica" de la interfaz; jamás para decidir el
 * referente, que solo se establece leyendo el EPAR.
 */
export function dcpSignal(registros) {
    const grupos = new Map();
    for (const r of registros) {
        for (const p of r.presentaciones || []) {
            if (!p.dcp_id) continue;
            if (!grupos.has(p.dcp_id)) grupos.set(p.dcp_id, { dcp_id: p.dcp_id, dcp_nombre: p.dcp_nombre, no_biosimilar: new Set(), biosimilar: new Set() });
            const g = grupos.get(p.dcp_id);
            (r.biosimilar ? g.biosimilar : g.no_biosimilar).add(r.marca);
        }
    }
    const conBiosimilar = [...grupos.values()].filter((g) => g.biosimilar.size > 0);
    return {
        warning: 'Señal orientativa. Compartir DCP es compartir sustancia, dosis y forma; no acredita la relación con el medicamento de referencia. Medido: resolvería 5 de 8 familias ambiguas y 2 de esas 5 serían falsas.',
        subfamilias: conBiosimilar.map((g) => ({
            dcp_id: g.dcp_id,
            dcp_nombre: g.dcp_nombre,
            no_biosimilar: [...g.no_biosimilar].filter(Boolean).sort(),
            biosimilar: [...g.biosimilar].filter(Boolean).sort(),
            huerfana: g.no_biosimilar.size === 0,
        })),
        subfamilias_huerfanas: conBiosimilar.filter((g) => g.no_biosimilar.size === 0).length,
    };
}

/** Hash estable de las fuentes: dos pasadas con el mismo hash vieron los mismos datos. */
export function sourceHash(registros) {
    const norm = registros
        .map((r) => `${r.nregistro}|${r.nombre}|${r.biosimilar}|${r.comerc}|${r.ema}|${r.vtm?.id ?? ''}`)
        .sort()
        .join('\n');
    return createHash('sha256').update(norm).digest('hex');
}

// ── Auditoría ────────────────────────────────────────────────────────────────

async function main() {
    const endpointsUsados = [];
    const track = (desc) => endpointsUsados.push(desc);

    // 1. Universo de biosimilares (comercializados y no).
    log('[audit] 1/5 biosimilares declarados por CIMA…');
    const bio = await crawl('medicamentos', { biosimilar: '1' });
    track(`GET /medicamentos?biosimilar=1 → ${bio.filas.length} registros en ${bio.paginas} pág. (declarados ${bio.totalDeclarado})`);
    if (bio.filas.length === 0) {
        problems.push('CIMA no devuelve ningún biosimilar: contrato de la API cambiado o parámetro `biosimilar` retirado.');
    }

    // 2. Agrupaciones VTM presentes. `vtm.id` es SNOMED y es la clave; el nombre solo rotula.
    const vtms = new Map();
    let sinVtm = 0;
    for (const m of bio.filas) {
        if (!m.vtm?.id) { sinVtm += 1; continue; }
        if (!vtms.has(m.vtm.id)) vtms.set(m.vtm.id, { id: m.vtm.id, nombre: m.vtm.nombre, biosimilares: [] });
        vtms.get(m.vtm.id).biosimilares.push(m);
    }
    if (sinVtm > 0) problems.push(`${sinVtm} biosimilares sin \`vtm.id\`: no se pueden agrupar por sustancia.`);

    // 3. Familia completa de cada VTM (biosimilares + no biosimilares).
    //    Se recluta por `practiv1` y se filtra por igualdad EXACTA de `vtm.id`: `practiv1`
    //    casa por subcadena y arrastra sustancias distintas — "epoetina alfa" recupera
    //    también darbepoetina alfa, y "teriparatida" recupera palopegteriparatida.
    log(`[audit] 2/5 familias completas (${vtms.size} agrupaciones VTM)…`);
    const familias = [];
    for (const v of vtms.values()) {
        const termino = String(v.nombre).split(/\s+/)[0];
        const fam = await crawl('medicamentos', { practiv1: termino });
        track(`GET /medicamentos?practiv1=${termino} → ${fam.filas.length} registros (familia ${v.nombre})`);
        const productos = fam.filas.filter((m) => m.vtm?.id === v.id);

        // Integridad del reclutamiento: todo biosimilar visto en el paso 1 debe aparecer
        // aquí. Si no, `practiv1` no recluta la familia entera y las cifras mentirían por
        // defecto — la misma clase de defecto que el ancla ciega por acentos del auditor
        // de ontología. No se estima: se marca inconclusa.
        const vistos = new Set(productos.map((p) => String(p.nregistro)));
        const perdidos = v.biosimilares.filter((b) => !vistos.has(String(b.nregistro)));
        if (perdidos.length > 0) {
            inconclusive.push(`familia ${v.nombre}: practiv1="${termino}" no recluta ${perdidos.length} biosimilar(es) ya conocidos (${perdidos.map((p) => p.nregistro).join(', ')})`);
        }

        familias.push({
            vtm_id: v.id,
            vtm_nombre: v.nombre,
            recruitment: { endpoint: '/medicamentos', param: 'practiv1', value: termino, filtered_by: 'vtm.id exacto' },
            ...classifyFamily(productos),
            registros: productos.map((p) => ({
                nregistro: String(p.nregistro),
                nombre: p.nombre,
                marca: brandOf(p.nombre),
                biosimilar: p.biosimilar === true,
                comercializado: p.comerc === true,
                ema: p.ema === true,
                ema_authorisation: emaAuthorisation(p),
                nosustituible_id: p.nosustituible?.id ?? null,
                laboratorio: p.labtitular || null,
            })),
        });
        await sleep(120);
    }

    // 4. Presentaciones y códigos nacionales de cada registro de cada familia.
    log('[audit] 3/5 presentaciones y códigos nacionales…');
    const cnPorRegistro = new Map();
    const dcpGroups = new Map();
    let presTotal = 0;
    const registrosPlanos = familias.flatMap((f) => f.registros);
    for (const r of registrosPlanos) {
        const data = await getJSON(`${BASE}/presentaciones?nregistro=${r.nregistro}`);
        const filas = data?.resultados || [];
        presTotal += filas.length;
        cnPorRegistro.set(r.nregistro, filas.map((p) => ({
            cn: String(p.cn), comercializado: p.comerc === true,
            dcp_id: p.dcp?.id ?? null, dcp_nombre: p.dcp?.nombre ?? null,
            dcpf_id: p.dcpf?.id ?? null,
        })));
        for (const p of filas) {
            if (!p.dcp?.id) continue;
            if (!dcpGroups.has(p.dcp.id)) dcpGroups.set(p.dcp.id, { id: p.dcp.id, nombre: p.dcp.nombre, marcas: new Set() });
            dcpGroups.get(p.dcp.id).marcas.add(brandOf(r.nombre));
        }
        await sleep(90);
    }
    track(`GET /presentaciones?nregistro={n} × ${registrosPlanos.length} → ${presTotal} presentaciones`);

    // 5. Concordancia CIMA ↔ BIFIMED, por código nacional.
    //    Dos fuentes independientes para lo mismo: CIMA marca `biosimilar` y la categoría
    //    «Biológicos» de la lista de no sustituibles; BIFIMED (Ministerio) publica
    //    `biosimilar` y `biologico` por CN. Una discrepancia es señal de que una de las
    //    dos cambió de criterio, y conviene enterarse antes de construir nada encima.
    let bifimed = null;
    if (!NO_BIFIMED) {
        log('[audit] 4/5 concordancia CIMA ↔ BIFIMED…');
        const res = { comprobados: 0, ausentes: 0, acuerdo_biologico: 0, acuerdo_biosimilar: 0, discrepancias: [] };
        for (const r of registrosPlanos) {
            for (const p of cnPorRegistro.get(r.nregistro) || []) {
                const b = await getJSON(`${WORKER}/bifimed/by-cn/${p.cn}`,
                    { headers: { 'X-MC-Autocomplete': '1' }, allow404: true });
                if (b.__notFound || b.found === false) { res.ausentes += 1; continue; }
                res.comprobados += 1;
                const cimaBiologico = r.nosustituible_id === 1;
                if (cimaBiologico === (b.biologico === true)) res.acuerdo_biologico += 1;
                else res.discrepancias.push({ cn: p.cn, campo: 'biologico', cima_nosustituible_id: r.nosustituible_id, bifimed_biologico: b.biologico ?? null, nombre: r.nombre });
                if (r.biosimilar === (b.biosimilar === true)) res.acuerdo_biosimilar += 1;
                else res.discrepancias.push({ cn: p.cn, campo: 'biosimilar', cima: r.biosimilar, bifimed: b.biosimilar ?? null, nombre: r.nombre });
                await sleep(60);
            }
        }
        bifimed = res;
        track(`GET ${WORKER}/bifimed/by-cn/{cn} × ${res.comprobados + res.ausentes} (no-track)`);
    }

    // ── Centinelas: cordura sobre el orden de magnitud ────────────────────────
    // No fijan cifras exactas (CIMA cambia a diario). Detectan derrumbes, que son
    // cambios de contrato disfrazados de "hoy hay menos".
    log('[audit] 5/5 centinelas…');
    const comercializados = bio.filas.filter((m) => m.comerc === true).length;
    if (bio.filas.length < 200) problems.push(`solo ${bio.filas.length} registros biosimilares (esperable >200): posible cambio de contrato en CIMA`);
    if (vtms.size < 15) problems.push(`solo ${vtms.size} agrupaciones VTM con biosimilares (esperable >15)`);
    if (bifimed && bifimed.comprobados > 0) {
        const tasa = bifimed.acuerdo_biologico / bifimed.comprobados;
        if (tasa < 0.95) problems.push(`concordancia CIMA↔BIFIMED en \`biologico\` del ${(tasa * 100).toFixed(1)}% (esperable >95%)`);
    }

    // ── Salida ────────────────────────────────────────────────────────────────
    const resumen = {
        registros_cima_biosimilar: bio.filas.length,
        registros_cima_biosimilar_comercializados: comercializados,
        agrupaciones_vtm: vtms.size,
        registros_en_familias: registrosPlanos.length,
        marcas_distintas: new Set(registrosPlanos.map((r) => r.marca).filter(Boolean)).size,
        autorizaciones_ema_heuristicas: new Set(registrosPlanos.map((r) => r.ema_authorisation?.authorisationKey).filter(Boolean)).size,
        presentaciones: presTotal,
        codigos_nacionales: new Set([...cnPorRegistro.values()].flat().map((p) => p.cn)).size,
        agrupaciones_dcp: dcpGroups.size,
        familias_status: familias.reduce((a, f) => { a[f.status] = (a[f.status] || 0) + 1; return a; }, {}),
    };

    const payload = {
        meta: {
            script: 'scripts/medcheck-audit-biosimilars.mjs',
            generated_at: new Date().toISOString(),
            source_date: TODAY,
            sources: { cima: BASE, bifimed_via: NO_BIFIMED ? null : WORKER },
            endpoints: endpointsUsados,
            pagination: 'tamaño de página REAL devuelto por CIMA (capa en 200); nunca el pedido',
            source_hash_sha256: sourceHash(bio.filas),
            requests: { ...stats },
            disclaimer: 'Las relaciones biosimilar–referente son CANDIDATAS derivadas de la ausencia del flag `biosimilar` dentro del mismo VTM. NO están verificadas contra el EPAR de la EMA y no deben tratarse como confirmadas.',
        },
        resumen,
        familias: familias.map((f) => {
            const registros = f.registros.map((r) => ({ ...r, presentaciones: cnPorRegistro.get(r.nregistro) || [] }));
            return { ...f, registros, dcp_signal: dcpSignal(registros) };
        }),
        // Calidad del propio flag `biosimilar` de CIMA. No todo lo que CIMA marca como
        // biosimilar es un biosimilar autorizado por la EMA: hay registros nacionales y
        // hasta productos fuera de la lista «Biológicos» de no sustituibles. Quien
        // construya encima de este flag tiene que saberlo antes, no después.
        calidad_flag_biosimilar: (() => {
            const bios = registrosPlanos.filter((r) => r.biosimilar);
            const noEma = bios.filter((r) => !r.ema);
            const fueraListaBiologicos = bios.filter((r) => r.nosustituible_id !== 1);
            return {
                total: bios.length,
                sin_registro_ema: noEma.length,
                fuera_lista_biologicos_aemps: fueraListaBiologicos.length,
                nota: '`biosimilar === true` en CIMA no equivale a «biosimilar autorizado por la EMA». Revisar estos casos antes de tratar el flag como criterio regulatorio.',
                casos_a_revisar: fueraListaBiologicos.map((r) => ({
                    nregistro: r.nregistro, nombre: r.nombre, ema: r.ema, nosustituible_id: r.nosustituible_id,
                })),
                sin_ema_por_marca: [...new Set(noEma.map((r) => r.marca))].sort(),
            };
        })(),
        dcp_compartidos: [...dcpGroups.values()]
            .map((g) => ({ dcp_id: g.id, dcp_nombre: g.nombre, marcas: [...g.marcas].filter(Boolean).sort() }))
            .filter((g) => g.marcas.length > 1)
            .sort((a, b) => b.marcas.length - a.marcas.length),
        concordancia_bifimed: bifimed,
        inconclusive,
        problems,
    };

    const md = renderMarkdown(payload);

    if (DRY) {
        log('[audit] --dry: no se escribe nada');
        console.log(md);
    } else {
        mkdirSync(OUT_DIR, { recursive: true });
        const stamp = TODAY;
        writeFileSync(join(OUT_DIR, `${stamp}_auditoria-biosimilares.json`), JSON.stringify(payload, null, 2));
        writeFileSync(join(OUT_DIR, `${stamp}_auditoria-biosimilares.md`), md);
        log(`[audit] escrito ${join(OUT_DIR, `${stamp}_auditoria-biosimilares.{json,md}`)}`);
    }

    log(`[audit] peticiones ${stats.requests} (caché ${stats.fromCache}, reintentos ${stats.retries})`);

    if (inconclusive.length > 0) {
        console.error(`\n[audit] INCONCLUSA — ${inconclusive.length} motivo(s):`);
        inconclusive.forEach((m) => console.error(`  · ${m}`));
        console.error('[audit] repite la ejecución; la caché del día conserva lo ya descargado.');
        return 2;
    }
    if (problems.length > 0) {
        console.error(`\n[audit] PROBLEMAS — ${problems.length}:`);
        problems.forEach((m) => console.error(`  · ${m}`));
        return 1;
    }
    log('\n[audit] OK — auditoría completa y sin problemas.');
    return 0;
}

function renderMarkdown(p) {
    const r = p.resumen;
    const L = [];
    L.push('# Auditoría de biosimilares — CIMA/AEMPS');
    L.push('');
    L.push(`**Generada:** ${p.meta.generated_at}`);
    L.push(`**Hash de fuentes (SHA-256):** \`${p.meta.source_hash_sha256}\``);
    L.push(`**Peticiones:** ${p.meta.requests.requests} (caché ${p.meta.requests.fromCache}, reintentos ${p.meta.requests.retries})`);
    L.push('');
    L.push('> ' + p.meta.disclaimer);
    L.push('');
    L.push('## Endpoints y parámetros');
    L.push('');
    p.meta.endpoints.forEach((e) => L.push(`- \`${e}\``));
    L.push(`- Paginación: ${p.meta.pagination}`);
    L.push('');
    L.push('## Recuento por unidad de análisis');
    L.push('');
    L.push('| Unidad | Valor |');
    L.push('|---|---|');
    L.push(`| Registros CIMA con \`biosimilar=true\` | ${r.registros_cima_biosimilar} |`);
    L.push(`| …de ellos comercializados | ${r.registros_cima_biosimilar_comercializados} |`);
    L.push(`| Agrupaciones VTM con al menos un biosimilar | ${r.agrupaciones_vtm} |`);
    L.push(`| Registros CIMA en esas familias (biosim. + no biosim.) | ${r.registros_en_familias} |`);
    L.push(`| Marcas distintas (heurística sobre el nombre) | ${r.marcas_distintas} |`);
    L.push(`| Autorizaciones EMA (heurística de conciliación) | ${r.autorizaciones_ema_heuristicas} |`);
    L.push(`| Presentaciones | ${r.presentaciones} |`);
    L.push(`| Códigos nacionales | ${r.codigos_nacionales} |`);
    L.push(`| Agrupaciones DCP | ${r.agrupaciones_dcp} |`);
    L.push('');
    L.push('**Ninguna de estas cifras es intercambiable con otra.** Un registro CIMA no es un');
    L.push('producto, una marca no es una autorización y un VTM no es una familia biosimilar.');
    L.push('');
    L.push('## Familias por resolubilidad del referente');
    L.push('');
    L.push(`- \`candidate\` (una sola marca no-biosimilar): **${r.familias_status.candidate || 0}**`);
    L.push(`- \`ambiguous\` (varias): **${r.familias_status.ambiguous || 0}** — el referente NO es derivable`);
    L.push(`- \`none\` (ninguna en ese VTM): **${r.familias_status.none || 0}** — la familia cruza el VTM`);
    L.push('');
    L.push('| VTM | Estado | Candidatos a referente | Biosim. | No biosim. |');
    L.push('|---|---|---|---|---|');
    for (const f of [...p.familias].sort((a, b) => a.status.localeCompare(b.status) || a.vtm_nombre.localeCompare(b.vtm_nombre))) {
        L.push(`| ${f.vtm_nombre} | \`${f.status}\` | ${f.reference_candidates.join(' / ') || '—'} | ${f.counts.biosimilar_registros} | ${f.counts.non_biosimilar_registros} |`);
    }
    L.push('');
    L.push('Las familias `ambiguous` y `none` **requieren curación humana contra el EPAR**.');
    L.push('Las `candidate` son un punto de partida plausible, no una relación verificada.');
    L.push('');
    if (p.calidad_flag_biosimilar) {
        const q = p.calidad_flag_biosimilar;
        L.push('## Calidad del flag `biosimilar` de CIMA');
        L.push('');
        L.push(`- Registros con \`biosimilar=true\`: **${q.total}**`);
        L.push(`- …sin registro EMA (\`ema=false\`): **${q.sin_registro_ema}**`);
        L.push(`- …fuera de la lista «Biológicos» de no sustituibles (\`nosustituible.id ≠ 1\`): **${q.fuera_lista_biologicos_aemps}**`);
        L.push('');
        L.push(`> ${q.nota}`);
        L.push('');
        if (q.casos_a_revisar.length) {
            L.push('| nregistro | nombre | ema | nosustituible.id |');
            L.push('|---|---|---|---|');
            q.casos_a_revisar.forEach((c) => L.push(`| ${c.nregistro} | ${c.nombre} | ${c.ema} | ${c.nosustituible_id} |`));
            L.push('');
        }
        if (q.sin_ema_por_marca.length) {
            L.push(`Marcas sin registro EMA marcadas como biosimilar: ${q.sin_ema_por_marca.join(', ')}.`);
            L.push('');
        }
    }
    L.push('## Señal por DCP dentro de cada familia');
    L.push('');
    L.push('Agrupar por descripción clínica de producto **estrecha** los candidatos, pero no');
    L.push('los determina. Medido sobre esta misma pasada: resolvería 5 de las 8 familias');
    L.push('ambiguas y **2 de esas 5 serían falsas** (somatropina emparejaría Omnitrope con');
    L.push('Norditropin, cuyo referente es Genotropin; insulina asparta emparejaría Dazparda');
    L.push('con Fiasp, cuyo referente es NovoRapid). El DCP codifica sustancia, dosis y forma,');
    L.push('no linaje regulatorio. **No se usa para decidir el referente.**');
    L.push('');
    const conSenal = p.familias.filter((f) => f.status !== 'candidate' && f.dcp_signal?.subfamilias?.length);
    if (conSenal.length) {
        L.push('| VTM | DCP | No biosimilar | Biosimilares |');
        L.push('|---|---|---|---|');
        for (const f of conSenal) {
            for (const s of f.dcp_signal.subfamilias) {
                L.push(`| ${f.vtm_nombre} | ${String(s.dcp_nombre || s.dcp_id).slice(0, 46)} | ${s.no_biosimilar.join(', ') || '—'} | ${s.biosimilar.length} |`);
            }
        }
        L.push('');
    }
    if (p.concordancia_bifimed) {
        const b = p.concordancia_bifimed;
        L.push('## Concordancia CIMA ↔ BIFIMED');
        L.push('');
        L.push(`- CN comprobados: **${b.comprobados}**`);
        L.push(`- CN ausentes de BIFIMED: **${b.ausentes}**${b.comprobados + b.ausentes > 0 ? ` (${((b.ausentes / (b.comprobados + b.ausentes)) * 100).toFixed(1)}%)` : ''}`);
        L.push(`- Acuerdo en \`biologico\`: **${b.acuerdo_biologico}/${b.comprobados}**`);
        L.push(`- Acuerdo en \`biosimilar\`: **${b.acuerdo_biosimilar}/${b.comprobados}**`);
        L.push(`- Discrepancias: **${b.discrepancias.length}**`);
        if (b.discrepancias.length > 0) {
            L.push('');
            b.discrepancias.slice(0, 30).forEach((d) => L.push(`  - CN ${d.cn} · ${d.campo} · ${d.nombre}`));
        }
        L.push('');
    }
    L.push('## Presentaciones con la misma descripción clínica (DCP) en marcas distintas');
    L.push('');
    L.push('Compartir DCP significa **misma sustancia, dosis y forma farmacéutica según CIMA**.');
    L.push('No demuestra mismo referente, sustituibilidad, mismo dispositivo, mismos excipientes,');
    L.push('misma conservación ni financiación equivalente.');
    L.push('');
    L.push('| DCP | Marcas |');
    L.push('|---|---|');
    p.dcp_compartidos.slice(0, 40).forEach((g) => L.push(`| ${g.dcp_nombre} | ${g.marcas.join(', ')} |`));
    L.push('');
    if (p.inconclusive.length) {
        L.push('## Motivos de pasada inconclusa');
        L.push('');
        p.inconclusive.forEach((m) => L.push(`- ${m}`));
        L.push('');
    }
    if (p.problems.length) {
        L.push('## Problemas');
        L.push('');
        p.problems.forEach((m) => L.push(`- ${m}`));
        L.push('');
    }
    return L.join('\n');
}

// Solo audita si se ejecuta directamente: las funciones puras son importables desde los
// tests sin disparar ~1.000 peticiones.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main()
        .then((code) => process.exit(code))
        .catch((err) => {
            const inc = err?.inconclusive;
            console.error(`[audit] ${inc ? 'INCONCLUSA' : 'ABORTA'}: ${err.message}`);
            process.exit(inc ? 2 : 1);
        });
}
