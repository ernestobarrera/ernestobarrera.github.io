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
const updateBaseline = args.has('--update-baseline');
const baselinePath = path.join(repoRoot, 'assets', 'data', 'reconcile-baseline.json');
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
const duplicateTerms = [...duplicateIndex.entries()]
  .map(([key, refs]) => {
    const owners = new Set(refs.map(ref => ref.owner));
    if (owners.size <= 1) return null;
    // Ruido inofensivo: si todos los dueños apuntan al MISMO ATC, el solapamiento de
    // sinónimos no cambia el resultado de la búsqueda. Solo señalamos divergencias reales.
    if (new Set([...owners].map(atcSignature)).size <= 1) return null;
    return `${key}: ${refs.map(ref => ref.label).join(', ')}`;
  })
  .filter(Boolean);

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
    const meds = await searchEntry(entry);
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
      const matched = await countSectionMatches(checked, sectionFilter);
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
let invalidReconcileCount = 0;
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
    classifyGapsAgainstBaseline(row);
    newGapCount += row.newGaps.length;
    invalidReconcileCount += row.anchorErrors.length ? 1 : 0;
    reconcileRows.push(row);
  }
  // Solo se persisten las filas con universo valido: escribir el baseline desde una pasada ciega
  // consolidaria un "sin GAPS" falso como si fuera revision humana.
  if (updateBaseline) await writeBaseline(reconcileRows.filter(r => !r.anchorErrors.length));
}

printReport();
// Gate pre-publicacion: un GAP NUEVO no clasificado en el baseline bloquea (como los problemas
// estructurales). Se resuelve curando (ampliar ATC/filtro) o registrandolo en el baseline con motivo.
// Una reconciliacion INVALIDA (ancla sin universo: error de red o fraseo) tambien bloquea: su "0
// GAPS" no es una comprobacion superada, es una comprobacion que no se ha hecho.
if (problems.length > 0 || newGapCount > 0 || invalidReconcileCount > 0) process.exitCode = 1;

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
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa',
  Aacute: '\u00c1', Eacute: '\u00c9', Iacute: '\u00cd', Oacute: '\u00d3', Uacute: '\u00da',
  ntilde: '\u00f1', Ntilde: '\u00d1', uuml: '\u00fc', Uuml: '\u00dc', ordm: '\u00ba', ordf: '\u00aa', deg: '\u00b0'
};
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

