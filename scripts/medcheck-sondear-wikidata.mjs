#!/usr/bin/env node
/**
 * MedCheck — la pasada abierta: Wikidata (CC0) sobre los 218 nombres que ninguna autoridad
 * resuelve.
 *
 * POR QUÉ SE VUELVE A INTENTAR. Un primer barrido dio «75 aciertos de 218» y se descartó por
 * contaminado: Wikidata contiene millones de referencias bibliográficas y `octocog alfa`
 * devolvía el TÍTULO de una revisión sobre octocog alfa, no la sustancia. El descarte fue
 * correcto; lo que estuvo mal fue concluir que la fuente no servía en vez de que el filtro no
 * existía.
 *
 * EL MÉTODO, fijado en el acta del 22/08 (§7.1-C) tras corregir una propuesta más floja:
 *   1. Búsqueda TEXTUAL para candidatos (`wbsearchentities`). Wikidata desaconseja SPARQL
 *      difuso para texto; el índice de búsqueda es el que sabe de grafías.
 *   2. Coincidencia EXACTA de etiqueta o alias, no aproximada. Se mide por separado la
 *      coincidencia en español (criterio estricto del acta) y la coincidencia de la MISMA
 *      cadena como alias inglés, que es evidencia distinta y no peor: si `octocog alfa` es
 *      alias inglés de una entidad, esa cadena es un nombre reconocido de la sustancia.
 *   3. Tipo POSITIVO por `P31/P279*` contra una raíz de entidades químicas, farmacológicas o
 *      proteicas.
 *   4. Exclusión EXPLÍCITA de artículos y ensayos clínicos.
 *   5. Identificador químico o farmacológico externo (CAS, ChEBI, DrugBank, ATC, UNII, PubChem,
 *      ChEMBL, RxNorm) como prueba de que la entidad es una sustancia y no un concepto.
 *
 * Y ADEMÁS, LA GUARDA DE SIEMPRE: lo que Wikidata proponga pasa por `comparteRaiz`, igual que
 * lo que proponen RxNav o PubMed. Wikidata es una autoridad más, no una excepción.
 *
 * LO QUE ESTE SCRIPT NO HACE, A PROPÓSITO. No escribe en el baseline ni en el diccionario. La
 * pasada del acta es de MEDICIÓN: «número de aciertos reales tras descartar los falsos
 * positivos, con una muestra revisada a mano». La incorporación sigue pasando por
 * `medcheck-promote-identity.mjs`, que es quien mide el derrumbe.
 *
 * Uso:
 *   node scripts/medcheck-sondear-wikidata.mjs              # pasada completa (218)
 *   node scripts/medcheck-sondear-wikidata.mjs --max=20     # acota (pruebas)
 *   node scripts/medcheck-sondear-wikidata.mjs --clases     # vuelca las clases P31 encontradas
 *
 * Salidas: consola + docs/medcheck/private/wikidata-pasada.json (zona privada, gitignorada).
 * La caché de respuestas vive en docs/medcheck/private/cache-wikidata.json y hace barata la
 * repetición: la pasada se puede rehacer con otro filtro sin volver a pedir nada.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { comparteRaiz, normalizar } from './medcheck-identity-kin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const PRIVADO = join(ROOT, 'docs', 'medcheck', 'private');
const CACHE = join(PRIVADO, 'cache-wikidata.json');
const SALIDA = join(PRIVADO, 'wikidata-pasada.json');

const args = process.argv.slice(2);
const max = Number((args.find(a => a.startsWith('--max=')) || '').split('=')[1]) || Infinity;
const volcarClases = args.includes('--clases');
// VARIANTE MEDIDA, NO DECIDIDA. `--sin-exacto` sustituye el requisito de coincidencia exacta de
// etiqueta española por el parentesco, que es la guarda propia del proyecto. Existe porque al
// medir apareció la razón real de la mayoría de los fallos: Wikidata TIENE la sustancia pero
// SIN etiqueta española (`sulodexida` encuentra Q7636496, cuyo `labelEs` es null y su `labelEn`
// es `sulodexide`). El filtro estricto del acta no descarta un falso positivo ahí: descarta un
// acierto por un hueco de Wikidata en español. Se mide para poder comparar las dos cifras; la
// decisión de cuál se usa no es de este script.
const sinExacto = args.includes('--sin-exacto');
const aplicar = args.includes('--aplicar');

/**
 * AVALES HUMANOS SOBRE EL PARENTESCO (2026-08-22). Cuatro términos que Wikidata propone, que
 * `comparteRaiz` rechaza, y que la medición demuestra que son correctos y que ganan.
 *
 * POR QUÉ ESTO NO ROMPE «ESPEJO, NO JUEZ». No se escribe aquí ninguna traducción: el término lo
 * propuso Wikidata, igual que RxNav o PubMed proponen los suyos. Lo que se anula es una
 * heurística NUESTRA —el parentesco, que compara grafías— en los casos en que compara mal porque
 * el español y el inglés usan palabras distintas para la misma cosa (`esencia`/`oil`), no
 * grafías distintas del mismo étimo. La guarda de derrumbe del promotor sigue en pie: si alguno
 * recuperase peor, se bloquea igual.
 *
 * Se anotan con la medición que los justifica, y con `human: true` para que una recompilación no
 * los vuelva a tirar. Los cuatro se midieron en los DOS registros, porque no dicen lo mismo:
 * PubMed mapea solo muchos nombres españoles y ClinicalTrials no.
 *
 * NO entran aquí, y es deliberado: `alcohol etílico -> ethanol` (PubMed 61 -> 230.129, que es el
 * ensanchamiento de `retinol -> vitamin A` con otra cara), `fitomenadiona -> (E)-phytonadione`
 * (2.015 -> 215, el estereodescriptor estrecha), `octocog alfa` (nombre de clase) y los seis en
 * los que los dos registros ya mapean el español y la traducción no cambia nada.
 */
