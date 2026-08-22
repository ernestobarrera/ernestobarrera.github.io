#!/usr/bin/env node
/**
 * MedCheck — tercera vía para los `unresolved`: preguntar a RxNav de forma APROXIMADA.
 *
 * EL PROBLEMA. 135 nombres quedaron en `unresolved` con la nota «ninguna autoridad lo resuelve».
 * Pero no es que las autoridades no supieran: es que se les preguntó con el nombre español
 * EXACTO. `micofenolato mofetilo` no existe en RxNorm; `mycophenolate mofetil` sí, y es la misma
 * sustancia escrita en el otro idioma.
 *
 * POR QUÉ ESTO NO ES INVENTAR UNA TRADUCCIÓN, que es lo que el compilador tiene prohibido.
 * RxNav expone `approximateTerm`, un emparejamiento difuso que corre EN SU LADO. No le mandamos
 * una traducción nuestra para que la confirme —eso sí sería escribirla y pedir sello—: le
 * mandamos el nombre español tal cual y es ÉL quien propone a qué concepto se parece. Sigue
 * siendo la autoridad la que habla; nosotros solo hemos hecho una pregunta más flexible.
 *
 * Y lo que propone pasa por las MISMAS dos guardas que todo lo demás:
 *   - el parentesco (`comparteRaiz`), que rechaza la familia, el nombre de clase y el fármaco
 *     distinto — medido: de los 15 rechazos más gordos, 7 eran errores reales de RxNav
 *     (`germanio (68Ge) cloruro` -> `calcium chloride`, `oxibato sodio` -> `ganciclovir sodium`);
 *   - la guarda de derrumbe de la promoción, que mide recuperación real antes de escribir nada.
 *
 * LA GUARDA PROPIA DE AQUÍ: RxNorm contiene entradas EN ESPAÑOL, y un emparejamiento difuso las
 * encuentra primero justamente porque están en el mismo idioma. Medido: `veneno de abeja`
 * devolvía `Veneno de Abeja Aceite de Vibora`, que comparte raíz con el español porque ES el
 * español. Un término que no traduce nada no sirve para buscar en un registro que indexa en
 * inglés, y encima lo parecería. Se rechaza por las preposiciones, que ningún término inglés
 * de RxNorm lleva.
 *
 * Uso:
 *   node scripts/medcheck-sondear-aproximado.mjs             # solo mide y enseña
 *   node scripts/medcheck-sondear-aproximado.mjs --aplicar   # marca verified en el baseline
 *   node scripts/medcheck-sondear-aproximado.mjs --max=20    # acota (pruebas)
 *
 * Después hay que pasar SIEMPRE por medcheck-promote-identity.mjs, que es quien mide el
 * derrumbe y quien escribe el diccionario.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { comparteRaiz, normalizar } from './medcheck-identity-kin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const max = Number((args.find(a => a.startsWith('--max=')) || '').split('=')[1]) || Infinity;

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

// Preposiciones y artículos que delatan un término español dentro de RxNorm.
const PREPOSICIONES_ES = /\b(de|del|la|el|los|las|con|para)\b/;
const esTerminoEspanol = t => PREPOSICIONES_ES.test(normalizar(t));

const dormir = ms => new Promise(r => setTimeout(r, ms));
let inconclusas = 0;
async function pedir(url) {
    for (let i = 0; i < 3; i++) {
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (r.ok) return await r.json();
            if (r.status === 429) { await dormir(1500 * (i + 1)); continue; }
            return undefined;
        } catch { await dormir(600 * (i + 1)); }
    }
    inconclusas += 1;
    return undefined;
}

const cacheNombre = new Map();
async function nombreRxcui(rxcui) {
    if (cacheNombre.has(rxcui)) return cacheNombre.get(rxcui);
    const p = await pedir(`https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/property.json?propName=RxNorm%20Name`);
    const n = p?.propConceptGroup?.propConcept?.[0]?.propValue || null;
    cacheNombre.set(rxcui, n);
    await dormir(120);   // ~5 req/s: muy por debajo del limite de RxNav, y no hay prisa
    return n;
}

const pendientes = Object.entries(baseline.terms)
    .filter(([, v]) => v.status === 'unresolved' && !v.human)
    .sort((a, c) => (c[1].products || 0) - (a[1].products || 0))
    .slice(0, max);

console.log(`unresolved a sondear: ${pendientes.length}\n`);

const aciertos = [], rechazados = [], enEspanol = [], mudos = [];
let n = 0;
for (const [es, v] of pendientes) {
    n += 1;
    const ap = await pedir(`https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(es)}&maxEntries=4`);
    await dormir(120);
    const rxcuis = [...new Set((ap?.approximateGroup?.candidate || []).map(c => c.rxcui))].slice(0, 4);
    if (!rxcuis.length) { mudos.push([es, v, '']); continue; }

    let elegido = null, descartadoPorIdioma = null, primerNo = null;
    for (const rx of rxcuis) {
        const nom = await nombreRxcui(rx);
        if (!nom) continue;
        if (!comparteRaiz(es, nom)) { primerNo = primerNo || nom; continue; }
        if (esTerminoEspanol(nom)) { descartadoPorIdioma = descartadoPorIdioma || nom; continue; }
        elegido = nom; break;
    }
    if (elegido) aciertos.push([es, v, elegido]);
    else if (descartadoPorIdioma) enEspanol.push([es, v, descartadoPorIdioma]);
    else rechazados.push([es, v, primerNo || '']);
    if (n % 25 === 0) console.error(`  … ${n}/${pendientes.length}`);
}

const prods = l => l.reduce((s, [, v]) => s + (v.products || 0), 0);
console.log(`RESUELTOS (RxNav propone y el parentesco lo acepta): ${aciertos.length} (${prods(aciertos)} productos)`);
console.log(`rechazados por parentesco: ${rechazados.length} (${prods(rechazados)} productos)`);
console.log(`descartados por venir EN ESPAÑOL: ${enEspanol.length} (${prods(enEspanol)} productos)`);
console.log(`RxNav no propone nada: ${mudos.length}`);
if (inconclusas) console.log(`consultas inconclusas (red): ${inconclusas}`);
console.log('');

console.log('--- RESUELTOS, por productos ---');
aciertos.sort((a, c) => (c[1].products || 0) - (a[1].products || 0))
    .forEach(([es, v, en]) => console.log(`  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 34).padEnd(36)} -> ${en}`));

if (enEspanol.length) {
    console.log('\n--- DESCARTADOS por venir en español (la guarda de idioma) ---');
    enEspanol.forEach(([es, v, x]) => console.log(`  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 34).padEnd(36)} ~ ${x}`));
}

console.log('\n--- Rechazados por parentesco, top 12 ---');
rechazados.sort((a, c) => (c[1].products || 0) - (a[1].products || 0)).slice(0, 12)
    .forEach(([es, v, x]) => console.log(`  ${String(v.products || 0).padStart(4)}  ${es.slice(0, 34).padEnd(36)} ~ ${x || '(nada usable)'}`));

if (!aplicar) {
    console.log('\nNada escrito. Repite con --aplicar para marcarlos verified en el baseline.');
    console.log('La incorporación al diccionario sigue siendo de medcheck-promote-identity.mjs.');
    process.exit(0);
}

for (const [es, v, en] of aciertos) {
    baseline.terms[es] = {
        ...v, status: 'verified', en, method: 'rxnav-aproximado',
        sources: { ...(v.sources || {}), rxnav_aproximado: 'ok' },
        evidence: [`RxNav approximateTerm sobre el nombre español; parentesco verificado`],
        reason_previa: v.reason,
    };
    delete baseline.terms[es].reason;
}
baseline.note = (baseline.note || '') +
    ` · 2026-08-20: ${aciertos.length} unresolved resueltos por emparejamiento aproximado de RxNav (la autoridad propone, el parentesco y el derrumbe filtran).`;
writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
console.log(`\nBaseline actualizado: ${aciertos.length} pasan a verified.`);
