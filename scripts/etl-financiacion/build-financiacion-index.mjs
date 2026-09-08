#!/usr/bin/env node
/**
 * MedCheck — ETL del índice de financiación por medicamento
 *
 * Construye `nregistro -> conteo de presentaciones comercializadas por lista oficial de
 * BIFIMED`, para que la LISTA de resultados pueda mostrar y filtrar la financiación sin una
 * petición por tarjeta. Hoy la financiación solo se ve abriendo la ficha de una en una.
 *
 * QUÉ GUARDA, Y QUÉ NO. Guarda conteos por PROCEDENCIA —de cuál de las seis listas oficiales
 * viene cada CN—, nunca un veredicto. La pregunta «¿esto cuenta como financiado?» se responde
 * en un solo sitio, el cliente (`_classifyFinSit` / `_computeFinancingSummary`), para que no
 * existan dos verdades sobre lo mismo. La procedencia llega del sidecar del ETL de BIFIMED
 * (`bifimed_catalog_procedencia.json`), que es dato de la fuente y no interpretación nuestra.
 *
 * EL UNIVERSO SON LAS COMERCIALIZADAS, Y ESO SE DICE. Se crawlea el censo COMPLETO de CIMA
 * (sin `comerc=1`), pero los conteos se hacen sobre las presentaciones comercializadas, que es
 * la partición sobre la que el resumen de la ficha ya cuenta («2 comercializadas de 3»). Medido
 * el 2026-09-08: contar todas o solo las comercializadas cambia el veredicto de 1.723
 * medicamentos, y en 1.587 de ellos la diferencia es `parcial → financiado` — medicamentos cuyas
 * presentaciones vivas están todas financiadas y que hoy se anuncian como parciales porque
 * arrastran un envase retirado. Contar el censo entero haría a la lista decir de un medicamento
 * algo distinto de lo que dice su propia ficha.
 *
 * UN MEDICAMENTO SIN ENTRADA NO ES UN MEDICAMENTO SIN FINANCIACIÓN. La ausencia de marca nunca
 * puede leerse como «no financiado»: hay 1.331 medicamentos visibles sin ningún CN en BIFIMED
 * (993 de ellos importaciones paralelas, que el Ministerio no publica). Por eso se emiten también
 * los que tienen cero presentaciones comercializadas, con total 0: permite decir «sin
 * presentaciones comercializadas» en vez de callar.
 *
 * Uso:
 *   node scripts/etl-financiacion/build-financiacion-index.mjs --procedencia <ruta> [--out <ruta>] [--dry]
 * Salida:
 *   exit 0 con el índice escrito; exit 1 si un centinela falla o la cobertura se desploma.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASE = 'https://cima.aemps.es/cima/rest';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NO_CACHE = args.includes('--no-cache');
const argOf = (name, def = null) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};
const OUT = argOf('--out', join(ROOT, 'assets', 'data', 'financiacion-index.json'));
const PROCEDENCIA = argOf('--procedencia', null);

/**
 * Orden de los conteos en cada entrada. Es el mismo de `DESCARGAS` en el ETL de BIFIMED y NO se
 * reordena: el cliente lee por posición. Cada entrada del índice es
 *   [ totalComercializadas, si, si_determinadas, no_incluido, excluido, no_fin_resolucion, estudio ]
 * y las presentaciones sin dato son `total - suma(resto)`, que nunca se emite porque es derivable.
 */
const CODIGOS = ['1', '2', '5', '6', '7', '666'];

// Umbrales de cordura: una caída brusca es un cambio de contrato en CIMA o un sidecar truncado,
// no que España se haya quedado sin medicamentos. Mismo criterio fail-closed que el ETL de envases.
const MIN_NREGISTROS = 20000;
const MIN_PRESENTACIONES = 55000;
const MIN_CON_DATO = 12000;

// ── Crawl con caché del día ───────────────────────────────────────────────────
const CACHE_DIR = join(HERE, '.cache');
const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const cachePath = (endpoint, pagina) => join(CACHE_DIR, `${endpoint}-${hoy()}-p${pagina}.json`);

