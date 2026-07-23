#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const ontologyPath = path.join(repoRoot, 'assets', 'data', 'clinical-ontology.json');
const CIMA_BASE = 'https://cima.aemps.es/cima/rest';
// Tope de paginas de /buscarEnFichaTecnica (100 por pagina). Se declara aqui arriba, junto al resto
// de constantes de modulo, porque el bloque `await` de nivel superior corre ANTES que las
// declaraciones de la mitad inferior del archivo (zona muerta temporal).
const FT_MAX_PAGES = 30;

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const reconcile = args.has('--reconcile');
const probeAnchors = args.has('--probe-anchors');
const updateBaseline = args.has('--update-baseline');
// --baseline= permite apuntar a otro archivo (lo usan los tests de gates con baselines sintéticos).
const baselineArg = readStringArg('--baseline');
const baselinePath = baselineArg
  ? path.resolve(baselineArg)
  : path.join(repoRoot, 'assets', 'data', 'reconcile-baseline.json');
// Antigüedad máxima de un 'accepted' antes de exigir re-revisión humana.
const ACCEPTED_MAX_AGE_DAYS = 180;
// Base de los backoffs de reintento (1-3-8 × base). MC_AUDIT_BACKOFF_MS=1 en tests.
// Estas const/class viven aquí arriba por la misma zona muerta temporal que FT_MAX_PAGES:
// el bloque await superior corre antes que las declaraciones de la mitad inferior.
const BACKOFF_BASE_MS = Number(process.env.MC_AUDIT_BACKOFF_MS) || 1000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
class UnknownResultError extends Error {}
// Entidades HTML nombradas que decodeEntities traduce a mano (docSegmentado no las decodifica).
// Ver la nota junto a decodeEntities: DEBE vivir aquí arriba por la zona muerta temporal.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', ordm: 'º', ordf: 'ª', deg: '°'
};
// Motivos por los que esta ejecución NO puede certificar nada (red agotada, respuesta inválida,
// truncación del universo decisorio). Si hay alguno y ningún problema determinista, exit 2:
// "repite la pasada", que es distinto de exit 1: "el producto está mal".
const inconclusive = [];
const requestedTerms = readStringArg('--terms')
  .split(',')
  .map(normalize)
  .filter(Boolean);
const maxTerms = readNumberArg('--max-terms', live ? 40 : Infinity);
const tooManyThreshold = readNumberArg('--too-many', 250);
const sectionLimit = readNumberArg('--section-limit', 60);

const expectedTerms = [
  'hipertensión', 'insuficiencia cardiaca', 'cardiopatía isquémica', 'fibrilación auricular',
  'trombosis', 'antiagregación', 'dislipemia', 'hipertensión pulmonar',
  'asma', 'epoc', 'fibrosis pulmonar', 'rinitis alérgica', 'infección respiratoria',
  'reflujo', 'enfermedad inflamatoria intestinal', 'hepatitis', 'cirrosis', 'insuficiencia pancreática',
  'náuseas', 'estreñimiento', 'diarrea', 'diabetes', 'obesidad', 'hipotiroidismo',
  'hipertiroidismo', 'osteoporosis', 'gota', 'enfermedad renal crónica', 'anemia renal',
  'hiperpotasemia', 'hbp', 'vejiga hiperactiva', 'litiasis renal', 'infección urinaria',
  'epilepsia', 'migraña', 'parkinson', 'alzheimer', 'esclerosis múltiple', 'dolor neuropático',
  'depresión', 'ansiedad', 'insomnio', 'esquizofrenia', 'trastorno bipolar', 'tdah',
  'adicciones', 'artritis reumatoide', 'espondiloartritis', 'artritis psoriásica',
  'lupus', 'vasculitis', 'psoriasis', 'dermatitis atópica', 'acné', 'urticaria',
  'infección cutánea', 'anticoagulación', 'anemia', 'neutropenia', 'hemofilia',
  'linfoma', 'leucemia', 'mieloma múltiple', 'cáncer de mama', 'cáncer de pulmón',
  'cáncer colorrectal', 'cáncer de ovario', 'cáncer renal', 'anticoncepción',
  'menopausia', 'endometriosis', 'fertilidad', 'glaucoma', 'dmae', 'retinopatía diabética',
  'conjuntivitis', 'ojo seco', 'otitis', 'sinusitis', 'vértigo', 'dolor', 'dolor crónico',
  'cuidados paliativos', 'estreñimiento por opioides', 'antibióticos', 'antifúngicos',
  'antivirales', 'vih', 'tuberculosis', 'trasplante', 'inmunosupresión',
  'profilaxis infecciosa'
];

// Dominios clínicos permitidos para catalogGroup (deben coincidir con GROUP_ORDER en cima-app.js).
// El catálogo de indicaciones agrupa por este campo curado, no por ATC (que clasifica el fármaco,
// no la enfermedad). El guardián de abajo avisa si una entrada no lo trae o usa un dominio no listado.
const allowedCatalogGroups = new Set([
  'Cardiovascular', 'Nefrología y medio interno', 'Endocrinología y metabolismo',
  'Digestivo', 'Respiratorio', 'Otorrinolaringología', 'Alergología', 'Oftalmología', 'Dermatología',
  'Neurología', 'Salud mental y adicciones', 'Dolor y cuidados paliativos',
  'Reumatología y musculoesquelético', 'Inmunología, autoinmunes y trasplante',
  'Infecciosas', 'Hematología y hemostasia', 'Oncología',
  'Ginecología y obstetricia', 'Urología', 'Fármacos y clases'
]);

const raw = await fs.readFile(ontologyPath, 'utf8');
const ontology = JSON.parse(raw);
const terms = ontology.terms || {};
const entries = Object.entries(terms);
const allowedStatuses = new Set(ontology.metadata?.statusValues || ['stable', 'beta', 'broad', 'needsSection41Filter']);

const stats = {
  total: entries.length,
  stable: 0,
  beta: 0,
  broad: 0,
  needsSection41Filter: 0,
  exact: 0,
  section41: 0,
  biosimilarRelevant: 0,
  biologicArea: 0
};

const problems = [];
const warnings = [];
const duplicateIndex = new Map();

for (const [term, entry] of entries) {
  // Solo contabilizar estados reales: evita una clave "undefined" en el informe cuando
  // falta status (que ya se reporta como problema estructural más abajo).
  if (entry.status) stats[entry.status] = (stats[entry.status] || 0) + 1;
  if (entry.matchMode === 'exact') stats.exact += 1;
  if (entry.section41Filter || entry.sectionFilter) stats.section41 += 1;
  if (entry.biosimilarRelevant) stats.biosimilarRelevant += 1;
  if (entry.biologicArea) stats.biologicArea += 1;

  if (!entry.atc) problems.push(`${term}: falta atc`);
  if (!entry.label) problems.push(`${term}: falta label`);
  if (!entry.status) problems.push(`${term}: falta status`);
  if (entry.status && !allowedStatuses.has(entry.status)) problems.push(`${term}: status desconocido "${entry.status}"`);
  if (!entry.catalogGroup) warnings.push(`${term}: sin catalogGroup (caería al fallback ATC en el catálogo)`);
  else if (!allowedCatalogGroups.has(entry.catalogGroup)) problems.push(`${term}: catalogGroup desconocido "${entry.catalogGroup}"`);
  if ((entry.status === 'broad' || entry.status === 'needsSection41Filter') && entry.matchMode !== 'exact') {
    warnings.push(`${term}: estado ${entry.status} sin matchMode exact`);
  }
  if (entry.status === 'needsSection41Filter' && !(entry.section41Filter || entry.sectionFilter)) {
    problems.push(`${term}: needsSection41Filter sin filtro`);
  }

  addDuplicateKey(term, term, `term:${term}`);
  for (const synonym of entry.synonyms || []) addDuplicateKey(synonym, term, `synonym:${term}`);
}

