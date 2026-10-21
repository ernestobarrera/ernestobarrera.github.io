#!/usr/bin/env node
/**
 * MedCheck — la versión de caché no puede repetirse entre ramas paralelas (2026-10-21).
 *
 * El 20/10 dos ramas que partían de `20261020a` calcularon cada una «la siguiente» sobre su copia
 * local: una llegó a `c` por su camino y la otra, desde `b`, también a `c`. El rebase entró limpio
 * porque la línea era idéntica, y la segunda habría salido con una versión que los navegadores ya
 * tenían en caché. `siguienteVersion` mira además la de origin/main; este banco fija esa regla
 * ejecutando el código real de `medcheck-bump-version.mjs`.
 *
 * Uso: node scripts/medcheck-test-version-paralela.mjs
 */
import { compararVersion, siguienteVersion, versionEn, TARGETS } from './medcheck-bump-version.mjs';

let fallos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { console.log(`  ok    ${nombre}`); return; }
  fallos++;
  console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

console.log('Orden de versiones');
ok('sin letra va antes que la «a»', compararVersion('20261020', '20261020a') < 0);
ok('c > b', compararVersion('20261020c', '20261020b') > 0);
ok('un día nuevo gana a cualquier letra del anterior', compararVersion('20261021a', '20261020z') > 0);
ok('iguales', compararVersion('20261020d', '20261020d') === 0);

console.log('Siguiente versión con main en paralelo');
const casos = [
  // [local, publicada en main, hoy, esperada, por qué]
  ['20261020b', '20261020c', '20261020', '20261020d', 'EL CASO DEL 20/10: la local va por detrás de main → por encima de main, no «c»'],
  ['20261020c', '20261020c', '20261020', '20261020d', 'iguales → la siguiente'],
  ['20261020d', '20261020c', '20261020', '20261020e', 'la local ya va por delante → la siguiente a la local'],
  ['20261017a', '20261020d', '20261021', '20261021a', 'día nuevo → la «a» de hoy'],
  ['20261021a', null, '20261021', '20261021b', 'sin remoto → como antes, sobre la local'],
  ['20261020', '20261020', '20261020', '20261020b', 'sin letra cuenta como «a»'],
];
for (const [l, r, hoy, esperada, porque] of casos) {
  const v = siguienteVersion(l, r, hoy);
  ok(`${l} / main ${r ?? '—'} → ${esperada} (${porque})`, v === esperada, `dio ${v}`);
}

console.log('Lectura de versiones');
ok('lee el ?v= de cima-app.js en medcheck.html', versionEn('<script src="assets/js/cima-app.js?v=20261020d"></script>', TARGETS.app) === '20261020d');
ok('lee la VERSION de sw.js', versionEn("const VERSION = '20261020d';", TARGETS.sw) === '20261020d');
ok('sin referencia → null', versionEn('nada', TARGETS.app) === null);

console.log(`\n${fallos === 0 ? 'OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos ? 1 : 0);
