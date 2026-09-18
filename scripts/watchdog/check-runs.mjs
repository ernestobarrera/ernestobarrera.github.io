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
 * LO QUE ENTIENDE, Y POR QUÉ (18/09/2026)
 *
 * 1. UN WORKFLOW PUEDE ESTAR PROGRAMADO SIN CRON. `etl-financiacion.yml` se encadena al ETL
 *    de BIFIMED con `workflow_run` en vez de a un día del calendario, a propósito: el índice
 *    cruza el catálogo de ESE run con CIMA. Buscando solo `cron:` este vigilante lo declaraba
 *    «solo manual; no se vigila», y resulta que es la vista que gobierna «Financiado por el
 *    SNS». Ahora se resuelve el padre por su `name:` y se comprueba lo que de verdad define
 *    una cadena sana: que el hijo haya corrido DESPUÉS del último éxito del padre.
 *
 *    A un encadenado no se le aplica ventana de tiempo. Si el padre lleva un mes mudo, el que
 *    hay que arreglar es el padre, y su fila ya lo dice: dos alarmas para una sola causa
 *    enseñan a ignorar las dos.
 *
 *    Esto caza además un fallo silencioso que antes no veía nadie: `workflow_run` casa por
 *    NOMBRE, así que cambiarle el `name:` al padre desengancha la cadena sin tocar al hijo.
 *
 * 2. «NUNCA HA CORRIDO» TIENE DOS CAUSAS OPUESTAS y decirlas igual era el defecto: un
 *    workflow recién escrito que todavía no ha alcanzado su primer cron y uno que lleva
 *    meses sin dispararse. Se separan con la fecha en que el fichero entró en el repo
 *    (`git log --diff-filter=A`), que es un dato objetivo y no una suposición. Dentro de su
 *    ventana es NUEVO y no cuenta como problema; pasada, es NUNCA y sí lo cuenta.
 *
 * Requiere `gh` autenticado (ya lo está en esta máquina).
 *
 * Uso: node scripts/watchdog/check-runs.mjs [--json]
 * Tres estados, como el resto de guardianes del repo:
 *   0 todos laten · 1 hay alguno sin latido o en rojo · 2 INCONCLUSO (no se pudo comprobar)
 */
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');

/**
 * Ventana esperada a partir del cron. Se deriva de la CADENCIA, no de una tabla: así un
 * workflow nuevo no necesita que nadie lo inscriba. Margen generoso a propósito — esto
 * detecta "ha dejado de correr", no "ha corrido tarde".
 */
export function ventanaDias(cron) {
    const campos = String(cron).trim().split(/\s+/);
    if (campos.length < 5) return null;
    const [, , dom, mes, dow] = campos;
    // El mes va PRIMERO. Un cron anual se escribe con día del mes fijo (`0 0 1 4 *` = el 1 de
    // abril), así que mirando antes el día se le daba ventana mensual y a los 41 días habría
    // salido SIN LATIDO todos los años. Hoy no hay ninguno anual: era un fallo esperando.
    if (mes !== '*' && mes !== '?') return 400;  // anual
    if (dom !== '*' && dom !== '?') return 40;   // mensual (día fijo del mes)
    if (dow !== '*' && dow !== '?') return 10;   // semanal
    return 2;                                    // diario
}

/**
 * Lee el directorio de workflows y devuelve lo declarado en cada fichero, sin resolver nada
 * todavía. Separado del resto para poder probarlo contra un directorio de mentira.
 */
export function leerWorkflows(dir) {
    const out = [];
    for (const f of readdirSync(dir).filter(n => /\.ya?ml$/.test(n))) {
        const src = readFileSync(join(dir, f), 'utf8');
        const nombre = (src.match(/^name:\s*(.+)$/m) || [, f])[1].trim();
        // Todos los cron del fichero; se toma el más frecuente (la ventana más estrecha).
        const crons = [...src.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
        const ventanas = crons.map(ventanaDias).filter(v => v != null);
        // `workflow_run: workflows: ["A", "B"]` — los padres que lo disparan.
        const bloque = src.match(/workflow_run:\s*\n\s*workflows:\s*\[([^\]]*)\]/);
        const padres = bloque
            ? [...bloque[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])
            : [];
        out.push({
            fichero: f,
            nombre,
            ventana: ventanas.length ? Math.min(...ventanas) : null,
            padres,
        });
    }
    return out;
}