const missingExpected = expectedTerms.filter(term => !terms[term] && !hasSynonym(term));
const atcSignature = (owner) => JSON.stringify(
  toAtcList(terms[owner] || {}).map(a => String(a).toUpperCase()).sort()
);
// Colisiones de termino/sinonimo entre entradas. Se separan en dos, porque solo unas son un
// fallo real: findClinicalDictionaryMatches puntua el termino exacto con 100 y el sinonimo con 70,
// y searchByIndication se queda con matches[0]. Si alguno de los duenos casa por TERMINO, gana de
// forma determinista y la colision es inocua. Si TODOS casan por sinonimo, empatan a 70 y el
// desempate lo decide el orden de las claves del JSON: reordenar el fichero —una edicion
// cosmetica— cambiaria en silencio la lista de farmacos que ve un clinico. Eso es ambiguo y
// bloquea; se arregla dando UN solo dueno al sinonimo.
const ambiguousTerms = [];
const duplicateTerms = [...duplicateIndex.entries()]
  .map(([key, refs]) => {
    const owners = new Set(refs.map(ref => ref.owner));
    if (owners.size <= 1) return null;
    // Ruido inofensivo: si todos los dueños apuntan al MISMO ATC, el solapamiento de
    // sinónimos no cambia el resultado de la búsqueda. Solo señalamos divergencias reales.
    if (new Set([...owners].map(atcSignature)).size <= 1) return null;
    const linea = `${key}: ${refs.map(ref => ref.label).join(', ')}`;
    const hayTermino = refs.some(ref => String(ref.label).startsWith('term:'));
    if (!hayTermino) {
      ambiguousTerms.push(`${linea} — EMPATE a 70: hoy gana "${refs[0].owner}" solo por orden en el JSON`);
      return null;
    }
    return linea;
  })
  .filter(Boolean);
for (const a of ambiguousTerms) problems.push(`Sinónimo ambiguo (desempate por orden de fichero) → ${a}`);

let liveRows = [];
let sectionRows = [];
if (live) {
  if (typeof fetch !== 'function') {
    throw new Error('Este Node no expone fetch global. Usa Node 18+ para --live.');
  }
  const requestedSet = new Set(requestedTerms);
  const liveSource = requestedSet.size > 0
    ? entries.filter(([term]) => requestedSet.has(normalize(term)))
    : entries;
  const foundRequested = new Set(liveSource.map(([term]) => normalize(term)));
  for (const term of requestedSet) {
    if (!foundRequested.has(term)) warnings.push(`--terms no encontrado: ${term}`);
  }
  const liveEntries = liveSource.slice(0, Number.isFinite(maxTerms) ? maxTerms : liveSource.length);
  for (const [term, entry] of liveEntries) {
    let meds = [];
    try {
      meds = await searchEntry(entry);
    } catch (error) {
      // --live es informativo: no bloquea, pero un término no medible no puede aparecer como "0".
      warnings.push(`${term}: live no medible (${error.message})`);
      continue;
    }
    const biosimilars = meds.filter(med => med.biosimilar === true).length;
    liveRows.push({
      term,
      status: entry.status,
      atc: toAtcList(entry).join(','),
      total: meds.length,
      biosimilars
    });

    const sectionFilter = entry.section41Filter || entry.sectionFilter;
    if (sectionFilter && meds.length > 0) {
      const checked = meds.slice(0, sectionLimit);
      const { matched, unknown } = await countSectionMatches(checked, sectionFilter);
      if (unknown > 0) warnings.push(`${term}: ${unknown}/${checked.length} fichas no verificables al medir el filtro 4.1 (métrica informativa parcial)`);
      sectionRows.push({ term, candidates: meds.length, checked: checked.length, matched });
    }
  }
}

// Reconciliacion ATC <-> ficha tecnica 4.1: para cada entrada compara el conjunto que devuelve
// hoy MedCheck (por ATC) contra el conjunto que CIMA reporta con esa indicacion en su 4.1 (la
// verdad legal). Detecta HUECOS DE SENSIBILIDAD (farmacos autorizados que el ATC no captura,
// p. ej. Zyntabac/bupropion codificado como antidepresivo). Es un DETECTOR DE CANDIDATOS, no un
// oraculo: la busqueda por texto tiene falsos positivos (un 4.1 que menciona "dejar de fumar"
// como consejo) y depende de la fraseologia. Pensado para refresco periodico y gate pre-publicacion.
let reconcileRows = [];
let newGapCount = 0;
let blockedGapCount = 0;
let invalidReconcileCount = 0;
let orphanAnchorCount = 0;
let probeRows = [];
const baseline = await loadBaseline();
if (reconcile || updateBaseline) {
  if (typeof fetch !== 'function') {
    throw new Error('Este Node no expone fetch global. Usa Node 18+ para --reconcile.');
  }
  const requestedSet = new Set(requestedTerms);
  // Por defecto solo las entradas con fraseologia curada (filtro 4.1, ancla o reconcileTerms); con
  // --terms se fuerza cualquiera. Evita ruido masivo en entradas sin terminos curados.
  const source = requestedSet.size > 0
    ? entries.filter(([term]) => requestedSet.has(normalize(term)))
    : entries.filter(([, entry]) => entry.section41Filter || entry.sectionFilter || entry.reconcileTerms || entry.reconcileAnchor);
  const recEntries = source.slice(0, Number.isFinite(maxTerms) ? maxTerms : source.length);
  for (const [term, entry] of recEntries) {
    const row = await reconcileEntry(term, entry);
    classifyGapsAgainstBaseline(row, entry);
    newGapCount += row.newGaps.length;
    blockedGapCount += row.blockedGaps.length;
    invalidReconcileCount += row.anchorErrors.length ? 1 : 0;
    for (const motivo of row.inconcluso) inconclusive.push(`reconcile "${term}": ${motivo}`);
    reconcileRows.push(row);
  }
  // Una pasada inconclusa NUNCA escribe baseline: consolidaria como "revisado" un universo que no
  // se pudo medir. Ademas solo se persisten filas con universo valido (sin anchorErrors).
  if (updateBaseline) {
    if (inconclusive.length) {
      console.log('\n[baseline] NO escrito: ejecución inconclusa (repite la pasada cuando la red/universo estén completos).');
    } else {
      await writeBaseline(reconcileRows.filter(r => !r.anchorErrors.length));
    }
  }
}

