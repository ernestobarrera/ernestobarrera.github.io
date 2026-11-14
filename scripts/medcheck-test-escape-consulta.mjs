#!/usr/bin/env node
/**
 * MedCheck — el texto que teclea el usuario (o que manda el atajo desde la historia clínica) nunca
 * entra en la página como HTML.
 *
 * QUÉ PASÓ (revisión de diseño de Fable, 14/11/2026, B1; comprobado en producción):
 *   `?view=search&q=zzqq<b id="sonda-html">x</b>` creaba ese `<b>` en la página: los estados vacíos
 *   («No se encontraron medicamentos para "…"») interpolaban `${query}` en `innerHTML` sin escapar.
 *   El atajo manda como consulta el texto seleccionado en la historia clínica, así que un «<» en esa
 *   selección se interpretaba.
 *
 * LA REGLA QUE FIJA ESTE BANCO:
 *   1. `_escapeHtml` neutraliza las cinco entidades.
 *   2. En el fuente no queda ningún `"${query}"` sin escapar fuera de `console.*`.
 *   3. El estado vacío real de Buscar pinta la sonda como texto, no como elemento.
 *
 * Uso: node scripts/medcheck-test-escape-consulta.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'assets', 'js', 'cima-app.js'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    console.log(`${cond ? '  ✓' : '  ✗'} ${nombre}${!cond && detalle ? ` — ${detalle}` : ''}`);
    if (!cond) fallos++;
};

const SONDA = 'zzqq<b id="sonda-html">x</b>';

console.log('1) _escapeHtml');
{
    const m = SRC.match(/\n    _escapeHtml\(value\) \{[\s\S]*?\n    \}/);
    ok('existe el método', !!m);
    const fn = vm.runInNewContext(`(function ${m[0].trim()})`);
    const out = fn(SONDA);
    ok('no deja ningún < ni >', !/[<>]/.test(out), out);
    ok('escapa comillas simples y dobles', fn(`'"`) === '&#39;&quot;');
    ok('null y undefined dan cadena vacía', fn(null) === '' && fn(undefined) === '');
}

console.log('\n2) ninguna consulta sin escapar en el fuente');
{
    const sucias = SRC.split('\n')
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => /"\$\{query\}"/.test(l) && !/console\.(log|warn|error|info|debug)/.test(l));
    ok('cero `"${query}"` fuera de console.*', sucias.length === 0,
        sucias.map(([n]) => `línea ${n}`).join(', '));
    ok('al menos nueve sitios escapan la consulta', (SRC.match(/_escapeHtml\(query\)/g) || []).length >= 9);
}

console.log('\n3) el estado vacío de Buscar pinta la sonda como texto');
{
    // La plantilla real de la línea del estado vacío, evaluada con el método real.
    const linea = SRC.split('\n').find(l => /No se encontraron medicamentos para "\$\{/.test(l));
    ok('la plantilla existe', !!linea);
    const m = SRC.match(/\n    _escapeHtml\(value\) \{[\s\S]*?\n    \}/);
    const ctx = { query: SONDA, self: {} };
    ctx.self._escapeHtml = vm.runInNewContext(`(function ${m[0].trim()})`);
    const plantilla = linea.trim().replace(/this\./g, 'self.');
    const html = vm.runInNewContext('`' + plantilla + '`', ctx);
    ok('no aparece la etiqueta <b', !/<b\b/.test(html), html);
    ok('sí aparece el texto escapado', html.includes('&lt;b id=&quot;sonda-html&quot;&gt;'), html);
}

console.log(fallos ? `\n✗ ${fallos} fallo(s)` : '\n✓ todo en orden');
process.exit(fallos ? 1 : 0);
