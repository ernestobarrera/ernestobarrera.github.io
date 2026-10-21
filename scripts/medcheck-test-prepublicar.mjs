#!/usr/bin/env node
/**
 * MedCheck — `medcheck-prepublicar.mjs` probado de verdad (2026-10-21).
 *
 * Revisión de Codex del 21/10: el banco de versiones probaba el cálculo de la letra, no el script
 * que decide si se publica. Con Git simulado, tocar solo `medynut-index.json` sin subir su versión
 * acababa en «Se puede publicar». Este banco monta un origen y un clon de Git en una carpeta
 * temporal, con la misma forma de ficheros que el repo, y ejecuta el script REAL en cada caso:
 * recurso de datos sin bump, cadena de dependencias, recurso versionado sin mapear, main que
 * avanzó, remoto inalcanzable y --sin-red.
 *
 * Uso: node scripts/medcheck-test-prepublicar.mjs
 *      MC_PREPUBLICAR=<otra versión del script> node scripts/medcheck-test-prepublicar.mjs  (mutación)
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = process.env.MC_PREPUBLICAR || join(RAIZ, 'scripts', 'medcheck-prepublicar.mjs');
let fallos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { console.log(`  ok    ${nombre}`); return; }
  fallos++;
  console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

const tmp = mkdtempSync(join(tmpdir(), 'mc-prepublicar-'));
const ORIGEN = join(tmp, 'origen.git');
const W = join(tmp, 'trabajo');
const W2 = join(tmp, 'otra-sesion');
const g = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=banco', '-c', 'user.email=banco@local', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const escribe = (base, ruta, texto) => { mkdirSync(dirname(join(base, ruta)), { recursive: true }); writeFileSync(join(base, ruta), texto); };
const toca = (ruta, marca) => escribe(W, ruta, `${readFileSync(join(W, ruta), 'utf8')}\n// ${marca}\n`);
const prepublicar = (...args) => {
  const r = spawnSync(process.execPath, [join(W, 'scripts', 'medcheck-prepublicar.mjs'), ...args], { cwd: W, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const caso = nombre => { g(W, 'checkout', '-q', '-B', nombre, 'origin/main'); g(W, 'reset', '-q', '--hard', 'origin/main'); };
const commit = msg => { g(W, 'add', '-A'); g(W, 'commit', '-q', '-m', msg); };

try {
  // ── Origen con la forma del repo: las referencias ?v= donde viven de verdad ──────────────────
  g(tmp, 'init', '-q', '--bare', '--initial-branch=main', ORIGEN);
  g(tmp, 'clone', '-q', ORIGEN, W);
  g(W, 'checkout', '-q', '-b', 'main');
  const V = '20200101a';
  escribe(W, 'medcheck.html', [
    `<script src="assets/js/inn-dict.js?v=${V}"></script>`,
    `<script src="assets/js/cima-api.js?v=${V}"></script>`,
    `<script src="assets/js/cima-app.js?v=${V}"></script>`,
    `<link href="assets/css/cima-app.css?v=${V}">`,
    // Un recurso versionado que ni el bump ni prepublicar conocen: tiene que bloquear si cambia.
    `<script src="assets/js/extra.js?v=${V}"></script>`,
  ].join('\n'));
  escribe(W, 'sw.js', `const VERSION = '${V}';\n`);
  escribe(W, 'assets/js/cima-app.js', [
    `fetch('assets/data/packs-index.json?v=${V}');`,
    `fetch('assets/data/medynut-index.json?v=${V}');`,
    `fetch('assets/data/financiacion-index.json?v=${V}');`,
  ].join('\n'));
  escribe(W, 'assets/js/cima-api.js', `fetch('assets/data/clinical-ontology.json?v=${V}');\n`);
  escribe(W, 'assets/js/inn-dict.js', `fetch('assets/data/inn-es-en.json?v=${V}');\n`);
  escribe(W, 'assets/js/extra.js', '// extra\n');
  escribe(W, 'assets/css/cima-app.css', '/* css */\n');
  for (const d of ['packs-index', 'medynut-index', 'financiacion-index', 'clinical-ontology', 'inn-es-en']) escribe(W, `assets/data/${d}.json`, '{}\n');
  mkdirSync(join(W, 'scripts'), { recursive: true });
  copyFileSync(join(RAIZ, 'scripts', 'medcheck-bump-version.mjs'), join(W, 'scripts', 'medcheck-bump-version.mjs'));
  copyFileSync(SCRIPT, join(W, 'scripts', 'medcheck-prepublicar.mjs'));
  commit('base');
  g(W, 'push', '-q', 'origin', 'main');

  console.log('Sin cambios');
  caso('limpio');
  let r = prepublicar();
  ok('rama igual a main → «Se puede publicar», exit 0', r.code === 0 && /Se puede publicar/.test(r.out), `exit ${r.code}`);

  console.log('Recurso de datos sin bump (el caso de Codex)');
  caso('medynut');
  toca('assets/data/medynut-index.json', 'dato nuevo');
  commit('solo medynut');
  r = prepublicar();
  ok('medynut-index.json sin subir versión → FALLO, exit 1', r.code === 1 && /FALLO medynut/.test(r.out), `exit ${r.code}\n${r.out}`);
  ok('…y exige también app (la referencia vive en cima-app.js) y sw', /FALLO app/.test(r.out) && /FALLO sw/.test(r.out));
  const b = spawnSync(process.execPath, [join(W, 'scripts', 'medcheck-bump-version.mjs'), 'medynut', '--sin-red'], { cwd: W, encoding: 'utf8' });
  ok('el bump de medynut arrastra app y sw', b.status === 0 && /app:/.test(b.stdout) && /sw:/.test(b.stdout), b.stdout);
  commit('bump');
  r = prepublicar();
  ok('con el bump → «Se puede publicar», exit 0', r.code === 0 && /Se puede publicar/.test(r.out), `exit ${r.code}\n${r.out}`);

  console.log('Código de la app sin bump');
  caso('app');
  toca('assets/js/cima-app.js', 'cambio');
  commit('solo app');
  r = prepublicar();
  ok('cima-app.js sin bump → FALLO app y sw', r.code === 1 && /FALLO app/.test(r.out) && /FALLO sw/.test(r.out), `exit ${r.code}`);

  console.log('Recurso versionado sin mapear');
  caso('extra');
  toca('assets/js/extra.js', 'cambio');
  commit('solo extra');
  r = prepublicar();
  ok('extra.js (se pide con ?v=, no está en la tabla) → FALLO, exit 1', r.code === 1 && /extra\.js se pide con \?v=/.test(r.out), `exit ${r.code}\n${r.out}`);

  console.log('Main avanza en paralelo');
  caso('paralela');
  toca('assets/js/extra.js', 'mío');
  g(tmp, 'clone', '-q', ORIGEN, W2);
  escribe(W2, 'otro.txt', 'otra sesión\n');
  g(W2, 'add', '-A'); g(W2, '-c', 'user.name=x', 'commit', '-q', '-m', 'otra sesión publica');
  g(W2, 'push', '-q', 'origin', 'main');
  r = prepublicar();
  ok('main avanzó y la rama no lo contiene → FALLO «main ha avanzado»', r.code === 1 && /main ha avanzado/.test(r.out), `exit ${r.code}`);
  g(W, 'checkout', '-q', '--', '.');

  console.log('Sin acceso a lo publicado');
  caso('sinred');
  r = prepublicar('--sin-red');
  ok('--sin-red → INCONCLUSO, exit 2, nunca «Se puede publicar»', r.code === 2 && /INCONCLUSO/.test(r.out) && !/Se puede publicar/.test(r.out), `exit ${r.code}`);
  g(W, 'remote', 'set-url', 'origin', join(tmp, 'no-existe.git'));
  r = prepublicar();
  ok('remoto inalcanzable → INCONCLUSO, exit 2, nunca «Se puede publicar»', r.code === 2 && /INCONCLUSO/.test(r.out) && !/Se puede publicar/.test(r.out), `exit ${r.code}`);
} catch (e) {
  fallos++;
  console.log(`  FALLO montaje del caso: ${e.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fallos === 0 ? 'OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos ? 1 : 0);