function readCache(endpoint, pagina) {
    if (NO_CACHE) return null;
    const file = cachePath(endpoint, pagina);
    try {
        if (!existsSync(file) || statSync(file).size === 0) return null;
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}
function writeCache(endpoint, pagina, data) {
    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath(endpoint, pagina), JSON.stringify(data));
    } catch { /* la caché es una optimización: si no se puede escribir, seguimos */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_INTENTOS = 6;

async function fetchPagina(endpoint, pagina) {
    const cached = readCache(endpoint, pagina);
    if (cached) return { data: cached, deCache: true };

    let ultimoError = null;
    for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
        try {
            const res = await fetch(`${BASE}/${endpoint}?pagina=${pagina}`);
            if (!res.ok) {
                const retryAfter = Number(res.headers.get('Retry-After'));
                if ((res.status === 429 || res.status >= 500) && intento < MAX_INTENTOS) {
                    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * intento);
                    continue;
                }
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            writeCache(endpoint, pagina, data);
            return { data, deCache: false };
        } catch (err) {
            ultimoError = err;
            if (intento < MAX_INTENTOS) await sleep(2000 * intento);
        }
    }
    // Un fallo de red no puede degradar en "índice más corto": aborta.
    throw new Error(`[${endpoint}] página ${pagina}: ${ultimoError?.message || 'desconocido'} (reejecuta para reanudar)`);
}

async function crawl(endpoint) {
    const filas = [];
    const vistos = new Set();
    let pagina = 1;
    let total = null;
    for (;;) {
        const { data, deCache } = await fetchPagina(endpoint, pagina);
        const lote = data?.resultados || [];
        for (const r of lote) {
            // Deriva durante la paginación: en 336 páginas, un alta o una baja desplaza filas y
            // la misma puede llegar dos veces. Medir el avance en filas brutas dejaría "completar"
            // el total con duplicados mientras faltan registros reales.
            const clave = `${r?.nregistro}|${r?.cn}`;
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            filas.push(r);
        }
        if (total === null) total = data?.totalFilas ?? lote.length;
        if (filas.length >= total || lote.length === 0) break;
        pagina += 1;
        if (!deCache) await sleep(200);
    }
    if (filas.length < total) {
        throw new Error(`[${endpoint}] recogidas ${filas.length} únicas de ${total} declaradas`);
    }
    console.error(`[etl-fin] ${endpoint}: ${filas.length} filas únicas en ${pagina} páginas`);
    return filas;
}

// ── Centinelas ────────────────────────────────────────────────────────────────
/**
 * Comprueban VALORES, no existencia. Un centinela que solo mira si una clave está presente
 * aprueba un índice lleno de ceros, que es exactamente el fallo que no puede pasar desapercibido:
 * un índice de ceros no rompe nada visible y convierte toda la lista en "sin datos".
 */
