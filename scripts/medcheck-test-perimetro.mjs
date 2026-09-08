#!/usr/bin/env node
/**
 * MedCheck — test del perímetro del gate de reconciliación y de su ratchet
 *
 * PREGUNTA QUE RESPONDE: ¿qué parte del universo del gate DETIENE una publicación, y se puede
 * ampliar sin poder encogerse?
 *
 * Nace del diagnóstico del 08/09/2026. `--reconcile` salía 1 con 2.200 GAPS y llevaba así desde
 * antes de esa sesión. Medido, la causa no era decadencia de lo curado: **23 de las 28 indicaciones
 * del universo entraron en la ontología después de construirse el baseline y no se reconciliaron
 * nunca; las 5 adjudicadas dan cero gaps nuevos**. Un gate bloqueante que nadie puede poner en
 * verde deja de ser un gate — se publica por encima, que es exactamente lo que pasaba.
 *
 * La solución NO es blanquear los 2.200 como `accepted` ni convivir con el rojo «documentado»:
 * es declarar el perímetro y que la puerta solo gire en un sentido.
 *
 * Ejecuta el auditor REAL como subproceso con el fetch sustituido por medcheck-mock-cima.mjs y
 * baselines sintéticos en un temporal. NUNCA toca el baseline del repo.
 *
 * Uso: node scripts/medcheck-test-perimetro.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(__dirname, 'medcheck-audit-ontology.mjs');
const MOCK = pathToFileURL(join(__dirname, 'medcheck-mock-cima.mjs')).href;
const BASELINE_REAL = join(__dirname, '..', 'assets', 'data', 'reconcile-baseline.json');
const ONTOLOGY = join(__dirname, '..', 'assets', 'data', 'clinical-ontology.json');
const TERM = 'depresión';
const workDir = mkdtempSync(join(tmpdir(), 'mc-perim-'));

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};

const ontology = JSON.parse(readFileSync(ONTOLOGY, 'utf8'));
// El universo del gate, con la MISMA condición que el auditor. Si esa condición cambia y aquí no,
// los escenarios dejarían indicaciones sin declarar y el test se caería: es deliberado.
const universo = Object.entries(ontology.terms)
    .filter(([, e]) => e.section41Filter || e.sectionFilter || e.reconcileTerms || e.reconcileAnchor)
    .map(([t]) => t);

function correr({ baseline, gaps = '', extraArgs = [] }) {
    const args = ['--import', MOCK, AUDIT, '--reconcile', `--terms=${TERM}`, `--baseline=${baseline}`, ...extraArgs];
    const r = spawnSync(process.execPath, args, {
        encoding: 'utf8',
        env: { ...process.env, MC_MOCK_MODE: 'ok', MC_MOCK_TERM: TERM, MC_MOCK_GAPS: gaps, MC_AUDIT_BACKOFF_MS: '1' }
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** Baseline sintético: sin registros de gaps, y con el perímetro que se le pase. */
function baselineCon(nombre, perimetro) {
    const file = join(workDir, nombre);
    const body = { version: '2026-07-01', ...(perimetro === null ? {} : { perimetro }), terms: {} };
    writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
    return file;
}

const bloqueanteReal = JSON.parse(readFileSync(BASELINE_REAL, 'utf8')).perimetro?.bloqueante || [];
const perimetroCompleto = (bloqueante) => ({
    bloqueante,
    deudaConocida: universo.filter(t => !bloqueante.includes(t))
});

// 1 · COMPATIBILIDAD: sin perímetro declarado, el contrato anterior sigue intacto (todo bloquea)
{
    const { code, out } = correr({ baseline: baselineCon('sin.json', null), gaps: '9001' });
    ok('sin "perimetro" en el baseline → el GAP bloquea, como antes', code === 1, `exit ${code}`);
    ok('sin "perimetro" → no imprime cabecera de perímetro', !out.includes('PERIMETRO:'));
}

// 2 · Una indicación ADJUDICADA con un GAP nuevo detiene la publicación
{
    const { code, out } = correr({ baseline: baselineCon('bloq.json', perimetroCompleto([TERM])), gaps: '9001' });
    ok('en "bloqueante" con GAP nuevo → exit 1', code === 1, `exit ${code}`);
    ok('anuncia el reparto del perímetro', out.includes('PERIMETRO:'));
}

// 3 · La MISMA indicación en deuda: el mismo GAP se reporta y NO bloquea
{
    const { code, out } = correr({ baseline: baselineCon('deuda.json', perimetroCompleto([])), gaps: '9001' });
    ok('en "deudaConocida" con el mismo GAP → exit 0', code === 0, `exit ${code}\n${out.slice(-600)}`);
    ok('la fila sale marcada como deuda', out.includes('[deuda · no bloquea]'));
    ok('la deuda se reporta, no se esconde', />> DEUDA: \d+ GAP/.test(out));
    ok('dice que verde NO es "todo reconciliado"', out.includes('no que la ontologia entera este reconciliada'));
}

