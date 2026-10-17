#!/usr/bin/env node
/**
 * MedCheck — guardián de la ontología frente a los cambios del ATC (2026-10-17).
 *
 * Pregunta: ¿algún fármaco que una entrada de `clinical-ontology.json` NOMBRA —en sus sinónimos o
 * en su lista de vigilados `watchSubstances`— tiene hoy su código ATC fuera de los códigos de esa
 * misma entrada? Y, para los vigilados: ¿sigue alguno sin aparecer en el censo de comercializados?
 *
 * Nació de dos causas medidas el 17/10/2026, la segunda peor que la primera:
 *   1. Clases clínicas que el ATC reparte: «ACOD» era B01AF y nombraba dabigatrán, que está en
 *      B01AE07. La búsqueda por indicación no lo devolvía.
 *   2. Revisiones anuales del ATC de la OMS, que rompen la ontología EN SILENCIO: la
 *      reorganización de L04A (natalizumab, ocrelizumab y belimumab pasaron a L04AG; sirolimus a
 *      L04AH) y los gabapentinoides de N03AX a N02BF. Ningún código quedó vacío, así que nada
 *      avisaba: solo faltaban miembros.
 *
 * Dos fuentes de nombres, con dos reglas de identidad distintas:
 *   - `synonyms`: términos de BÚSQUEDA. Un sinónimo es una sustancia si coincide con su nombre o con
 *     su primera palabra («micofenolato» frente a «micofenolato mofetilo»). Heurístico: no reconoce
 *     «patiromer» frente a «patiromero» y funde las epoetinas (revisión de Codex, 17/10).
 *   - `watchSubstances`: lista explícita de VTM de CIMA, tal y como los escribe CIMA. No interviene
 *     en el matching de Indicaciones (solo lo lee este guardián) y casa por nombre EXACTO. Un vigilado
 *     que no aparece en el censo se avisa: o se retiró, o CIMA lo renombró.
 *
 * Límite, dicho para no confiar de más: solo ve lo que la ontología NOMBRA. Un fármaco que debería
 * estar en una entrada y que nadie nombra es invisible, igual que un hermano terapéutico nuevo. Para
 * lo que llega bajo un código están --cobertura-atc y --vigilar-broad de medcheck-audit-ontology.mjs.
 * Un 0 de aquí NO significa «ontología clínicamente completa».
 *
 * Las contradicciones aceptadas a propósito viven en scripts/baselines/ontologia-atc.json, cada una
 * con su motivo. Una nueva, o una aceptada que ya no se da, se avisa. Una excepción sin `motivo`
 * no silencia nada y se avisa como inválida.
 *
 * Uso:   node scripts/medcheck-audit-ontologia-atc.mjs
 * Salida: 0 sin novedades · 1 contradicciones nuevas, vigilados ausentes, excepciones caducadas o
 *         inválidas · 2 no se pudo concluir (CIMA no respondió, censo incompleto o índice ATC sin
 *         cubrirlo): no poder mirar nunca aprueba.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Error que significa «no se pudo mirar» (exit 2), nunca «limpio». */
export class Inconcluso extends Error {}

const textoNoVacio = v => typeof v === 'string' && v.trim() !== '';

/** Una excepción solo vale si dice de qué entrada, de qué nombre y POR QUÉ. */
export function excepcionValida(x) {
    return Boolean(x) && typeof x === 'object' && textoNoVacio(x.entrada) && textoNoVacio(x.sinonimo) && textoNoVacio(x.motivo);
}

/**
 * Núcleo puro. `sustancias`: Map de nombre de sustancia normalizado (vtm monocomponente) → Set
 * de ATC5 de sus medicamentos comercializados.
 * @returns {{nuevas: object[], aceptadas: object[], caducadas: object[], invalidas: object[], ausentes: object[]}}
 */
