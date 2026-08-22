#!/usr/bin/env node
/**
 * MedCheck — retira del baseline PÚBLICO los identificadores de SNOMED CT, y solo eso.
 *
 * EL PROBLEMA, tal como quedó acotado el 22/08. `substance-identity-baseline.json` se sirve en
 * abierto desde GitHub Pages —la contraseña de MedCheck no protege `assets/data/*.json`— bajo la
 * CC BY-NC-SA 4.0 del repositorio, que concede a terceros el derecho a ADAPTAR. Dentro había
 * 1.102 identificadores SCTID y 408 líneas de evidencia con la forma `SNOMEDCT <id>`.
 *
 * SNOMED CT tiene régimen propio. Lo demás que hay en el fichero no: los nombres de RxNorm que
 * se obtienen por API son de dominio público, los conceptos MeSH también, y las etiquetas de
 * Wikidata son CC0. Es decir, el problema no era «el fichero», era UN CAMPO del fichero, y por
 * eso la solución no es esconder el fichero.
 *
 * POR QUÉ ESTO NO DESTRUYE LA AUDITABILIDAD, que es lo que estaba en juego. El SCTID no lo
 * inventamos: sale de `vtm.id`, que publica la propia CIMA. El compilador lo lee de CIMA en cada
 * pasada, NO del baseline —verificado: `porSnomed(meta.sctid)` toma `meta` del barrido de CIMA—,
 * así que quitarlo de aquí no le quita nada a nadie que quiera reproducir el método: se vuelve a
 * ejecutar el compilador contra CIMA y salen los mismos. Lo que queda publicado sigue diciendo,
 * término a término, QUÉ dijo cada autoridad y con qué evidencia, incluido el `rxcui`, que es la
 * parte de dominio público de la cadena.
 *
 * Y EL RASTRO NO SE PIERDE: antes de tocar nada se deja una copia íntegra en la zona privada
 * gitignorada, que es donde ya viven el CHANGELOG y el revisor.
 *
 * ESTO NO ES ASESORAMIENTO JURÍDICO. Es la aplicación del criterio del responsable (22/08): «el
 * caso de uso de PubMed y ClinicalTrials no debería arriesgar todo lo demás». La identidad de
 * sustancia sirve a una pestaña accesoria y no toca el motor clínico; no tiene por qué
 * comprometer el régimen legal del proyecto entero.
 *
 * HAY QUE VOLVER A PASARLO CADA VEZ QUE CORRA EL COMPILADOR, porque el compilador vuelve a
 * escribir el `sctid`. Que un paso haya que recordarlo es exactamente cómo se olvida, así que la
 * aserción 8 de `medcheck-test-identidad.mjs` falla si el baseline público trae un SCTID.
 *
 * Uso:
 *   node scripts/medcheck-despublicar-sctid.mjs            # enseña qué quitaría
 *   node scripts/medcheck-despublicar-sctid.mjs --aplicar  # copia privada + limpia el público
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const PRIVADO = join(ROOT, 'docs', 'medcheck', 'private');
const COPIA = join(PRIVADO, 'substance-identity-baseline-con-sctid.json');
const aplicar = process.argv.slice(2).includes('--aplicar');

const crudo = readFileSync(BASELINE, 'utf8');
const baseline = JSON.parse(crudo);

let campos = 0, evidencias = 0;
for (const v of Object.values(baseline.terms)) {
    if (v.sctid) campos += 1;
    for (const e of v.evidence || []) if (/SNOMEDCT/i.test(e)) evidencias += 1;
}
console.log(`baseline: ${Object.keys(baseline.terms).length} términos · ${crudo.length} bytes`);
console.log(`  campos sctid: ${campos}`);
console.log(`  líneas de evidencia con SNOMEDCT: ${evidencias}`);

if (!aplicar) {
    console.log('\n[solo lectura] nada escrito. Repite con --aplicar.');
    process.exit(0);
}

mkdirSync(PRIVADO, { recursive: true });
writeFileSync(COPIA, crudo);
console.log(`\ncopia íntegra guardada en ${COPIA.replace(ROOT, '.')}`);

for (const v of Object.values(baseline.terms)) {
    delete v.sctid;
    // Se recorta el fragmento del SCTID y se conserva el rxcui: la evidencia sigue nombrando el
    // concepto de RxNorm, que es lo que se puede republicar.
    if (v.evidence) v.evidence = v.evidence.map(e => e.replace(/\s*·?\s*SNOMEDCT\s+\d+/gi, '').trim());
}
baseline.sources = {
    ...(baseline.sources || {}),
    snomed: 'CIMA vtm.id (SNOMED CT) -> RxNav idtype=SNOMEDCT (NLM). Los identificadores SCTID NO se publican: SNOMED CT tiene regimen de licencia propio. El compilador los toma de CIMA en cada pasada, asi que el metodo es reproducible sin ellos.',
};
baseline.note = (baseline.note || '') +
    ' · 2026-08-22: retirados del fichero publico los identificadores SCTID (1102 campos y 408 lineas de evidencia). Se conserva que SNOMED resolvio o no cada termino, y el rxcui, que es de dominio publico. Copia integra en la zona privada.';
writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');

const despues = readFileSync(BASELINE, 'utf8');
console.log(`retirados ${campos} campos sctid y ${evidencias} referencias en evidencia`);
console.log(`baseline público: ${crudo.length} -> ${despues.length} bytes`);
console.log(`SCTID que quedan en el público: ${(despues.match(/SNOMEDCT\s+\d+/gi) || []).length + (despues.match(/"sctid"/g) || []).length}`);