// 4 · RATCHET: una indicación del universo sin declarar BLOQUEA. Es la deriva que dejó el gate rojo
{
    const recortado = perimetroCompleto([TERM]);
    const fuera = recortado.deudaConocida.pop();
    const { code, out } = correr({ baseline: baselineCon('sinDecl.json', recortado) });
    ok('indicación del universo sin declarar → exit 1', code === 1, `exit ${code}`);
    ok('nombra cuál falta por declarar', out.includes(`"${fuera}"`) && out.includes('no está declarada'));
}

// 5 · Contradicción de esquema: en las dos listas a la vez
{
    const p = perimetroCompleto([TERM]);
    p.deudaConocida.push(TERM);
    const { code, out } = correr({ baseline: baselineCon('dos.json', p) });
    ok('en "bloqueante" y "deudaConocida" a la vez → exit 1', code === 1, `exit ${code}`);
    ok('lo dice con ese nombre', out.includes('está a la vez'));
}

// 6 · Una ADJUDICADA que se cae del universo no se puede reconciliar → INCONCLUSO, jamás verde.
//     Es el guardián que aprueba por no haber podido mirar, y aquí no aprueba.
{
    const p = perimetroCompleto([TERM]);
    p.bloqueante.push('indicación que ya no existe');
    const { code, out } = correr({ baseline: baselineCon('perdida.json', p) });
    ok('adjudicada fuera del universo → exit 2 (inconcluso), NO exit 0', code === 2, `exit ${code}`);
    ok('explica que no hay forma de reconciliarla', out.includes('no hay forma de reconciliarla'));
}

// 7 · Un perímetro ilegible no se interpreta como "no hay perímetro": eso convertiría en silencio
//     un gate acotado en otra cosa
{
    const file = join(workDir, 'roto.json');
    writeFileSync(file, JSON.stringify({ version: '2026-07-01', perimetro: { bloqueante: 'depresión' }, terms: {} }), 'utf8');
    const { code, out } = correr({ baseline: file });
    ok('"perimetro" malformado → exit 2, no se ignora', code === 2, `exit ${code}`);
    ok('lo declara inválido por su nombre', out.includes('"perimetro" inválido'));
}

// 8 · --update-baseline registra gaps pero NO promueve nada: mover una indicación entre listas es
//     un acto humano, igual que aceptar un gap. Si lo hiciera solo, la ratchet sería decorativa.
{
    const p = perimetroCompleto([]);
    const file = baselineCon('upd.json', p);
    const { code } = correr({ baseline: file, gaps: '9001', extraArgs: ['--update-baseline'] });
    const despues = JSON.parse(readFileSync(file, 'utf8'));
    ok('--update-baseline no rompe la pasada', code === 0 || code === 1, `exit ${code}`);
    ok('--update-baseline PRESERVA el perímetro', !!despues.perimetro, 'se perdió el bloque');
    ok('--update-baseline NO promueve a "bloqueante"',
        !(despues.perimetro?.bloqueante || []).includes(TERM),
        `bloqueante = ${JSON.stringify(despues.perimetro?.bloqueante)}`);
    ok('--update-baseline sí registró el gap como review',
        despues.terms?.[TERM]?.gaps?.['9001']?.status === 'review',
        JSON.stringify(despues.terms?.[TERM]?.gaps));
}

// 9 · --solo-perimetro recorta la ENTRADA y lo DICE. Recortar en silencio sería el gate que se
//     define a sí mismo el trabajo.
{
    const { code, out } = correr({
        baseline: baselineCon('solo.json', perimetroCompleto([])),
        gaps: '9001',
        extraArgs: ['--solo-perimetro']
    });
    ok('--solo-perimetro con la indicación en deuda → no la recorre', !out.includes('[deuda · no bloquea]'));
    ok('--solo-perimetro avisa de lo que NO ha mirado', out.includes('la deuda NO se ha mirado'));
    ok('--solo-perimetro no inventa un bloqueo', code === 0, `exit ${code}`);
}

// 10 · LA RATCHET, fijada: de "bloqueante" no se sale. Esta lista solo puede CRECER; quitar un
//      nombre obliga a editar este test y a decir por qué en el commit. Es la única forma de
//      impedir que el perímetro encoja por descuido en un repo con varias sesiones a la vez.
{
    const minimo = ['depresión', 'enfermedad renal crónica', 'fibrilación auricular', 'insuficiencia cardiaca', 'obesidad'];
    const perdidas = minimo.filter(t => !bloqueanteReal.includes(t));
    ok('el perímetro bloqueante real no ha encogido', !perdidas.length, `faltan: ${perdidas.join(', ')}`);
    ok('las adjudicadas siguen en el universo del gate',
        bloqueanteReal.every(t => universo.includes(t)),
        bloqueanteReal.filter(t => !universo.includes(t)).join(', '));
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — el perímetro reparte, la deuda no bloquea y la ratchet solo gira en un sentido.');
process.exit(fallos ? 1 : 0);