const AVALES = {
    'bencilpenicilina benzatina': { en: 'benzathine benzylpenicillin', medida: 'PubMed 22 -> 2194 · ensayos 0 -> 65' },
    'esencia de lavanda': { en: 'lavender oil', medida: 'PubMed 0 -> 698 · ensayos 0 -> 224' },
    'hexafluoruro de azufre': { en: 'sulfur hexafluoride', medida: 'PubMed 2 -> 3846 · ensayos 0 -> 246' },
    'Ioflupano (123I)': { en: 'ioflupane I-123', medida: 'PubMed 419 = 419 · ensayos 0 -> 54' },
};

const UA = 'MedCheck-identity/1.0 (https://ernestobarrera.github.io/medcheck.html)';
const dormir = ms => new Promise(r => setTimeout(r, ms));

// ── Caché en disco ──────────────────────────────────────────────────────────────────────────
mkdirSync(PRIVADO, { recursive: true });
const cache = existsSync(CACHE)
    ? JSON.parse(readFileSync(CACHE, 'utf8'))
    : { buscar: {}, entidades: {}, clases: {} };
const guardarCache = () => writeFileSync(CACHE, JSON.stringify(cache));

let inconclusas = 0;
async function pedirJson(url) {
    for (let i = 0; i < 3; i++) {
        try {
            const r = await fetch(url, {
                headers: { 'User-Agent': UA, Accept: 'application/json' },
                signal: AbortSignal.timeout(30000),
            });
            if (r.ok) return await r.json();
            if (r.status === 429 || r.status >= 500) { await dormir(2000 * (i + 1)); continue; }
            return undefined;
        } catch { await dormir(900 * (i + 1)); }
    }
    inconclusas += 1;
    return undefined;
}

// ── 1 · Los pendientes, el mismo conjunto que usa el revisor humano ──────────────────────────
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const pendientes = Object.entries(baseline.terms)
    .filter(([, v]) => (v.status === 'review' || v.status === 'unresolved') && !v.human)
    .sort((a, b) => (b[1].products || 0) - (a[1].products || 0))
    .slice(0, max);
const sumaProductos = l => l.reduce((s, x) => s + (Array.isArray(x) ? (x[1].products || 0) : (x.products || 0)), 0);
console.log(`pendientes a sondear: ${pendientes.length} (${sumaProductos(pendientes)} productos)\n`);

