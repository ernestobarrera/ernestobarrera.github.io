import { writeFileSync, mkdirSync } from 'fs';

const BASE = 'https://cima.aemps.es/cima/rest';
const DELAY = 600;
const BATCH = 3;

async function get(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  return JSON.parse(text);
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 1. Catálogo de materiales ─────────────────────────────────────────────
console.log('Fase 1: catálogo de materiales...');
const cat = await get(`${BASE}/materiales?pagina=1&pageSize=300`);
const items = cat.resultados || [];
console.log(`  ${items.length} items\n`);

// ── 2. Buscar nregistro por nombre ────────────────────────────────────────
console.log('Fase 2: búsqueda nregistro por nombre...');
const nrMap = {}; // nombre → nregistro
let ok2 = 0, fail2 = 0;

for (let i = 0; i < items.length; i += BATCH) {
  const lote = items.slice(i, i + BATCH);
  await Promise.all(lote.map(async item => {
    const nombre = item.medicamento;
    // Intentar con nombre completo, luego con parte antes del paréntesis
    const terminos = [
      nombre,
      nombre.split('(')[0].trim(),
      nombre.split(' ')[0].trim(),
    ];
    for (const t of terminos) {
      try {
        const q = encodeURIComponent(t);
        const data = await get(`${BASE}/medicamentos?nombre=${q}&pageSize=10`);
        if (data.resultados?.length > 0) {
          // Preferir match donde nombre empieza igual (ignorando dosificación)
          const match = data.resultados.find(m =>
            m.nombre?.toUpperCase().startsWith(nombre.toUpperCase().split('(')[0].trim())
          ) || data.resultados[0];
          nrMap[nombre] = match.nregistro;
          ok2++;
          return;
        }
      } catch {}
    }
    nrMap[nombre] = null;
    fail2++;
  }));
  process.stdout.write(`\r  ${ok2+fail2}/${items.length} OK:${ok2} FAIL:${fail2}`);
  if (i + BATCH < items.length) await sleep(DELAY);
}
console.log(`\n  Resultado: ${ok2} OK, ${fail2} sin nregistro\n`);

// ── 3. Obtener ATC via detalle para los que tienen nregistro ──────────────
console.log('Fase 3: obteniendo ATCs...');
const atcMap = {}; // nregistro → {codigo, nombre}
const nregistros = [...new Set(Object.values(nrMap).filter(Boolean))];
let ok3 = 0, fail3 = 0;

for (let i = 0; i < nregistros.length; i += BATCH) {
  const lote = nregistros.slice(i, i + BATCH);
  await Promise.all(lote.map(async nreg => {
    try {
      const med = await get(`${BASE}/medicamento?nregistro=${nreg}`);
      const atc = med?.atcs?.[0];
      atcMap[nreg] = atc ? { codigo: atc.codigo, nombre: atc.nombre } : null;
      ok3++;
    } catch {
      atcMap[nreg] = null;
      fail3++;
    }
  }));
  process.stdout.write(`\r  ${ok3+fail3}/${nregistros.length} OK:${ok3} FAIL:${fail3}`);
  if (i + BATCH < nregistros.length) await sleep(DELAY);
}
console.log(`\n  Resultado: ${ok3} OK, ${fail3} sin ATC\n`);

// ── 4. Combinar y guardar ─────────────────────────────────────────────────
const catalog = {};
for (const item of items) {
  const nreg = nrMap[item.medicamento];
  const atc  = nreg ? atcMap[nreg] : null;
  catalog[item.medicamento] = {
    nregistro:  nreg  || null,
    atcCodigo:  atc?.codigo || null,
    atcNombre:  atc?.nombre || null,
  };
}

const outDir = '/c/Users/ebarr/Documentos/GitHub/ernestobarrera.github.io/assets/data';
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/materiales-catalog.json`, JSON.stringify(catalog));

// Stats
const conNreg = Object.values(catalog).filter(v=>v.nregistro).length;
const conAtc  = Object.values(catalog).filter(v=>v.atcCodigo).length;
console.log(`Guardado. ${items.length} total | ${conNreg} con nregistro | ${conAtc} con ATC`);

// Muestra
Object.entries(catalog).slice(1, 4).forEach(([k,v]) =>
  console.log(`  ${k}: nreg=${v.nregistro} atc=${v.atcCodigo}`)
);
