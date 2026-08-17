#!/usr/bin/env node
/**
 * MedCheck — test del gate de cobertura ATC (`--cobertura-atc`)
 *
 * La comprobación responde a "¿hay algún código ATC del grupo, con producto comercializado, al
 * que ningún término específico de la ontología llegue?". Nació de una pregunta suya del
 * 2026-08-17 sobre si la familia de vacunas se automantiene, y encontró un hueco real
 * (J07BP, chikunguña) en su primera pasada.
 *
 * ESTE TEST NO COMPRUEBA QUE SALGA VERDE. Comprobar el caso bueno lo pasaría un script que
 * devolviera 0 siempre — que es exactamente el fallo que un gate tiene que impedir. Lo que hace
 * es ROMPER cada guarda de una en una y exigir que la comprobación se caiga:
 *
 *   1. código hoja con producto y sin término específico  → 1 (bloquea)
 *   2. el mismo código pero sin comercializar             → 0 (no es hueco hoy)
 *   3. código hoja cubierto por un término específico     → 0
 *   4. MUTANTE: si la cobertura contara los `broad`, el caso 1 pasaría — `vacunas → J07` es
 *      prefijo de todo el grupo. Se exige que 1 siga bloqueando con el broad presente.
 *   5. maestra truncada (totalFilas > filas servidas)     → 2 INCONCLUSO, jamás 0
 *   6. maestra vacía                                      → 2 INCONCLUSO, jamás 0
 *   7. red rota persistente                               → 2 INCONCLUSO, jamás 0
 *   8. solo se evalúan HOJAS: un padre cuyos hijos están cubiertos no es un hueco
 *
 * Usa el mock de CIMA (medcheck-mock-cima.mjs) vía `node --import`: no toca la red ni el
 * clinical-ontology.json real.
 *
 * Uso: node scripts/medcheck-test-atc-coverage.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(__dirname, 'medcheck-audit-ontology.mjs');
const MOCK = pathToFileURL(join(__dirname, 'medcheck-mock-cima.mjs')).href;
const workDir = mkdtempSync(join(tmpdir(), 'mc-atc-'));

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

function runCoverage({ atc, total, sinProducto = '', mode = 'ok', grupo = 'J07' }) {
    const args = ['--import', MOCK, AUDIT, `--cobertura-atc=${grupo}`];
    const env = {
        ...process.env,
        MC_MOCK_MODE: mode,
        MC_MOCK_ATC: atc,
        MC_MOCK_ATC_SIN_PRODUCTO: sinProducto,
        MC_AUDIT_BACKOFF_MS: '1'
    };
    if (total !== undefined) env.MC_MOCK_ATC_TOTAL = String(total);
    else delete env.MC_MOCK_ATC_TOTAL;
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

// La ontología real tiene términos específicos bajo J07 (p. ej. J07BB para la gripe) y el
// término amplio `vacunas → J07`. Ambos hechos se usan abajo, así que se comprueban primero:
// un test que se apoya en una suposición sobre los datos caduca sin avisar.
const ontology = JSON.parse(
    (await import('node:fs')).readFileSync(join(__dirname, '..', 'assets', 'data', 'clinical-ontology.json'), 'utf8')
);
const atcsDe = (e) => (Array.isArray(e.atc) ? e.atc : [e.atc]).map(a => String(a).toUpperCase());
const hayEspecificoJ07BB = Object.values(ontology.terms)
    .some(e => e.status !== 'broad' && atcsDe(e).some(a => a === 'J07BB' || 'J07BB'.startsWith(a)));
const hayBroadJ07 = Object.values(ontology.terms)
    .some(e => e.status === 'broad' && atcsDe(e).includes('J07'));
check('premisa: existe término específico que alcanza J07BB', hayEspecificoJ07BB);
check('premisa: existe el término amplio vacunas → J07 (es el mutante del caso 4)', hayBroadJ07);

// 1 · código hoja inventado, con producto y sin ningún término específico → bloquea
const nuevo = runCoverage({ atc: 'J07,J07Z,J07Z99' });
check('1 · código hoja sin término y con producto → exit 1',
    nuevo.code === 1, `exit ${nuevo.code}`);
check('1b · lo nombra en el informe',
    /J07Z99/.test(nuevo.out), 'no aparece el código en la salida');

// 4 · MUTANTE: el broad `vacunas → J07` es prefijo de J07Z99. Si la cobertura lo contara, el
// caso 1 saldría limpio. Es el mismo caso 1 y por eso basta con que siga bloqueando: si alguien
// borra el filtro `status === 'broad'` de checkAtcCoverage, este test se cae.
check('4 · MUTANTE: el término amplio NO cubre; el hueco sigue bloqueando',
    nuevo.code === 1, 'un broad estaría tapando el hueco');

// 2 · mismo código huérfano pero sin comercializar → no es hueco hoy
const sinProducto = runCoverage({ atc: 'J07,J07Z,J07Z99', sinProducto: 'J07Z99' });
check('2 · código huérfano sin producto comercializado → exit 0',
    sinProducto.code === 0, `exit ${sinProducto.code}`);

// 3 · código hoja cubierto por un término específico real de la ontología → limpio
const cubierto = runCoverage({ atc: 'J07,J07B,J07BB,J07BB99' });
check('3 · código hoja bajo un término específico → exit 0',
    cubierto.code === 0, `exit ${cubierto.code}`);

// 8 · solo hojas: J07BB es padre de J07BB99 y no debe evaluarse por su cuenta
check('8 · un padre con hijos no se evalúa como hoja',
    cubierto.code === 0 && !/!! J07BB —/.test(cubierto.out), 'el padre se está evaluando');

// 5 · maestra truncada: totalFilas dice más de lo servido → INCONCLUSO
const truncada = runCoverage({ atc: 'J07,J07Z,J07Z99', total: 999 });
check('5 · maestra truncada → exit 2 inconcluso (nunca 0)',
    truncada.code === 2, `exit ${truncada.code}`);
check('5b · lo dice, no lo silencia',
    /truncada/i.test(truncada.out), 'no explica por qué es inconcluso');

// 6 · maestra vacía: no encontrar nada NO es aprobar
const vacia = runCoverage({ atc: '' });
check('6 · maestra vacía → exit 2 inconcluso (una marca ausente no aprueba)',
    vacia.code === 2, `exit ${vacia.code}`);

// 7 · red rota persistente → inconcluso, no limpio
const rota = runCoverage({ atc: 'J07,J07Z,J07Z99', mode: 'fail500' });
check('7 · red rota → exit 2 inconcluso',
    rota.code === 2, `exit ${rota.code}`);

console.log('');
if (failures) {
    console.log(`${failures} fallo(s) — el gate de cobertura ATC no está haciendo su trabajo.`);
    process.exitCode = 1;
} else {
    console.log('Gate de cobertura ATC en verde: bloquea el hueco, distingue el código sin producto');
    console.log('y sale inconcluso cuando no puede medir.');
}