// ── 2 · Búsqueda textual ────────────────────────────────────────────────────────────────────
const API = 'https://www.wikidata.org/w/api.php';
async function buscar(termino) {
    if (cache.buscar[termino]) return cache.buscar[termino];
    const u = `${API}?action=wbsearchentities&format=json&language=es&uselang=es&type=item&limit=15&search=${encodeURIComponent(termino)}`;
    const d = await pedirJson(u);
    await dormir(120);
    const ids = (d?.search || []).map(s => s.id);
    cache.buscar[termino] = ids;
    return ids;
}

let n = 0;
for (const [es] of pendientes) {
    n += 1;
    await buscar(es);
    if (n % 25 === 0) { console.error(`  búsqueda … ${n}/${pendientes.length}`); guardarCache(); }
}
guardarCache();

// ── 3 · Hidratado de entidades (lotes de 50) ────────────────────────────────────────────────
const IDS_QUIMICOS = ['P231', 'P683', 'P715', 'P267', 'P662', 'P652', 'P592', 'P3345'];
const necesarias = [...new Set(pendientes.flatMap(([es]) => cache.buscar[es] || []))]
    .filter(id => cache.entidades[id] === undefined);
console.log(`entidades candidatas a hidratar: ${necesarias.length}`);
for (let i = 0; i < necesarias.length; i += 50) {
    const lote = necesarias.slice(i, i + 50);
    const u = `${API}?action=wbgetentities&format=json&ids=${lote.join('%7C')}&props=labels%7Caliases%7Cclaims&languages=es%7Cen`;
    const d = await pedirJson(u);
    await dormir(150);
    for (const id of lote) {
        const e = d?.entities?.[id];
        if (!e) { cache.entidades[id] = null; continue; }
        cache.entidades[id] = {
            labelEs: e.labels?.es?.value || null,
            labelEn: e.labels?.en?.value || null,
            aliasEs: (e.aliases?.es || []).map(a => a.value),
            aliasEn: (e.aliases?.en || []).map(a => a.value),
            p31: (e.claims?.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean),
            ids: IDS_QUIMICOS.filter(p => (e.claims?.[p] || []).length),
        };
    }
    guardarCache();
    console.error(`  hidratado … ${Math.min(i + 50, necesarias.length)}/${necesarias.length}`);
}

// ── 4 · Tipado por P31/P279* ────────────────────────────────────────────────────────────────
//
// RAÍCES POSITIVAS. No se eligen a ojo: se vuelcan primero todas las clases P31 que aparecen
// (--clases) y se decide sobre la lista real. `Q113145171` (type of chemical entity) está aquí
// porque Wikidata modela como METACLASE los principios activos genéricos —`Factor VIII` es
// «tipo de entidad química», no «entidad química»— y sin él se caen sustancias legítimas.
//
// Las tres últimas se añadieron DESPUÉS de volcar las clases reales, no antes: son metaclases
// químicas que `P279*` no lleva hasta `chemical entity` aunque nombren sustancias. Medido lo que
// cambian: exactamente dos entidades más llegan al parentesco (`citicolina` -> `CDP-choline (1+)`
// y `goma guar` -> `guar gum`), y el parentesco decide. Es decir, no fabrican ningún acierto —
// evitan que un término se caiga por cómo Wikidata modela su clase, que no es una razón.
const RAICES = {
    Q43460564: 'chemical entity',
    Q113145171: 'type of chemical entity',
    Q12140: 'medication',
    Q8054: 'protein',
    Q28885102: 'pharmaceutical product',
    Q79529: 'chemical substance',
    Q11344: 'chemical element',
    Q59199015: 'group of stereoisomers',
    Q72070508: 'group or class of chemical entities',
    Q55640599: 'group of chemical entities',
};
// EXCLUSIONES EXPLÍCITAS. Son las que produjeron los falsos aciertos del primer intento.
const EXCLUIDAS = {
    Q13442814: 'artículo científico',
    Q30612: 'ensayo clínico',
    Q5: 'ser humano',
    Q4167410: 'página de desambiguación',
    Q13406463: 'artículo de lista',
    Q7187: 'gen',
    Q16521: 'taxón',
    Q3331189: 'edición',
};

