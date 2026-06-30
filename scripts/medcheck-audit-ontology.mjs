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
  try {
    const data = await fetchCima('/docSegmentado/contenido/1', { nregistro, seccion: section });
    if (Array.isArray(data)) return data.map(item => `${item.titulo || ''} ${item.contenido || ''}`).join(' ');
    if (typeof data === 'string') return data;
    return '';
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