if (probeAnchors) {
  const todas = Object.entries(ontology.terms);
  const objetivo = requestedTerms.length
    ? todas.filter(([t]) => requestedTerms.includes(normalize(t)))
    : todas;
  probeRows = await probeAnchorsFor(objetivo);
  // Un huerfano en una entrada YA anclada es un universo publicado que se esta perdiendo
  // productos: bloquea, igual que un GAP nuevo.
  orphanAnchorCount = probeRows.filter(r => (r.huerfanos || []).some(h => h.ciego)).length;
}

printReport();
// Gate pre-publicacion con salida ternaria (revision cruzada 2026-07-23):
//   0 → cobertura completa y limpia.
//   1 → problema DETERMINISTA: estructural, GAP nuevo, GAP bloqueado por el baseline (review/
//       curated reaparecido/accepted caducado), ancla que recluta 0 (fraseo) o huerfano ciego.
//       Se arregla curando la ontologia o revisando el baseline.
//   2 → ejecucion INCONCLUSA: red agotada, respuesta invalida o universo truncado. No significa
//       "el producto esta mal", significa "repite la pasada": un exit 2 jamas imprime un GAPS=0
//       certificado ni escribe baseline.
// Ambos codigos bloquean publicacion.
const deterministicBlock = problems.length > 0 || newGapCount > 0 || blockedGapCount > 0
  || invalidReconcileCount > 0 || orphanAnchorCount > 0;
if (deterministicBlock) process.exitCode = 1;
else if (inconclusive.length > 0) process.exitCode = 2;

function readNumberArg(name, fallback) {
  const rawArg = process.argv.slice(2).find(arg => arg.startsWith(`${name}=`));
  if (!rawArg) return fallback;
  const n = Number(rawArg.slice(name.length + 1));
  return Number.isFinite(n) ? n : fallback;
}

function readStringArg(name, fallback = '') {
  const rawArg = process.argv.slice(2).find(arg => arg.startsWith(`${name}=`));
  if (!rawArg) return fallback;
  return rawArg.slice(name.length + 1);
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// El endpoint docSegmentado devuelve la 4.1 con entidades HTML sin decodificar
// (p. ej. "cr&#243;nica"). En el navegador, CimaAPI._normalizeSectionFilterText las
// decodifica con un <textarea>; en Node no hay document, asi que hay que hacerlo a mano
// o el texto "enfermedad renal cronica" NUNCA casaria y el auditor subcontaria (justo el
// caso de los iSGLT2 en ERC). Cubre entidades numericas (dec/hex) y las nombradas comunes.
// NAMED_ENTITIES vive arriba con las constantes de m\u00f3dulo (zona muerta temporal): aqu\u00ed abajo, el
// callback de decodeEntities solo la tocaba al encontrar una entidad nombrada en el texto, y esas
// fichas concretas lanzaban ReferenceError que el antiguo catch convert\u00eda en texto vac\u00edo \u2014 83
// fichas 4.1 invisibles para el reconciliador sin que nada lo delatara (destapado 2026-07-23 por
// el contrato ternario success/absent/unknown).
function decodeEntities(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : m));
}
function safeFromCodePoint(code) {
  try { return Number.isFinite(code) ? String.fromCodePoint(code) : ''; } catch { return ''; }
}

function addDuplicateKey(value, owner, label) {
  const key = normalize(value);
  if (!key) return;
  const refs = duplicateIndex.get(key) || [];
  refs.push({ owner, label });
  duplicateIndex.set(key, refs);
}

function hasSynonym(term) {
  const target = normalize(term);
  return entries.some(([, entry]) => (entry.synonyms || []).some(syn => normalize(syn) === target));
}

function toAtcList(entry) {
  return Array.isArray(entry.atc) ? entry.atc : [entry.atc];
}

async function searchEntry(entry) {
  const seen = new Set();
  const found = [];
  for (const atc of toAtcList(entry)) {
    for (const med of await searchAtc(atc)) {
      const key = med.nregistro || med.nombre;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(med);
    }
  }
  return found;
}

async function searchAtc(atc) {
  const upper = String(atc).toUpperCase();
  // CIMA capa la pagina en 200 e ignora tamanioPagina mayores; paginar con el tamano
  // PEDIDO (500) daba ceil(400/500)=1 y el conjunto ATC se quedaba a la mitad, generando
  // GAPS falsos en masa (el reconcile los veia como agujeros de sensibilidad).
  const first = await fetchCima('/medicamentos', {
    atc: upper,
    comerc: '1',
    tamanioPagina: '200',
    pagina: '1'
  });
  const items = [...(first?.resultados || [])];
  const total = first?.totalFilas || items.length;
  const actualPageSize = items.length || 200;
  const pages = Math.min(Math.ceil(total / actualPageSize), 10);
  for (let pagina = 2; pagina <= pages; pagina += 1) {
    const page = await fetchCima('/medicamentos', {
      atc: upper,
      comerc: '1',
      tamanioPagina: '200',
      pagina: String(pagina)
    });
    items.push(...(page?.resultados || []));
  }
  return items.filter(med => {
    if (!Array.isArray(med.atcs) || med.atcs.length === 0) return true;
    return med.atcs.some(item => String(item.codigo || '').toUpperCase().startsWith(upper));
  });
}

// ---- Contrato de red -------------------------------------------------------------------------
// CIMA da 429/500 transitorios con frecuencia. Un gate que falla ABIERTO ante ellos certifica en
// falso; uno que falla CERRADO ante cada 429 se acaba ignorando. El contrato: reintentar lo
// transitorio (429/408/red/500-504, 4 intentos, Retry-After o backoff ~1-3-8s con jitter) y, si
// se agota, lanzar UnknownResultError: el resultado es 'unknown', nunca un array/texto vacío que
// se confunda con 'absent'. Quien lo capture debe marcar la ejecución como inconclusa (exit 2).
// (UnknownResultError y RETRYABLE_STATUS se declaran arriba, junto a BACKOFF_BASE_MS, por la TDZ.)