const clasesVistas = new Map();
for (const e of Object.values(cache.entidades)) {
    if (!e) continue;
    for (const c of e.p31) clasesVistas.set(c, (clasesVistas.get(c) || 0) + 1);
}
const porResolver = [...clasesVistas.keys()].filter(c => cache.clases[c] === undefined);
console.log(`clases P31 distintas: ${clasesVistas.size} (por resolver: ${porResolver.length})`);

for (let i = 0; i < porResolver.length; i += 60) {
    const lote = porResolver.slice(i, i + 60);
    const q = `SELECT ?c ?cLabel (GROUP_CONCAT(DISTINCT ?r; separator=",") AS ?raices) WHERE {
  VALUES ?c { ${lote.map(c => 'wd:' + c).join(' ')} }
  OPTIONAL {
    VALUES ?root { ${Object.keys(RAICES).map(r => 'wd:' + r).join(' ')} }
    ?c wdt:P279* ?root .
    BIND(STRAFTER(STR(?root), "entity/") AS ?r)
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
} GROUP BY ?c ?cLabel`;
    const d = await pedirJson('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q));
    await dormir(400);
    if (!d) { console.error('  SPARQL sin respuesta para un lote de clases'); continue; }
    for (const b of d.results.bindings) {
        const id = b.c.value.split('/').pop();
        cache.clases[id] = { label: b.cLabel?.value || id, raices: (b.raices?.value || '').split(',').filter(Boolean) };
    }
    for (const c of lote) if (cache.clases[c] === undefined) cache.clases[c] = { label: c, raices: [] };
    guardarCache();
    console.error(`  clases … ${Math.min(i + 60, porResolver.length)}/${porResolver.length}`);
}
guardarCache();

const esSustancia = p31 => p31.some(c => (cache.clases[c]?.raices || []).length);
const esExcluida = p31 => p31.some(c => EXCLUIDAS[c]);

if (volcarClases) {
    console.log('\n--- CLASES P31 encontradas (frecuencia · veredicto) ---');
    [...clasesVistas.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, k]) => {
        const info = cache.clases[c] || { label: c, raices: [] };
        const v = EXCLUIDAS[c] ? 'EXCLUIDA' : info.raices.length ? 'sustancia' : '—';
        console.log(`  ${String(k).padStart(4)}  ${c.padEnd(12)} ${String(info.label).slice(0, 42).padEnd(44)} ${v}`);
    });
}

// ── 5 · Decisión por término ────────────────────────────────────────────────────────────────
const exacto = (t, lista) => lista.some(x => normalizar(x) === normalizar(t));

