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

// ── De dónde salen los nombres a sondear ────────────────────────────────────────────────────
//
// Por defecto, los `unresolved`: nombres de sustancia completos que ninguna autoridad resolvió.
//
// Con --componentes, los COMPONENTES de las combinaciones. Y esto merece explicación, porque
// deshace un supuesto que el propio CHANGELOG arrastraba: las 304 combinaciones NO necesitan
// «los componentes estructurados de CIMA». El runtime ya las resuelve solo —`_substanceIdentity`
// parte el nombre por `[+,/]` y traduce componente a componente—, así que las 304 fichas
// `manual` del baseline son contabilidad, no un fallo de la aplicación.
//
// Lo que SÍ falla es que muchos de esos componentes nunca tuvieron ficha propia, porque solo
// aparecen dentro de una combinación y el compilador recorre nombres completos. Medido con el
// resolutor REAL (no con el diccionario a pelo, que se salta las reglas de sufijo y las sales
// metálicas): 250 componentes distintos viajan en español, y afectan a 208 combinaciones y 3245
// productos. `clorfenamina` sola aparece en 12 combinaciones y arrastra 426.
const sondearComponentes = args.includes('--componentes');

function cosecharComponentes() {
    const vistos = new Map();
    for (const [es, v] of Object.entries(baseline.terms)) {
        if (v.status !== 'manual') continue;
        for (const parte of es.split(/[+,/]/).map(s => s.trim()).filter(Boolean)) {
            // Un token de una o dos letras no es una sustancia: sale de partir por `+` una lista
            // de serogrupos (`vacuna anti meningococo A + C + W135 + Y`). No es vocabulario que
            // falte, es una separación que no significa lo que parece.
            if (parte.replace(/[^a-záéíóúñ0-9]/gi, '').length < 3) continue;
            const clave = parte;
            if (baseline.terms[clave]) continue;            // ya tiene ficha propia
            const e = vistos.get(clave) || { products: 0, combinaciones: 0 };
            e.products += v.products || 0; e.combinaciones += 1;
            vistos.set(clave, e);
        }
    }
    return [...vistos.entries()].map(([es, e]) => [es, { ...e, origen: 'componente de combinacion' }]);
}

const pendientes = (sondearComponentes
    ? cosecharComponentes()
    : Object.entries(baseline.terms).filter(([, v]) => v.status === 'unresolved' && !v.human))
    .sort((a, c) => (c[1].products || 0) - (a[1].products || 0))
    .slice(0, max);

console.log(`unresolved a sondear: ${pendientes.length}\n`);

// ── Coherencia con lo ya incorporado ────────────────────────────────────────────────────────
//
// CIMA escribe la misma sal de dos maneras: `picosulfato de sodio` y `picosulfato sodio`. La
// primera ya estaba en el diccionario como `picosulfate sodium`; para la segunda, el
// emparejamiento aproximado propuso `picosulfurate`. Dos ingleses distintos para la misma
// sustancia es peor que no tener ninguno: el recuento cambia según cómo escriba CIMA ese día, y
// nada lo señala.
//
// Antes de preguntar a nadie se comprueba si ya existe una grafía HERMANA —los mismos tokens
// salvo conectores— y, si existe, se reutiliza SU término. No se gasta consulta y no se abre
// divergencia.
const diccionario = JSON.parse(readFileSync(join(ROOT, 'assets', 'data', 'inn-es-en.json'), 'utf8')).map;
const CONECTORES = new Set(['de', 'del', 'la', 'el', 'y', 'con']);
const esqueleto = s => normalizar(s).split(' ').filter(t => t && !CONECTORES.has(t)).sort().join(' ');
const porEsqueleto = new Map();
for (const [k, en] of Object.entries(diccionario)) {
    const e = esqueleto(k);
    if (e && !porEsqueleto.has(e)) porEsqueleto.set(e, en);
}

const aciertos = [], rechazados = [], enEspanol = [], hermanos = [], mudos = [];
let n = 0;
for (const [es, v] of pendientes) {
    n += 1;
    const gemelo = porEsqueleto.get(esqueleto(es));
    if (gemelo) { hermanos.push([es, v, gemelo]); continue; }
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
console.log(`reutilizan una grafía HERMANA ya incorporada: ${hermanos.length} (${prods(hermanos)} productos)`);
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

for (const [es, v, en] of [...aciertos, ...hermanos.map(h => [h[0], h[1], h[2]])]) {
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
