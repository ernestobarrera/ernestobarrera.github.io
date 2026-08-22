#!/usr/bin/env node
/**
 * MedCheck — aplica al baseline los veredictos humanos que salen del revisor.
 *
 * EL CONTRATO. Un veredicto humano MANDA sobre cualquier regla y sobre cualquier recompilación:
 * se marca `human: true`, que es la bandera que el reclasificador y el sondeo ya respetan (los
 * dos filtran por `!v.human`). Sin esa bandera, la siguiente pasada automática pisaría el
 * criterio clínico en silencio, que es el fallo que este proyecto no se puede permitir.
 *
 * VOCABULARIO CERRADO, cuatro valores. Un campo libre habría producido 218 criterios distintos
 * y ninguno auditable:
 *   acepta      el candidato de la autoridad ES la sustancia   -> verified, entra al diccionario
 *   corrige     el término correcto es otro, lo escribe él     -> verified con el término suyo
 *   rechaza     el candidato no vale y no hay término mejor    -> unresolved, honestamente
 *   no_procede  no es una sustancia buscable (agua para inyección, un excipiente, un fragmento
 *               de una lista de serogrupos) -> unresolved, y no se vuelve a preguntar
 *
 * LO QUE ESTE SCRIPT NO HACE: escribir el diccionario. De eso sigue encargándose
 * medcheck-promote-identity.mjs, que mide el derrumbe antes de incorporar nada. Un veredicto
 * humano decide la IDENTIDAD; la guarda de recuperación sigue siendo la última palabra sobre si
 * ese término, aun siendo correcto, recupera algo. Son dos preguntas distintas y este proyecto
 * ya pagó por confundirlas.
 *
 * Uso:
 *   node scripts/medcheck-aplicar-veredictos.mjs veredictos.json          # enseña el diff
 *   node scripts/medcheck-aplicar-veredictos.mjs veredictos.json --aplicar
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const fichero = args.find(a => !a.startsWith('--'));

if (!fichero) {
    console.error('Falta el fichero de veredictos. Uso: node scripts/medcheck-aplicar-veredictos.mjs veredictos.json [--aplicar]');
    process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const veredictos = JSON.parse(readFileSync(fichero, 'utf8'));

const VALIDOS = new Set(['acepta', 'corrige', 'rechaza', 'no_procede']);
const cambios = [], problemas = [];

for (const [es, v] of Object.entries(veredictos)) {
    const ficha = baseline.terms[es];
    if (!ficha) { problemas.push([es, 'no existe en el baseline']); continue; }
    if (!VALIDOS.has(v.veredicto)) { problemas.push([es, `veredicto desconocido: ${v.veredicto}`]); continue; }

    let nuevo;
    if (v.veredicto === 'acepta') {
        const cand = (ficha.candidates || [])[0];
        if (!cand) { problemas.push([es, 'acepta pero no hay candidato que aceptar']); continue; }
        nuevo = { status: 'verified', en: cand, method: 'veredicto humano: acepta' };
    } else if (v.veredicto === 'corrige') {
        if (!v.termino) { problemas.push([es, 'corrige sin término']); continue; }
        nuevo = { status: 'verified', en: v.termino, method: 'veredicto humano: corrige' };
    } else if (v.veredicto === 'rechaza') {
        nuevo = { status: 'unresolved', reason: 'veredicto humano: el candidato no es la sustancia y no hay termino mejor' };
    } else {
        nuevo = { status: 'unresolved', reason: 'veredicto humano: no es una sustancia buscable' };
    }
    cambios.push([es, ficha, { ...nuevo, human: true, veredicto_fecha: v.fecha || new Date().toISOString().slice(0, 10) }]);
}

const porTipo = {};
for (const [, , n] of cambios) { const k = n.method || n.reason; porTipo[k] = (porTipo[k] || 0) + 1; }
console.log(`veredictos leídos: ${Object.keys(veredictos).length} · aplicables: ${cambios.length}`);
Object.entries(porTipo).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
if (problemas.length) {
    console.log(`\nNO se aplican (${problemas.length}):`);
    problemas.forEach(([es, r]) => console.log(`  ${es} — ${r}`));
}

console.log('\n--- detalle ---');
cambios.sort((a, b) => (b[1].products || 0) - (a[1].products || 0))
    .forEach(([es, viejo, nuevo]) => console.log(
        `  ${String(viejo.products || 0).padStart(4)}  ${es.slice(0, 34).padEnd(36)} ${viejo.status} -> ${nuevo.status}${nuevo.en ? '  ' + nuevo.en : ''}`));

if (!aplicar) {
    console.log('\nNada escrito. Repite con --aplicar.');
    console.log('Después, medcheck-promote-identity.mjs incorpora lo que sobreviva a la guarda de derrumbe.');
    process.exit(0);
}

for (const [es, viejo, nuevo] of cambios) {
    baseline.terms[es] = { ...viejo, ...nuevo, candidates_previos: viejo.candidates, reason_previa: viejo.reason };
    if (nuevo.status === 'verified') delete baseline.terms[es].reason;
}
baseline.note = (baseline.note || '') +
    ` · ${new Date().toISOString().slice(0, 10)}: ${cambios.length} veredictos humanos aplicados (mandan sobre cualquier recompilacion).`;
writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
console.log(`\nBaseline actualizado: ${cambios.length} veredictos humanos fijados.`);
