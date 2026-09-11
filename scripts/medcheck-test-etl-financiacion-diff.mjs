#!/usr/bin/env node
/**
 * MedCheck — test de la decisión «¿commiteo el índice de financiación?»
 *
 * No comprueba cadenas del YAML: **extrae el bloque de shell real** del paso «¿Ha cambiado el
 * contenido?» de `.github/workflows/etl-financiacion.yml` y lo EJECUTA contra ficheros sintéticos.
 * Si alguien edita ese paso, este test corre el código editado.
 *
 * Por qué existe. La versión anterior comparaba solo `.fin` (los conteos). Pero el `catalog_id`
 * puede cambiar SIN que cambie ningún conteo: basta un CN que cambie de lista en BIFIMED y no esté
 * en ninguna presentación comercializada de CIMA. Ese mes no se commitearía nada, el índice
 * publicado conservaría el sello viejo, el cliente vería que no coincide con `/bifimed/meta` y
 * **apagaría la faceta indefinidamente**, en silencio. El mecanismo que existe para fallar en
 * cerrado acabaría apagando la función para siempre. Lo encontró Codex el 2026-09-10.
 *
 * Uso: node scripts/medcheck-test-etl-financiacion-diff.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML = join(ROOT, '.github/workflows/etl-financiacion.yml');

/** Extrae el `run:` del paso cuyo `name` se indica, desindentado para poder ejecutarlo. */
function extraerRun(yaml, nombrePaso) {
    const lineas = readFileSync(yaml, 'utf8').split(/\r?\n/);
    const iPaso = lineas.findIndex(l => l.includes(`- name: ${nombrePaso}`));
    if (iPaso < 0) throw new Error(`no encuentro el paso «${nombrePaso}» en el workflow`);
    const iRun = lineas.findIndex((l, i) => i > iPaso && /^\s*run:\s*\|/.test(l));
    if (iRun < 0) throw new Error('ese paso no tiene bloque run');
    const sangria = lineas[iRun + 1].match(/^\s*/)[0].length;
    const cuerpo = [];
    for (let i = iRun + 1; i < lineas.length; i += 1) {
        const l = lineas[i];
        if (l.trim() === '') { cuerpo.push(''); continue; }
        if (l.match(/^\s*/)[0].length < sangria) break;
        cuerpo.push(l.slice(sangria));
    }
    return cuerpo.join('\n');
}

const script = extraerRun(YAML, '¿Ha cambiado el contenido?');

/**
 * `jq` existe en los runners de Ubuntu pero no en el Git Bash de Windows, y un test que no puede
 * ejecutarse no protege de nada. Se provee un sustituto acotado a las DOS expresiones que usa el
 * workflow. Cualquier otra **falla ruidosamente** (exit 9) en vez de devolver vacío: un shim que
 * callara ante una expresión nueva haría pasar el test comparando dos cadenas vacías, que es
 * exactamente cómo este test se engañó a sí mismo la primera vez que se escribió.
 */
function prepararJq(dir) {
    mkdirSync(dir, { recursive: true });
    const evaluador = `
const fs = require('fs');
const args = process.argv.slice(2).filter(a => a !== '-S' && a !== '-c' && a !== '-r');
const [expr, ruta] = args;
let j; try { j = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch { process.exit(2); }
const orden = (v) => Array.isArray(v) ? v.map(orden)
  : (v && typeof v === 'object')
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, orden(v[k])]))
    : v;
if (expr === '.fin') { process.stdout.write(JSON.stringify(orden(j.fin)) + '\\n'); }
else if (expr === '._meta.catalog_id, ._meta.schema_version') {
  process.stdout.write(String(j._meta.catalog_id) + '\\n' + String(j._meta.schema_version) + '\\n');
} else { process.stderr.write('shim de jq: expresion no contemplada: ' + expr + '\\n'); process.exit(9); }
`;
    writeFileSync(join(dir, 'jq.js'), evaluador);
    writeFileSync(join(dir, 'jq'), `#!/usr/bin/env bash\nexec node "${join(dir, 'jq.js').replace(/\\/g, '/')}" "$@"\n`);
    try { execFileSync('chmod', ['+x', join(dir, 'jq')], { stdio: 'ignore' }); } catch { /* Windows */ }
    return dir;
}

let failures = 0;
function check(name, got, expected) {
    if (got === expected) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}\n    esperado: ${expected}\n    obtenido: ${got}`); }
}

const base = join(tmpdir(), `mc-fin-diff-${process.pid}`);

/** Ejecuta el bloque real con un índice «nuevo» y otro «publicado», y devuelve `changed`. */
function decidir(nuevo, viejo) {
    if (existsSync(base)) rmSync(base, { recursive: true, force: true });
    mkdirSync(join(base, 'assets/data'), { recursive: true });
    mkdirSync(join(base, 'tmp'), { recursive: true });
    const out = join(base, 'github_output');
    writeFileSync(out, '');
    writeFileSync(join(base, 'tmp/financiacion-index.json'), JSON.stringify(nuevo));
    if (viejo) writeFileSync(join(base, 'assets/data/financiacion-index.json'), JSON.stringify(viejo));
    // El bloque apunta a /tmp: se reescribe a la carpeta del caso para no tocar la máquina.
    const adaptado = script.replaceAll('/tmp/', `${join(base, 'tmp').replace(/\\/g, '/')}/`);
    const binDir = prepararJq(join(base, 'bin'));
    execFileSync('bash', ['-c', adaptado], {
        cwd: base,
        env: { ...process.env, GITHUB_OUTPUT: out, PATH: `${binDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
        stdio: ['ignore', 'ignore', 'inherit'],
    });
    const texto = readFileSync(out, 'utf8');
    return /changed=true/.test(texto) ? 'true' : /changed=false/.test(texto) ? 'false' : '(nada)';
}

const idx = (fin, catalog_id, schema_version = 2) => ({ _meta: { catalog_id, schema_version, generated_at: '2026-09-11' }, fin });
const FIN_A = { 63575: [2, 0, 0, 0, 0, 1, 1, 0] };
const FIN_B = { 63575: [2, 1, 0, 0, 0, 0, 1, 0] };

console.log('— La decisión de commitear —');
check('todo idéntico → no se commitea (no invalidar la caché de todos por nada)',
    decidir(idx(FIN_A, 'aaa'), idx(FIN_A, 'aaa')), 'false');
check('cambian los conteos → se commitea',
    decidir(idx(FIN_B, 'aaa'), idx(FIN_A, 'aaa')), 'true');

console.log('\n— El caso que apagaba la faceta para siempre —');
check('MISMOS conteos pero OTRO catalog_id → se commitea igual',
    decidir(idx(FIN_A, 'bbb'), idx(FIN_A, 'aaa')), 'true');
check('mismos conteos y mismo sello pero OTRO esquema → se commitea igual',
    decidir(idx(FIN_A, 'aaa', 1), idx(FIN_A, 'aaa', 2)), 'true');

console.log('\n— Bordes —');
check('sin índice publicado todavía → se commitea',
    decidir(idx(FIN_A, 'aaa'), null), 'true');
check('`generated_at` distinto NO basta para commitear (cambia en cada pasada)',
    decidir({ ...idx(FIN_A, 'aaa'), _meta: { catalog_id: 'aaa', schema_version: 2, generated_at: '2026-12-31' } },
        idx(FIN_A, 'aaa')), 'false');

if (existsSync(base)) rmSync(base, { recursive: true, force: true });
console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