function validarCentinelas(fin, ruta) {
    let sentinels;
    try {
        sentinels = JSON.parse(readFileSync(ruta, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('[etl-fin] aviso: sin sentinels.json, no se verifican valores');
            return 0;
        }
        throw err;
    }
    let fallos = 0;
    for (const s of sentinels.checks || []) {
        if (s.kind === 'columna_min') {
            // No fija un medicamento concreto a propósito: el estado de financiación de uno
            // cualquiera puede cambiar el mes que viene y el centinela fallaría sin que hubiera
            // nada roto. Lo que vigila es que la COLUMNA siga poblada, que es el fallo real —
            // reordenar `CODIGOS` o perder una de las seis descargas vacía una posición entera y
            // el índice sigue pareciendo válido.
            const n = Object.values(fin).filter((v) => v[s.pos] > 0).length;
            if (n < s.min) {
                fallos += 1;
                console.error(`[centinela] columna ${s.pos} (${s.note}): ${n} medicamentos, mínimo ${s.min}`);
            }
            continue;
        }
        const got = fin[s.nregistro];
        const esperado = s.expect;
        const ok = Array.isArray(got) && Array.isArray(esperado)
            && got.length === esperado.length
            && got.every((v, i) => v === esperado[i]);
        if (!ok) {
            fallos += 1;
            console.error(`[centinela] ${s.nregistro} (${s.note}): esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(got)}`);
        }
    }
    console.error(`[etl-fin] centinelas: ${(sentinels.checks || []).length - fallos} OK, ${fallos} fallidos`);
    return fallos;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    if (!PROCEDENCIA) {
        throw new Error('falta --procedencia <ruta a bifimed_catalog_procedencia.json>');
    }
    const proc = JSON.parse(readFileSync(PROCEDENCIA, 'utf8'));
    const porCn = proc.por_cn || {};
    const catalogId = proc.meta?.catalog_id;
    if (!catalogId) {
        // Sin identidad no hay forma de que el cliente compruebe que índice y catálogo son la
        // misma generación, y filtrar con generaciones distintas es peor que no filtrar.
        throw new Error('el sidecar no trae meta.catalog_id: no se puede sellar el índice');
    }
    const cnsConDato = Object.keys(porCn).length;
    console.error(`[etl-fin] procedencia: ${cnsConDato} CN · catalog_id ${catalogId.slice(0, 16)}…`);
    if (proc.meta?.suma_listas !== proc.meta?.total_cn_con_procedencia) {
        throw new Error('el sidecar declara solapamiento entre listas; el índice contaría CN dos veces');
    }

    const pres = await crawl('presentaciones');
    if (pres.length < MIN_PRESENTACIONES) {
        throw new Error(`cobertura anómala: ${pres.length} presentaciones (mínimo ${MIN_PRESENTACIONES})`);
    }

    const idx = CODIGOS.reduce((m, c, i) => (m[c] = i + 1, m), {});
    const fin = {};
    let conAlgunDato = 0;
    let sinComercializadas = 0;

    for (const p of pres) {
        if (!p?.nregistro || !p?.cn) continue;
        const nreg = String(p.nregistro);
        if (!fin[nreg]) fin[nreg] = [0, 0, 0, 0, 0, 0, 0];
        // `comerc !== false` y no `=== true`: es el criterio que ya usa el bloque de
        // presentaciones de la ficha, y dos criterios distintos darían dos recuentos distintos
        // de lo mismo en la misma pantalla.
        if (p.comerc === false) continue;
        const fila = fin[nreg];
        fila[0] += 1;
        const codigo = porCn[String(p.cn).padStart(7, '0')];
        if (codigo !== undefined) fila[idx[String(codigo)]] += 1;
    }

    for (const fila of Object.values(fin)) {
        if (fila[0] === 0) sinComercializadas += 1;
        else if (fila.slice(1).some((n) => n > 0)) conAlgunDato += 1;
    }

    const nregistros = Object.keys(fin).length;
    if (nregistros < MIN_NREGISTROS || conAlgunDato < MIN_CON_DATO) {
        throw new Error(`cobertura anómala: ${nregistros} nregistros, ${conAlgunDato} con dato `
            + `(mínimos ${MIN_NREGISTROS} / ${MIN_CON_DATO})`);
    }

    const fallos = validarCentinelas(fin, join(HERE, 'sentinels.json'));
    if (fallos > 0) throw new Error(`${fallos} centinela(s) fallidos`);

    const payload = {
        _meta: {
            schema_version: 1,
            source: 'CIMA REST /presentaciones (censo completo) × BIFIMED (sidecar de procedencia)',
            generated_at: new Date().toISOString().slice(0, 10),
            // Sello de generación. El cliente NO habilita la faceta si esto no coincide con el
            // `catalog_id` que devuelve `/bifimed/meta`: filtrar una lista con un índice de otra
            // generación que la ficha es la forma silenciosa de mentir.
            catalog_id: catalogId,
            bifimed_download_date: proc.meta?.download_date ?? null,
            orden_codigos: CODIGOS,
            presentaciones: pres.length,
            nregistros,
            con_algun_dato: conAlgunDato,
            sin_comercializadas: sinComercializadas,
        },
        fin,
    };

    const json = JSON.stringify(payload);
    console.error(`[etl-fin] crudo ${(json.length / 1048576).toFixed(2)} MiB · `
        + `gzip ${(gzipSync(Buffer.from(json), { level: 9 }).length / 1024).toFixed(0)} KiB`);
    console.error(`[etl-fin] ${nregistros} nregistros · ${conAlgunDato} con dato · `
        + `${sinComercializadas} sin comercializadas`);

    if (DRY) {
        console.error('[etl-fin] --dry: no se escribe nada');
        return;
    }
    writeFileSync(OUT, json);
    console.error(`[etl-fin] escrito ${OUT}`);
}

main().catch((err) => {
    console.error(`[etl-fin] ABORTA: ${err.message}`);
    process.exit(1);
});
