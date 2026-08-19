#!/usr/bin/env node
/**
 * MedCheck — test del guardián de identidad de sustancia (medcheck-audit-identity.mjs)
 *
 * NO comprueba que salga verde con el baseline real: eso lo pasaría un script que devolviera 0
 * siempre, y un guardián que aprueba por no mirar es peor que no tenerlo, porque además da
 * confianza. Lo que hace es ROMPER cada guarda y exigir que el guardián se caiga:
 *
 *   1. Un nombre que CIMA sirve y el baseline no registra -> exit 1. Es el caso SPRAVATO:
 *      nadie lo ha mirado nunca, y hasta hoy nada avisaba.
 *   2. Ese mismo nombre, ya registrado como `unresolved` -> exit 0. Registrado no es resuelto,
 *      pero sí es visto: bloquear lo ya anotado haría que el guardián avisara siempre.
 *   3. Registrado como `review` o `manual` -> exit 0, por lo mismo.
 *   4. Baseline inexistente -> exit 2, no 0. No se certifica sin con qué comparar.
 *   5. CIMA caído -> exit 2 INCONCLUSO, jamás 0. No se aprueba lo que no se ha podido medir.
 *   6. Un `verified` con más de 180 días avisa por caducidad, pero NO bloquea.
 *
 * Usa un CIMA sintético y baselines sintéticos en un temporal: no toca la red ni los datos
 * reales del repo.
 *
 * Uso: node scripts/medcheck-test-audit-identity.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDITOR = join(__dirname, 'medcheck-audit-identity.mjs');
const MOCK = pathToFileURL(join(__dirname, 'medcheck-mock-identity.mjs')).href;
const workDir = mkdtempSync(join(tmpdir(), 'mc-audit-id-'));

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// El mock sirve un único producto cuyo nombre de sustancia es "micofenolato raro" (caso
// `convergencia`), que NO está en el diccionario real: el auditor lo verá sin verificar.
const NOMBRE = 'micofenolato raro';

function baselineCon(entrada, nombreFichero) {
    const f = join(workDir, nombreFichero);
    writeFileSync(f, JSON.stringify({ version: '2026-08-18', terms: entrada }, null, 2), 'utf8');
    return f;
}

function auditar(baselinePath, { modo = 'convergencia' } = {}) {
    const args = ['--import', MOCK, AUDITOR];
    if (baselinePath) args.push(`--baseline=${baselinePath}`);
    const r = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        cwd: workDir,
        env: { ...process.env, MC_ID_CASO: modo },
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const hace200dias = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
const hoy = new Date().toISOString().slice(0, 10);

// 1 · desconocido: nadie lo ha mirado nunca
let r = auditar(baselineCon({}, 'vacio.json'));
check('1 · un nombre que nadie ha registrado -> exit 1 (bloquea)', r.code === 1, `exit ${r.code}`);
check('1b · y lo nombra, para poder actuar', new RegExp(NOMBRE).test(r.out), r.out.slice(0, 200));

// 2 · registrado como unresolved: visto y anotado, aunque sin resolver
r = auditar(baselineCon({ [NOMBRE]: { status: 'unresolved', checked: hoy } }, 'unres.json'));
check('2 · registrado como unresolved -> exit 0 (no bloquea lo ya visto)', r.code === 0, `exit ${r.code}`);

// 3 · review y manual tampoco bloquean
for (const estado of ['review', 'manual']) {
    r = auditar(baselineCon({ [NOMBRE]: { status: estado, checked: hoy } }, `${estado}.json`));
    check(`3 · registrado como ${estado} -> exit 0`, r.code === 0, `exit ${r.code}`);
}

// 4 · sin baseline no se certifica nada
r = auditar(join(workDir, 'no-existe.json'));
check('4 · baseline inexistente -> exit 2, no 0', r.code === 2, `exit ${r.code}`);

// 5 · CIMA caído: inconcluso, nunca limpio
r = auditar(baselineCon({ [NOMBRE]: { status: 'verified', en: 'x', checked: hoy } }, 'ok.json'), { modo: 'red-rota' });
check('5 · CIMA caído -> exit 2 inconcluso, jamás 0', r.code === 2, `exit ${r.code}`);
check('5b · y lo dice en vez de callarlo', /INCONCLUSO/i.test(r.out));

// 6 · caducidad: avisa pero no bloquea
r = auditar(baselineCon({ [NOMBRE]: { status: 'verified', en: 'x', checked: hace200dias } }, 'viejo.json'));
check('6 · un verified caducado avisa pero NO bloquea', r.code === 0, `exit ${r.code}`);
check('6b · y aparece en la lista de caducados', /CADUCADOS/.test(r.out), r.out.slice(-300));

// 7 · MUTACIÓN: si el guardián dejara de comparar contra el baseline, el caso 1 pasaría.
// Se comprueba que el caso 1 y el caso 2 dan resultados DISTINTOS: si diesen lo mismo, el
// auditor no estaría mirando el baseline en absoluto.
const vacio = auditar(baselineCon({}, 'vacio2.json'));
const lleno = auditar(baselineCon({ [NOMBRE]: { status: 'unresolved', checked: hoy } }, 'lleno2.json'));
check('7 · el guardián DEPENDE del baseline (con y sin registro dan distinto)',
    vacio.code !== lleno.code, `ambos exit ${vacio.code}`);

console.log('');
if (failures) {
    console.log(`${failures} fallo(s) — el guardián de identidad no hace su trabajo.`);
    process.exitCode = 1;
} else {
    console.log('Guardián de identidad en verde: bloquea lo que nadie ha mirado, no bloquea lo');
    console.log('ya anotado, y sale inconcluso cuando no puede medir.');
}
