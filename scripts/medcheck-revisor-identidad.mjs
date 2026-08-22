#!/usr/bin/env node
/**
 * MedCheck — genera el REVISOR de identidad: una página autónoma para dar veredicto clínico a
 * los términos que ninguna regla puede decidir.
 *
 * POR QUÉ UNA PÁGINA GENERADA Y NO UNA BANDEJA DE CABECERA. La bandeja es superficie de TRIAJE
 * —dice qué te espera y en qué orden—, no de captura. 218 veredictos homogéneos la ahogarían y
 * dejaría de servir para lo que sirve. La división correcta: Cabecera es la PUERTA (un widget
 * que dice cuántos quedan), y el trabajo se hace aquí.
 *
 * POR QUÉ CON EL ESTADO INCRUSTADO. Mismo patrón que `dashboard-sync` en ia-config: sin fetch,
 * sin servidor, sin picker. Se abre con doble clic desde el disco y funciona sin red, que es lo
 * único que garantiza poder revisar en cualquier sitio y sin depender de nada.
 *
 * QUÉ HACE RIGUROSO ESTO, y no una lista de nombres:
 *   1. Cada ficha trae LO QUE DIJO CADA AUTORIDAD, no un resumen. Espejo, igual que el baseline.
 *   2. Cada ficha trae la RECUPERACIÓN MEDIDA del español y del candidato, en PubMed y en
 *      ensayos. Sin las cifras, un veredicto es una corazonada: el proyecto ya aprendió que
 *      identidad y recuperación son propiedades distintas, y que la buena puede ser la que
 *      devuelve MENOS (`insulina regular`) o la que devuelve MÁS (`herpes zoster vaccine`).
 *   3. El vocabulario de veredictos es CERRADO y corto. Cuatro opciones y una nota. Un campo
 *      libre produciría 218 criterios distintos y ninguno auditable.
 *   4. Orden por PRODUCTOS COMERCIALIZADOS, que es el mismo criterio de impacto que usa todo el
 *      resto del pipeline. 36 términos cubren la mitad; 103, el 80 %.
 *
 * DOS TAREAS DISTINTAS, y por eso se pueden generar por separado:
 *   (por defecto)   aceptar o rechazar lo que propuso una autoridad. Un vistazo.
 *   --sin-candidato escribir el término desde cero. Mucho más lento.
 *
 * Y UNA TERCERA COSA, añadida el 22/08 y la más importante: `--solo-ceros`. Ver más abajo.
 *
 * Uso:
 *   node scripts/medcheck-revisor-identidad.mjs --solo-ceros
 *   node scripts/medcheck-revisor-identidad.mjs --max=36
 *   node scripts/medcheck-revisor-identidad.mjs --sin-candidato --max=20
 *
 * Salida: docs/medcheck/private/revisor-identidad.html (zona privada, gitignorada).
 * Los veredictos vuelven con medcheck-aplicar-veredictos.mjs.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const SALIDA_DIR = join(ROOT, 'docs', 'medcheck', 'private');
const args = process.argv.slice(2);
const max = Number((args.find(a => a.startsWith('--max=')) || '').split('=')[1]) || 40;
const sinCandidato = args.includes('--sin-candidato');
const sinMedir = args.includes('--sin-medir');

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

// SOLO CEROS (2026-08-22). El revisor nació para 218 veredictos y eso lo convertía en una tarea
// sin final. Pero no todos hacen daño: la mayoría de los nombres españoles YA recuperan, porque
// PubMed mapea solo muchos de ellos y porque la ficha no depende de la traducción para existir.
// El caso que engaña de verdad —el que abrió todo esto con la vacuna del herpes zóster— es el
// CERO: un recuento vacío es indistinguible de «no hay evidencia».
//
// Con `--solo-ceros` se mide todo y se deja en la cola únicamente aquello donde el español
// devuelve 0 en algún registro. Eso convierte una tarea abierta en una lista corta y acabable,
// que es la diferencia entre revisar y no revisar nunca.
const soloCeros = args.includes('--solo-ceros');

const todosPendientes = Object.entries(baseline.terms)
    .filter(([, v]) => (v.status === 'review' || v.status === 'unresolved') && !v.human)
    .filter(([, v]) => (sinCandidato ? !(v.candidates || []).length : (v.candidates || []).length))
    .sort((a, b) => (b[1].products || 0) - (a[1].products || 0));
const pendientes = soloCeros ? todosPendientes : todosPendientes.slice(0, max);

console.log(`${sinCandidato ? 'SIN' : 'CON'} candidato · ${pendientes.length} términos · ${pendientes.reduce((s, [, v]) => s + (v.products || 0), 0)} productos`);

// Caché en disco de las mediciones: sin ella, cada regeneración vuelve a pedir ~700 recuentos a
// NCBI y a ClinicalTrials para enseñar lo mismo.
const CACHE = join(SALIDA_DIR, 'cache-revisor-medidas.json');
mkdirSync(SALIDA_DIR, { recursive: true });
const medidas = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

// ── Medición de recuperación (la misma que usa la promoción) ────────────────────────────────
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function pubmed(q) {
    try {
        const r = await fetch('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `db=pubmed&rettype=count&retmode=json&term=${encodeURIComponent(q)}`,
            signal: AbortSignal.timeout(12000),
        });
        const d = await r.json();
        await dormir(360);   // bajo el techo de 3 req/s de NCBI sin API key
        return Number(d?.esearchresult?.count ?? NaN);
    } catch { return null; }
}
async function ctgov(q) {
    try {
        const r = await fetch(`https://medcheck-proxy.medtools.workers.dev/ctgov/search?q=${encodeURIComponent(q)}`,
            { signal: AbortSignal.timeout(20000) });
        const d = await r.json();
        return Number.isFinite(d?.count) ? d.count : null;
    } catch { return null; }
}

let fichas = [];
let i = 0;
for (const [es, v] of pendientes) {
    i += 1;
    const cand = (v.candidates || [])[0] || null;
    let m = medidas[es] || { pEs: null, pEn: null, cEs: null, cEn: null };
    if (!sinMedir && !medidas[es]) {
        m.pEs = await pubmed(es);
        m.cEs = await ctgov(es);
        if (cand) { m.pEn = await pubmed(cand); m.cEn = await ctgov(cand); }
        medidas[es] = m;
        if (i % 10 === 0) writeFileSync(CACHE, JSON.stringify(medidas));
    }
    fichas.push({ es, products: v.products || 0, status: v.status, candidates: v.candidates || [],
        sources: v.sources || {}, reason: v.reason || '', sctid: v.sctid || null, m });
    if (i % 10 === 0) console.error(`  … ${i}/${pendientes.length}`);
}
writeFileSync(CACHE, JSON.stringify(medidas));

if (soloCeros) {
    const cero = f => (f.m.pEs === 0 || f.m.cEs === 0);
    const dañinos = fichas.filter(cero);
    const inocuos = fichas.filter(f => !cero(f));
    const suma = l => l.reduce((s, f) => s + f.products, 0);
    console.log(`\nde ${fichas.length} pendientes (${suma(fichas)} productos):`);
    console.log(`  el español devuelve CERO en algún registro: ${dañinos.length} (${suma(dañinos)} productos)  <- la cola real`);
    console.log(`  el español ya recupera en los dos:           ${inocuos.length} (${suma(inocuos)} productos)  <- no engañan a nadie`);
    fichas = dañinos.slice(0, max);
    console.log(`\nse generan ${fichas.length} fichas.`);
}

// ── La página ───────────────────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revisor de identidad · MedCheck</title>
<style>
:root{--bg:#0f1216;--card:#171b21;--bd:#262c35;--tx:#e6e9ee;--mu:#98a2b3;--ok:#3fb950;--no:#f85149;--wa:#d29922;--pr:#58a6ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--bd);padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;z-index:5}
h1{font-size:15px;margin:0;font-weight:600}
.barra{flex:1;min-width:140px;height:6px;background:var(--bd);border-radius:3px;overflow:hidden}
.barra i{display:block;height:100%;background:var(--pr);width:0;transition:width .2s}
.mu{color:var(--mu)}
main{max-width:820px;margin:0 auto;padding:20px 16px 120px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:18px 20px}
.nom{font-size:23px;font-weight:600;letter-spacing:-.01em}
.meta{margin:4px 0 16px;font-size:13px;color:var(--mu)}
.cand{font-size:19px;color:var(--pr);font-weight:500;margin:2px 0 14px;word-break:break-word}
table{width:100%;border-collapse:collapse;font-size:13.5px;margin:12px 0}
th,td{text-align:right;padding:6px 8px;border-bottom:1px solid var(--bd)}
th:first-child,td:first-child{text-align:left;color:var(--mu)}
td b{font-variant-numeric:tabular-nums}
.ev{font-size:12.5px;color:var(--mu);background:#0d1014;border:1px solid var(--bd);border-radius:6px;padding:9px 11px;margin:12px 0;white-space:pre-wrap;word-break:break-word}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
button{font:inherit;font-size:14px;padding:9px 14px;border-radius:8px;border:1px solid var(--bd);background:#1d232b;color:var(--tx);cursor:pointer}
button:hover{border-color:var(--pr)}
button b{display:inline-block;min-width:15px;color:var(--mu);font-weight:600}
.b-ok{border-color:rgba(63,185,80,.4)} .b-no{border-color:rgba(248,81,73,.4)} .b-co{border-color:rgba(210,153,34,.4)}
input[type=text]{width:100%;font:inherit;padding:9px 11px;border-radius:8px;border:1px solid var(--bd);background:#0d1014;color:var(--tx);margin-top:10px}
a{color:var(--pr)}
.fin{text-align:center;padding:40px 0}
textarea{width:100%;height:220px;font:12px ui-monospace,monospace;background:#0d1014;color:var(--tx);border:1px solid var(--bd);border-radius:8px;padding:10px;margin-top:12px}
.hint{font-size:12.5px;color:var(--mu);margin-top:14px}
.chip{display:inline-block;font-size:11.5px;padding:2px 8px;border:1px solid var(--bd);border-radius:99px;margin-right:6px;color:var(--mu)}
</style></head><body>
<header>
  <h1>Revisor de identidad</h1>
  <span class="mu" id="pos"></span>
  <div class="barra"><i id="pb"></i></div>
  <span class="mu" id="cuenta"></span>
</header>
<main id="app"></main>
<script>
const FICHAS = ${JSON.stringify(fichas)};
const CLAVE = 'medcheck-veredictos-${sinCandidato ? 'sin' : 'con'}';
let ver = {};
try { ver = JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { ver = {}; }
const guarda = () => { try { localStorage.setItem(CLAVE, JSON.stringify(ver)); } catch (e) {} };
let i = FICHAS.findIndex(f => !ver[f.es]);
if (i < 0) i = FICHAS.length;

const n = x => x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toLocaleString('es-ES');
const pmUrl = q => 'https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(q);
const ctUrl = q => 'https://clinicaltrials.gov/search?term=' + encodeURIComponent(q);

function veredicto(tipo, termino) {
  const f = FICHAS[i];
  ver[f.es] = { veredicto: tipo, termino: termino || null, fecha: new Date().toISOString().slice(0, 10) };
  guarda(); i++; pinta();
}

function pinta() {
  const hechos = Object.keys(ver).length;
  document.getElementById('cuenta').textContent = hechos + '/' + FICHAS.length + ' resueltos';
  document.getElementById('pb').style.width = (100 * hechos / FICHAS.length) + '%';
  const app = document.getElementById('app');
  if (i >= FICHAS.length) {
    document.getElementById('pos').textContent = '';
    app.innerHTML = '<div class="fin"><h2>Hecho</h2><p class="mu">Copia esto y pásaselo al agente.</p>' +
      '<textarea id="out" readonly></textarea>' +
      '<div class="btns" style="justify-content:center"><button onclick="copiar()">Copiar veredictos</button>' +
      '<button onclick="if(confirm(\\'¿Borrar todos los veredictos guardados?\\')){localStorage.removeItem(CLAVE);location.reload()}">Empezar de cero</button></div></div>';
    document.getElementById('out').value = JSON.stringify(ver, null, 2);
    return;
  }
  const f = FICHAS[i];
  document.getElementById('pos').textContent = (i + 1) + ' de ' + FICHAS.length;
  const cand = f.candidates[0] || null;
  const filas = cand ? \`<table>
      <tr><th></th><th>PubMed</th><th>Ensayos</th></tr>
      <tr><td>español · <a href="\${pmUrl(f.es)}" target="_blank">abrir</a></td><td><b>\${n(f.m.pEs)}</b></td><td><b>\${n(f.m.cEs)}</b></td></tr>
      <tr><td>candidato · <a href="\${pmUrl(cand)}" target="_blank">abrir</a> · <a href="\${ctUrl(cand)}" target="_blank">ensayos</a></td><td><b>\${n(f.m.pEn)}</b></td><td><b>\${n(f.m.cEn)}</b></td></tr>
    </table>\` : \`<table>
      <tr><th></th><th>PubMed</th><th>Ensayos</th></tr>
      <tr><td>español · <a href="\${pmUrl(f.es)}" target="_blank">abrir</a></td><td><b>\${n(f.m.pEs)}</b></td><td><b>\${n(f.m.cEs)}</b></td></tr>
    </table>\`;
  app.innerHTML = \`<div class="card">
    <div class="nom">\${f.es}</div>
    <div class="meta"><span class="chip">\${f.products} productos</span><span class="chip">\${f.status}</span>\${f.sctid ? '<span class="chip">SCTID ' + f.sctid + '</span>' : ''}</div>
    \${cand ? '<div class="cand">→ ' + cand + '</div>' : '<div class="cand mu">sin candidato: ninguna autoridad propuso término</div>'}
    \${filas}
    <div class="ev"><b>SNOMED:</b> \${f.sources.snomed || '—'}   <b>PubMed:</b> \${f.sources.pubmed || '—'}\${f.reason ? '\\n' + f.reason : ''}\${f.candidates.length > 1 ? '\\notros candidatos: ' + f.candidates.slice(1).join(' · ') : ''}</div>
    <div class="btns">
      \${cand ? '<button class="b-ok" onclick="veredicto(\\'acepta\\')"><b>A</b> Acepta el candidato</button>' : ''}
      <button class="b-no" onclick="veredicto('rechaza')"><b>R</b> Rechaza · sin término</button>
      <button class="b-co" onclick="corrige()"><b>C</b> Corrige · escribo yo</button>
      <button onclick="veredicto('no_procede')"><b>N</b> No procede</button>
      <button onclick="i++;pinta()"><b>S</b> Saltar</button>
    </div>
    <div id="corr"></div>
    <div class="hint">Teclas: <b>A</b> acepta · <b>R</b> rechaza · <b>C</b> corrige · <b>N</b> no procede · <b>S</b> salta · <b>←</b> atrás.
    «No procede» es para lo que no es una sustancia buscable (agua para inyección, un excipiente, un fragmento de una lista).</div>
  </div>\`;
}

function corrige() {
  const d = document.getElementById('corr');
  d.innerHTML = '<input type="text" id="tx" placeholder="término inglés correcto, y Enter">';
  const tx = document.getElementById('tx');
  tx.focus();
  tx.onkeydown = e => { if (e.key === 'Enter' && tx.value.trim()) veredicto('corrige', tx.value.trim()); };
}

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const f = FICHAS[i]; if (!f) return;
  const k = e.key.toLowerCase();
  if (k === 'a' && f.candidates[0]) veredicto('acepta');
  else if (k === 'r') veredicto('rechaza');
  else if (k === 'c') corrige();
  else if (k === 'n') veredicto('no_procede');
  else if (k === 's') { i++; pinta(); }
  else if (e.key === 'ArrowLeft' && i > 0) { i--; pinta(); }
});

function copiar() {
  const t = document.getElementById('out'); t.select();
  navigator.clipboard.writeText(t.value).catch(() => document.execCommand('copy'));
}
pinta();
</script></body></html>`;

mkdirSync(SALIDA_DIR, { recursive: true });
const salida = join(SALIDA_DIR, `revisor-identidad${sinCandidato ? '-sin-candidato' : ''}.html`);
writeFileSync(salida, html);
console.log(`\nGenerado: ${salida}`);
console.log('Ábrelo con doble clic. Funciona sin red y recuerda dónde te quedaste.');
