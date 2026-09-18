#!/usr/bin/env node
/**
 * MedCheck — contrato del vigilante del vigilante (`scripts/watchdog/check-runs.mjs`)
 *
 * Este script decide QUÉ SE VIGILA, y por eso sus errores son mudos por naturaleza: si se deja
 * fuera un workflow, nadie recibe un aviso diciendo que no hay aviso. Ya pasó dos veces:
 *
 *   - `packs-index.json` estuvo 27 días desfasado porque el watchdog llevaba sus fuentes
 *     escritas dentro, y el índice nuevo no estaba en la lista.
 *   - `etl-financiacion.yml` se declaraba «solo manual; no se vigila» hasta el 18/09/2026,
 *     porque se encadena con `workflow_run` en vez de tener `cron`. Es la vista que gobierna
 *     «Financiado por el SNS».
 *
 * Las dos son el mismo fallo: el vigilante decidiendo su propio perímetro y aprobándose.
 *
 * Todo lo de aquí corre SIN RED: la clasificación es pura y se le pasan los runs a mano. Lo
 * único que toca proceso es la última prueba, que ejecuta el script de verdad sin `gh` a la
 * vista para comprobar que no aprueba lo que no ha podido comprobar.
 *
 * Uso: node scripts/medcheck-test-check-runs.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ventanaDias, leerWorkflows, resolverCadenas, clasificar } from './watchdog/check-runs.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok    ${nombre}`); return; }
    fallos += 1;
    console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

const AHORA = Date.parse('2026-09-18T12:00:00Z');
const hace = (dias) => new Date(AHORA - dias * 86400000).toISOString();

// ── 1 · la ventana sale de la cadencia, no de una tabla ─────────────────────
console.log('\n1) la ventana se deriva del cron');
{
    ok('diario → 2 d', ventanaDias('37 5 * * *') === 2);
    ok('semanal → 10 d', ventanaDias('0 9 * * 1') === 10);
    ok('mensual (día fijo) → 40 d', ventanaDias('17 8 3 * *') === 40);
    ok('anual → 400 d', ventanaDias('0 0 1 4 *') === 400);
    ok('lo que no es un cron no inventa ventana', ventanaDias('mañana') === null);
}

// ── 2 · lectura del directorio: cron Y encadenado ───────────────────────────
console.log('\n2) un workflow puede estar programado sin cron');
const dir = mkdtempSync(join(tmpdir(), 'mc-wf-'));
{
    writeFileSync(join(dir, 'padre.yml'), [
        'name: ETL Padre',
        'on:',
        '  schedule:',
        "    - cron: '17 8 3 * *'",
    ].join('\n'), 'utf8');
    writeFileSync(join(dir, 'hijo.yml'), [
        'name: ETL Hijo',
        'on:',
        '  workflow_run:',
        '    workflows: ["ETL Padre"]',
        '    types: [completed]',
        '  workflow_dispatch:',
    ].join('\n'), 'utf8');
    writeFileSync(join(dir, 'suelto.yml'), [
        'name: Solo a mano',
        'on:',
        '  workflow_dispatch:',
    ].join('\n'), 'utf8');

    const wfs = resolverCadenas(leerWorkflows(dir));
    const padre = wfs.find(w => w.fichero === 'padre.yml');
    const hijo = wfs.find(w => w.fichero === 'hijo.yml');
    const suelto = wfs.find(w => w.fichero === 'suelto.yml');

    ok('el padre se lee con su ventana', padre.ventana === 40 && padre.programado);
    ok('el hijo NO tiene cron', hijo.ventana === null);
    ok('y aun así cuenta como programado', hijo.programado === true, JSON.stringify(hijo.padres));
    ok('su padre se resuelve por el `name:`', hijo.padres[0]?.wf?.fichero === 'padre.yml');
    ok('el que solo tiene dispatch no se vigila', suelto.programado === false);
}

// ── 3 · el padre que ya no se llama así ─────────────────────────────────────
// `workflow_run` casa por NOMBRE. Cambiarle el `name:` al padre desengancha la cadena sin
// tocar al hijo, y el hijo se queda esperando un disparo que no llega nunca.
console.log('\n3) un disparador que ya no existe es cadena rota, no silencio');
{
    const dir2 = mkdtempSync(join(tmpdir(), 'mc-wf2-'));
    writeFileSync(join(dir2, 'padre.yml'), 'name: ETL Padre RENOMBRADO\non:\n  schedule:\n    - cron: \'17 8 3 * *\'\n', 'utf8');
    writeFileSync(join(dir2, 'hijo.yml'), 'name: ETL Hijo\non:\n  workflow_run:\n    workflows: ["ETL Padre"]\n    types: [completed]\n', 'utf8');
    const hijo = resolverCadenas(leerWorkflows(dir2)).find(w => w.fichero === 'hijo.yml');
    ok('se marca huérfano', hijo.huerfano === true);
    const v = clasificar({ wf: hijo, run: null, ahora: AHORA });
    ok('y es un problema, no un inconcluso', v.estado === 'CADENA ROTA' && v.problema === true, v.estado);
}

// ── 4 · el encadenado se mide contra su padre, no contra el calendario ──────
console.log('\n4) la cadena está sana si el hijo corrió DESPUÉS del último éxito del padre');
const wfs = resolverCadenas(leerWorkflows(dir));
const hijo = wfs.find(w => w.fichero === 'hijo.yml');
const padre = wfs.find(w => w.fichero === 'padre.yml');
{
    const v = clasificar({
        wf: hijo,
        run: { createdAt: hace(9), conclusion: 'success' },
        padreRun: { createdAt: hace(9.002), conclusion: 'success' },
        ahora: AHORA,
    });
    ok('detrás de su padre → OK', v.estado === 'OK' && !v.problema, v.detalle);

    const roto = clasificar({
        wf: hijo,
        run: { createdAt: hace(40), conclusion: 'success' },
        padreRun: { createdAt: hace(2), conclusion: 'success' },
        ahora: AHORA,
    });
    ok('el padre corrió y el hijo no fue detrás → CADENA ROTA',
        roto.estado === 'CADENA ROTA' && roto.problema === true, roto.detalle);

    // MUTANTE. El fallo natural al implementar esto es darle al hijo la ventana del padre y
    // aprobarlo por ser reciente. Aquí el hijo tiene 40 días y el padre 2: dentro de una
    // ventana de 40 d pasaría por bueno, y la cadena está rota.
    ok('MUTANTE: no se aprueba por «está dentro de la ventana»', roto.estado !== 'OK');

    const omitido = clasificar({
        wf: hijo,
        run: { createdAt: hace(1), conclusion: 'skipped' },
        padreRun: { createdAt: hace(30), conclusion: 'success' },
        ahora: AHORA,
    });
    ok('`skipped` es el caso previsto, no un rojo del hijo',
        omitido.estado === 'OMITIDO' && omitido.problema === false, omitido.detalle);

    const rojo = clasificar({
        wf: hijo,
        run: { createdAt: hace(1), conclusion: 'failure' },
        padreRun: { createdAt: hace(2), conclusion: 'success' },
        ahora: AHORA,
    });
    ok('pero un fallo suyo sí lo es', rojo.estado === 'ÚLTIMA EN ROJO' && rojo.problema === true);
}

// ── 5 · «nunca» tiene dos causas opuestas ───────────────────────────────────
console.log('\n5) nunca-porque-es-nuevo no es nunca-porque-está-roto');
{
    const recien = clasificar({ wf: padre, run: null, altaISO: hace(3), ahora: AHORA });
    ok('recién puesto y dentro de su ventana → NUEVO',
        recien.estado === 'NUEVO' && recien.problema === false, recien.detalle);

    const viejo = clasificar({ wf: padre, run: null, altaISO: hace(120), ahora: AHORA });
    ok('viejo y sin una sola ejecución → NUNCA',
        viejo.estado === 'NUNCA' && viejo.problema === true, viejo.detalle);

    // La frontera exacta: el día de la ventana todavía es NUEVO, el siguiente ya no.
    ok('en el borde de la ventana sigue siendo NUEVO',
        clasificar({ wf: padre, run: null, altaISO: hace(39.9), ahora: AHORA }).estado === 'NUEVO');
    ok('y pasada, NUNCA',
        clasificar({ wf: padre, run: null, altaISO: hace(40.1), ahora: AHORA }).estado === 'NUNCA');

    const sinFecha = clasificar({ wf: padre, run: null, altaISO: null, ahora: AHORA });
    ok('sin poder fechar el fichero NO se decide: INCONCLUSO',
        sinFecha.estado === 'INCONCLUSO' && sinFecha.problema === false, sinFecha.detalle);
}

// ── 6 · lo de siempre sigue en pie ──────────────────────────────────────────
console.log('\n6) el cron sigue midiéndose contra el calendario');
{
    ok('dentro de la ventana → OK',
        clasificar({ wf: padre, run: { createdAt: hace(9), conclusion: 'success' }, ahora: AHORA }).estado === 'OK');
    ok('pasada la ventana → SIN LATIDO',
        clasificar({ wf: padre, run: { createdAt: hace(41), conclusion: 'success' }, ahora: AHORA }).estado === 'SIN LATIDO');
    ok('un run cancelado es rojo, no verde',
        clasificar({ wf: padre, run: { createdAt: hace(1), conclusion: 'cancelled' }, ahora: AHORA }).estado === 'ÚLTIMA EN ROJO');
    const err = clasificar({ wf: padre, run: { _error: 'gh: not found' }, ahora: AHORA });
    ok('si no se pudo preguntar, INCONCLUSO y no OK', err.estado === 'INCONCLUSO' && !err.problema);
}

// ── 7 · REGRESIÓN CONOCIDA, contra los workflows REALES del repo ────────────
// El defecto que esto arregla, escrito como prueba: si alguien vuelve a derivar la vigilancia
// solo de `cron:`, esta se pone en rojo.
console.log('\n7) los workflows reales: ninguno programado se declara «no se vigila»');
{
    const reales = resolverCadenas(leerWorkflows(join(RAIZ, '.github', 'workflows')));
    const fin = reales.find(w => w.fichero === 'etl-financiacion.yml');
    ok('etl-financiacion.yml existe y está encadenado', !!fin && fin.encadenado === true);
    ok('y NO se declara solo manual',
        clasificar({ wf: fin, run: { createdAt: hace(1), conclusion: 'success' }, padreRun: { createdAt: hace(2), conclusion: 'success' }, ahora: AHORA }).estado === 'OK');
    ok('su padre declarado existe en el repo', fin.padres.every(p => !!p.wf),
        fin.padres.map(p => `${p.nombre}=${p.wf ? 'ok' : 'NO ESTÁ'}`).join(', '));
    const huerfanos = reales.filter(w => w.huerfano);
    ok('ningún workflow espera a un padre que no existe', huerfanos.length === 0,
        huerfanos.map(w => w.fichero).join(', '));
}

// ── 8 · EL PROCESO, no solo las funciones ───────────────────────────────────
// Un banco que solo importa funciones no prueba que el script arranque. Se ejecuta de verdad,
// con un PATH en el que no hay `gh`: todo queda inconcluso y tiene que DECIRLO y salir 2.
console.log('\n8) sin `gh` a la vista no aprueba nada: lo dice y sale 2');
{
    const vacio = mkdtempSync(join(tmpdir(), 'mc-sin-gh-'));
    const env = { ...process.env, PATH: vacio, Path: vacio };
    const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'watchdog', 'check-runs.mjs')], {
        encoding: 'utf8', env, cwd: RAIZ,
    });
    const salida = `${r.stdout || ''}${r.stderr || ''}`;
    ok('el script arranca y termina', r.error === undefined, String(r.error || ''));
    ok('dice que no puede concluir', /INCONCLUSO/.test(salida), salida.slice(0, 200));
    ok('y NO dice que todo late', !/TODOS LATEN/.test(salida), salida.slice(-200));
    ok('sale 2 (inconcluso), ni 0 ni 1', r.status === 2, `status ${r.status}`);
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
