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
 *
 * Maestra ATC y recuentos (los consumen --cobertura-atc y --vigilar-broad):
 *   MC_MOCK_ATC                 códigos que devuelve la maestra
 *   MC_MOCK_ATC_ECO=1           la maestra responde `<prefijo>` y `<prefijo>01` para lo que se pida
 *   MC_MOCK_ATC_TOTAL           finge un totalFilas mayor que lo servido (universo incompleto)
 *   MC_MOCK_ATC_UNA_PAGINA=1    solo la página 1 trae filas → maestra truncada de verdad
 *   MC_MOCK_ATC_SIN_TOTAL=1     maestra sin totalFilas → no se puede afirmar completitud
 *   MC_MOCK_ATC_SIN_PRODUCTO    códigos declarados sin comercializar
 *   MC_MOCK_MEDS_SIN_TOTAL      /medicamentos con productos pero SIN totalFilas
 *   MC_MOCK_MEDS_CERO_CON_FILAS /medicamentos con totalFilas 0 y productos dentro (contradictoria)
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

  // Maestra ATC (maestra=7) — la consumen --cobertura-atc y --vigilar-broad. Por defecto IGNORA
  // `pagina` y devuelve siempre los mismos códigos: ese es justo el CIMA que repite página, y el
  // auditor tiene que distinguirlo de uno truncado (MC_MOCK_ATC_UNA_PAGINA) y de uno que no
  // declara cuántas filas hay (MC_MOCK_ATC_SIN_TOTAL). Los tres salen inconclusos, por motivos
  // distintos; hasta la revisión cruzada de 2026-09-05 solo se probaba el primero.
  if (url.pathname.endsWith('/maestras') && url.searchParams.get('maestra') === '7') {
    // MC_MOCK_ATC_ECO: la maestra responde en función del prefijo pedido (`<P>` y `<P>01`), en vez
    // de una lista fija. Es lo que permite ejercitar el gate COMPLETO de --vigilar-broad, que
    // recorre los 63 prefijos broad reales de la ontología: con una lista fija, todos menos uno
    // saldrían "sin códigos bajo el grupo" y la pasada sería inconclusa en vez de medir nada.
    const grupo = String(url.searchParams.get('nombre') || '').trim().toUpperCase();
    const codigos = process.env.MC_MOCK_ATC_ECO === '1'
      ? (grupo ? [grupo, `${grupo}01`] : [])
      : (process.env.MC_MOCK_ATC || '').split(',').map(s => s.trim()).filter(Boolean);
    const pagina = Number(url.searchParams.get('pagina') || 1);
    const unaPagina = process.env.MC_MOCK_ATC_UNA_PAGINA === '1';
    const resultados = (unaPagina && pagina > 1)
      ? []
      : codigos.map(codigo => ({ codigo, nombre: `MOCK ${codigo}` }));
    if (process.env.MC_MOCK_ATC_SIN_TOTAL === '1') {
      return json({ pagina, tamanioPagina: 200, resultados });
    }
    const total = Number(process.env.MC_MOCK_ATC_TOTAL || codigos.length);
    return json({ totalFilas: total, pagina, tamanioPagina: 200, resultados });
  }
  if (url.pathname.endsWith('/medicamentos')) {
    const atc = url.searchParams.get('atc') || 'X00XX';
    // MC_MOCK_ATC_SIN_PRODUCTO declara códigos sin comercializar: un código huérfano SIN
    // producto no es un hueco hoy, y esa diferencia tiene que ser comprobable.
    const vacios = (process.env.MC_MOCK_ATC_SIN_PRODUCTO || '').split(',').map(s => s.trim()).filter(Boolean);
    if (vacios.includes(atc)) return json({ totalFilas: 0, resultados: [] });
    const med = { ...baseMed('11111'), atcs: [{ codigo: atc }] };
    // Los dos sabores de respuesta INCOMPLETA que se leían como "cero productos", y por tanto
    // como "aquí no ha entrado nada": sin recuento, y con recuento 0 contradiciendo sus filas.
    const sinTotal = (process.env.MC_MOCK_MEDS_SIN_TOTAL || '').split(',').map(s => s.trim()).filter(Boolean);
    if (sinTotal.includes(atc)) return json({ resultados: [med] });
    const ceroConFilas = (process.env.MC_MOCK_MEDS_CERO_CON_FILAS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ceroConFilas.includes(atc)) return json({ totalFilas: 0, resultados: [med] });
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