export function contradicciones(terms, sustancias, excepciones = []) {
    const encontradas = [];
    const ausentes = [];
    const vistasEnEntrada = new Set();
    const fuera = (codigos, claves) => {
        const atcs = [...new Set(claves.flatMap(k => [...sustancias.get(k)]))].sort();
        return atcs.some(a => codigos.some(c => a.startsWith(c))) ? null : atcs;
    };
    for (const [entrada, e] of Object.entries(terms || {})) {
        const codigos = [].concat(e?.atc || []).map(String).filter(Boolean);
        if (!codigos.length) continue;
        for (const sinonimo of e.synonyms || []) {
            const s = norm(sinonimo);
            const claves = [...sustancias.keys()].filter(k => k === s || k.split(' ')[0] === s);
            if (!claves.length) continue;
            const atcs = fuera(codigos, claves);
            vistasEnEntrada.add(`${entrada}|${s}`);
            if (atcs) encontradas.push({ entrada, sinonimo, origen: 'sinonimo', atcEntrada: codigos, atcSustancia: atcs });
        }
        for (const vigilada of Array.isArray(e.watchSubstances) ? e.watchSubstances : []) {
            const s = norm(vigilada);
            if (!sustancias.has(s)) {
                ausentes.push({ entrada, sustancia: vigilada });
                continue;
            }
            // Si el mismo nombre ya se evaluó como sinónimo, no se cuenta dos veces.
            if (vistasEnEntrada.has(`${entrada}|${s}`)) continue;
            const atcs = fuera(codigos, [s]);
            if (atcs) encontradas.push({ entrada, sinonimo: vigilada, origen: 'vigilada', atcEntrada: codigos, atcSustancia: atcs });
        }
    }
    const clave = x => `${x.entrada}|${norm(x.sinonimo)}`;
    const invalidas = (excepciones || []).filter(x => !excepcionValida(x));
    const validas = (excepciones || []).filter(excepcionValida);
    const aceptadasPorClave = new Map(validas.map(x => [clave(x), x]));
    const nuevas = encontradas.filter(x => !aceptadasPorClave.has(clave(x)));
    const aceptadas = encontradas.filter(x => aceptadasPorClave.has(clave(x)));
    const vistas = new Set(encontradas.map(clave));
    const caducadas = validas.filter(x => !vistas.has(clave(x)));
    return { nuevas, aceptadas, caducadas, invalidas, ausentes };
}

