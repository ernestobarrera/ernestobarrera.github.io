#!/usr/bin/env node
/**
 * MedCheck — guardián de la ontología frente a los cambios del ATC (2026-10-17).
 *
 * Pregunta: ¿algún fármaco que una entrada de `clinical-ontology.json` NOMBRA en sus sinónimos
 * tiene hoy su código ATC fuera de los códigos de esa misma entrada?
 *
 * Nació de dos causas medidas el 17/10/2026, la segunda peor que la primera:
 *   1. Clases clínicas que el ATC reparte: «ACOD» era B01AF y nombraba dabigatrán, que está en
 *      B01AE07. La búsqueda por indicación no lo devolvía.
 *   2. Revisiones anuales del ATC de la OMS, que rompen la ontología EN SILENCIO: la
 *      reorganización de L04A (natalizumab, ocrelizumab y belimumab pasaron a L04AG; sirolimus a
 *      L04AH) y los gabapentinoides de N03AX a N02BF. Ningún código quedó vacío, así que nada
 *      avisaba: solo faltaban miembros.
 *
 * Límite, dicho para no confiar de más: solo ve lo que la ontología NOMBRA. Un fármaco que debería
 * estar en una entrada y que ningún sinónimo menciona es invisible para este guardián.
 *
 * Las contradicciones aceptadas a propósito viven en scripts/baselines/ontologia-atc.json, cada una
 * con su motivo. Una nueva, o una aceptada que ya no se da, se avisa.
 *
 * Uso:   node scripts/medcheck-audit-ontologia-atc.mjs
 * Salida: 0 sin contradicciones nuevas · 1 hay contradicciones nuevas o excepciones caducadas
 *         · 2 no se pudo concluir (CIMA no respondió): no poder mirar nunca aprueba.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Núcleo puro. `sustancias`: Map de nombre de sustancia normalizado (vtm monocomponente) → Set
 * de ATC5 de sus medicamentos comercializados. Un sinónimo es una sustancia si coincide con su
 * nombre o con su primera palabra (para «micofenolato» frente a «micofenolato mofetilo»).
 * @returns {{nuevas: object[], aceptadas: object[], caducadas: object[]}}
 */
export function contradicciones(terms, sustancias, excepciones = []) {
    const encontradas = [];
    for (const [entrada, e] of Object.entries(terms || {})) {
        const codigos = [].concat(e?.atc || []).map(String).filter(Boolean);
        if (!codigos.length) continue;
        for (const sinonimo of e.synonyms || []) {
            const s = norm(sinonimo);
            const claves = [...sustancias.keys()].filter(k => k === s || k.split(' ')[0] === s);
            if (!claves.length) continue;
            const atcs = [...new Set(claves.flatMap(k => [...sustancias.get(k)]))].sort();
            if (atcs.some(a => codigos.some(c => a.startsWith(c)))) continue;
            encontradas.push({ entrada, sinonimo, atcEntrada: codigos, atcSustancia: atcs });
        }
    }
    const clave = x => `${x.entrada}|${norm(x.sinonimo)}`;
    const aceptadasPorClave = new Map(excepciones.map(x => [clave(x), x]));
    const nuevas = encontradas.filter(x => !aceptadasPorClave.has(clave(x)));
    const aceptadas = encontradas.filter(x => aceptadasPorClave.has(clave(x)));
    const vistas = new Set(encontradas.map(clave));
    const caducadas = excepciones.filter(x => !vistas.has(clave(x)));
    return { nuevas, aceptadas, caducadas };
}

async function sustanciasComercializadas() {
    const atcIdx = JSON.parse(readFileSync(join(ROOT, 'assets/data/atc-index.json'), 'utf8')).atc;
    const mapa = new Map();
    let filas = Infinity;
    for (let p = 1; (p - 1) * 200 < filas; p++) {
        let j = null;
        for (let i = 0; i < 4 && !j; i++) {
            try {
                const r = await fetch(`https://cima.aemps.es/cima/rest/medicamentos?comerc=1&pagina=${p}`, { signal: AbortSignal.timeout(20000) });
                if (r.ok) j = await r.json();
            } catch { /* reintento */ }
            if (!j) await new Promise(s => setTimeout(s, 2000 * (i + 1)));
        }
        if (!j) throw new Error(`CIMA no respondió en la página ${p}`);
        filas = j.totalFilas;
        for (const m of j.resultados || []) {
            const v = norm(m.vtm?.nombre);
            const a = atcIdx[m.nregistro];
            if (!v || v.includes('+') || typeof a !== 'string') continue;
            if (!mapa.has(v)) mapa.set(v, new Set());
            mapa.get(v).add(a);
        }
        await new Promise(s => setTimeout(s, 200));
    }
    return mapa;
}

async function main() {
    const terms = JSON.parse(readFileSync(join(ROOT, 'assets/data/clinical-ontology.json'), 'utf8')).terms;
    const base = JSON.parse(readFileSync(join(ROOT, 'scripts/baselines/ontologia-atc.json'), 'utf8'));
    let sustancias;
    try {
        sustancias = await sustanciasComercializadas();
    } catch (err) {
        console.log(`INCONCLUSO: ${err.message}. No poder mirar no aprueba.`);
        return 2;
    }
    const { nuevas, aceptadas, caducadas } = contradicciones(terms, sustancias, base.excepciones || []);
    console.log(`Sustancias comercializadas: ${sustancias.size} · entradas: ${Object.keys(terms).length}`);
    console.log(`Aceptadas (con motivo en la línea base): ${aceptadas.length}`);
    for (const x of nuevas) {
        console.log(`NUEVA  ${x.entrada} [${x.atcEntrada.join(',')}] nombra «${x.sinonimo}», que está en ${x.atcSustancia.join(',')}`);
    }
    for (const x of caducadas) {
        console.log(`CADUCADA  ${x.entrada} / «${x.sinonimo}»: ya no es una contradicción; retírala de la línea base.`);
    }
    if (!nuevas.length && !caducadas.length) {
        console.log('Sin contradicciones nuevas.');
        return 0;
    }
    return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main().then(code => process.exit(code));
}
