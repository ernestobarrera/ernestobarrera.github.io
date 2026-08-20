#!/usr/bin/env node
/**
 * MedCheck — reclasificación local del baseline de identidad (2026-08-20)
 *
 * POR QUÉ ESTO NO ES VOLVER A COMPILAR, Y POR QUÉ NO TOCA LA RED.
 * El baseline es un ESPEJO: guarda lo que dijeron las dos autoridades (`sources`, `candidates`,
 * `reason`). El `status` no es dato, es un VEREDICTO derivado de ese dato. Cuando se corrige el
 * juez —aquí, el parentesco, que no entendía la transliteración ES/EN— hay que volver a juzgar,
 * no a preguntar. Reconsultar SNOMED y PubMed para 650 nombres que ya respondieron sería gastar
 * cuota ajena para obtener las mismas respuestas.
 *
 * DOS REGLAS, Y SON LA MISMA EN DOS DIRECCIONES.
 * `curarTermino` (en medcheck-identity-kin.mjs) ya retira del inglés el calificador que el
 * español NO declara: `rimegepant sulfate` -> `rimegepant`, porque CIMA no dice la sal. Aquí se
 * aplica el principio simétrico — CONSERVAR LO QUE EL ESPAÑOL SÍ DECLARA — en los dos frentes
 * que quedaron abiertos:
 *
 *   1. VARIOS CANDIDATOS: si más de uno comparte raíz, gana el que conserva lo que el español
 *      dice. `amfotericina B` traía `["amphotericin", "amphotericin b"]`, los dos de la
 *      autoridad. Amputar la «B» perdería lo que CIMA declara; inventarla habría sido escribir
 *      una traducción. No hace falta ninguna de las dos cosas: basta ELEGIR bien entre lo que
 *      la autoridad ya dijo.
 *
 *   2. VACUNAS: la autoridad resuelve el ANTÍGENO y pierde el sustantivo. `vacuna anti herpes
 *      Zóster` devuelve el concepto `herpes zoster`, porque el mapeo de PubMed casa la
 *      enfermedad, no el preparado. Se restituye `vaccine`, que es exactamente la palabra que
 *      el español declara y la autoridad dejó caer. NO se toca el antígeno, que sigue viniendo
 *      íntegro de la autoridad: la regla no escribe identidad, repone un sustantivo común.
 *      Medido en la sesión 45: `vacuna anti herpes zoster` da 3 en PubMed y `herpes zoster
 *      vaccine` da 3529. El caso que originó todo este trabajo, en la sesión 44, era este.
 *
 * LO QUE NO HACE. No promueve nada al diccionario —eso es medcheck-promote-identity.mjs, que
 * además mide el derrumbe—, no toca las combinaciones (`manual`), no reabre lo ya `verified` ni
 * pisa un veredicto humano. Solo puede mover `review` -> `verified`, nunca al revés.
 *
 * Uso:
 *   node scripts/medcheck-reclasificar-identidad.mjs             # solo enseña el diff
 *   node scripts/medcheck-reclasificar-identidad.mjs --aplicar   # escribe el baseline
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { comparteRaiz, normalizar, RUIDO } from './medcheck-identity-kin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const aplicar = process.argv.includes('--aplicar');

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

// ── Regla 2 · vacunas ───────────────────────────────────────────────────────────────────────
// Solo se activa si el español declara «vacuna». El antígeno NO se toca.
const ES_VACUNA = /(^|\s)vacunas?(\s|$)/i;
function componerVacuna(es, candidato) {
    if (!ES_VACUNA.test(normalizar(es))) return null;
    const ant = normalizar(candidato).replace(/\bvaccines?\b/g, '').trim();
    if (ant.length < 3) return null;

    // GUARDA: el antígeno tiene que dar cuenta de lo que el español declara, no ser un muñón.
    //
    // Sin esto, tres vacunas salían como `viruses vaccine`: la respiratoria sincitial, la de
    // chikungunya y la del papiloma humano. PubMed había devuelto el concepto genérico
    // `viruses`, que no identifica antígeno alguno, y componer sobre un fragmento produce un
    // término que parece específico y no lo es — exactamente el fallo que este proyecto lleva
    // tres sesiones corrigiendo. Un hueco reconocido es mejor que un término que miente.
    //
    // Se reutiliza el MISMO parentesco que decide todo lo demás, aplicado al español sin el
    // prefijo `vacuna anti`. Si el nombre trae además marca o fabricante (`vacuna anti COVID-19
    // (Hipra) meracovid`), tampoco pasa: ahí el español declara más que el antígeno y eso es
    // criterio humano, no una regla.
    const nucleoEs = normalizar(es).replace(/^vacunas?\s+(anti\s+)?/, '').trim();
    if (!comparteRaiz(nucleoEs, ant)) return null;

    return `${ant} vaccine`;
}

const movidos = [];
const vacunas = [];
const siguenFuera = [];

for (const [es, v] of Object.entries(baseline.terms)) {
    if (v.status !== 'review') continue;                 // verified/manual/unresolved: intactos
    if (v.human) { continue; }                           // un veredicto humano manda siempre
    const cands = (v.candidates || []).filter(Boolean);
    if (!cands.length) { siguenFuera.push([es, v, '(sin candidato)']); continue; }

    // 1 · ¿alguno comparte raíz ya, con el parentesco corregido?
    const pasan = cands.filter(c => comparteRaiz(es, c));
    if (pasan.length) {
        // Entre los que pasan gana el que AÑADE MENOS de lo que el español no declara, y a
        // igualdad el más completo.
        //
        // La primera versión de esta línea decía «gana el que conserva más» y estaba mal: daba
        // `atomoxetina -> atomoxetine hydrochloride`, `imatinib -> imatinib mesylate` y
        // `hipromelosa -> hypromellose derivatives`. Añadir una sal, un origen o un «derivatives»
        // que CIMA no dice es exactamente el error que `curarTermino` existe para impedir, y
        // estrecha o ensancha la búsqueda por una precisión que no tenemos.
        //
        // Con el desempate correcto, `amfotericina B` sigue quedándose con `amphotericin b`:
        // ahí la «B» no sobra, la declara el español. Una sola regla resuelve los dos casos.
        const sobrantes = cand => {
            const tEs = normalizar(es).split(' ').filter(Boolean);
            return normalizar(cand).split(' ').filter(Boolean)
                // Una palabra de RUIDO nunca es un sobrante: no identifica sustancia. Sin esto, `acid`
                // contaba como aporte y `acido pamidronico` elegia `pamidronate` sobre `pamidronic acid`,
                // incoherente con el `alendronic acid` que el diccionario ya lleva desde la sesion 46.
                .filter(t => !RUIDO.has(t) && !tEs.some(e => comparteRaiz(e, t) || e === t)).length;
        };
        const elegido = pasan.slice().sort((a, b) => sobrantes(a) - sobrantes(b) || b.length - a.length)[0];
        movidos.push([es, v, elegido, pasan.length > 1 ? `elegido entre ${pasan.length}` : 'parentesco']);
        continue;
    }

    // 2 · ¿es una vacuna cuyo antígeno sí resolvió la autoridad?
    const compuesto = componerVacuna(es, cands[0]);
    if (compuesto) { vacunas.push([es, v, compuesto, cands[0]]); continue; }

    siguenFuera.push([es, v, v.reason || '']);
}

const prods = lista => lista.reduce((s, [, v]) => s + (v.products || 0), 0);

console.log(`review en el baseline: ${Object.values(baseline.terms).filter(t => t.status === 'review').length}\n`);
console.log(`── Se resuelven por PARENTESCO corregido: ${movidos.length} (${prods(movidos)} productos)`);
movidos.sort((a, b) => (b[1].products || 0) - (a[1].products || 0))
    .forEach(([es, v, en, via]) => console.log(`  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 36).padEnd(38)} -> ${en}   [${via}]`));

console.log(`\n── Se resuelven reponiendo el sustantivo VACCINE: ${vacunas.length} (${prods(vacunas)} productos)`);
vacunas.sort((a, b) => (b[1].products || 0) - (a[1].products || 0))
    .forEach(([es, v, en, cand]) => console.log(`  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 36).padEnd(38)} -> ${en}   [antigeno de la autoridad: "${cand}"]`));

console.log(`\n── Siguen en review (criterio humano): ${siguenFuera.length} (${prods(siguenFuera)} productos)`);
siguenFuera.sort((a, b) => (b[1].products || 0) - (a[1].products || 0)).slice(0, 12)
    .forEach(([es, v, r]) => console.log(`  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 36).padEnd(38)} ${String(r).slice(0, 46)}`));
if (siguenFuera.length > 12) console.log(`  … y ${siguenFuera.length - 12} más`);

if (!aplicar) {
    console.log('\nNada escrito. Repite con --aplicar para fijar estos veredictos en el baseline.');
    console.log('Después, la incorporación al diccionario la hace medcheck-promote-identity.mjs,');
    console.log('que mide el derrumbe contra PubMed y ClinicalTrials antes de escribir nada.');
    process.exit(0);
}

for (const [es, v, en, via] of movidos) {
    baseline.terms[es] = { ...v, status: 'verified', en, method: `reclasificado: ${via}`,
        candidates_previos: v.candidates, reason_previa: v.reason };
    delete baseline.terms[es].reason;
}
for (const [es, v, en, cand] of vacunas) {
    baseline.terms[es] = { ...v, status: 'verified', en, method: 'reclasificado: sustantivo vaccine repuesto',
        antigeno_autoridad: cand, candidates_previos: v.candidates, reason_previa: v.reason };
    delete baseline.terms[es].reason;
}
baseline.note = (baseline.note || '') +
    ` · 2026-08-20: ${movidos.length + vacunas.length} veredictos reclasificados en local (parentesco con transliteracion y reposicion del sustantivo vaccine); las respuestas de las autoridades no se volvieron a pedir.`;
writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
console.log(`\nBaseline actualizado: ${movidos.length + vacunas.length} pasan a verified.`);
