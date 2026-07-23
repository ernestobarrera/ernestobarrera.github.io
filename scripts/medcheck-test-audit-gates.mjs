#!/usr/bin/env node
/**
 * MedCheck — test de los gates del auditor con inyección de fallos
 *
 * Ejecuta medcheck-audit-ontology.mjs como subproceso con el fetch sustituido por
 * medcheck-mock-cima.mjs (via node --import) y baselines sintéticos (via --baseline=),
 * y verifica el contrato de salida 0/1/2 y la máquina de estados del baseline:
 *
 *   exit 0  cobertura completa y limpia (incluye recuperación de 429 transitorios)
 *   exit 1  problema determinista (GAP nuevo, review pendiente, curated reaparecido,
 *           accepted caducado)
 *   exit 2  ejecución inconclusa (red agotada): nunca certifica GAPS=0 ni escribe baseline
 *
 * Uso: node scripts/medcheck-test-audit-gates.mjs
 * Salida: exit 0 si todos los escenarios pasan; exit 1 con el detalle de cada fallo.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(__dirname, 'medcheck-audit-ontology.mjs');
const MOCK = pathToFileURL(join(__dirname, 'medcheck-mock-cima.mjs')).href;
const TERM = 'depresión';
const workDir = mkdtempSync(join(tmpdir(), 'mc-gates-'));

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function runAudit({ mode, gaps = '', baseline, extraArgs = [] }) {
    const args = ['--import', MOCK, AUDIT, '--reconcile', `--terms=${TERM}`, `--baseline=${baseline}`, ...extraArgs];
    const r = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        env: {
            ...process.env,
            MC_MOCK_MODE: mode,
            MC_MOCK_TERM: TERM,
            MC_MOCK_GAPS: gaps,
            MC_AUDIT_BACKOFF_MS: '1' // backoffs de 1-3-8 ms en tests
        }
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function makeBaseline(name, gapsRecord, termExtras = {}) {
    const file = join(workDir, name);
    const body = gapsRecord === null
        ? { version: null, terms: {} }
        : { version: '2026-07-01', terms: { [TERM]: { anchor: null, gaps: gapsRecord, ...termExtras } } };
    writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
    return file;
}

const hoy = new Date().toISOString().slice(0, 10);
const hace10dias = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

// 1. Red rota persistente → exit 2, y jamás "GAPS NUEVOS = 0"
{
    const { code, out } = runAudit({ mode: 'fail500', baseline: makeBaseline('b1.json', null) });
    check('fail500 → exit 2 (inconclusa, no exit 0 ni 1)', code === 2, `exit ${code}`);
    check('fail500 → no certifica "GAPS NUEVOS = 0"', !out.includes('GAPS NUEVOS = 0'));
    check('fail500 → informa ejecución inconclusa', out.includes('INCONCLUSA'));
}

// 2. 429 transitorios (2 por URL) → los reintentos recuperan → exit 0
{
    const { code, out } = runAudit({ mode: 'flaky', baseline: makeBaseline('b2.json', null) });
    check('flaky 429×2 → recupera con reintentos y exit 0', code === 0, `exit ${code}\n${out.slice(-400)}`);
    check('flaky → certifica GAPS NUEVOS = 0', out.includes('GAPS NUEVOS = 0'));
}

// 3. GAP nuevo sin clasificar → exit 1
{
    const { code, out } = runAudit({ mode: 'ok', gaps: '22222', baseline: makeBaseline('b3.json', null) });
    check('GAP nuevo → exit 1', code === 1, `exit ${code}`);
    check('GAP nuevo → aparece como bloqueante', out.includes('GAPS NUEVOS (sin clasificar, BLOQUEAN)'));
}

// 4. review en baseline → sigue bloqueando (estar en el baseline no es revisión)
{
    const baseline = makeBaseline('b4.json', { 22222: { status: 'review', nombre: 'MOCKFARMACO 22222', reason: '' } });
    const { code, out } = runAudit({ mode: 'ok', gaps: '22222', baseline });
    check('review → exit 1 en la siguiente pasada', code === 1, `exit ${code}`);
    check('review → motivo "pendiente de revisión humana"', out.includes('pendiente de revisión humana'));
}

// 5. accepted vigente (reason + reviewedAt reciente, legacy sin huella) → silencia → exit 0
{
    const baseline = makeBaseline('b5.json', { 22222: { status: 'accepted', nombre: 'MOCKFARMACO 22222', reason: 'falso positivo del texto', reviewedAt: hace10dias } });
    const { code, out } = runAudit({ mode: 'ok', gaps: '22222', baseline });
    check('accepted vigente → exit 0', code === 0, `exit ${code}\n${out.slice(-400)}`);
    check('accepted vigente → contado como GAP conocido', out.includes('GAPS conocidos (accepted vigente en baseline) = 1'));
}

// 6. accepted caducado (>180 días) → se reabre → exit 1
{
    const baseline = makeBaseline('b6.json', { 22222: { status: 'accepted', nombre: 'MOCKFARMACO 22222', reason: 'falso positivo', reviewedAt: '2025-01-01' } });
    const { code, out } = runAudit({ mode: 'ok', gaps: '22222', baseline });
    check('accepted caducado → exit 1', code === 1, `exit ${code}`);
    check('accepted caducado → motivo "caducado"', out.includes('caducado'));
}

// 7. curated reaparecido → bloquea (la cura falló)
{
    const baseline = makeBaseline('b7.json', { 22222: { status: 'curated', nombre: 'MOCKFARMACO 22222', reason: 'cubierto por ATC ampliado' } });
    const { code, out } = runAudit({ mode: 'ok', gaps: '22222', baseline });
    check('curated reaparecido → exit 1', code === 1, `exit ${code}`);
    check('curated reaparecido → motivo "REAPARECIDO"', out.includes('REAPARECIDO'));
}

// 8. accepted sin reason → bloquea por esquema
{
    const baseline = makeBaseline('b8.json', { 22222: { status: 'accepted', nombre: 'MOCKFARMACO 22222', reason: '', reviewedAt: hace10dias } });
    const { code, out } = runAudit({ mode: 'ok', gaps: '22222', baseline });
    check('accepted sin reason → exit 1 (esquema)', code === 1, `exit ${code}`);
    check('accepted sin reason → motivo de esquema', out.includes('sin reason'));
}

// 9. Pasada inconclusa con --update-baseline → NO escribe el archivo
{
    const baseline = makeBaseline('b9.json', null);
    const before = readFileSync(baseline, 'utf8');
    const { code, out } = runAudit({ mode: 'fail500', baseline, extraArgs: ['--update-baseline'] });
    const after = readFileSync(baseline, 'utf8');
    check('update-baseline inconcluso → exit 2', code === 2, `exit ${code}`);
    check('update-baseline inconcluso → archivo intacto', before === after);
    check('update-baseline inconcluso → avisa que NO escribe', out.includes('[baseline] NO escrito'));
}

// 10. --update-baseline sano solo crea "review"… y ese review sigue bloqueando después
{
    const baseline = makeBaseline('b10.json', null);
    const first = runAudit({ mode: 'ok', gaps: '22222', baseline, extraArgs: ['--update-baseline'] });
    const written = JSON.parse(readFileSync(baseline, 'utf8'));
    const record = written.terms?.[TERM]?.gaps?.['22222'];
    check('update-baseline crea el GAP como review (nunca auto-acepta)', record?.status === 'review', JSON.stringify(record));
    check('update-baseline guarda huella configHash del término', typeof written.terms?.[TERM]?.configHash === 'string');
    const second = runAudit({ mode: 'ok', gaps: '22222', baseline });
    check('el review recién escrito sigue bloqueando en la 2ª pasada', second.code === 1, `exit ${second.code}`);
    check('la 1ª pasada también bloqueó (GAP nuevo)', first.code === 1, `exit ${first.code}`);
}

if (failures > 0) {
    console.log(`\n${failures} caso(s) en rojo.`);
    process.exit(1);
}
console.log('\nContrato 0/1/2 y máquina de estados del baseline en verde.');