async function fetchWithRetry(url, options = {}) {
  let lastReason = '';
  for (let intento = 1; intento <= 4; intento += 1) {
    let response = null;
    let retryAfterMs = 0;
    try {
      response = await fetch(url, options);
    } catch (error) {
      lastReason = error.message; // error de red puro
    }
    if (response) {
      if (!RETRYABLE_STATUS.has(response.status)) return response;
      lastReason = `HTTP ${response.status}`;
      const retryAfter = Number(response.headers?.get?.('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
    }
    if (intento < 4) {
      const base = [1, 3, 8][intento - 1] * BACKOFF_BASE_MS;
      const waitMs = retryAfterMs || base + Math.random() * BACKOFF_BASE_MS * 0.5;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw new UnknownResultError(`agotados 4 intentos (${lastReason}) ${url}`);
}

async function fetchCima(endpoint, params) {
  const url = new URL(`${CIMA_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
  if (response.status === 204) return null;
  if (!response.ok) throw new UnknownResultError(`CIMA ${response.status} ${url}`);
  return response.json();
}

async function postCima(endpoint, params, body) {
  const url = new URL(`${CIMA_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new UnknownResultError(`CIMA ${response.status} ${url}`);
  return response.json();
}

// Busca medicamentos comercializados cuya seccion de ficha tecnica contiene `texto`.
// OJO: el tope de paginas es una truncatura silenciosa de la MISMA clase que el bug de
// /medicamentos (200): si totalFilas supera lo que traemos, el universo del ancla queda
// recortado y el reconcile deja de ver GAPS reales sin avisar. Por eso el tope es alto y
// cualquier truncatura se reporta en voz alta (p. ej. "hipercolesterolemia" = 622 filas).
// FT_MAX_PAGES se define arriba con las constantes de modulo (ver nota sobre la zona muerta).
async function buscarFichaTecnica(section, texto) {
  const body = JSON.stringify([{ seccion: section, texto, contiene: 1 }]);
  const first = await postCima('/buscarEnFichaTecnica', { comerc: '1', tamanioPagina: '100', pagina: '1' }, body);
  const out = [...(first?.resultados || [])];
  const total = first?.totalFilas || out.length;
  const needed = Math.ceil(total / 100);
  const pages = Math.min(needed, FT_MAX_PAGES);
  for (let pagina = 2; pagina <= pages; pagina += 1) {
    const d = await postCima('/buscarEnFichaTecnica', { comerc: '1', tamanioPagina: '100', pagina: String(pagina) }, body);
    out.push(...(d?.resultados || []));
  }
  if (needed > pages) {
    // La truncación afecta al universo DECISORIO (reconcile o huérfanos de ancla): no puede
    // quedarse en aviso, porque el "0 GAPS" resultante estaría medido sobre un universo recortado.
    inconclusive.push(`universo truncado: "${texto}" en ${section} tiene ${total} filas y solo se traen ${pages * 100} — acota el ancla o sube FT_MAX_PAGES`);
  }
  return out;
}

// ---- Preflight de anclas (--probe-anchors) ----------------------------------------------------
// El fallo que motivo esto: buscarEnFichaTecnica compara literalmente (acentos incluidos), asi que
// un ancla bien escrita puede dejar fuera del universo a las fichas que escriben el termino de otra
// forma, sin que nada lo delate (el resultado es "0 GAPS", que parece exito). En vez de descubrirlo
// entrada por entrada cuando ya esta publicada, esto sondea TODAS de golpe, barato: una llamada por
// candidata leyendo solo totalFilas, sin descargar fichas.
//
// La regla que lo hace generico: las variantes de escritura que el ancla se pierde ya suelen estar
// escritas en la propia ontologia como sinonimos ("insuficiencia cardíaca" era sinonimo de la
// entrada cuyo ancla era "insuficiencia cardiaca"). Candidatas = termino + sinonimos + ancla actual
// + reconcileTerms, cada una tal cual y sin acentos.
function anchorCandidates(term, entry) {
  const out = new Set();
  const add = v => { if (typeof v === 'string' && v.trim().length > 3) out.add(v.trim()); };
  add(term);
  for (const s of toArray(entry.synonyms)) add(s);
  for (const a of toArray(entry.reconcileAnchor)) add(a);
  for (const t of toArray(entry.reconcileTerms)) add(t);
  // Las frases del filtro 4.1 forman parte de la fraseologia ACEPTADA por la verificacion: si una
  // de ellas recluta productos que el ancla no ve, ese huerfano es CIEGO. Sin incluirlas aqui, el
  // preflight ni siquiera las media (hueco señalado en la revision cruzada 2026-07-23).
  const f = entry.section41Filter || entry.sectionFilter;
  for (const t of toArray(f?.includeAny)) add(t);
  for (const t of toArray(f?.terms)) add(t);
  // Variante sin acentos de cada candidata: si difiere como cadena, CIMA la trata como otra busqueda.
  for (const v of [...out]) {
    const sinAcentos = v.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (sinAcentos !== v) out.add(sinAcentos);
  }
  return [...out];
}

// Cuenta sin traer resultados: tamanioPagina=1 y leemos totalFilas.
async function contarEnFicha(texto) {
  const body = JSON.stringify([{ seccion: '4.1', texto, contiene: 1 }]);
  const d = await postCima('/buscarEnFichaTecnica', { comerc: '1', tamanioPagina: '1', pagina: '1' }, body);
  return d?.totalFilas ?? 0;
}

// Conjunto de nregistros de una busqueda (para medir solapamiento real, no solo conteos).
async function idsEnFicha(texto) {
  const meds = await buscarFichaTecnica('4.1', texto);
  return new Set(meds.map(m => m.nregistro).filter(Boolean));
}

async function probeAnchorsFor(entries) {
  const filas = [];
  for (const [term, entry] of entries) {
    const candidatas = anchorCandidates(term, entry);
    const actual = normalizeAnchor(entry.reconcileAnchor);
    const conteos = [];
    for (const c of candidatas) {
      try {
        conteos.push({ texto: c, n: await contarEnFicha(c) });
      } catch (error) {
        // n:null ya no se omite en silencio: una candidata no medible deja el preflight de esta
        // entrada sin certificar (antes podia acabar mostrando "ok" y devolviendo exit 0).
        conteos.push({ texto: c, n: null, error: error.message });
        inconclusive.push(`preflight "${term}": candidata "${c}" no medible (${error.message})`);
      }
    }
    conteos.sort((a, b) => (b.n ?? -1) - (a.n ?? -1));

    // Solo para las entradas YA ancladas medimos huerfanos de verdad (con los nregistro), que es
    // donde la precision importa y donde el coste es asumible: un universo publicado que se esta
    // perdiendo productos es un fallo en vivo, no una sugerencia de curacion.
    let huerfanos = null;
    if (actual) {
      try {
        const cubierto = new Set();
        for (const a of actual) for (const id of await idsEnFicha(a)) cubierto.add(id);
        // Un huerfano solo es CIEGO (bloquea) si la capa de verificacion habria aceptado esos
        // productos: es decir, si esa escritura esta en reconcileTerms o en el filtro 4.1. Si no
        // lo esta, los productos se descartarian igualmente al verificar y el huerfano es solo
        // informativo. Sin esta distincion el gate bloquea por ruido y se acaba ignorando.
        const f = entry.section41Filter || entry.sectionFilter;
        const aceptadas = new Set([
          ...toArray(entry.reconcileTerms),
          ...toArray(f?.includeAny),
          ...toArray(f?.terms)
        ].map(normalize));
        huerfanos = [];
        for (const { texto, n } of conteos) {
          if (!n || actual.includes(texto)) continue;
          const ids = await idsEnFicha(texto);
          const fuera = [...ids].filter(id => !cubierto.has(id));
          if (fuera.length) huerfanos.push({ texto, fuera: fuera.length, total: ids.size, ciego: aceptadas.has(normalize(texto)) });
        }
      } catch (error) {
        // "?? no se pudo medir" sin consecuencia era un gate que fallaba abierto: el preflight
        // de una entrada YA anclada que no se puede medir deja la ejecución inconclusa (exit 2).
        huerfanos = null;
        inconclusive.push(`preflight "${term}": huérfanos no medibles (${error.message})`);
      }
    }
    filas.push({ term, actual, conteos, huerfanos });
  }
  return filas;
}

// Un ancla puede declararse como string (retrocompat) o como array de variantes de escritura.
// Devuelve siempre array (o null), sin duplicados ni vacios.
function normalizeAnchor(value) {
  const list = (Array.isArray(value) ? value : [value])
    .filter(v => typeof v === 'string' && v.trim())
    .map(v => v.trim());
  return list.length ? [...new Set(list)] : null;
}

// Fraseologia para la busqueda en 4.1: preferimos terminos curados especificos (reconcileTerms),
// luego los del filtro; como ultimo recurso el propio termino (menos fiable, se marca en el informe).
function reconcileTermsFor(term, entry) {
  const f = entry.section41Filter || entry.sectionFilter;
  // El ancla (opcional) solo tiene sentido con fraseologia precisa que verificar sobre el texto real.
  // Admite VARIAS variantes de escritura (array): buscarEnFichaTecnica es literal con los acentos
  // ("insuficiencia cardiaca"=527 vs "insuficiencia cardíaca"=64, conjuntos distintos), asi que el
  // universo se recluta como UNION de variantes. Ver el modo de fallo 4 en ontology-refresh.md.
  const anchor = normalizeAnchor(entry.reconcileAnchor);
  if (Array.isArray(entry.reconcileTerms) && entry.reconcileTerms.length) {
    return { terms: entry.reconcileTerms, source: 'reconcileTerms', anchor };
  }
  if (f && Array.isArray(f.includeAny) && f.includeAny.length) {
    return { terms: f.includeAny, source: 'section41Filter.includeAny', anchor };
  }
  if (f && Array.isArray(f.terms) && f.terms.length) {
    return { terms: f.terms, source: 'section41Filter.terms', anchor };
  }
  return { terms: [term], source: 'fallback:term', anchor };
}

// ---- Baseline de descartes de reconciliacion --------------------------------------------------
// Memoria versionada de los GAPS ya revisados por un humano: los clasificados (accepted = fuera de
// alcance / falso positivo del texto; curated = ya cubierto) se silencian, para que un barrido
// futuro SOLO destaque GAPS NUEVOS (p. ej. un nuevo iSGLT2 autorizado para ERC). Eso es lo que hace
// la red de seguridad "automantenida": alerta de novedades, no repite el ruido conocido.
async function loadBaseline() {
  try {
    const raw = await fs.readFile(baselinePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { version: null, terms: {} };
  } catch {
    return { version: null, terms: {} };
  }
}

function baselineEntryFor(term) {
  const t = baseline.terms || {};
  return t[term] || t[normalize(term)] || null;
}

// Huella FNV-1a de una cadena (hex, 8 chars). Suficiente para detectar "esto cambió desde la
// revisión humana"; no es criptográfica ni lo necesita.
function fingerprint(value) {
  let h = 0x811c9dc5;
  const s = String(value || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Huella de la configuración de la entrada que afecta a la reconciliación: si el humano aceptó un
// GAP con una configuración y esta cambia, la aceptación deja de valer y el caso se reabre.
function entryConfigHash(entry) {
  const f = entry.section41Filter || entry.sectionFilter || null;
  return fingerprint(JSON.stringify({
    atc: toAtcList(entry).map(a => String(a).toUpperCase()).sort(),
    filter: f,
    reconcileTerms: toArray(entry.reconcileTerms),
    anchor: normalizeAnchor(entry.reconcileAnchor)
  }));
}

function daysSince(isoDate) {
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// Máquina de estados del baseline (revisión cruzada 2026-07-23). Para un GAP aún PRESENTE:
//   review    → bloquea siempre (pendiente de humano; aparecer en el baseline no es revisión).
//   accepted  → único estado que silencia, y solo si la aceptación sigue vigente (ver abajo).
//   curated   → bloquea: significaba "ya cubierto por ATC/filtro"; si reaparece, la cura falló.
//   otro/ausente → bloquea por error de esquema.
// Vigencia de un accepted: reason no vacío, fecha de revisión (reviewedAt, o la version del
// archivo para registros legacy) con antigüedad <= ACCEPTED_MAX_AGE_DAYS, y huellas coherentes:
// si el registro guarda configHash/hash41 y difieren de los actuales, la entrada o la 4.1
// cambiaron desde la revisión → se reabre. Los registros legacy sin huella valen hasta caducar.
function acceptedBlockReason(gapRecord, termRecord, currentHash41, currentConfigHash) {
  if (!String(gapRecord.reason || '').trim()) return 'accepted sin reason (esquema)';
  const reviewedAt = gapRecord.reviewedAt || baseline.version || null;
  if (!reviewedAt) return 'accepted sin fecha de revisión (esquema)';
  const age = daysSince(reviewedAt);
  if (age === null) return `accepted con fecha ilegible "${reviewedAt}"`;
  if (age > ACCEPTED_MAX_AGE_DAYS) return `accepted caducado (${age} días > ${ACCEPTED_MAX_AGE_DAYS}; renovar revisión humana)`;
  const legacy = !gapRecord.hash41 && !termRecord?.configHash;
  if (!legacy) {
    if (!String(gapRecord.reviewedBy || '').trim()) return 'accepted sin responsable (reviewedBy)';
    if (termRecord?.configHash && currentConfigHash && termRecord.configHash !== currentConfigHash) {
      return 'la configuración de la entrada cambió desde la revisión (reabrir)';
    }
    if (gapRecord.hash41 && currentHash41 && gapRecord.hash41 !== currentHash41) {
      return 'el texto 4.1 cambió desde la revisión (reabrir)';
    }
  }
  return null;
}

function classifyGapsAgainstBaseline(row, entry) {
  const known = baselineEntryFor(row.term);
  const currentConfigHash = entry ? entryConfigHash(entry) : null;
  row.newGaps = [];
  row.knownGaps = [];
  row.blockedGaps = []; // [gap, motivo]
  for (const gap of row.gaps) {
    const [nr, , , , hash41] = gap;
    const record = known?.gaps?.[String(nr)];
    if (!record) { row.newGaps.push(gap); continue; }
    const status = record.status;
    if (status === 'accepted') {
      const motivo = acceptedBlockReason(record, known, hash41, currentConfigHash);
      if (motivo) row.blockedGaps.push([gap, motivo]);
      else row.knownGaps.push(gap);
    } else if (status === 'curated') {
      row.blockedGaps.push([gap, 'curated pero el GAP ha REAPARECIDO: la cura (ATC/filtro) ya no lo cubre']);
    } else if (status === 'review') {
      row.blockedGaps.push([gap, 'pendiente de revisión humana (review): estar en el baseline no lo silencia']);
    } else {
      row.blockedGaps.push([gap, `status desconocido "${status}" (esquema)`]);
    }
  }
}

async function writeBaseline(rows) {
  // --update-baseline solo puede CREAR estados 'review' o REABRIR como 'review' aceptaciones cuya
  // huella ya no coincide. Nunca acepta automáticamente: mover un gap a accepted/curated (con
  // reason, reviewedAt y reviewedBy) es siempre un acto humano sobre el JSON.
  const next = {
    version: today(),
    generatedBy: 'medcheck-audit-ontology --update-baseline',
    // Preserva la documentación editada a mano (si no, se perdería en cada regeneración).
    ...(baseline._doc ? { _doc: baseline._doc } : {}),
    terms: { ...(baseline.terms || {}) }
  };
  for (const row of rows) {
    const entry = terms[row.term] || {};
    const configHash = entryConfigHash(entry);
    const prevTerm = next.terms[row.term] || baselineEntryFor(row.term) || {};
    const gaps = { ...(prevTerm.gaps || {}) };
    for (const [nr, nombre, vtm, , hash41] of row.gaps) {
      const existing = gaps[nr];
      if (!existing) {
        gaps[nr] = {
          status: 'review',
          nombre,
          vtm: vtm || undefined,
          reason: '',
          detectedAt: today(),
          ...(hash41 ? { hash41 } : {})
        };
        continue;
      }
      if (!existing.nombre) existing.nombre = nombre;
      if (!existing.vtm && vtm) existing.vtm = vtm;
      // Reapertura por huella: la aceptación se hizo sobre otra configuración u otra 4.1.
      if (existing.status === 'accepted') {
        const motivo = acceptedBlockReason(existing, prevTerm, hash41, configHash);
        if (motivo && (motivo.includes('cambió') || motivo.includes('caducado'))) {
          existing.status = 'review';
          existing.reopened = `${motivo} (${today()})`;
          if (hash41) existing.hash41 = hash41;
        }
      }
    }
    next.terms[row.term] = { anchor: row.anchor || null, configHash, gaps };
  }
  await fs.writeFile(baselinePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`\n[baseline] escrito ${path.relative(repoRoot, baselinePath)} (${rows.length} entradas)`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function reconcileEntry(term, entry) {
  // Motivos por los que ESTA fila no puede certificar nada (se agregan al exit 2 global).
  const inconcluso = [];
  // Conjunto ATC: lo que MedCheck devuelve hoy (por nregistro). Si la red se agota aquí, el
  // universo ATC es desconocido y TODO lo que salga en 4.1 parecería GAP: fila inconclusa entera.
  let atcMeds = [];
  try {
    atcMeds = await searchEntry(entry);
  } catch (error) {
    inconcluso.push(`universo ATC no medible: ${error.message}`);
    return { term, source: 'n/a', anchor: null, atc: 0, ft: 0, perTerm: [], gaps: [], extra: 0, anchorErrors: [], inconcluso, newGaps: [], knownGaps: [], blockedGaps: [] };
  }
  const atcIds = new Set(atcMeds.map(m => m.nregistro).filter(Boolean));

  // Conjunto verdad (la 4.1 = verdad legal). Dos motores:
  //  - anchor: si la entrada declara reconcileAnchor, acotamos el universo con un termino AMPLIO
  //    server-side (buscarEnFichaTecnica, barato) y verificamos la fraseologia PRECISA sobre el texto
  //    real (docSegmentado decodificado, regex inicio-palabra = MISMO criterio que el runtime). Es el
  //    unico modo que ve fraseos que buscarEnFichaTecnica NO indexa (p. ej. "enfermedad renal cronica"
  //    devuelve 0 server-side pese a estar en la 4.1 de los iSGLT2 -> el caso que motivó esto).
  //  - directo (retrocompat): sin ancla, cuenta con buscarEnFichaTecnica por cada fraseo.
  const { terms, source, anchor } = reconcileTermsFor(term, entry);
  const txt = new Map(); // nregistro -> { nombre, vtm, excerpt }
  const perTerm = [];
  const anchorErrors = [];
  if (anchor) {
    // Universo = UNION de las variantes del ancla, deduplicada por nregistro (una misma ficha
    // puede caer en varias variantes; descargarla dos veces solo cuesta red).
    const universoMap = new Map();
    for (const variante of anchor) {
      let parcial = [];
      try {
        parcial = await buscarFichaTecnica('4.1', variante);
      } catch (error) {
        // NO tragarse el error: un 429/500 agotado dejaria el universo vacio y el reconcile
        // informaria "0 GAPS" estando ciego. Red agotada = fila INCONCLUSA (exit 2: repetir);
        // no es lo mismo que un ancla que recluta 0 (fraseo mal escrito, exit 1: corregir).
        inconcluso.push(`ancla "${variante}": ${error.message}`);
        continue;
      }
      const nuevos = parcial.filter(m => m.nregistro && !universoMap.has(m.nregistro)).length;
      for (const m of parcial) if (m.nregistro) universoMap.set(m.nregistro, m);
      perTerm.push(`ancla "${variante}"=${parcial.length}${anchor.length > 1 ? ` (+${nuevos} nuevos)` : ''}`);
      // Un ancla que no recluta nada es casi siempre un fallo de escritura (acento/fraseo), no
      // una ausencia clinica: sin universo, el reconcile diria "0 GAPS" estando ciego.
      if (!parcial.length) {
        anchorErrors.push(`ancla "${variante}": 0 productos reclutados (¿acento o fraseo?)`);
      }
    }
    const universo = [...universoMap.values()];
    if (anchor.length > 1) perTerm.push(`universo union=${universo.length}`);
    const normalizedTerms = terms.map(normalize);
    let matched = 0;
    let unknownTexts = 0;
    const unknownReasons = new Set();
    for (const m of universo) {
      if (!m.nregistro) continue;
      const seccion = await fetchSectionText(m.nregistro, '4.1');
      if (seccion.status === 'unknown') {
        // Sin el texto no se sabe si este producto es un GAP: la fila no puede certificar "0".
        unknownTexts += 1;
        unknownReasons.add(seccion.reason || 'motivo desconocido');
        continue;
      }
      const rawText = seccion.text.replace(/<[^>]*>/g, ' ');
      const text = normalize(rawText);
      const hitTerm = normalizedTerms.find(t => termInText(text, t));
      if (hitTerm) {
        txt.set(m.nregistro, { nombre: m.nombre, vtm: m.vtm?.nombre || m.nombre, excerpt: excerptAround(rawText, hitTerm), hash41: fingerprint(text) });
        matched += 1;
      }
    }
    if (unknownTexts > 0) {
      const motivo = [...unknownReasons].slice(0, 3).join(' · ');
      inconcluso.push(`${unknownTexts} ficha(s) 4.1 no verificables tras reintentos (${motivo})`);
    }
    perTerm.push(`verdad(${terms.join('|')})=${matched}`);
  } else {
    for (const t of terms) {
      let meds = [];
      try {
        meds = await buscarFichaTecnica('4.1', t);
      } catch (error) {
        // Antes: "${t}=ERR" y seguir, con lo que la fila podia terminar en "GAPS NUEVOS = 0"
        // habiendose saltado un fraseo entero. Red agotada = fila inconclusa.
        inconcluso.push(`fraseo "${t}": ${error.message}`);
        perTerm.push(`${t}=??`);
        continue;
      }
      perTerm.push(`${t}=${meds.length}`);
      for (const m of meds) {
        if (!m.nregistro) continue;
        // Este modo (retrocompat, sin ancla) no descarga el texto completo de la 4.1
        // (buscarEnFichaTecnica solo confirma la coincidencia server-side) — sin excerpt ni hash.
        txt.set(m.nregistro, { nombre: m.nombre, vtm: m.vtm?.nombre || m.nombre, excerpt: '', hash41: null });
      }
    }
  }
  const gaps = [...txt.entries()].map(([nr, v]) => [nr, v.nombre, v.vtm, v.excerpt, v.hash41]).filter(([nr]) => !atcIds.has(nr));
  const extra = atcMeds.filter(m => m.nregistro && !txt.has(m.nregistro)).length;
  // newGaps/knownGaps/blockedGaps los rellena classifyGapsAgainstBaseline.
  return { term, source, anchor, atc: atcIds.size, ft: txt.size, perTerm, gaps, extra, anchorErrors, inconcluso, newGaps: [], knownGaps: [], blockedGaps: [] };
}

async function countSectionMatches(meds, filter) {
  const section = filter.section || '4.1';
  const includeAny = toArray(filter.includeAny || filter.terms).map(normalize);
  const includeAll = toArray(filter.includeAll).map(normalize);
  const excludeAny = toArray(filter.excludeAny).map(normalize);
  let matched = 0;
  let unknown = 0;

  // Métrica INFORMATIVA (--live): un fallo puntual no invalida la ejecución, pero se cuenta y se
  // reporta aparte — un "0 coincidencias" con la mitad de fichas ilegibles no es un cero real.
  for (const med of meds) {
    const seccion = await fetchSectionText(med.nregistro, section);
    if (seccion.status === 'unknown') { unknown += 1; continue; }
    if (!seccion.text) continue;
    const normalizedText = normalize(seccion.text.replace(/<[^>]*>/g, ' '));
    const okAll = includeAll.length === 0 || includeAll.every(term => termInText(normalizedText, term));
    const okAny = includeAny.length === 0 || includeAny.some(term => termInText(normalizedText, term));
    const okExclude = excludeAny.length === 0 || !excludeAny.some(term => termInText(normalizedText, term));
    if (okAll && okAny && okExclude) matched += 1;
  }
  return { matched, unknown };
}

// Mismo criterio que CimaAPI._sectionTermInText: coincidencia al inicio de palabra
// (evita que 'recto' case en 'directo' o 'renal' en 'suprarrenal').
function termInText(text, term) {
  if (!term) return false;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}`).test(text);
}

// Extracto legible alrededor de la primera mencion del termino, para que un GAP se pueda
// adjudicar (indicacion real vs. mencion incidental de contraindicacion/factor de riesgo,
// ver ontology-refresh.md "modo de fallo: mencion contextual") sin abrir la ficha a mano.
function excerptAround(rawText, term, radius = 90) {
  if (!rawText || !term) return '';
  const idx = normalize(rawText).indexOf(normalize(term));
  if (idx < 0) return rawText.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(rawText.length, idx + term.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < rawText.length ? '…' : '';
  return (prefix + rawText.slice(start, end) + suffix).replace(/\s+/g, ' ').trim();
}

// Resultado TERNARIO, nunca texto vacío ambiguo: 'success' (texto obtenido), 'absent' (la ficha
// no tiene esa sección: 204/404, ausencia real) o 'unknown' (red agotada o respuesta inválida:
// NO se sabe qué dice la 4.1, y tratarlo como vacío certificaba GAPS=0 estando ciego).
async function fetchSectionText(nregistro, section) {
  // El endpoint docSegmentado devuelve a veces JSON (array de secciones) y a veces texto/HTML.
  // Replicamos a CimaAPI.getDocSeccion: leer texto y parsear con fallback (fetchCima haría
  // response.json() y tragaria el texto plano como '', subcontando coincidencias).
  try {
    const url = new URL(`${CIMA_BASE}/docSegmentado/contenido/1`);
    url.searchParams.set('nregistro', nregistro);
    url.searchParams.set('seccion', section);
    const r = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
    if (r.status === 204 || r.status === 404) return { status: 'absent', text: '' };
    if (!r.ok) return { status: 'unknown', text: '', reason: `HTTP ${r.status}` };
    const raw = await r.text();
    if (!raw) return { status: 'absent', text: '' };
    let data;
    try { data = JSON.parse(raw); } catch { return { status: 'success', text: decodeEntities(raw) }; }
    if (Array.isArray(data)) {
      return { status: 'success', text: decodeEntities(data.map(item => `${item.titulo || ''} ${item.contenido || ''}`).join(' ')) };
    }
    return { status: 'success', text: decodeEntities(typeof data === 'string' ? data : raw) };
  } catch (error) {
    return { status: 'unknown', text: '', reason: error.message };
  }
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function printReport() {
  console.log('# MedCheck Ontology Audit');
  console.log('');
  console.log(`- Ontology: ${path.relative(repoRoot, ontologyPath)}`);
  console.log(`- Version: ${ontology.version || 'n/a'}`);
  console.log(`- Reviewed: ${ontology.metadata?.lastReviewed || 'n/a'}`);
  console.log(`- Live CIMA check: ${live ? 'yes' : 'no'}`);
  console.log('');
  console.log('## Counts');
  for (const [key, value] of Object.entries(stats)) console.log(`- ${key}: ${value}`);
  console.log('');
  printList('## Structural Problems', problems);
  printList('## Warnings', warnings);
  printList('## Cross-Entry Terms/Synonyms To Review', duplicateTerms);
  printList('## Candidate Missing Terms', missingExpected);

  if (live) {
    const noResults = liveRows.filter(row => row.total === 0).map(row => `${row.term} (${row.atc})`);
    const tooMany = liveRows.filter(row => row.total > tooManyThreshold).map(row => `${row.term}: ${row.total}`);
    const biosimilarRows = liveRows.filter(row => row.biosimilars > 0).map(row => `${row.term}: ${row.biosimilars}/${row.total}`);
    const zeroSection = sectionRows.filter(row => row.checked > 0 && row.matched === 0).map(row => `${row.term}: 0/${row.checked} de ${row.candidates}`);
    printList('## Live No-Result Entries', noResults);
    printList(`## Live Broad Entries Over ${tooManyThreshold}`, tooMany);
    printList('## Live Biosimilar Signals', biosimilarRows);
    printList('## Section 4.1 Filters Returning Zero', zeroSection);
  }

  if (probeAnchors) {
    console.log('## Preflight de anclas (sondeo barato, sin descargar fichas)');
    console.log('(buscarEnFichaTecnica compara LITERALMENTE, acentos incluidos: dos escrituras del');
    console.log(' mismo termino son dos universos distintos. HUERFANA = recluta productos que el');
    console.log(' ancla actual NO ve -> ese reconcile esta ciego y BLOQUEA.)');
    console.log('');
    const conAncla = probeRows.filter(r => r.actual);
    const sinAncla = probeRows.filter(r => !r.actual);

    if (conAncla.length) {
      console.log('### Entradas ya ancladas');
      for (const r of conAncla) {
        const ciegas = (r.huerfanos || []).filter(h => h.ciego);
        const estado = r.huerfanos === null
          ? '?? no se pudo medir'
          : (ciegas.length ? '!! CIEGA (bloquea)' : 'ok');
        console.log(`- ${r.term} [ancla: ${r.actual.join(' | ')}] ${estado}`);
        for (const h of ciegas) {
          console.log(`    !! "${h.texto}" esta en la fraseologia que se verifica, recluta ${h.total} y ${h.fuera} quedan FUERA del universo — nunca se comprueban`);
        }
        for (const h of (r.huerfanos || []).filter(h => !h.ciego)) {
          console.log(`    ·  "${h.texto}" reclutaria ${h.fuera} productos nuevos, pero esa escritura no se verifica (informativo: amplia reconcileTerms si deberia contar)`);
        }
      }
      console.log('');
    }

    if (sinAncla.length) {
      console.log('### Entradas sin ancla — candidatas ordenadas por cobertura');
      console.log('(elige la que recluta un universo amplio y plausible; un 0 casi siempre es');
      console.log(' acento o fraseo, no ausencia clinica — verificalo antes de darlo por bueno)');
      for (const r of sinAncla) {
        const vivas = r.conteos.filter(c => c.n);
        const ceros = r.conteos.filter(c => c.n === 0).map(c => c.texto);
        const trunca = vivas.filter(c => c.n > FT_MAX_PAGES * 100).map(c => `${c.texto}=${c.n}`);
        if (!vivas.length) {
          console.log(`- ${r.term}: NINGUNA candidata recluta nada — requiere fraseo a mano`);
          continue;
        }
        console.log(`- ${r.term}: ${vivas.slice(0, 4).map(c => `"${c.texto}"=${c.n}`).join(', ')}`);
        if (ceros.length) console.log(`      (0 productos: ${ceros.slice(0, 4).join(', ')})`);
        if (trunca.length) console.log(`      !! supera el tope de paginacion: ${trunca.join(', ')}`);
      }
      console.log('');
    }
  }

  if (reconcile || updateBaseline) {
    console.log('## Reconciliation: ATC vs ficha tecnica 4.1');
    console.log('(GAPS = farmacos con la indicacion en su 4.1 que el ATC NO captura. NEW = no clasificados');
    console.log(' en el baseline (bloquean el gate); KNOWN = ya revisados/aceptados en reconcile-baseline.json.)');
    console.log('');
    if (!reconcileRows.length) {
      console.log('- none');
      console.log('');
    }
    for (const r of reconcileRows) {
      const mode = r.anchor ? 'ancla+texto real' : 'buscarEnFichaTecnica';
      console.log(`- ${r.term} [${r.source} · ${mode}] ATC=${r.atc} 4.1=${r.ft} extra(ATC sin 4.1)=${r.extra}`);
      console.log(`    terms: ${r.perTerm.join(', ')}`);
      if (r.inconcluso.length) {
        // Una fila inconclusa nunca certifica un "0": ni GAPS NUEVOS = 0 ni universo completo.
        console.log('    ?? FILA INCONCLUSA (exit 2: repetir la pasada) — lo no medido NO cuenta como limpio:');
        for (const motivo of r.inconcluso) console.log(`       - ${motivo}`);
      }
      if (r.anchorErrors.length) {
        // No decir "0 GAPS" cuando no se ha podido mirar: distinguir "limpio" de "ciego".
        console.log('    !! RECONCILIACION INVALIDA (universo del ancla vacio) — NO es un "sin GAPS":');
        for (const e of r.anchorErrors) console.log(`       - ${e}`);
        console.log('       Revisa acentos/fraseo del ancla contra CIMA.');
        continue;
      }
      if (r.blockedGaps.length) {
        console.log(`    GAPS BLOQUEADOS por el baseline = ${r.blockedGaps.length}:`);
        for (const [[nr, nombre], motivo] of r.blockedGaps.slice(0, 10)) {
          console.log(`      !! ${nombre} (nregistro ${nr}): ${motivo}`);
        }
        if (r.blockedGaps.length > 10) console.log(`      ... (+${r.blockedGaps.length - 10} más)`);
      }
      if (r.newGaps.length) {
        // Agrupar por principio activo (vtm): un GAP de 119 presentaciones suele ser
        // 10-15 sustancias con muchas dosis/marcas cada una — la unidad de decision
        // clinica es la sustancia, no el envase. Reduce el ruido visual ~80-90%.
        const byVtm = new Map();
        for (const [nr, nombre, vtm, excerpt] of r.newGaps) {
          const key = vtm || nombre;
          if (!byVtm.has(key)) byVtm.set(key, { count: 0, sample: nombre, nregs: [], excerpt });
          const g = byVtm.get(key);
          g.count += 1;
          g.nregs.push(nr);
        }
        console.log(`    GAPS NUEVOS (sin clasificar, BLOQUEAN) = ${r.newGaps.length} presentaciones en ${byVtm.size} principios activos:`);
        const groups = [...byVtm.entries()].sort((a, b) => b[1].count - a[1].count);
        for (const [vtm, g] of groups.slice(0, 15)) {
          const nregSample = g.nregs.slice(0, 3).join(',') + (g.nregs.length > 3 ? '…' : '');
          console.log(`      ! ${vtm} (${g.count}x, p.ej. "${g.sample}", nregistro ${nregSample})`);
          if (g.excerpt) console.log(`          4.1: "${g.excerpt}"`);
        }
        if (groups.length > 15) console.log(`      ... (+${groups.length - 15} principios activos mas)`);
      } else if (!r.inconcluso.length) {
        console.log('    GAPS NUEVOS = 0');
      }
      if (r.knownGaps.length) {
        console.log(`    GAPS conocidos (accepted vigente en baseline) = ${r.knownGaps.length}`);
      }
    }
    if (newGapCount > 0 && !updateBaseline) {
      console.log('');
      console.log(`>> ${newGapCount} GAP(s) nuevo(s): cura la entrada (ampliar ATC/filtro) o registralos en`);
      console.log('   reconcile-baseline.json con motivo (o corre --update-baseline y clasifica los "review").');
    }
    if (blockedGapCount > 0) {
      console.log('');
      console.log(`>> ${blockedGapCount} GAP(s) bloqueado(s) por el baseline: revisa los 'review' pendientes, las`);
      console.log("   curas reaparecidas ('curated') y los 'accepted' caducados o con huella desfasada.");
    }
    console.log('');
  }

  if (inconclusive.length) {
    console.log('## Ejecución INCONCLUSA — lo no medido no cuenta como limpio');
    console.log('(exit 2 salvo que además haya problemas deterministas, que ganan con exit 1.');
    console.log(' Significa "repite la pasada", no "el producto está mal". Nunca escribe baseline.)');
    console.log('');
    for (const motivo of inconclusive) console.log(`- ${motivo}`);
    console.log('');
  }
}

function printList(title, values) {
  console.log(title);
  if (!values.length) {
    console.log('- none');
    console.log('');
    return;
  }
  for (const value of values) console.log(`- ${value}`);
  console.log('');
}
