#!/usr/bin/env node
/**
 * MedCheck — ETL del índice de envases (Nivel 2, variante 2B)
 *
 * Construye `nregistro -> [envases comercializados]` barriendo el REST de CIMA, para que
 * la tarjeta de resultado pueda mostrar el tamaño de envase sin una petición por tarjeta
 * (la búsqueda `/medicamentos` no devuelve `presentaciones` ni `cn`; solo el detalle lo hace).
 *
 * Por qué CIMA y no el Nomenclátor: la tarjeta es 100% CIMA en vivo. Derivar el envase de
 * otra fuente (Prescripción o Facturación) mezclaría ámbitos administrativos y cadencias
 * distintas en una misma línea. Fuente única = un solo criterio de alta/baja.
 *
 * Los ~220 GET diarios ocurren aquí, en el ETL — no contra el presupuesto del Worker.
 *
 * Uso:
 *   node scripts/etl-packs/build-packs-index.mjs [--out <ruta>] [--dry]
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
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'assets', 'data', 'packs-index.json');

// Caché de páginas del día: un barrido son ~220 peticiones y CIMA corta de vez en cuando.
// Sin esto, un fallo en la página 90 obliga a repetir las 89 anteriores (y a martillear
// la API en cada reintento). Con esto, la ejecución siguiente reanuda donde se quedó.
const CACHE_DIR = join(HERE, '.cache');
const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
function cachePath(endpoint, pagina) {
    return join(CACHE_DIR, `${endpoint}-${hoy()}-p${pagina}.json`);
}
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

// Umbral de cordura: una caída brusca de cobertura significa cambio de contrato en CIMA,
// no que España se haya quedado sin medicamentos. Mismo criterio fail-closed que el auditor.
const MIN_NREGISTROS = 12000;
const MIN_PRESENTACIONES = 22000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_INTENTOS = 6;

async function fetchPagina(endpoint, pagina) {
    const cached = readCache(endpoint, pagina);
    if (cached) return { data: cached, deCache: true };

    let ultimoError = null;
    for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
        try {
            const res = await fetch(`${BASE}/${endpoint}?comerc=1&pagina=${pagina}`);
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
    // La caché del día conserva lo ya descargado, así que reejecutar reanuda.
    throw new Error(`[${endpoint}] página ${pagina}: ${ultimoError?.message || 'desconocido'} (reejecuta para reanudar)`);
}

async function crawl(endpoint) {
    const filas = [];
    let pagina = 1;
    let total = null;
    for (;;) {
        const { data, deCache } = await fetchPagina(endpoint, pagina);
        const lote = data?.resultados || [];
        filas.push(...lote);
        if (total === null) total = data?.totalFilas ?? lote.length;
        if (filas.length >= total || lote.length === 0) break;
        pagina += 1;
        if (!deCache) await sleep(200);
    }
    if (filas.length < total) {
        throw new Error(`[${endpoint}] recogidas ${filas.length} de ${total} filas declaradas`);
    }
    console.error(`[etl-packs] ${endpoint}: ${filas.length} filas en ${pagina} páginas`);
    return filas;
}

/**
 * Recorta el nombre del medicamento y el acondicionamiento final entre paréntesis.
 * Misma regla que `_getPresentationFormat` en cima-app.js — el texto oficial íntegro
 * sigue estando en el modal, que se sirve del detalle en vivo.
 */
export function packFormat(medName, presName) {
    if (!presName) return null;
    const pres = String(presName).replace(/\s+/g, ' ').trim();
    let format = pres;
    const med = String(medName || '').replace(/\s+/g, ' ').trim();
    if (med) {
        const escaped = med.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        format = format.replace(new RegExp(`^${escaped}\\s*[,.]?\\s*`, 'i'), '').trim();
    }
    if (format === pres && format.includes(',')) format = format.split(',').pop().trim();
    format = format.replace(/\s*\([^)]*\)\s*$/, '').trim();
    return format || null;
}

async function main() {
    const [meds, pres] = [await crawl('medicamentos'), await crawl('presentaciones')];
    const nameByNreg = new Map(meds.map((m) => [String(m.nregistro), m.nombre]));

    const packs = {};
    let huerfanas = 0;
    let sinEnvase = 0;
    for (const p of pres) {
        const nreg = String(p.nregistro);
        const medName = nameByNreg.get(nreg);
        if (!medName) huerfanas += 1;
        const format = packFormat(medName, p.nombre);
        if (!format) { sinEnvase += 1; continue; }
        (packs[nreg] ||= []).push(format);
    }
    for (const nreg of Object.keys(packs)) packs[nreg] = [...new Set(packs[nreg])];

    const nregistros = Object.keys(packs).length;
    if (nregistros < MIN_NREGISTROS || pres.length < MIN_PRESENTACIONES) {
        throw new Error(`cobertura anómala: ${nregistros} nregistros / ${pres.length} presentaciones`);
    }

    // Centinelas: si CIMA cambia el formato del nombre, el recorte deja de funcionar y el
    // índice se llenaría de nombres completos en silencio. Esto lo caza.
    const sentinelsPath = join(HERE, 'sentinels.json');
    let fallos = 0;
    try {
        const sentinels = JSON.parse(readFileSync(sentinelsPath, 'utf8'));
        for (const s of sentinels.checks || []) {
            const got = packs[s.nregistro];
            const ok = Array.isArray(got) && s.expectAny.some((e) => got.includes(e));
            if (!ok) {
                fallos += 1;
                console.error(`[centinela] ${s.nregistro} (${s.note}): esperado alguno de ${JSON.stringify(s.expectAny)}, obtenido ${JSON.stringify(got)}`);
            }
        }
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        console.error('[etl-packs] aviso: sin sentinels.json, no se verifica el recorte');
    }
    if (fallos > 0) throw new Error(`${fallos} centinela(s) fallidos`);

    const payload = {
        _meta: {
            source: 'CIMA REST /medicamentos + /presentaciones (comerc=1)',
            generated_at: new Date().toISOString().slice(0, 10),
            presentaciones: pres.length,
            nregistros,
        },
        packs,
    };
    const json = JSON.stringify(payload);
    console.error(`[etl-packs] crudo ${(json.length / 1048576).toFixed(2)} MiB · gzip ${(gzipSync(Buffer.from(json), { level: 9 }).length / 1024).toFixed(0)} KiB`);
    console.error(`[etl-packs] huérfanas ${huerfanas} · sin envase legible ${sinEnvase}`);

    if (DRY) {
        console.error('[etl-packs] --dry: no se escribe nada');
        return;
    }
    writeFileSync(OUT, json);
    console.error(`[etl-packs] escrito ${OUT}`);
}

// Solo barre si se ejecuta directamente: así `packFormat` es importable desde tests
// y utilidades de diagnóstico sin disparar 220 peticiones a CIMA.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((err) => {
        console.error(`[etl-packs] ABORTA: ${err.message}`);
        process.exit(1);
    });
}
