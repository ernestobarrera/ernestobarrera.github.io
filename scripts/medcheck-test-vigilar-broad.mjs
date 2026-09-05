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

// ---------------------------------------------------------------------------------------------
// EL GATE COMPLETO (--vigilar-broad a secas). Todo lo de arriba usa --vigilar-broad=L01XL, que es
// una pasada FOCALIZADA y no comprueba adjudicación: por esa rama nunca se pasaba, y era el
// hallazgo P1 de Codex (2026-09-05). El universo del gate lo fija la ONTOLOGÍA, no la línea base.
// ---------------------------------------------------------------------------------------------
const ONTOLOGIA = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'data', 'clinical-ontology.json'), 'utf8'));
const PREFIJOS_BROAD = [...new Set(Object.values(ONTOLOGIA.terms)
    .filter((e) => e.status === 'broad')
    .flatMap((e) => (Array.isArray(e.atc) ? e.atc : [e.atc]))
    .map((a) => String(a || '').trim().toUpperCase())
    .filter(Boolean))].sort();

function runGate({ prefixes, mode = 'ok' }) {
    const file = join(workDir, `gate-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify({ version: '2026-09-01', prefixes }, null, 2), 'utf8');
    const r = spawnSync(process.execPath, ['--import', MOCK, AUDIT, '--vigilar-broad', `--broad-baseline=${file}`], {
        encoding: 'utf8',
        env: { ...process.env, MC_MOCK_MODE: mode, MC_MOCK_ATC_ECO: '1', MC_AUDIT_BACKOFF_MS: '1' }
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}`, file };
}

// Adjudicación completa y coherente: cada prefijo broad vigilado por códigos, con su inventario ya
// sembrado (la maestra en modo eco devuelve `<P>` y `<P>01`, y la hoja es `<P>01`).
const todoAdjudicado = () => Object.fromEntries(PREFIJOS_BROAD.map((p) => [p, {
    watch: 'codigos', codes: [`${p}01`], owners: ['x']
}]));

check('premisa: la ontología declara varios prefijos broad', PREFIJOS_BROAD.length > 10, `${PREFIJOS_BROAD.length}`);

// 12. LA REGRESIÓN P1: línea base incompleta → el gate NO puede salir verde
{
    const r = runGate({ prefixes: { L01XL: { watch: 'codigos', codes: ['L01XL01'], owners: ['x'] } } });
    check('línea base incompleta → exit 1 (no puede aprobar lo que no vigila)', r.code === 1, `exit ${r.code}`);
    check('nombra los prefijos sin adjudicar', /SIN-ADJUDICAR/.test(r.out));
    check('y dice qué entrada los declara', /lo declaran /.test(r.out));
}

// 13. Línea base vacía: el caso extremo del mismo fallo (antes: "none" + exit 0)
{
    const r = runGate({ prefixes: {} });
    check('línea base vacía → exit 1, jamás verde', r.code === 1, `exit ${r.code}`);
}

// 14. Adjudicación completa y coherente → verde
{
    const r = runGate({ prefixes: todoAdjudicado() });
    check('todos los prefijos adjudicados e inventariados → exit 0', r.code === 0, `exit ${r.code}`);
}

// 15. Un código nuevo bajo un paraguas vigilado por códigos → bloquea
{
    const prefixes = todoAdjudicado();
    prefixes[PREFIJOS_BROAD[0]].codes = [];
    const r = runGate({ prefixes });
    check('código nuevo bajo un prefijo broad → exit 1', r.code === 1, `exit ${r.code}`);
    check('lo nombra como código nuevo', /código nuevo bajo este paraguas/.test(r.out));
}

// 16. Prefijo en la línea base que ya no reclama nadie → bloquea (la ontología cambió)
{
    const prefixes = todoAdjudicado();
    prefixes.ZZZ9 = { watch: 'codigos', codes: [], owners: [] };
    const r = runGate({ prefixes });
    check('prefijo huérfano en la línea base → exit 1', r.code === 1, `exit ${r.code}`);
    check('lo llama huérfano', /HUÉRFANO/i.test(r.out));
}

// 17. La renuncia es un estado legítimo, pero solo firmada
{
    const conMotivo = todoAdjudicado();
    conMotivo[PREFIJOS_BROAD[1]] = { watch: 'waived', reason: 'coste', reviewedBy: 'test', owners: ['x'] };
    check('renuncia con motivo y responsable → exit 0', runGate({ prefixes: conMotivo }).code === 0);

    const sinMotivo = todoAdjudicado();
    sinMotivo[PREFIJOS_BROAD[1]] = { watch: 'waived', reason: '', reviewedBy: 'test', owners: ['x'] };
    const r = runGate({ prefixes: sinMotivo });
    check('renuncia sin motivo → exit 1', r.code === 1, `exit ${r.code}`);
    check('lo dice explícitamente', /renuncia sin motivo escrito/.test(r.out));

    const sinQuien = todoAdjudicado();
    sinQuien[PREFIJOS_BROAD[1]] = { watch: 'waived', reason: 'coste', reviewedBy: '', owners: ['x'] };
    check('renuncia sin responsable → exit 1', runGate({ prefixes: sinQuien }).code === 1);
}

// 18. Un `watch` desconocido no se interpreta con buena fe
{
    const prefixes = todoAdjudicado();
    prefixes[PREFIJOS_BROAD[2]].watch = 'un poco';
    const r = runGate({ prefixes });
    check('watch desconocido → exit 1', r.code === 1, `exit ${r.code}`);
    check('lo llama problema de esquema', /watch desconocido/.test(r.out));
}

// 19. La pasada focalizada se declara como lo que es, para que no se confunda con el gate
{
    const b = makeBaseline('focal.json', { L01XL03: aceptada('A'), L01XL04: aceptada('B') });
    const r = runAudit({ codigos: DOS_HOJAS, baseline: b });
    check('--vigilar-broad=X avisa de que NO es el gate', /PASADA FOCALIZADA/.test(r.out));
}

console.log('');
if (failures) {
    console.log(`${failures} comprobación(es) fallida(s)`);
    process.exit(1);
}
console.log('Todas las comprobaciones de --vigilar-broad pasan.');