/**
 * Resuelve cada padre declarado por NOMBRE al fichero que lo define. Un padre que no aparece
 * en el repositorio no se calla: es justo el síntoma de que alguien le cambió el `name:`.
 */
export function resolverCadenas(lista) {
    const porNombre = new Map(lista.map(w => [w.nombre, w]));
    return lista.map(w => {
        const padres = w.padres.map(n => ({ nombre: n, wf: porNombre.get(n) || null }));
        return {
            ...w,
            padres,
            encadenado: padres.length > 0,
            huerfano: padres.length > 0 && padres.every(p => !p.wf),
            programado: w.ventana != null || padres.length > 0,
        };
    });
}

/**
 * El veredicto de una fila, aislado de la red y del reloj para poder probarlo.
 *
 * @param wf        workflow ya resuelto
 * @param run       último run del workflow (o null si ninguno, o `{_error}` si no se pudo saber)
 * @param padreRun  último run CON ÉXITO del padre, solo para encadenados
 * @param altaISO   fecha en que el fichero entró en el repo, o null si no se pudo averiguar
 * @param ahora     milisegundos
 */
export function clasificar({ wf, run, padreRun = null, altaISO = null, ahora = Date.now() }) {
    if (!wf.programado) {
        return { estado: 'SOLO MANUAL', detalle: 'ni cron ni encadenado; no se vigila', problema: false };
    }
    if (wf.huerfano) {
        const quien = wf.padres.map(p => p.nombre).join(', ');
        return { estado: 'CADENA ROTA', detalle: `su disparador «${quien}» no existe en el repo: ¿le han cambiado el name?`, problema: true };
    }
    if (run && run._error) {
        return { estado: 'INCONCLUSO', detalle: run._error, problema: false };
    }
    if (!run) {
        // Las dos causas opuestas de «nunca». Sin fecha de alta no se decide: se dice.
        if (!altaISO) {
            return { estado: 'INCONCLUSO', detalle: 'sin ejecuciones y sin poder fechar el fichero', problema: false };
        }
        const edad = (ahora - Date.parse(altaISO)) / 86400000;
        // Un encadenado no tiene ventana propia: se le da la de su padre para esto, y si el
        // padre tampoco la tiene, el listón es un día — lo justo para no gritar el primer día.
        const margen = wf.ventana ?? wf.padres.find(p => p.wf?.ventana)?.wf.ventana ?? 1;
        if (edad <= margen) {
            return {
                estado: 'NUEVO',
                detalle: `en el repo desde hace ${edad.toFixed(1)} d y su ventana es ${margen} d: aún no ha tenido que correr`,
                problema: false,
            };
        }
        return {
            estado: 'NUNCA',
            detalle: `programado hace ${edad.toFixed(1)} d (ventana ${margen}) y sin una sola ejecución`,
            problema: true,
        };
    }

    const dias = (ahora - Date.parse(run.createdAt)) / 86400000;
    const conclusion = run.conclusion || run.status;

    if (wf.encadenado) {
        // Un encadenado no se mide contra el calendario sino contra su padre: tiene que haber
        // corrido DESPUÉS del último éxito de este. Si no, la cadena está rota aunque las
        // fechas parezcan recientes.
        if (padreRun && padreRun._error) {
            return { estado: 'INCONCLUSO', detalle: `no se pudo leer el padre: ${padreRun._error}`, problema: false };
        }
        if (padreRun && Date.parse(run.createdAt) < Date.parse(padreRun.createdAt)) {
            const retraso = (Date.parse(padreRun.createdAt) - Date.parse(run.createdAt)) / 86400000;
            return {
                estado: 'CADENA ROTA',
                detalle: `su padre tuvo éxito y él no fue detrás (${retraso.toFixed(1)} d de desfase)`,
                problema: true,
            };
        }
        // `skipped` es el caso previsto: el padre no terminó bien y el `if:` del hijo lo para.
        // No es un rojo suyo, y el padre ya tiene su propia fila.
        if (conclusion === 'skipped') {
            return { estado: 'OMITIDO', detalle: 'su padre no terminó con éxito; el hijo se paró solo', problema: false };
        }
        if (run.conclusion && run.conclusion !== 'success') {
            return { estado: 'ÚLTIMA EN ROJO', detalle: `${dias.toFixed(1)} d · ${conclusion}`, problema: true };
        }
        return { estado: 'OK', detalle: `${dias.toFixed(1)} d · detrás de su padre · ${conclusion}`, problema: false };
    }

    if (dias > wf.ventana) {
        return { estado: 'SIN LATIDO', detalle: `${dias.toFixed(1)} d (ventana ${wf.ventana}) · ${conclusion}`, problema: true };
    }
    if (run.conclusion && run.conclusion !== 'success') {
        return { estado: 'ÚLTIMA EN ROJO', detalle: `${dias.toFixed(1)} d (ventana ${wf.ventana}) · ${conclusion}`, problema: true };
    }
    return { estado: 'OK', detalle: `${dias.toFixed(1)} d (ventana ${wf.ventana}) · ${conclusion}`, problema: false };
}