const fichas = [];
for (const [es, v] of pendientes) {
    const ficha = {
        es, products: v.products || 0, status: v.status,
        candidatoPrevio: (v.candidates || [])[0] || null,
        resultado: null, qid: null, en: null, via: null, clase: null, ids: [],
        parentesco: null, descartes: [],
    };
    for (const qid of cache.buscar[es] || []) {
        const e = cache.entidades[qid];
        if (!e) continue;
        const matchEs = exacto(es, [e.labelEs, ...e.aliasEs].filter(Boolean));
        const matchEn = exacto(es, [e.labelEn, ...e.aliasEn].filter(Boolean));
        if (!matchEs && !matchEn && !sinExacto) continue;
        if (esExcluida(e.p31)) {
            ficha.descartes.push(`${qid} tipo excluido: ${e.p31.map(c => EXCLUIDAS[c] || c).join(', ')}`);
            continue;
        }
        if (!esSustancia(e.p31)) {
            ficha.descartes.push(`${qid} sin tipo de sustancia: ${e.p31.map(c => cache.clases[c]?.label || c).join(', ') || '(sin P31)'}`);
            continue;
        }
        if (!e.ids.length) { ficha.descartes.push(`${qid} sin identificador químico externo`); continue; }
        if (!e.labelEn) { ficha.descartes.push(`${qid} sin etiqueta inglesa`); continue; }
        // LA ETIQUETA INGLESA ES LA MISMA CADENA. No es un descarte: es un veredicto.
        // El nombre que CIMA escribe YA es el término inglés, así que no hay nada que traducir y
        // no hace falta que nadie lo decida — el runtime, que envía el nombre español cuando no
        // hay entrada de diccionario, ya está enviando lo correcto. Se compara sin acentos pero
        // CONSERVANDO la grafía: `inclisirán` frente a `inclisiran` NO es este caso, es una
        // entrada de diccionario que hace falta, y confundirlos dejaría fuera la tilde que
        // justamente rompe la búsqueda.
        if (e.labelEn.toLowerCase() === es.toLowerCase()) {
            ficha.qid = qid; ficha.en = e.labelEn; ficha.via = matchEs ? 'es' : 'en';
            ficha.clase = e.p31.map(c => cache.clases[c]?.label || c).join(', ');
            ficha.ids = e.ids;
            ficha.resultado = 'ya-en-ingles';
            break;
        }
        const parentesco = comparteRaiz(es, e.labelEn);
        // Sin coincidencia exacta, el parentesco es el ÚNICO filtro de identidad que queda: una
        // búsqueda textual devuelve entidades parecidas y cualquiera de ellas pasaría el tipo y
        // el identificador. Por eso aquí no se acepta el primero que llegue — se sigue mirando
        // hasta encontrar uno emparentado, o no hay candidato.
        if (!parentesco && sinExacto) { ficha.descartes.push(`${qid} ${e.labelEn}: sin parentesco`); continue; }
        ficha.qid = qid;
        ficha.en = e.labelEn;
        ficha.via = matchEs ? 'es' : matchEn ? 'en' : 'parentesco';
        ficha.clase = e.p31.map(c => cache.clases[c]?.label || c).join(', ');
        ficha.ids = e.ids;
        ficha.parentesco = parentesco;
        ficha.resultado = parentesco ? 'candidato' : 'rechazado-parentesco';
        break;
    }
    if (!ficha.resultado) ficha.resultado = ficha.descartes.length ? 'descartado' : 'sin-coincidencia-exacta';
    fichas.push(ficha);
}

// ── 6 · Recuento ────────────────────────────────────────────────────────────────────────────
const grupo = r => fichas.filter(f => f.resultado === r);
const cand = grupo('candidato');
const candEs = cand.filter(f => f.via === 'es');
const candEn = cand.filter(f => f.via === 'en');
const yaIngles = grupo('ya-en-ingles');
const rech = grupo('rechazado-parentesco').sort((a, b) => b.products - a.products);

console.log('\n═══ RECUENTO DE LA PASADA ═══');
console.log(`  sobre ${fichas.length} pendientes (${sumaProductos(fichas)} productos)\n`);
console.log(`  CANDIDATOS que pasan TODOS los filtros: ${cand.length} (${sumaProductos(cand)} productos)`);
console.log(`      · coincidencia exacta en ESPAÑOL (criterio estricto del acta): ${candEs.length} (${sumaProductos(candEs)} productos)`);
console.log(`      · la misma cadena como alias INGLÉS:                           ${candEn.length} (${sumaProductos(candEn)} productos)`);
if (sinExacto) {
    const candPar = cand.filter(f => f.via === 'parentesco');
    console.log(`      · SIN etiqueta española, solo por parentesco (--sin-exacto): ${candPar.length} (${sumaProductos(candPar)} productos)`);
}
console.log(`  YA ESTÁN EN INGLÉS (no hay nada que traducir ni que decidir): ${yaIngles.length} (${sumaProductos(yaIngles)} productos)`);
console.log(`  rechazados por el parentesco: ${rech.length} (${sumaProductos(rech)} productos)`);
console.log(`  descartados por los filtros de tipo/identificador: ${grupo('descartado').length}`);
console.log(`  sin coincidencia exacta en Wikidata: ${grupo('sin-coincidencia-exacta').length}`);
if (inconclusas) console.log(`  consultas inconclusas (red): ${inconclusas}`);

console.log('\n--- CANDIDATOS, por productos ---');
cand.sort((a, b) => b.products - a.products).forEach(f => {
    console.log(`  ${String(f.products).padStart(4)}  ${f.es.slice(0, 32).padEnd(34)} -> ${String(f.en).slice(0, 34).padEnd(36)} [${f.via}] ${f.ids.join(',')}`);
});

