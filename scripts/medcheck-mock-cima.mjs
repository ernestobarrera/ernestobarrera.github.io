#!/usr/bin/env node
/**
 * MedCheck — mock de CIMA para inyección de fallos (preload de node --import)
 *
 * Sustituye globalThis.fetch por un CIMA sintético y determinista ANTES de que corra el
 * auditor. No lo ejecutes directamente: lo carga medcheck-test-audit-gates.mjs así:
 *
 *   node --import file://.../medcheck-mock-cima.mjs scripts/medcheck-audit-ontology.mjs ...
 *
 * Env:
 *   MC_MOCK_MODE  fail500 → todo responde HTTP 500 (red rota persistente)
 *                 flaky   → cada URL responde 429 dos veces y luego funciona (transitorio)
 *                 ok      → todo funciona a la primera
 *   MC_MOCK_TERM  término de la ontología cuya fraseología se inyecta en la 4.1 sintética
 *   MC_MOCK_GAPS  nregistros extra (coma) que la 4.1 recluta pero el universo ATC no ve → GAPs
 */
import { readFileSync } from 'node:fs';

const mode = process.env.MC_MOCK_MODE || 'ok';
const term = process.env.MC_MOCK_TERM || 'depresión';
const extraGaps = (process.env.MC_MOCK_GAPS || '').split(',').map(s => s.trim()).filter(Boolean);

const ontology = JSON.parse(readFileSync(new URL('../assets/data/clinical-ontology.json', import.meta.url), 'utf8'));
const entry = ontology.terms[term] || {};
const toArr = v => (v ? (Array.isArray(v) ? v : [v]) : []);
const filtro = entry.section41Filter || entry.sectionFilter || {};
// Texto 4.1 sintético que satisface cualquier fraseología curada de la entrada.
const phraseSoup = [
  term, ...toArr(entry.synonyms), ...toArr(entry.reconcileAnchor), ...toArr(entry.reconcileTerms),
  ...toArr(filtro.includeAny), ...toArr(filtro.terms)
].join('. ') + '. Indicado para el tratamiento en adultos.';

const baseMed = nr => ({ nregistro: nr, nombre: `MOCKFARMACO ${nr}`, vtm: { nombre: `mocksustancia ${nr}` }, atcs: [] });
const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const flakyCounts = new Map();

globalThis.fetch = async (input) => {
  const url = new URL(String(input && input.url ? input.url : input));

  if (mode === 'fail500') return new Response('mock 500', { status: 500 });

  if (mode === 'flaky') {
    const key = url.pathname + url.search;
    const n = (flakyCounts.get(key) || 0) + 1;
    flakyCounts.set(key, n);
    if (n <= 2) return new Response('mock 429', { status: 429 });
  }

  // Maestra ATC (maestra=7) — la consume --cobertura-atc. MC_MOCK_ATC es la lista de códigos
  // que devuelve, y MC_MOCK_ATC_TOTAL permite fingir una respuesta TRUNCADA (totalFilas mayor
  // que las filas servidas), que debe salir inconclusa y nunca limpia.
  if (url.pathname.endsWith('/maestras') && url.searchParams.get('maestra') === '7') {
    const codigos = (process.env.MC_MOCK_ATC || '').split(',').map(s => s.trim()).filter(Boolean);
    const resultados = codigos.map(codigo => ({ codigo, nombre: `MOCK ${codigo}` }));
    const total = Number(process.env.MC_MOCK_ATC_TOTAL || resultados.length);
    return json({ totalFilas: total, pagina: 1, tamanioPagina: 200, resultados });
  }
  if (url.pathname.endsWith('/medicamentos')) {
    const atc = url.searchParams.get('atc') || 'X00XX';
    // MC_MOCK_ATC_SIN_PRODUCTO declara códigos sin comercializar: un código huérfano SIN
    // producto no es un hueco hoy, y esa diferencia tiene que ser comprobable.
    const vacios = (process.env.MC_MOCK_ATC_SIN_PRODUCTO || '').split(',').map(s => s.trim()).filter(Boolean);
    if (vacios.includes(atc)) return json({ totalFilas: 0, resultados: [] });
    const med = { ...baseMed('11111'), atcs: [{ codigo: atc }] };
    return json({ totalFilas: 1, resultados: [med] });
  }
  if (url.pathname.endsWith('/buscarEnFichaTecnica')) {
    const meds = ['11111', ...extraGaps].map(baseMed);
    return json({ totalFilas: meds.length, resultados: meds });
  }
  if (url.pathname.includes('/docSegmentado/')) {
    return new Response(phraseSoup, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('mock: endpoint no contemplado', { status: 404 });
};
