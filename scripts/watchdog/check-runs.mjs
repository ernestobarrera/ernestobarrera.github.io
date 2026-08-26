#!/usr/bin/env node
/**
 * MedCheck — el vigilante del vigilante (latido de los workflows programados)
 *
 * `check_freshness.py` comprueba que los DATOS estén frescos, pero corre DENTRO de GitHub
 * Actions. Si deja de correr —lo borran, falla el cron, o GitHub deshabilita los
 * `schedule` tras 60 días sin actividad en el repo— el silencio vuelve a ser
 * indistinguible de la salud. Un vigilante no puede vigilarse a sí mismo.
 *
 * Esto corre FUERA de Actions, en la máquina, y comprueba lo único que importa: que cada
 * workflow programado se haya EJECUTADO dentro de su ventana. No mira datos; mira latidos.
 *
 * Por descubrimiento, no por lista: recorre `.github/workflows/*.yml`, lee su `cron` y
 * DERIVA la ventana esperada. Un workflow programado nuevo queda vigilado sin tocar nada
 * aquí — que es exactamente lo que no pasó con `packs-index.json`, invisible durante 27
 * días porque el watchdog llevaba sus fuentes escritas dentro.
 *
 * Requiere `gh` autenticado (ya lo está en esta máquina).
 *
 * Uso: node scripts/watchdog/check-runs.mjs [--json]
 * Salida: exit 0 si todos laten; exit 1 con el detalle de los que no.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const JSON_OUT = process.argv.includes('--json');

/**
 * Ventana esperada a partir del cron. Se deriva de la CADENCIA, no de una tabla: así un
 * workflow nuevo no necesita que nadie lo inscriba. Margen generoso a propósito — esto
 * detecta "ha dejado de correr", no "ha corrido tarde".
 */
function ventanaDias(cron) {
    const campos = cron.trim().split(/\s+/);
    if (campos.length < 5) return null;
    const [, , dom, mes, dow] = campos;
    if (dom !== '*' && dom !== '?') return 40;   // mensual (día fijo del mes)
    if (mes !== '*') return 400;                 // anual
    if (dow !== '*' && dow !== '?') return 10;   // semanal
    return 2;                                    // diario
}

function workflowsProgramados() {
    const out = [];
    for (const f of readdirSync(WF_DIR).filter(n => /\.ya?ml$/.test(n))) {
        const src = readFileSync(join(WF_DIR, f), 'utf8');
        const nombre = (src.match(/^name:\s*(.+)$/m) || [, f])[1].trim();
        // Todos los cron del fichero; se toma el más frecuente (la ventana más estrecha).
        const crons = [...src.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
        const ventanas = crons.map(ventanaDias).filter(v => v != null);
        out.push({
            fichero: f,
            nombre,
            programado: ventanas.length > 0,
            ventana: ventanas.length ? Math.min(...ventanas) : null,
        });
    }
    return out;
}

function ultimaEjecucion(fichero) {
    try {
        const raw = execFileSync('gh', [
            'run', 'list', '--workflow', fichero, '--limit', '1',
            '--json', 'createdAt,conclusion,status',
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const arr = JSON.parse(raw);
        return arr[0] || null;
    } catch (err) {
        return { _error: String(err.message || err).split('\n')[0] };
    }
}

const ahora = Date.now();
const filas = [];
let problemas = 0;

for (const wf of workflowsProgramados()) {
    if (!wf.programado) {
        filas.push({ ...wf, estado: 'SIN CRON', detalle: 'solo manual; no se vigila' });
        continue;
    }
    const run = ultimaEjecucion(wf.fichero);
    if (!run) {
        problemas += 1;
        filas.push({ ...wf, estado: 'NUNCA', detalle: 'programado y sin ninguna ejecución' });
        continue;
    }
    if (run._error) {
        // No se puede concluir. Se dice, no se aprueba en silencio.
        filas.push({ ...wf, estado: 'INCONCLUSO', detalle: run._error });
        continue;
    }
    const dias = (ahora - Date.parse(run.createdAt)) / 86400000;
    let estado = 'OK';
    if (dias > wf.ventana) { estado = 'SIN LATIDO'; problemas += 1; }
    else if (run.conclusion && run.conclusion !== 'success') { estado = 'ÚLTIMA EN ROJO'; problemas += 1; }
    filas.push({
        ...wf, estado,
        dias: Number(dias.toFixed(1)),
        conclusion: run.conclusion || run.status,
        detalle: `${dias.toFixed(1)} d (ventana ${wf.ventana}) · ${run.conclusion || run.status}`,
    });
}

if (JSON_OUT) {
    console.log(JSON.stringify({ comprobado: new Date().toISOString(), problemas, filas }, null, 2));
} else {
    console.log('Latido de los workflows programados\n');
    for (const f of filas) {
        console.log(`  [${f.estado.padEnd(14)}] ${f.nombre}`);
        console.log(`                    ${f.detalle}`);
    }
    // Los inconclusos NO cuentan como problema (un workflow recién creado en local y aún
    // sin empujar da error en `gh`), pero se dicen SIEMPRE: un inconcluso callado es un
    // aprobado en falso, que es el fallo que este script existe para no repetir.
    const inconclusos = filas.filter(f => f.estado === 'INCONCLUSO').length;
    const cola = inconclusos ? ` · ${inconclusos} INCONCLUSO(S), no se aprueban` : '';
    console.log(`\n${problemas === 0 ? 'TODOS LATEN' : `${problemas} SIN LATIDO O EN ROJO`}${cola}`);
}

process.exit(problemas === 0 ? 0 : 1);