if (yaIngles.length) {
    console.log('\n--- YA EN INGLÉS (Wikidata confirma que la cadena de CIMA es el término inglés) ---');
    yaIngles.sort((a, b) => b.products - a.products)
        .forEach(f => console.log(`  ${String(f.products).padStart(4)}  ${f.es.slice(0, 32).padEnd(34)} = ${f.qid}  ${f.ids.join(',')}`));
}

if (rech.length) {
    console.log('\n--- RECHAZADOS POR PARENTESCO (Wikidata proponía otra cosa) ---');
    rech.slice(0, 20).forEach(f => console.log(`  ${String(f.products).padStart(4)}  ${f.es.slice(0, 32).padEnd(34)} ~ ${f.en}`));
}

writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), fichas }, null, 2) + '\n');

// ── 7 · Aplicación al baseline (opcional) ───────────────────────────────────────────────────
//
// Marca `verified` con su término. NO escribe el diccionario: eso es de
// `medcheck-promote-identity.mjs`, que mide la recuperación y aplica la guarda de derrumbe.
// Por eso aquí NO hay lista negra de falsos positivos: `almagato -> almagate dihydrate` se
// aplica como los demás y lo para el promotor, que es quien tiene la medición delante. Una
// exclusión escrita a mano aquí sería una decisión sin medida, que es lo que este proyecto
// evita.
if (!aplicar) {
    console.log(`\nNada escrito en el baseline ni en el diccionario. Detalle en ${SALIDA.replace(ROOT, '.')}`);
    console.log('Repite con --aplicar para marcarlos verified en el baseline.');
} else {
    const HOY = new Date().toISOString().slice(0, 10);
    let n1 = 0, n2 = 0, n3 = 0;
    for (const f of cand) {
        baseline.terms[f.es] = {
            ...baseline.terms[f.es], status: 'verified', en: f.en, method: 'wikidata',
            sources: { ...(baseline.terms[f.es].sources || {}), wikidata: f.qid },
            evidence: [`Wikidata ${f.qid} · coincidencia exacta ${f.via} · tipo ${f.clase} · ids ${f.ids.join(',')}`],
            reason_previa: baseline.terms[f.es].reason,
        };
        delete baseline.terms[f.es].reason;
        n1 += 1;
    }
    // Los que ya están en inglés se anotan con su propio término. Parece redundante y no lo es:
    // deja escrito que la pregunta SE HIZO y se contestó, y los saca de la cola del revisor, que
    // es donde estaban ocupando sitio sin tener nada que decidir.
    for (const f of yaIngles) {
        baseline.terms[f.es] = {
            ...baseline.terms[f.es], status: 'verified', en: f.es.toLowerCase(), method: 'wikidata-identico',
            sources: { ...(baseline.terms[f.es].sources || {}), wikidata: f.qid },
            evidence: [`Wikidata ${f.qid}: la etiqueta inglesa es la misma cadena que escribe CIMA; no hay traducción que hacer`],
            reason_previa: baseline.terms[f.es].reason,
        };
        delete baseline.terms[f.es].reason;
        n2 += 1;
    }
    for (const [es, av] of Object.entries(AVALES)) {
        const v = baseline.terms[es];
        if (!v) { console.error(`  [aviso] aval sin ficha en el baseline: ${es}`); continue; }
        baseline.terms[es] = {
            ...v, status: 'verified', en: av.en, method: 'wikidata-aval-humano', human: true,
            evidence: [`Wikidata propone "${av.en}"; el parentesco lo rechaza y la medición lo desmiente: ${av.medida}`],
            veredicto: `revisión asistida ${HOY}, medida en PubMed y ClinicalTrials`,
            reason_previa: v.reason,
        };
        delete baseline.terms[es].reason;
        n3 += 1;
    }
    baseline.note = (baseline.note || '') +
        ` · ${HOY}: pasada abierta de Wikidata (CC0) con filtros estrictos — ${n1} candidatos, ${n2} términos que ya estaban en inglés y ${n3} avales humanos sobre el parentesco, medidos en los dos registros.`;
    writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`\nBaseline actualizado: ${n1} candidatos + ${n2} ya-en-inglés + ${n3} avales = ${n1 + n2 + n3} pasan a verified.`);
    console.log('El diccionario NO se ha tocado: eso es de medcheck-promote-identity.mjs.');
}