async function fetchCima(endpoint, params) {
  const url = new URL(`${CIMA_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`CIMA ${response.status} ${url}`);
  return response.json();
}

async function postCima(endpoint, params, body) {
  const url = new URL(`${CIMA_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`CIMA ${response.status} ${url}`);
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
    console.warn(`[AVISO] "${texto}" en ${section}: ${total} filas y solo se traen ${pages * 100} — universo TRUNCADO, el reconcile puede perder GAPS. Acota el ancla o sube FT_MAX_PAGES.`);
  }
  return out;
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

function classifyGapsAgainstBaseline(row) {
  const known = baselineEntryFor(row.term);
  const accepted = new Set(Object.keys(known?.gaps || {}));
  row.newGaps = row.gaps.filter(([nr]) => !accepted.has(String(nr)));
  row.knownGaps = row.gaps.filter(([nr]) => accepted.has(String(nr)));
}

async function writeBaseline(rows) {
  // Preserva las clasificaciones existentes (no degrada un "accepted" a "review"); añade los GAPS
  // nuevos como "review" para que el humano los mueva a accepted/curated con motivo.
  const next = {
    version: today(),
    generatedBy: 'medcheck-audit-ontology --update-baseline',
    // Preserva la documentación editada a mano (si no, se perdería en cada regeneración).
    ...(baseline._doc ? { _doc: baseline._doc } : {}),
    terms: { ...(baseline.terms || {}) }
  };
  for (const row of rows) {
    const prev = next.terms[row.term]?.gaps || baselineEntryFor(row.term)?.gaps || {};
    const gaps = { ...prev };
    for (const [nr, nombre, vtm] of row.gaps) {
      if (!gaps[nr]) gaps[nr] = { status: 'review', nombre, vtm: vtm || undefined, reason: '' };
      else {
        if (!gaps[nr].nombre) gaps[nr].nombre = nombre;
        if (!gaps[nr].vtm && vtm) gaps[nr].vtm = vtm;
      }
    }
    next.terms[row.term] = { anchor: row.anchor || null, gaps };
  }
  await fs.writeFile(baselinePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log(`\n[baseline] escrito ${path.relative(repoRoot, baselinePath)} (${rows.length} entradas)`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function reconcileEntry(term, entry) {
  // Conjunto ATC: lo que MedCheck devuelve hoy (por nregistro).
  const atcMeds = await searchEntry(entry);
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
        // NO tragarse el error: un 429/500 transitorio dejaria el universo vacio y el reconcile
        // informaria "0 GAPS" estando ciego, que es indistinguible de "todo correcto". Se marca
        // la fila como invalida para que bloquee el gate.
        anchorErrors.push(`ancla "${variante}": ${error.message}`);
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
    for (const m of universo) {
      if (!m.nregistro) continue;
      const rawText = (await fetchSectionText(m.nregistro, '4.1')).replace(/<[^>]*>/g, ' ');
      const text = normalize(rawText);
      const hitTerm = normalizedTerms.find(t => termInText(text, t));
      if (hitTerm) {
        txt.set(m.nregistro, { nombre: m.nombre, vtm: m.vtm?.nombre || m.nombre, excerpt: excerptAround(rawText, hitTerm) });
        matched += 1;
      }
    }
    perTerm.push(`verdad(${terms.join('|')})=${matched}`);
  } else {
    for (const t of terms) {
      let meds = [];
      try {
        meds = await buscarFichaTecnica('4.1', t);
      } catch (error) {
        perTerm.push(`${t}=ERR`);
        continue;
      }
      perTerm.push(`${t}=${meds.length}`);
      for (const m of meds) {
        if (!m.nregistro) continue;
        // Este modo (retrocompat, sin ancla) no descarga el texto completo de la 4.1
        // (buscarEnFichaTecnica solo confirma la coincidencia server-side) — sin excerpt honesto.
        txt.set(m.nregistro, { nombre: m.nombre, vtm: m.vtm?.nombre || m.nombre, excerpt: '' });
      }
    }
  }
  const gaps = [...txt.entries()].map(([nr, v]) => [nr, v.nombre, v.vtm, v.excerpt]).filter(([nr]) => !atcIds.has(nr));
  const extra = atcMeds.filter(m => m.nregistro && !txt.has(m.nregistro)).length;
  // newGaps/knownGaps los rellena classifyGapsAgainstBaseline.
  return { term, source, anchor, atc: atcIds.size, ft: txt.size, perTerm, gaps, extra, anchorErrors, newGaps: [], knownGaps: [] };
}

async function countSectionMatches(meds, filter) {
  const section = filter.section || '4.1';
  const includeAny = toArray(filter.includeAny || filter.terms).map(normalize);
  const includeAll = toArray(filter.includeAll).map(normalize);
  const excludeAny = toArray(filter.excludeAny).map(normalize);
  let matched = 0;

  for (const med of meds) {
    const text = await fetchSectionText(med.nregistro, section);
    if (!text) continue;
    const normalizedText = normalize(text.replace(/<[^>]*>/g, ' '));
    const okAll = includeAll.length === 0 || includeAll.every(term => termInText(normalizedText, term));
    const okAny = includeAny.length === 0 || includeAny.some(term => termInText(normalizedText, term));
    const okExclude = excludeAny.length === 0 || !excludeAny.some(term => termInText(normalizedText, term));
    if (okAll && okAny && okExclude) matched += 1;
  }
  return matched;
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

async function fetchSectionText(nregistro, section) {
  // El endpoint docSegmentado devuelve a veces JSON (array de secciones) y a veces texto/HTML.
  // Replicamos a CimaAPI.getDocSeccion: leer texto y parsear con fallback (fetchCima haría
  // response.json() y tragaria el texto plano como '', subcontando coincidencias).
  try {
    const url = new URL(`${CIMA_BASE}/docSegmentado/contenido/1`);
    url.searchParams.set('nregistro', nregistro);
    url.searchParams.set('seccion', section);
    const r = await fetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return '';
    const raw = await r.text();
    if (!raw) return '';
    let data;
    try { data = JSON.parse(raw); } catch { return decodeEntities(raw); }
    if (Array.isArray(data)) return decodeEntities(data.map(item => `${item.titulo || ''} ${item.contenido || ''}`).join(' '));
    return decodeEntities(typeof data === 'string' ? data : raw);
  } catch {
    return '';
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
      if (r.anchorErrors.length) {
        // No decir "0 GAPS" cuando no se ha podido mirar: distinguir "limpio" de "ciego".
        console.log('    !! RECONCILIACION INVALIDA (universo del ancla vacio) — NO es un "sin GAPS":');
        for (const e of r.anchorErrors) console.log(`       - ${e}`);
        console.log('       Repite la pasada; si persiste, revisa acentos/fraseo del ancla contra CIMA.');
        continue;
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
      } else {
        console.log('    GAPS NUEVOS = 0');
      }
      if (r.knownGaps.length) {
        console.log(`    GAPS conocidos (baseline) = ${r.knownGaps.length}`);
      }
    }
    if (newGapCount > 0 && !updateBaseline) {
      console.log('');
      console.log(`>> ${newGapCount} GAP(s) nuevo(s): cura la entrada (ampliar ATC/filtro) o registralos en`);
      console.log('   reconcile-baseline.json con motivo (o corre --update-baseline y clasifica los "review").');
    }
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
