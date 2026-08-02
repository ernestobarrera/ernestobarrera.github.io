#!/usr/bin/env node
/**
 * MedCheck — test del contrato de salida del auditor de dosis, con inyección de fallos.
 *
 * Ejecuta `medcheck-audit-dose.mjs` como subproceso contra volcados sintéticos vía `--catalog=`
 * y verifica su máquina de estados:
 *
 *   exit 0  volcado completo y acreditado, invariantes cumplidos
 *   exit 2  INCONCLUSO — no se puede auditar con garantías, y por tanto no se certifica nada
 *
 * Por qué existe: un auditor que confunde "no lo sé" con "está bien" es peor que no tenerlo,
 * porque presta autoridad a una cifra que nadie ha comprobado. Dos vías de falso OK llegaron a
 * producción de este script y las cazó la revisión de Codex, no estas pruebas: un volcado sin
 * `totalDeclarado` (nada acreditaba que estuviese completo) y un catálogo sin VTM (los
 * invariantes se comprueban por principio activo, así que no se comprobaba ninguno). Cada
 * escenario de aquí abajo es una de esas vías.
 *
 * El caso `exit 1` (invariante roto) no se puede inyectar desde un volcado: exigiría un
 * `cima-app.js` defectuoso. Lo cubren las aserciones de `medcheck-test-dose.mjs`.
 *
 * Uso: node scripts/medcheck-test-audit-dose.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT = join(__dirname, 'medcheck-audit-dose.mjs');
const workDir = mkdtempSync(join(tmpdir(), 'mc-dose-audit-'));

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Un producto mínimo pero auditable: dosis simple y VTM. */
const producto = (n) => ({
    nregistro: String(n),
    nombre: `FÁRMACO ${n} ${100 * n} mg COMPRIMIDOS`,
    dosis: `${100 * n} mg`,
    vtm: 'fármaco',
    forma: 'COMPRIMIDO',
});

/** Escribe un volcado y devuelve su ruta. `patch` sustituye o borra (con undefined) claves. */
function volcado(nombre, { registros = [producto(1), producto(2)], patch = {} } = {}) {
    const base = {
        esquema: 1,
        fuente: 'test sintético',
        fecha: new Date().toISOString(),
        totalDeclarado: registros.length,
        registros,
    };
    const v = { ...base, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete v[k];
    const ruta = join(workDir, `${nombre}.json`);
    writeFileSync(ruta, JSON.stringify(v));
    return ruta;
}

function auditar(ruta) {
    const r = spawnSync(process.execPath, [AUDIT, `--catalog=${ruta}`, '--json'], { encoding: 'utf8' });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* inconcluso por stderr, o salida no JSON */ }
    return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

const esperaInconcluso = (nombre, ruta, fragmentoDelMotivo) => {
    const r = auditar(ruta);
    check(`${nombre}: código 2`, r.code === 2, `código ${r.code}`);
    check(`${nombre}: estado inconclusive`, r.json?.estado === 'inconclusive',
        `estado ${r.json?.estado ?? '(sin JSON)'}`);
    if (fragmentoDelMotivo) {
        const motivo = r.json?.motivo || '';
        check(`${nombre}: el motivo lo explica`, motivo.includes(fragmentoDelMotivo),
            `motivo: ${motivo.slice(0, 120)}`);
    }
};

console.log('--- el caso bueno, para que el resto signifique algo ---');
{
    const r = auditar(volcado('valido'));
    check('volcado válido: código 0', r.code === 0, `código ${r.code}`);
    check('volcado válido: estado ok', r.json?.estado === 'ok', `estado ${r.json?.estado}`);
    check('declara cobertura VTM completa',
        r.json?.procedencia?.vtmCobertura?.sinVtm === 0
        && r.json?.procedencia?.vtmCobertura?.agrupados === 2,
        JSON.stringify(r.json?.procedencia?.vtmCobertura));
}

// Las dos vías de falso OK que cazó la revisión. Antes daban código 0 con estado "ok".
console.log('\n--- completitud no acreditada ---');
esperaInconcluso('sin totalDeclarado', volcado('sinTotal', { patch: { totalDeclarado: undefined } }),
    'totalDeclarado');
esperaInconcluso('totalDeclarado no entero', volcado('totalRaro', { patch: { totalDeclarado: 2.5 } }),
    'totalDeclarado');
esperaInconcluso('totalDeclarado cero', volcado('totalCero', { patch: { totalDeclarado: 0 } }),
    'totalDeclarado');
esperaInconcluso('truncado', volcado('truncado', { patch: { totalDeclarado: 99 } }), 'truncado');

console.log('\n--- cobertura de agrupación ---');
esperaInconcluso('todos sin VTM',
    volcado('sinVtm', { registros: [{ ...producto(1), vtm: null }] }), 'VTM');
esperaInconcluso('uno solo sin VTM',
    volcado('unoSinVtm', { registros: [producto(1), { ...producto(2), vtm: '  ' }] }), 'VTM');

console.log('\n--- procedencia ---');
esperaInconcluso('array desnudo (volcados antiguos)',
    (() => {
        const ruta = join(workDir, 'desnudo.json');
        writeFileSync(ruta, JSON.stringify([producto(1)]));
        return ruta;
    })(), 'array desnudo');
esperaInconcluso('sin fuente', volcado('sinFuente', { patch: { fuente: undefined } }), 'fuente');
esperaInconcluso('fuente vacía', volcado('fuenteVacia', { patch: { fuente: '   ' } }), 'fuente');
esperaInconcluso('sin fecha', volcado('sinFecha', { patch: { fecha: undefined } }), 'fecha');
esperaInconcluso('fecha inválida', volcado('fechaMala', { patch: { fecha: 'ayer' } }), 'fecha');
esperaInconcluso('esquema desconocido', volcado('esquema9', { patch: { esquema: 9 } }), 'esquema');
esperaInconcluso('nregistro repetido',
    volcado('dup', { registros: [producto(1), producto(1)] }), 'repetido');
esperaInconcluso('registro sin nregistro',
    volcado('sinNreg', { registros: [{ ...producto(1), nregistro: null }] }), 'nregistro');

// Un volcado viejo pasado a mano SÍ se audita: reproducir una medición pasada es el motivo de
// existir de --catalog=. Pero debe declarar que no describe el catálogo actual.
console.log('\n--- volcado histórico: se audita, pero se declara ---');
{
    const viejo = volcado('viejo', {
        patch: { fecha: new Date(Date.now() - 30 * 86_400_000).toISOString() },
    });
    const r = auditar(viejo);
    check('volcado de 30 días: código 0', r.code === 0, `código ${r.code}`);
    check('pero describeCatalogoActual es false',
        r.json?.procedencia?.describeCatalogoActual === false,
        String(r.json?.procedencia?.describeCatalogoActual));
}

console.log(failures === 0 ? '\nOK — el auditor no confunde "no lo sé" con "está bien"'
    : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
