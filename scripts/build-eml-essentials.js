#!/usr/bin/env node
/**
 * build-eml-essentials.js
 * Procesa el export CSV de la WHO Model List of Essential Medicines (eEML)
 * en un JSON compacto para enriquecer los favoritos de MedCheck.
 *
 * Entrada : assets/data/eml_export.csv  (separador ';', campos con comillas y saltos)
 * Salida  : assets/data/eml.json
 *
 * Reglas:
 *  - Solo entradas vigentes (Status === 'Added'); se descartan las 'Removed'.
 *  - Deduplicado por fármaco (una fila por indicación/formulación/combo en el CSV).
 *  - Recoge ATC únicos, secciones EML e indicaciones por fármaco.
 *  - Marca primaryCare según una lista de secciones NO de primaria (heurística editable).
 *  - Índice byAtc para cruce O(1) con el atcCodigo de un favorito.
 *
 * Licencia del dato: WHO Model List of Essential Medicines 23rd (2023),
 * CC BY-NC-SA 3.0 IGO. Se registra en _meta. Mantener atribución en la UI.
 *
 * Uso:  node scripts/build-eml-essentials.js
 */
const fs = require('fs');
const path = require('path');

const IN = path.join(__dirname, '..', 'assets', 'data', 'eml_export.csv');
const OUT = path.join(__dirname, '..', 'assets', 'data', 'eml.json');

// Secciones que NO son de Atención Primaria española (ruido para el médico de familia).
// Heurística por prefijo de la columna "EML section". Editable.
const NON_PRIMARY_PREFIXES = [
  'Immunologicals', 'Antiretrovirals', 'Fixed-dose combinations of antiretrovirals',
  'Antimalarial', 'Antituberculosis', 'Antileprosy', 'Antileishmaniasis',
  'American trypanosomiasis', 'Medicines for the treatment of', 'Antifilarials',
  'Antischistosomals', 'Cysticidal', 'Intestinal anthelminthics', 'Antiamoebic',
  'Antipneumocystosis', 'Cytotoxic', 'Targeted therapies', 'Immunomodulators',
  'Hormones and antihormones', 'Medicines for hepatitis', 'Medicines for COVID-19',
  'Medicines for Ebola', 'Reserve group antibiotics', 'Antineoplastics',
  'Coagulation factors', 'Blood and blood components', 'Human immunoglobulins',
  'Medicines administered to the neonate', 'Diagnostic agents', 'Disinfectants',
  'Antiseptics', 'Dental medicines', 'Radiocontrast', 'Medicines for cystic fibrosis',
  'Medicines for multiple sclerosis', 'Peritoneal dialysis', 'Therapeutic foods',
  'Muscle relaxants', 'General anaesthetics', 'Plasma substitutes', 'Uterotonics',
  'Medicines for medical abortion', 'Antivenom'
];

/** Parser CSV mínimo con comillas RFC4180-ish y saltos de línea dentro de comillas. */
function parseCSV(text, delim = ';') {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = s => (s || '').trim();
const isPrimary = section => !NON_PRIMARY_PREFIXES.some(p => section.startsWith(p));

function main() {
  if (!fs.existsSync(IN)) {
    console.error(`No encuentro ${IN}\nGuarda el CSV de la eEML ahí (Excel → Guardar como → CSV UTF-8) y reejecuta.`);
    process.exit(1);
  }
  const rows = parseCSV(fs.readFileSync(IN, 'utf8'));
  const header = rows.shift().map(h => h.trim().toLowerCase());
  const col = name => header.indexOf(name);
  const iName = col('medicine name'), iSec = col('eml section'),
        iInd = col('indication'), iAtc = col('atc codes'), iStatus = col('status');

  const meds = new Map(); // name -> { name, atcs:Set, sections:Set, indications:Set, primaryCare:bool }
  let total = 0, added = 0, removed = 0;
  for (const r of rows) {
    if (!r[iName]) continue;
    total++;
    const status = norm(r[iStatus]);
    if (status === 'Removed') { removed++; continue; }
    if (status !== 'Added') continue;
    added++;
    const name = norm(r[iName]);
    if (!meds.has(name)) meds.set(name, { name, atcs: new Set(), sections: new Set(), indications: new Set(), primaryCare: false });
    const m = meds.get(name);
    norm(r[iAtc]).split(',').map(s => s.trim()).filter(Boolean).forEach(a => m.atcs.add(a));
    const sec = norm(r[iSec]); if (sec) { m.sections.add(sec); if (isPrimary(sec)) m.primaryCare = true; }
    const ind = norm(r[iInd]); if (ind) m.indications.add(ind);
  }

  const out = [...meds.values()].map(m => ({
    name: m.name,
    atcs: [...m.atcs].sort(),
    sections: [...m.sections].sort(),
    indications: [...m.indications].sort(),
    primaryCare: m.primaryCare
  })).sort((a, b) => a.name.localeCompare(b.name));

  // --- Centinelas de integridad: esenciales conocidos con su ATC esperado.
  // Si fallan, el CSV está corrupto/truncado → NO se sobrescribe el JSON bueno.
  const SENTINELS = [
    ['paracetamol (acetaminophen)', 'N02BE01'], ['amoxicillin', 'J01CA04'],
    ['metformin', 'A10BA02'], ['enalapril', 'C09AA02'], ['omeprazole', 'A02BC01'],
    ['amlodipine', 'C08CA01'], ['empagliflozin', 'A10BK03']
  ];
  const fails = [];
  for (const [name, atc] of SENTINELS) {
    const m = out.find(x => x.name === name);
    if (!m) fails.push(`falta "${name}"`);
    else if (!m.atcs.includes(atc)) fails.push(`"${name}" sin ATC ${atc} (tiene ${JSON.stringify(m.atcs)})`);
  }
  if (out.length < 400) fails.push(`solo ${out.length} fármacos (esperados >400) — CSV probablemente truncado`);
  if (fails.length) {
    console.error('INTEGRIDAD FALLIDA — no se escribe nada:\n  - ' + fails.join('\n  - '));
    process.exit(1);
  }

  // Índice ATC -> nombre del esencial (para cruce rápido con favoritos).
  const byAtc = {};
  out.forEach(m => m.atcs.forEach(a => { byAtc[a] = m.name; }));

  const json = {
    _meta: {
      source: 'WHO Model List of Essential Medicines (eEML), 23rd list, 2023',
      url: 'https://list.essentialmeds.org/',
      license: 'CC BY-NC-SA 3.0 IGO',
      generated: new Date().toISOString().slice(0, 10),
      note: 'Solo entradas vigentes (Status=Added), deduplicadas por fármaco. byAtc indexa por código ATC. primaryCare es heurístico por sección EML.'
    },
    meds: out,
    byAtc
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(json, null, 2), 'utf8');

  const withAtc = out.filter(m => m.atcs.length).length;
  const primary = out.filter(m => m.primaryCare).length;
  console.log(`Filas: ${total} (Added ${added}, Removed ${removed})`);
  console.log(`Fármacos vigentes únicos: ${out.length}`);
  console.log(`  con ATC: ${withAtc}  ·  sin ATC: ${out.length - withAtc}`);
  console.log(`  relevantes para primaria (heurístico): ${primary}`);
  console.log(`  índice byAtc: ${Object.keys(byAtc).length} códigos`);
  console.log(`Escrito: ${OUT}`);
}

main();
