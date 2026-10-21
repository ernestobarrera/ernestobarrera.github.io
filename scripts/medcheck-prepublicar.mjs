#!/usr/bin/env node
/**
 * MedCheck — comprobación ANTES de publicar en main, pensada para sesiones paralelas (2026-10-21).
 *
 * En este repo trabajan a la vez varias conversaciones (Claude y Codex), cada una en su worktree, y
 * se publica por avance rápido sobre main. El 20/10 dos ramas que partían de la misma versión de
 * caché subieron las dos a `20261020c`; el rebase entró limpio porque la línea era idéntica, y la
 * segunda habría llegado a producción con una versión que los navegadores ya tenían en caché. Nadie
 * lo habría visto: CI pasa, el smoke pasa, y el usuario sigue con el código viejo.
 *
 * Qué comprueba (FALLO = exit 1, no se publica):
 *   1. que la rama contiene origin/main recién traído (si no, rebasa y repite los bancos);
 *   2. que cada recurso versionado que cambia respecto a main lleva una versión MAYOR que la
 *      publicada, y que la VERSION de sw.js también sube.
 * Qué avisa (no bloquea): otros worktrees —con cambios aún sin commitear— y ramas remotas vivas
 * que tocan los mismos ficheros. Es lo que hay que mirar antes de pisar trabajo ajeno.
 *
 * No ejecuta los bancos (tardan): eso va antes, como siempre.
 *
 * Uso: node scripts/medcheck-prepublicar.mjs [--sin-red]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TARGETS, compararVersion, versionEn, ficheroEnRevision } from './medcheck-bump-version.mjs';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const ROOT = git(['rev-parse', '--show-toplevel'], process.cwd());
const lineas = s => (s ? s.split('\n').map(l => l.trim()).filter(Boolean) : []);
// `git status --porcelain` lleva dos columnas de estado y un espacio: no se puede recortar antes.
const rutasStatus = cwd => execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' })
  .split('\n').filter(l => l.length > 3).map(l => l.slice(3).split(' -> ').pop().trim());
let fallos = 0;
const fallo = m => { fallos++; console.log(`  FALLO ${m}`); };
const ok = m => console.log(`  ok    ${m}`);
const aviso = m => console.log(`  AVISO ${m}`);

// Recurso versionado → objetivo de medcheck-bump-version que lo versiona. `sw` va aparte.
const RECURSO = {
  'assets/js/cima-app.js': 'app',
  'assets/js/cima-api.js': 'api',
  'assets/css/cima-app.css': 'css',
  'assets/js/inn-dict.js': 'dict',
  'assets/data/clinical-ontology.json': 'ontology',
  'assets/data/inn-es-en.json': 'innjson',
};

console.log('1. Base');
if (!process.argv.includes('--sin-red')) {
  try { git(['fetch', '-q', 'origin', 'main'], ROOT); ok('origin/main traído'); } catch { aviso('no se pudo traer origin/main: se compara con la copia local'); }
}
const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], ROOT);
try {
  git(['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], ROOT);
  ok(`${rama} contiene origin/main (${git(['rev-parse', '--short', 'origin/main'], ROOT)}): se puede publicar por avance rápido`);
} catch {
  fallo(`main ha avanzado y ${rama} no lo contiene: \`git rebase origin/main\`, repite los bancos y vuelve a pasar esto`);
}

const sinCommitear = rutasStatus(ROOT);
if (sinCommitear.length) aviso(`hay cambios sin commitear en esta rama: ${sinCommitear.join(', ')}`);
const mios = [...new Set([...lineas(git(['diff', '--name-only', 'origin/main...HEAD'], ROOT)), ...sinCommitear])];

console.log('\n2. Versiones de caché frente a lo publicado');
const local = t => versionEn(readFileSync(join(ROOT, TARGETS[t].file), 'utf8'), TARGETS[t]);
const publicada = t => versionEn(ficheroEnRevision('origin/main', TARGETS[t].file), TARGETS[t]);
const objetivos = [...new Set(mios.filter(f => RECURSO[f]).map(f => RECURSO[f]))];
if (!objetivos.length) ok('ningún recurso versionado cambia respecto a main');
for (const t of objetivos) {
  const [l, p] = [local(t), publicada(t)];
  if (compararVersion(l, p) > 0) ok(`${t}: ${p} → ${l}`);
  else fallo(`${t}: cambia el recurso pero su versión (${l}) no supera la publicada (${p}). \`node scripts/medcheck-bump-version.mjs ${t}\``);
}
if (objetivos.length || mios.includes('medcheck.html')) {
  const [l, p] = [local('sw'), publicada('sw')];
  if (compararVersion(l, p) > 0) ok(`sw: ${p} → ${l}`);
  else fallo(`sw: la VERSION de sw.js (${l}) no supera la publicada (${p}); sin ella, el modo sin conexión sirve lo viejo`);
}

console.log('\n3. Trabajo en paralelo sobre los mismos ficheros (no bloquea)');
const yo = resolve(ROOT).toLowerCase();
let solapes = 0;
const porcelana = lineas(git(['worktree', 'list', '--porcelain'], ROOT));
const worktrees = porcelana.filter(l => l.startsWith('worktree ')).map(l => l.slice(9));
for (const wt of worktrees) {
  if (resolve(wt).toLowerCase() === yo) continue;
  let suyos = [];
  let nombre = wt;
  try {
    nombre = `${git(['rev-parse', '--abbrev-ref', 'HEAD'], wt)} (${wt})`;
    const sucios = rutasStatus(wt);
    // Solo cuenta lo que aún no está en main: una rama ya fusionada (aunque con otro SHA) no es trabajo vivo.
    const vivos = lineas(git(['cherry', 'origin/main', 'HEAD'], wt)).filter(l => l.startsWith('+')).length;
    const commiteados = vivos ? lineas(git(['diff', '--name-only', 'origin/main...HEAD'], wt)) : [];
    suyos = [...new Set([...sucios, ...commiteados])];
  } catch { continue; }
  const comunes = suyos.filter(f => mios.includes(f));
  if (comunes.length) { solapes++; aviso(`worktree ${nombre} toca también: ${comunes.join(', ')}`); }
}
const hace7 = Date.now() - 7 * 864e5;
for (const l of lineas(git(['for-each-ref', '--format=%(refname:short) %(committerdate:unix)', 'refs/remotes/origin'], ROOT))) {
  const [ref, ts] = l.split(' ');
  if (/\/(main|HEAD)$/.test(ref) || ref === 'origin' || Number(ts) * 1000 < hace7 || ref === `origin/${rama}`) continue;
  let comunes = [];
  try {
    if (!lineas(git(['cherry', 'origin/main', ref], ROOT)).some(x => x.startsWith('+'))) continue;
    comunes = lineas(git(['diff', '--name-only', `origin/main...${ref}`], ROOT)).filter(f => mios.includes(f));
  } catch { continue; }
  if (comunes.length) { solapes++; aviso(`rama ${ref} (sin fusionar, últimos 7 días) toca también: ${comunes.join(', ')}`); }
}
if (!solapes) ok('ningún otro worktree ni rama viva toca estos ficheros');

console.log(`\n${fallos ? `${fallos} FALLO(S): no publiques todavía` : 'Se puede publicar'}${solapes ? ` · ${solapes} aviso(s) de trabajo paralelo: míralos antes` : ''}`);
process.exit(fallos ? 1 : 0);
