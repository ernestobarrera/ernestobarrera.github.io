#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const ontologyPath = path.join(repoRoot, 'assets', 'data', 'clinical-ontology.json');
const CIMA_BASE = 'https://cima.aemps.es/cima/rest';

const args = new Set(process.argv.slice(2));
const live = args.has('--live');
const reconcile = args.has('--reconcile');
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
  'reflujo', 'enfermedad inflamatoria intestinal', 'hepatitis', 'cirrosis', 'pancreatitis',
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
if (reconcile) {
  if (typeof fetch !== 'function') {
    throw new Error('Este Node no expone fetch global. Usa Node 18+ para --reconcile.');
  }
  const requestedSet = new Set(requestedTerms);
  // Por defecto solo las entradas con filtro 4.1 (las que tienen fraseologia curada); con --terms
  // se fuerza cualquiera. Evita ruido masivo en entradas sin terminos curados (caerian al termino).
  const source = requestedSet.size > 0
    ? entries.filter(([term]) => requestedSet.has(normalize(term)))
    : entries.filter(([, entry]) => entry.section41Filter || entry.sectionFilter || entry.reconcileTerms);
  const recEntries = source.slice(0, Number.isFinite(maxTerms) ? maxTerms : source.length);
  for (const [term, entry] of recEntries) {
    reconcileRows.push(await reconcileEntry(term, entry));
  }
}

printReport();
if (problems.length > 0) process.exitCode = 1;

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
  const first = await fetchCima('/medicamentos', {
    atc: upper,
    comerc: '1',
    tamanioPagina: '500',
    pagina: '1'
  });
  const items = [...(first?.resultados || [])];
  const total = first?.totalFilas || items.length;
  const pages = Math.min(Math.ceil(total / 500), 4);
  for (let pagina = 2; pagina <= pages; pagina += 1) {
    const page = await fetchCima('/medicamentos', {
      atc: upper,
      comerc: '1',
      tamanioPagina: '500',
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
async function buscarFichaTecnica(section, texto) {
  const body = JSON.stringify([{ seccion: section, texto, contiene: 1 }]);
  const first = await postCima('/buscarEnFichaTecnica', { comerc: '1', tamanioPagina: '100', pagina: '1' }, body);
  const out = [...(first?.resultados || [])];
  const total = first?.totalFilas || out.length;
  const pages = Math.min(Math.ceil(total / 100), 6);
  for (let pagina = 2; pagina <= pages; pagina += 1) {
    const d = await postCima('/buscarEnFichaTecnica', { comerc: '1', tamanioPagina: '100', pagina: String(pagina) }, body);
    out.push(...(d?.resultados || []));
  }
  return out;
}

// Fraseologia para la busqueda en 4.1: preferimos terminos curados especificos (reconcileTerms),
// luego los del filtro; como ultimo recurso el propio termino (menos fiable, se marca en el informe).
function reconcileTermsFor(term, entry) {
  const f = entry.section41Filter || entry.sectionFilter;
  if (Array.isArray(entry.reconcileTerms) && entry.reconcileTerms.length) {
    return { terms: entry.reconcileTerms, source: 'reconcileTerms' };
  }
  if (f && Array.isArray(f.includeAny) && f.includeAny.length) {
    return { terms: f.includeAny, source: 'section41Filter.includeAny' };
  }
  if (f && Array.isArray(f.terms) && f.terms.length) {
    return { terms: f.terms, source: 'section41Filter.terms' };
  }
  return { terms: [term], source: 'fallback:term' };
}

async function reconcileEntry(term, entry) {
  const { terms, source } = reconcileTermsFor(term, entry);
  // Conjunto ATC: lo que MedCheck devuelve hoy (por nregistro).
  const atcMeds = await searchEntry(entry);
  const atcIds = new Set(atcMeds.map(m => m.nregistro).filter(Boolean));
  // Conjunto verdad: union de la 4.1 por cada fraseo.
  const txt = new Map(); // nregistro -> nombre
  const perTerm = [];
  for (const t of terms) {
    let meds = [];
    try {
      meds = await buscarFichaTecnica('4.1', t);
    } catch (error) {
      perTerm.push(`${t}=ERR`);
      continue;
    }
    perTerm.push(`${t}=${meds.length}`);
    for (const m of meds) if (m.nregistro) txt.set(m.nregistro, m.nombre);
  }
  const gaps = [...txt.entries()].filter(([nr]) => !atcIds.has(nr));
  const extra = atcMeds.filter(m => m.nregistro && !txt.has(m.nregistro)).length;
  return { term, source, atc: atcIds.size, ft: txt.size, perTerm, gaps, extra };
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
    try { data = JSON.parse(raw); } catch { return raw; }
    if (Array.isArray(data)) return data.map(item => `${item.titulo || ''} ${item.contenido || ''}`).join(' ');
    return typeof data === 'string' ? data : raw;
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

  if (reconcile) {
    console.log('## Reconciliation: ATC vs ficha tecnica 4.1');
    console.log('(GAPS = farmacos con la indicacion en su 4.1 que el ATC NO captura. Candidatos a revisar:');
    console.log(' incluyen falsos positivos del texto -p. ej. un 4.1 que solo aconseja dejar de fumar-.)');
    console.log('');
    if (!reconcileRows.length) {
      console.log('- none');
      console.log('');
    }
    for (const r of reconcileRows) {
      console.log(`- ${r.term} [${r.source}] ATC=${r.atc} 4.1=${r.ft} extra(ATC sin 4.1)=${r.extra}`);
      console.log(`    terms: ${r.perTerm.join(', ')}`);
      if (r.gaps.length) {
        console.log(`    GAPS (en 4.1, ausentes del ATC) = ${r.gaps.length}:`);
        for (const [nr, nombre] of r.gaps.slice(0, 15)) console.log(`      + ${nombre} (nregistro ${nr})`);
        if (r.gaps.length > 15) console.log(`      ... (+${r.gaps.length - 15} mas)`);
      } else {
        console.log('    GAPS = 0');
      }
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
