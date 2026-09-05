#!/usr/bin/env node
/**
 * MedCheck — test del gate --vigilar-broad
 *
 * Cubre el punto ciego que --cobertura-atc deja abierto POR CONTRATO: bajo un prefijo `broad`
 * nadie mira lo que entra, porque los broad se excluyen del cálculo de cobertura (un prefijo
 * aprobaría siempre). Este gate detecta que un código ATC nuevo ha empezado a comercializarse
 * bajo un prefijo vigilado.
 *
 * Corre el auditor como subproceso con el fetch sustituido por medcheck-mock-cima.mjs (via
 * node --import) y baselines sintéticos (via --broad-baseline=), y comprueba:
 *
 *   exit 0  todas las hojas con producto están aceptadas (reason + reviewedBy)
 *   exit 1  hoja nueva sin clasificar · 'review' · accepted sin motivo · accepted sin responsable
 *   exit 2  maestra truncada o red rota: nunca certifica "no ha entrado nada" ni escribe baseline
 *
 * LA MUTACIÓN que hace fiable a esta suite: el escenario "hoja nueva CON producto" es exactamente
 * la regresión que el gate existe para cazar (Imlygic/Ebvallo comercializándose bajo L01XL). Si
 * alguien lo debilitara para que no bloqueara, ese escenario se pone rojo. Y su complementario
 * ("hoja nueva SIN producto") impide la cura fácil de bloquear ante cualquier código nuevo: eso
 * sería ruido en cada pasada y acabaría con la suite ignorada, que es como no tener gate.
 *
 * Uso: node scripts/medcheck-test-vigilar-broad.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(__dirname, 'medcheck-audit-ontology.mjs');
const MOCK = pathToFileURL(join(__dirname, 'medcheck-mock-cima.mjs')).href;
const PREFIJO = 'L01XL';
const workDir = mkdtempSync(join(tmpdir(), 'mc-broad-'));

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function runAudit({ mode = 'ok', codigos, sinProducto = '', total, baseline, extraArgs = [] }) {
    const args = ['--import', MOCK, AUDIT, `--vigilar-broad=${PREFIJO}`, `--broad-baseline=${baseline}`, ...extraArgs];
    const r = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        env: {
            ...process.env,
            MC_MOCK_MODE: mode,
            MC_MOCK_ATC: codigos,
            MC_MOCK_ATC_SIN_PRODUCTO: sinProducto,
            ...(total ? { MC_MOCK_ATC_TOTAL: String(total) } : {}),
            MC_AUDIT_BACKOFF_MS: '1'
        }
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function makeBaseline(name, leaves) {
    const file = join(workDir, name);
    writeFileSync(file, JSON.stringify({ version: '2026-09-01', prefixes: { [PREFIJO]: { leaves } } }, null, 2), 'utf8');
    return file;
}

const aceptada = (nombre) => ({
    status: 'accepted',
    nombre,
    reason: 'CAR-T autorizado, pertenece al grupo',
    reviewedAt: '2026-09-01',
    reviewedBy: 'test'
});
const DOS_HOJAS = 'L01XL,L01XL03,L01XL04';
const TRES_HOJAS = 'L01XL,L01XL03,L01XL04,L01XL09';

// 1. Todo aceptado -> verde
{
    const b = makeBaseline('ok.json', { L01XL03: aceptada('A'), L01XL04: aceptada('B') });
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b });
    check('hojas conocidas y aceptadas -> exit 0', r.code === 0, `exit ${r.code}`);
    check('el informe cierra la fila en ok', /2 aceptadas · ok/.test(r.out), 'no imprime el estado ok');
}

// 2. LA REGRESIÓN: hoja nueva CON producto comercializado -> bloquea y la nombra
{
    const b = makeBaseline('nueva.json', { L01XL03: aceptada('A'), L01XL04: aceptada('B') });
    const r = runAudit({ codigos: TRES_HOJAS, baseline: b });
    check('hoja nueva con producto -> exit 1', r.code === 1, `exit ${r.code}`);
    check('nombra el código nuevo en el informe', r.out.includes('L01XL09'), 'no aparece L01XL09');
    check('lo marca como sin clasificar', /SIN clasificar en el baseline/.test(r.out));
}

// 3. Su complementario: hoja nueva SIN producto comercializado NO bloquea
{
    const b = makeBaseline('nueva-sin-producto.json', { L01XL03: aceptada('A'), L01XL04: aceptada('B') });
    const r = runAudit({ codigos: TRES_HOJAS, sinProducto: 'L01XL09', baseline: b });
    check('hoja nueva sin producto -> exit 0 (no es un suceso)', r.code === 0, `exit ${r.code}`);
}

// 4. 'review' bloquea: estar en el baseline no es haber revisado
{
    const b = makeBaseline('review.json', {
        L01XL03: { status: 'review', nombre: 'A', reason: '', detectedAt: '2026-09-01' },
        L01XL04: aceptada('B')
    });
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b });
    check("'review' -> exit 1", r.code === 1, `exit ${r.code}`);
    check('dice que review no silencia', /pendiente de revisión humana/.test(r.out));
}

// 5. accepted sin motivo escrito -> bloquea
{
    const b = makeBaseline('sin-reason.json', { L01XL03: { ...aceptada('A'), reason: '' }, L01XL04: aceptada('B') });
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b });
    check('accepted sin reason -> exit 1', r.code === 1, `exit ${r.code}`);
    check('lo dice explícitamente', /accepted sin motivo escrito/.test(r.out));
}

// 6. accepted sin responsable -> bloquea
{
    const b = makeBaseline('sin-quien.json', { L01XL03: { ...aceptada('A'), reviewedBy: '' }, L01XL04: aceptada('B') });
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b });
    check('accepted sin reviewedBy -> exit 1', r.code === 1, `exit ${r.code}`);
    check('lo dice explícitamente', /accepted sin responsable/.test(r.out));
}

// 7. status desconocido -> bloquea por esquema
{
    const b = makeBaseline('esquema.json', { L01XL03: { status: 'vale', nombre: 'A' }, L01XL04: aceptada('B') });
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b });
    check('status desconocido -> exit 1', r.code === 1, `exit ${r.code}`);
    check('lo llama problema de esquema', /status desconocido/.test(r.out));
}

// 8. Maestra TRUNCADA -> inconcluso (exit 2), jamás un "no ha entrado nada"
{
    const b = makeBaseline('truncada.json', { L01XL03: aceptada('A'), L01XL04: aceptada('B') });
    const r = runAudit({ codigos: DOS_HOJAS, total: 99, baseline: b });
    check('maestra truncada -> exit 2', r.code === 2, `exit ${r.code}`);
    check('no certifica limpio', /INCONCLUSO/.test(r.out));
}

// 9. Red rota -> exit 2
{
    const b = makeBaseline('red.json', { L01XL03: aceptada('A'), L01XL04: aceptada('B') });
    const r = runAudit({ mode: 'fail500', codigos: DOS_HOJAS, baseline: b });
    check('red rota -> exit 2', r.code === 2, `exit ${r.code}`);
}

// 10. Una pasada inconclusa NUNCA escribe el baseline
{
    const b = makeBaseline('no-escribe.json', { L01XL03: aceptada('A') });
    const antes = readFileSync(b, 'utf8');
    const r = runAudit({ codigos: DOS_HOJAS, total: 99, baseline: b, extraArgs: ['--update-vigilancia-broad'] });
    check('inconclusa + --update -> exit 2', r.code === 2, `exit ${r.code}`);
    check('el baseline queda intacto', readFileSync(b, 'utf8') === antes, 'el archivo cambió');
}

// 11. --update solo crea 'review': nunca acepta por su cuenta
{
    const b = makeBaseline('update.json', {});
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b, extraArgs: ['--update-vigilancia-broad'] });
    const escrito = JSON.parse(readFileSync(b, 'utf8'));
    const estados = Object.values(escrito.prefixes[PREFIJO].leaves).map((l) => l.status);
    check('--update escribe las hojas vivas', estados.length === 2, `escribió ${estados.length}`);
    check("--update las deja en 'review', nunca en 'accepted'", estados.every((s) => s === 'review'), estados.join(','));
    check('y aun así la pasada bloquea', r.code === 1, `exit ${r.code}`);
}

console.log('');
if (failures) {
    console.log(`${failures} comprobación(es) fallida(s)`);
    process.exit(1);
}
console.log('Todas las comprobaciones de --vigilar-broad pasan.');