function ultimaEjecucion(fichero, extra = []) {
    try {
        const raw = execFileSync('gh', [
            'run', 'list', '--workflow', fichero, '--limit', '1',
            ...extra,
            '--json', 'createdAt,conclusion,status',
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const arr = JSON.parse(raw);
        return arr[0] || null;
    } catch (err) {
        return { _error: String(err.message || err).split('\n')[0] };
    }
}

/**
 * Cuándo entró el fichero en el repositorio. Es lo que separa «nuevo» de «roto», y sale de
 * git y no de la fecha del fichero en disco, que un `clone` reescribe entero.
 *
 * `CONTRATO:` si el workflow se renombró, esto da la fecha del renombrado. Al alza, nunca a
 * la baja: como mucho llama NUEVO un rato de más a algo que ya existía, nunca al revés.
 */
function fechaAlta(fichero) {
    try {
        const out = execFileSync('git', [
            'log', '-1', '--diff-filter=A', '--format=%aI', '--',
            `.github/workflows/${fichero}`,
        ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        return out || null;
    } catch {
        return null;
    }
}

function main() {
    const JSON_OUT = process.argv.includes('--json');
    const ahora = Date.now();
    const workflows = resolverCadenas(leerWorkflows(WF_DIR));
    const filas = [];
    let problemas = 0;

    for (const wf of workflows) {
        let run = null;
        let padreRun = null;
        if (wf.programado && !wf.huerfano) {
            run = ultimaEjecucion(wf.fichero);
            const padre = wf.padres.find(p => p.wf);
            if (padre) {
                // Solo los éxitos del padre obligan al hijo: si el padre falló, el hijo no
                // tenía que correr.
                padreRun = ultimaEjecucion(padre.wf.fichero, ['--status', 'success']);
            }
        }
        const alta = run ? null : fechaAlta(wf.fichero);
        const v = clasificar({ wf, run, padreRun, altaISO: alta, ahora });
        if (v.problema) problemas += 1;
        filas.push({
            fichero: wf.fichero,
            nombre: wf.nombre,
            ventana: wf.ventana,
            encadenado: wf.encadenado,
            padres: wf.padres.map(p => p.nombre),
            estado: v.estado,
            detalle: v.detalle,
        });
    }

    // Los inconclusos NO cuentan como problema (un workflow recién creado en local y aún sin
    // empujar da error en `gh`), pero no pueden pasar por un aprobado: si no hay nada roto y
    // sí algo sin comprobar, esto no dice que todo late, dice que no puede concluir.
    const inconclusos = filas.filter(f => f.estado === 'INCONCLUSO').length;

    if (JSON_OUT) {
        console.log(JSON.stringify({ comprobado: new Date().toISOString(), problemas, inconclusos, filas }, null, 2));
    } else {
        console.log('Latido de los workflows programados\n');
        for (const f of filas) {
            console.log(`  [${f.estado.padEnd(14)}] ${f.nombre}`);
            console.log(`                    ${f.detalle}`);
        }
        const cola = inconclusos ? ` · ${inconclusos} INCONCLUSO(S), no se aprueban` : '';
        const veredicto = problemas > 0
            ? `${problemas} SIN LATIDO O EN ROJO`
            : (inconclusos > 0 ? 'NO SE PUEDE CONCLUIR' : 'TODOS LATEN');
        console.log(`\n${veredicto}${cola}`);
    }

    process.exit(problemas > 0 ? 1 : (inconclusos > 0 ? 2 : 0));
}

// `import.meta.url` (ruta real) nunca casaría con `process.argv[1]` (ruta tecleada) concatenando
// a mano: en Windows casa y en Linux no, y el módulo se ejecutaría —o no— según la plataforma.
const invocado = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invocado && realpathSync(fileURLToPath(import.meta.url)) === invocado) main();