const enteroNoNegativo = v => (Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Censo de sustancias monocomponente comercializadas, con su ATC del índice local. Lanza
 * `Inconcluso` si no puede AFIRMAR que ha visto el universo entero (revisión de Codex, P1, 17/10:
 * sin `totalFilas` la versión anterior paraba en la primera página y devolvía 0 con 2 sustancias):
 *   - cada página tiene que declarar un `totalFilas` legible, y el mismo en todas;
 *   - el progreso se cuenta en nregistros ÚNICOS: una página repetida no avanza;
 *   - al final, únicos = total declarado;
 *   - todo comercializado tiene que tener ATC en el índice: si no, el índice va por detrás de CIMA
 *     y descartar esos registros en silencio sería mirar un universo más pequeño.
 * @param {(pagina: number) => Promise<object>} fetchPagina  respuesta JSON de /medicamentos?comerc=1
 * @param {Record<string, string>} atcIdx  nregistro → ATC5
 */
export async function censoComercializados(fetchPagina, atcIdx, { maxPaginas = 200 } = {}) {
    const mapa = new Map();
    const vistos = new Set();
    const sinIndice = [];
    let total = null;
    for (let p = 1; ; p++) {
        if (p > maxPaginas) throw new Inconcluso(`más de ${maxPaginas} páginas sin completar el censo`);
        const j = await fetchPagina(p);
        const declarado = enteroNoNegativo(j?.totalFilas);
        if (declarado === null) throw new Inconcluso(`la página ${p} no declara un totalFilas legible (${JSON.stringify(j?.totalFilas)})`);
        if (total === null) total = declarado;
        else if (declarado !== total) throw new Inconcluso(`el total cambió durante el recorrido: ${total} → ${declarado} en la página ${p}`);
        const lote = Array.isArray(j?.resultados) ? j.resultados : [];
        let nuevos = 0;
        for (const m of lote) {
            const n = String(m?.nregistro ?? '').trim();
            if (!n || vistos.has(n)) continue;
            vistos.add(n);
            nuevos += 1;
            const a = atcIdx[n];
            if (typeof a !== 'string') { sinIndice.push(n); continue; }
            const v = norm(m.vtm?.nombre);
            if (!v || v.includes('+')) continue;
            if (!mapa.has(v)) mapa.set(v, new Set());
            mapa.get(v).add(a);
        }
        if (vistos.size >= total) break;
        if (!lote.length) break;
        if (!nuevos) throw new Inconcluso(`CIMA repite página: ${vistos.size} nregistros únicos de ${total} y la página ${p} no aporta ninguno`);
    }
    if (!total) throw new Inconcluso('CIMA declara 0 comercializados');
    if (vistos.size !== total) throw new Inconcluso(`censo incompleto: ${vistos.size} nregistros únicos de ${total} declarados`);
    if (sinIndice.length) throw new Inconcluso(`${sinIndice.length} comercializado(s) sin ATC en assets/data/atc-index.json (p. ej. ${sinIndice.slice(0, 3).join(', ')}): el índice va por detrás de CIMA`);
    return mapa;
}

async function paginaCima(p) {
    for (let i = 0; i < 4; i++) {
        try {
            const r = await fetch(`https://cima.aemps.es/cima/rest/medicamentos?comerc=1&pagina=${p}`, { signal: AbortSignal.timeout(20000) });
            if (r.ok) {
                const j = await r.json();
                await new Promise(s => setTimeout(s, 200));
                return j;
            }
        } catch { /* reintento */ }
        await new Promise(s => setTimeout(s, 2000 * (i + 1)));
    }
    throw new Inconcluso(`CIMA no respondió en la página ${p}`);
}

async function main() {
    let terms, base, atcIdx;
    try {
        terms = JSON.parse(readFileSync(join(ROOT, 'assets/data/clinical-ontology.json'), 'utf8')).terms;
        base = JSON.parse(readFileSync(join(ROOT, 'scripts/baselines/ontologia-atc.json'), 'utf8'));
        atcIdx = JSON.parse(readFileSync(join(ROOT, 'assets/data/atc-index.json'), 'utf8')).atc;
        if (!Array.isArray(base?.excepciones)) throw new Error('la línea base no tiene una lista «excepciones»');
    } catch (err) {
        console.log(`INCONCLUSO: no se pudieron leer los datos locales (${err.message}). No poder mirar no aprueba.`);
        return 2;
    }
    let sustancias;
    try {
        sustancias = await censoComercializados(paginaCima, atcIdx);
    } catch (err) {
        console.log(`INCONCLUSO: ${err.message}. No poder mirar no aprueba.`);
        return 2;
    }
    const { nuevas, aceptadas, caducadas, invalidas, ausentes } = contradicciones(terms, sustancias, base.excepciones);
    const vigiladas = Object.values(terms).reduce((n, e) => n + (Array.isArray(e.watchSubstances) ? e.watchSubstances.length : 0), 0);
    console.log(`Sustancias comercializadas: ${sustancias.size} · entradas: ${Object.keys(terms).length} · sustancias vigiladas: ${vigiladas}`);
    console.log(`Aceptadas (con motivo en la línea base): ${aceptadas.length}`);
    for (const x of nuevas) {
        console.log(`NUEVA  ${x.entrada} [${x.atcEntrada.join(',')}] nombra «${x.sinonimo}» (${x.origen}), que está en ${x.atcSustancia.join(',')}`);
    }
    for (const x of ausentes) {
        console.log(`AUSENTE  ${x.entrada} vigila «${x.sustancia}» y no hay ningún comercializado monocomponente con ese VTM: ¿retirado o renombrado en CIMA?`);
    }
    for (const x of caducadas) {
        console.log(`CADUCADA  ${x.entrada} / «${x.sinonimo}»: ya no es una contradicción; retírala de la línea base.`);
    }
    for (const x of invalidas) {
        console.log(`INVÁLIDA  ${JSON.stringify(x)}: una excepción necesita entrada, sinonimo y motivo; así no silencia nada.`);
    }
    if (!nuevas.length && !ausentes.length && !caducadas.length && !invalidas.length) {
        console.log('Sin novedades. (Solo cubre lo que la ontología nombra: no es una certificación clínica.)');
        return 0;
    }
    return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main().then(code => process.exit(code));
}
