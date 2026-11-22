#!/usr/bin/env node
/**
 * MedCheck — el auditor y la app leen la 4.1 con el MISMO contrato.
 *
 * POR QUÉ EXISTE (R3 de la revisión de Codex, 22/11/2026). `medcheck-audit-ontology.mjs` leía la
 * sección con su propio código y divergía del navegador, siempre hacia certificar sin haber leído:
 * dejaba «cardia ca» de `cardia</span><span>ca`, no probaba la ficha del registro original de una
 * importación paralela, contaba un array vacío como lectura con éxito y convertía el
 * `{"error":"No existen secciones…"}` de CIMA en «ausente», que la reconciliación saltaba.
 *
 * Desde el 22/11 los dos cargan las mismas funciones estáticas de `assets/js/cima-api.js`
 * (`scripts/lib/lectura-41.mjs`). Este banco pasa las MISMAS respuestas de CIMA por los dos lados y
 * exige la misma decisión en cada una: confirmado, descartado o no verificable. Si alguien vuelve a
 * escribir una lectura propia en el auditor, un caso de aquí lo delata.
 *
 * Uso: node scripts/medcheck-test-contrato-lectura-41.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { CimaAPI as CimaAuditor, crearLectorSeccion } from './lib/lectura-41.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const auditSrc = readFileSync(join(ROOT, 'scripts/medcheck-audit-ontology.mjs'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};

const SIN_SECCIONES = { error: 'No existen secciones para el medicamento indicado' };
const s41 = (html) => [{ seccion: '4.1', titulo: 'Indicaciones terapéuticas', contenido: html }];

// Respuesta de CIMA por nregistro: { status, tipo, cuerpo }. `cuerpo` objeto → JSON.
const R = {
    json: (cuerpo) => ({ status: 200, tipo: 'application/json', cuerpo: JSON.stringify(cuerpo) }),
    html: (texto) => ({ status: 200, tipo: 'text/html', cuerpo: texto }),
    estado: (status) => ({ status, tipo: 'text/plain', cuerpo: status === 204 ? '' : 'error' }),
};

// Cada caso: respuestas de CIMA, filtro y la decisión que se espera de los DOS lados.
const CASOS = [
    { id: 'texto con el término', fichas: { A: R.json(s41('<p>Tratamiento de la insuficiencia cardiaca crónica.</p>')) }, filtro: ['insuficiencia cardiaca'], espera: 'confirmado' },
    { id: 'texto sin el término', fichas: { A: R.json(s41('<p>Hipertensión arterial esencial.</p>')) }, filtro: ['insuficiencia cardiaca'], espera: 'descartado' },
    { id: 'palabra partida entre <span>', fichas: { A: R.json(s41('<p>Insuficiencia <span>cardia</span><span>ca</span> crónica.</p>')) }, filtro: ['insuficiencia cardiaca'], espera: 'confirmado' },
    { id: 'entidad nombrada (&ntilde;)', fichas: { A: R.json(s41('<p>Profilaxis de la migra&ntilde;a.</p>')) }, filtro: ['migraña'], espera: 'confirmado' },
    { id: 'entidad numérica (&#241;)', fichas: { A: R.json(s41('<p>Profilaxis de la migra&#241;a.</p>')) }, filtro: ['migraña'], espera: 'confirmado' },
    { id: 'guion en el término (sars-cov-2)', fichas: { A: R.json(s41('<p>Prevención de la COVID-19 causada por el SARS-CoV-2.</p>')) }, filtro: ['sars-cov-2'], espera: 'confirmado' },
    // P1 de la revisión del delta (Codex, 22/11/2026): con HTTP 200, lo que no es la sección pedida
    // no es una lectura. Antes, la 4.2 o una página de error se leían como texto y el auditor
    // certificaba cero omisiones. Un texto sin JSON tampoco dice de qué sección es.
    { id: 'HTML sin JSON (no dice de qué sección es)', fichas: { A: R.html('<p>Enuresis nocturna primaria.</p>') }, filtro: ['enuresis'], espera: 'no-verificable', motivo: 'respuesta' },
    { id: '200 con una página HTML de error', fichas: { A: R.html('<!DOCTYPE html><html><head><title>Error temporal</title></head><body><p>Servicio no disponible.</p></body></html>') }, filtro: ['enuresis'], espera: 'no-verificable', motivo: 'respuesta' },
    { id: '200 con la 4.2 en lugar de la 4.1', fichas: { A: R.json([{ seccion: '4.2', titulo: 'Posología', contenido: '<p>Adultos: un comprimido al día.</p>' }]) }, filtro: ['enuresis'], espera: 'no-verificable', motivo: 'respuesta' },
    { id: '200 con la 4.2 que SÍ nombra el término', fichas: { A: R.json([{ seccion: '4.2', titulo: 'Posología', contenido: '<p>En la enuresis, 0,2 mg al acostarse.</p>' }]) }, filtro: ['enuresis'], espera: 'no-verificable', motivo: 'respuesta' },
    { id: '200 con un JSON de forma desconocida', fichas: { A: R.json({ mensaje: 'mantenimiento' }) }, filtro: ['enuresis'], espera: 'no-verificable', motivo: 'respuesta' },
    { id: 'subsecciones 4.1.x', fichas: { A: R.json([{ seccion: '4.1', titulo: 'Indicaciones terapéuticas', contenido: '' }, { seccion: '4.1.1', titulo: 'Adultos', contenido: '<p>Enuresis nocturna primaria en mayores de 5 años.</p>' }]) }, filtro: ['enuresis'], espera: 'confirmado' },
    { id: 'mezcla 4.1 y 4.2: solo cuenta la 4.1', fichas: { A: R.json([{ seccion: '4.1', titulo: 'Indicaciones', contenido: '<p>Diabetes insípida central.</p>' }, { seccion: '4.2', titulo: 'Posología', contenido: '<p>En la enuresis, 0,2 mg al acostarse.</p>' }]) }, filtro: ['enuresis'], espera: 'descartado' },
    { id: 'la 4.10 no es una subsección de la 4.1', fichas: { A: R.json([{ seccion: '4.10', titulo: 'Otra', contenido: '<p>Enuresis nocturna primaria.</p>' }]) }, filtro: ['enuresis'], espera: 'no-verificable', motivo: 'respuesta' },
    { id: 'importación paralela: la propia trae otra sección, la del original vale', nregistro: '333IP', fichas: { '333IP': R.json([{ seccion: '4.2', contenido: '<p>Un comprimido al día.</p>' }]), '333': R.json(s41('<p>Síndrome de piernas inquietas.</p>')) }, filtro: ['piernas inquietas'], espera: 'confirmado', fuente: 'original' },
    { id: '200 con {"error"} y sin original', fichas: { A: R.json(SIN_SECCIONES) }, filtro: ['enuresis'], espera: 'no-verificable' },
    { id: 'array vacío', fichas: { A: R.json([]) }, filtro: ['enuresis'], espera: 'no-verificable' },
    { id: 'subsecciones sin contenido', fichas: { A: R.json(s41('<p>  </p>')) }, filtro: ['enuresis'], espera: 'no-verificable' },
    { id: '204', fichas: { A: R.estado(204) }, filtro: ['enuresis'], espera: 'no-verificable' },
    { id: '503', fichas: { A: R.estado(503) }, filtro: ['enuresis'], espera: 'no-verificable' },
    { id: 'importación paralela: ficha del original', nregistro: '97051006IP', fichas: { '97051006IP': R.json(SIN_SECCIONES), '97051006': R.json(s41('<p>Síndrome de piernas inquietas.</p>')) }, filtro: ['piernas inquietas'], espera: 'confirmado', fuente: 'original' },
    { id: 'importación paralela: el original no la tiene', nregistro: '111IP', fichas: { '111IP': R.json(SIN_SECCIONES), '111': R.json(s41('<p>Enfermedad de Parkinson.</p>')) }, filtro: ['piernas inquietas'], espera: 'descartado' },
    { id: 'importación paralela: ni propia ni original', nregistro: '222IP', fichas: { '222IP': R.json(SIN_SECCIONES), '222': R.json(SIN_SECCIONES) }, filtro: ['piernas inquietas'], espera: 'no-verificable' },
];

// --- La app ---------------------------------------------------------------------------------------
function cargarApp(fichas) {
    const fetchImpl = async (url) => {
        const u = new URL(url, 'https://cima.test');
        const f = fichas[u.searchParams.get('nregistro')] || R.json(SIN_SECCIONES);
        return {
            ok: f.status >= 200 && f.status < 300, status: f.status, statusText: String(f.status),
            headers: { get: (h) => (h.toLowerCase() === 'content-type' ? f.tipo : null) },
            text: async () => f.cuerpo,
        };
    };
    const sandbox = {
        window: {}, console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: fetchImpl, setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
        AbortSignal, AbortController, navigator: { onLine: true }, location: { search: '', href: '' },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${apiSrc}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    return new sandbox.window.__CimaAPI();
}

async function decisionApp(caso) {
    const api = cargarApp(caso.fichas);
    const n = caso.nregistro || 'A';
    const r = await api._filterIndicationResultsBySection([{ nregistro: n, nombre: n }], { section: '4.1', includeAny: caso.filtro });
    const m = r.resultados[0];
    if (!m) return { decision: 'descartado' };
    return m._sectionUnverified
        ? { decision: 'no-verificable', motivo: m._sectionMotivo, porRespuesta: r.summary.porRespuesta }
        : { decision: 'confirmado', fuente: m._sectionFuente };
}

// --- El auditor -----------------------------------------------------------------------------------
async function decisionAuditor(caso) {
    const fetchWithRetry = async (url) => {
        const f = caso.fichas[url.searchParams.get('nregistro')] || R.json(SIN_SECCIONES);
        return new Response(f.status === 204 ? null : f.cuerpo, { status: f.status, headers: { 'content-type': f.tipo } });
    };
    const leer = crearLectorSeccion({ base: 'https://cima.test/rest', fetchWithRetry });
    const s = await leer(caso.nregistro || 'A', '4.1');
    if (s.status !== 'success') return { decision: 'no-verificable', reason: s.reason };
    return CimaAuditor.casaFiltroSeccion(s.text, { includeAny: caso.filtro })
        ? { decision: 'confirmado', fuente: s.fuente }
        : { decision: 'descartado' };
}

console.log('— 1. Mismas respuestas, misma decisión en los dos lados —');
for (const caso of CASOS) {
    const app = await decisionApp(caso);
    const aud = await decisionAuditor(caso);
    ok(`${caso.id}: app → ${caso.espera}`, app.decision === caso.espera, JSON.stringify(app));
    ok(`${caso.id}: auditor → ${caso.espera}`, aud.decision === caso.espera, JSON.stringify(aud));
    if (caso.motivo) ok(`${caso.id}: la app lo marca con el motivo «${caso.motivo}» y lo cuenta aparte`, app.motivo === caso.motivo && app.porRespuesta === 1, JSON.stringify(app));
    if (caso.motivo === 'respuesta') ok(`${caso.id}: el auditor dice por qué no vale`, /respuesta no válida/.test(aud.reason || ''), aud.reason);
    if (caso.fuente) ok(`${caso.id}: los dos dicen que la ficha leída es la del ${caso.fuente}`, app.fuente === caso.fuente && aud.fuente === caso.fuente, `${app.fuente} / ${aud.fuente}`);
}

console.log('— 2. El auditor no lleva una lectura propia —');
{
    ok('importa el lector compartido (scripts/lib/lectura-41.mjs)', auditSrc.includes("from './lib/lectura-41.mjs'"));
    ok('ya no tiene su propio decodificador de entidades', !/function decodeEntities\b/.test(auditSrc) && !/NAMED_ENTITIES/.test(auditSrc));
    ok('ya no quita etiquetas con un espacio al leer la 4.1', !auditSrc.includes(".replace(/<[^>]*>/g, ' ')"));
    ok('ya no existe el estado «absent» en la lectura', !/status:\s*'absent'/.test(auditSrc));
    const lib = readFileSync(join(ROOT, 'scripts/lib/lectura-41.mjs'), 'utf8');
    ok('el lector carga cima-api.js, no una copia', lib.includes("'assets', 'js', 'cima-api.js'"));
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — app y auditor leen la 4.1 igual.');
process.exit(fallos ? 1 : 0);
