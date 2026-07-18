#!/usr/bin/env node
/**
 * MedCheck — smoke test de producción (sin navegador)
 *
 * Chequeo rápido pre-demo / post-despliegue: página publicada y sincronizada
 * con el repo local, Worker vivo, datasets KV frescos y búsqueda CIMA operativa.
 * Todas las llamadas van marcadas X-MC-Autocomplete:1 para no ensuciar la
 * analítica D1.
 *
 * Uso: node scripts/medcheck-smoke.mjs
 * Salida: OK/AVISO/FALLO por chequeo; exit 1 si hay algún FALLO.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://ernestobarrera.github.io/medcheck.html';
const WORKER = 'https://medcheck-proxy.medtools.workers.dev';
const NO_TRACK = { 'X-MC-Autocomplete': '1' };

const results = [];
function report(level, name, detail) {
    const icon = { OK: '✓', AVISO: '⚠', FALLO: '✗' }[level];
    results.push({ level, name });
    console.log(`${icon} [${level}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(url, { asJson = true, headers = {} } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
        const res = await fetch(url, { headers, signal: ctrl.signal });
        const body = asJson ? await res.json() : await res.text();
        return { status: res.status, body };
    } finally {
        clearTimeout(timer);
    }
}

function extractVersions(html) {
    const out = {};
    for (const m of html.matchAll(/(cima-api\.js|cima-app\.js|cima-app\.css|inn-dict\.js)\?v=(\d{8}[a-z]?)/g)) {
        out[m[1]] = m[2];
    }
    return out;
}

// 1. Página en producción + sincronía de versiones con el repo local
try {
    const { status, body } = await get(SITE, { asJson: false });
    if (status !== 200) {
        report('FALLO', 'Página en producción', `HTTP ${status}`);
    } else {
        const prod = extractVersions(body);
        const local = extractVersions(readFileSync(join(ROOT, 'medcheck.html'), 'utf8'));
        const diffs = Object.keys(local).filter(k => prod[k] !== local[k]);
        if (diffs.length === 0) {
            report('OK', 'Página en producción sincronizada con el repo local', Object.entries(prod).map(([k, v]) => `${k}=${v}`).join(' '));
        } else {
            report('AVISO', 'Producción difiere del repo local (¿push pendiente?)', diffs.map(k => `${k}: prod=${prod[k] || '—'} local=${local[k]}`).join(' · '));
        }
    }
} catch (e) {
    report('FALLO', 'Página en producción', e.message);
}

// 2. Worker vivo
try {
    const { status, body } = await get(`${WORKER}/health`);
    if (status === 200 && body.status === 'ok') report('OK', 'Worker /health');
    else report('FALLO', 'Worker /health', `HTTP ${status}`);
} catch (e) {
    report('FALLO', 'Worker /health', e.message);
}

// 3. BIFIMED en KV (frescura: cron mensual + margen)
try {
    const { status, body } = await get(`${WORKER}/bifimed/meta`, { headers: NO_TRACK });
    if (status !== 200) {
        report('FALLO', 'BIFIMED /meta', `HTTP ${status}`);
    } else {
        const age = (Date.now() - new Date(body.download_date)) / 86400000;
        const detail = `download_date=${body.download_date}, ${body.total_cn} CN`;
        if (age > 45) report('AVISO', 'BIFIMED envejecido (>45 días; revisar cron etl-bifimed)', detail);
        else report('OK', 'BIFIMED en KV', detail);
    }
} catch (e) {
    report('FALLO', 'BIFIMED /meta', e.message);
}

// 4. Farmacogenómica en KV (frescura: ETL diario + margen)
try {
    const { status, body } = await get(`${WORKER}/pharmacogenomics/meta`, { headers: NO_TRACK });
    if (status !== 200) {
        report('FALLO', 'PGx /meta', `HTTP ${status}`);
    } else {
        const age = (Date.now() - new Date(body.generated_at)) / 86400000;
        const detail = `nomenclátor=${body.list_prescription_date}, ${body.medicamentos_con_biomarcador} medicamentos`;
        if (!body.generated_at || age > 7) report('AVISO', 'PGx envejecido (>7 días; revisar cron etl-biomarkers)', detail);
        else report('OK', 'PGx en KV', detail);
    }
} catch (e) {
    report('FALLO', 'PGx /meta', e.message);
}

// 5. Búsqueda CIMA a través del proxy
try {
    const { status, body } = await get(`${WORKER}/medicamentos?nombre=omeprazol`, { headers: NO_TRACK });
    const n = body?.resultados?.length || 0;
    if (status === 200 && n > 0) report('OK', 'Búsqueda CIMA vía proxy', `omeprazol → ${n} resultados`);
    else report('FALLO', 'Búsqueda CIMA vía proxy', `HTTP ${status}, ${n} resultados`);
} catch (e) {
    report('FALLO', 'Búsqueda CIMA vía proxy', e.message);
}

// 6. Ontología clínica publicada
try {
    const { status, body } = await get('https://ernestobarrera.github.io/assets/data/clinical-ontology.json');
    const n = Object.keys(body?.terms || {}).length;
    if (status === 200 && n > 100) report('OK', 'Ontología clínica publicada', `${n} términos, versión ${body.version || '—'}`);
    else report('FALLO', 'Ontología clínica publicada', `HTTP ${status}, ${n} términos`);
} catch (e) {
    report('FALLO', 'Ontología clínica publicada', e.message);
}

const fails = results.filter(r => r.level === 'FALLO').length;
const warns = results.filter(r => r.level === 'AVISO').length;
console.log(`\nResumen: ${results.length - fails - warns} OK · ${warns} AVISO · ${fails} FALLO`);
process.exit(fails > 0 ? 1 : 0);
