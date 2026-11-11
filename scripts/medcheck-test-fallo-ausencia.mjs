#!/usr/bin/env node
/**
 * MedCheck — una ficha que no se pudo leer NUNCA se pinta como «no aparece».
 *
 * QUÉ PASÓ (revisión de Fable, 11/11/2026, hallazgos 1 y 2; reproducidos en sandbox):
 *   - Interacciones (4.5): con CIMA caído, `analyzeInteractions` tragaba el error con un
 *     `console.warn`, devolvía `status: 'success'` y 0 menciones, y la pantalla decía «No se
 *     encontraron menciones cruzadas… en las secciones 4.5 de sus fichas técnicas» sin haber leído
 *     ninguna. En favoritos, con el check verde.
 *   - Síntoma (4.8): el fallo devolvía lo mismo que «no aparece». Pantalla: «No encontrado» con el
 *     check verde, y «el resto de medicamentos no mencionan estos términos» de fichas que no se
 *     abrieron.
 * Son las dos preguntas clínicas directas («¿interaccionan?», «¿puede ser del fármaco?») en las que
 * la respuesta equivocada es un «no» tranquilizador.
 *
 * LA REGLA QUE FIJA ESTE BANCO: el texto de ausencia solo sale cuando no queda ninguna ficha sin
 * leer. Un cero REAL (fichas leídas, sin mención) sigue siendo un cero.
 *
 * CÓMO: la red se corta de verdad (`fetch` rechazado) y la petición recorre el `_request` y el
 * `getDocSeccion` reales; no se simula el error un nivel más arriba. Las pantallas se pintan con
 * los métodos reales de `MedCheckApp` sobre un DOM mínimo.
 *
 * Uso: node scripts/medcheck-test-fallo-ausencia.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Red controlable ──────────────────────────────────────────────────────────────────────────
// `red(url)` decide qué pasa con cada petición: devolver un objeto { status, body } o lanzar.
let red = () => { throw new TypeError('Failed to fetch'); };
const respuesta = ({ status = 200, body = '' }) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});
const fetchFalso = async (url) => respuesta(await red(String(url)));

// ── DOM mínimo ───────────────────────────────────────────────────────────────────────────────
const nodos = new Map();
const nodo = (id) => {
    if (!nodos.has(id)) nodos.set(id, { id, innerHTML: '', disabled: false, value: '' });
    return nodos.get(id);
};
const sandbox = {
    window: {},
    document: { addEventListener() { }, getElementById: (id) => (id === 'symptom-search' ? null : nodo(id)) },
    console: { log() { }, warn() { }, error() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    fetch: fetchFalso,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, AbortSignal, TextEncoder,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${apiSrc}\n;window.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
vm.runInContext(`${appSrc}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const CimaAPI = sandbox.window.__CimaAPIClass;
const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof CimaAPI !== 'function' || typeof MedCheckApp !== 'function') {
    console.error('No se pudieron cargar CimaAPI y MedCheckApp');
    process.exit(1);
}

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok     ${nombre}`); return; }
    fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`);
};

// ── Fichas de prueba ─────────────────────────────────────────────────────────────────────────
const SINTROM = { nregistro: '51001', nombre: 'SINTROM 4 mg COMPRIMIDOS', pactivos: 'ACENOCUMAROL' };
const IBU = { nregistro: '62001', nombre: 'IBUPROFENO CINFA 600 mg', pactivos: 'IBUPROFENO' };
const OME = { nregistro: '73001', nombre: 'OMEPRAZOL CINFA 20 mg', pactivos: 'OMEPRAZOL' };
const seccion = (n, texto) => [{ seccion: n, titulo: `${n}. Sección`, contenido: `<p>${texto}</p>`, orden: 1 }];
const TEXTO_45_SINTROM = 'Los antiinflamatorios no esteroideos, como el ibuprofeno, potencian el efecto anticoagulante y aumentan el riesgo de hemorragia.';
const TEXTO_45_NEUTRO = 'No se han descrito interacciones clínicamente relevantes con otros medicamentos de uso habitual en la práctica.';
const TEXTO_48_SANGRADO = 'Muy frecuentes: hemorragia de cualquier localización, equimosis y hematomas en pacientes anticoagulados.';
const TEXTO_48_NEUTRO = 'Frecuentes: cefalea, dolor abdominal, estreñimiento, diarrea, flatulencia y náuseas o vómitos.';

/** La red sirve `fichas[nregistro:seccion]`; `'CORTE'` = sin red, `'204'` = CIMA sin la sección. */
const conRed = (fichas) => (url) => {
    const u = new URL(url.replace(/^.*?\/docSegmentado/, 'https://x/docSegmentado'));
    const clave = `${u.searchParams.get('nregistro')}:${u.searchParams.get('seccion')}`;
    const f = fichas[clave];
    if (f === undefined || f === 'CORTE') throw new TypeError('Failed to fetch');
    if (f === '503') return { status: 503, body: { error: 'no disponible' } };
    if (f === '204') return { status: 204, body: '' };
    return { status: 200, body: f };
};
const nuevaApi = () => { const api = new CimaAPI(); api.useProxy = false; return api; };

// ── 1. Capa de datos ─────────────────────────────────────────────────────────────────────────
console.log('\n— Interacciones (4.5), capa de datos —');
{
    red = conRed({});
    const r = await nuevaApi().analyzeInteractions([SINTROM, IBU]);
    ok('red cortada: las dos fichas constan como no leídas', r.noLeidas?.length === 2, JSON.stringify(r.noLeidas));
    ok('red cortada: el motivo es «fallo» (admite reintento)', r.noLeidas?.every(f => f.motivo === 'fallo'));
    ok('red cortada: ninguna sección cuenta como analizada', r.sectionsAnalyzed === 0);

    red = conRed({ '51001:4.5': '503', '62001:4.5': seccion('4.5', TEXTO_45_NEUTRO) });
    const r2 = await nuevaApi().analyzeInteractions([SINTROM, IBU]);
    ok('un 503 en una de dos: esa no leída, la otra sí', r2.noLeidas?.length === 1 && r2.noLeidas[0].nregistro === '51001' && r2.sectionsAnalyzed === 1, JSON.stringify(r2));

    red = conRed({ '51001:4.5': '204', '62001:4.5': seccion('4.5', TEXTO_45_NEUTRO) });
    const r3 = await nuevaApi().analyzeInteractions([SINTROM, IBU]);
    ok('204 de CIMA: no leída con motivo «sin_seccion», no «fallo»', r3.noLeidas?.length === 1 && r3.noLeidas[0].motivo === 'sin_seccion', JSON.stringify(r3.noLeidas));

    red = conRed({ '51001:4.5': seccion('4.5', TEXTO_45_SINTROM), '62001:4.5': 'CORTE' });
    const r4 = await nuevaApi().analyzeInteractions([SINTROM, IBU]);
    ok('lo que sí se leyó se sigue encontrando (SINTROM → ibuprofeno)', r4.interactions?.length === 1 && r4.noLeidas?.length === 1, JSON.stringify(r4));

    red = conRed({ '51001:4.5': seccion('4.5', TEXTO_45_NEUTRO), '62001:4.5': seccion('4.5', 'No procede.') });
    const r5 = await nuevaApi().analyzeInteractions([SINTROM, IBU]);
    ok('cero REAL: las dos leídas (también la de texto corto), sin no leídas', r5.noLeidas?.length === 0 && r5.interactions.length === 0 && r5.sectionsAnalyzed === 2, JSON.stringify(r5));
}

console.log('\n— Síntoma (4.8), capa de datos —');
{
    red = conRed({});
    const r = await nuevaApi().analyzeSymptom([SINTROM, IBU, OME], 'hemorragia');
    ok('red cortada: las tres fichas no leídas, ninguna coincidencia', r.noLeidas?.length === 3 && r.matches.length === 0, JSON.stringify(r));

    red = conRed({ '51001:4.8': seccion('4.8', TEXTO_48_SANGRADO), '62001:4.8': 'CORTE', '73001:4.8': seccion('4.8', TEXTO_48_NEUTRO) });
    const r2 = await nuevaApi().analyzeSymptom([SINTROM, IBU, OME], 'hemorragia');
    ok('parcial: 1 coincidencia, 1 no leída', r2.matches.length === 1 && r2.noLeidas?.length === 1 && r2.noLeidas[0].nregistro === '62001', JSON.stringify(r2));

    red = conRed({ '51001:4.8': seccion('4.8', TEXTO_48_NEUTRO), '62001:4.8': seccion('4.8', TEXTO_48_NEUTRO) });
    const r3 = await nuevaApi().analyzeSymptom([SINTROM, IBU], 'hemorragia');
    ok('cero REAL: leídas y sin el término, sin no leídas', r3.matches.length === 0 && r3.noLeidas?.length === 0, JSON.stringify(r3));
}

// ── 2. Pantallas ─────────────────────────────────────────────────────────────────────────────
const nuevaApp = (meds) => {
    const app = Object.create(MedCheckApp.prototype);
    app.api = nuevaApi();
    app.comboDrugList = meds;
    app.showToast = () => { };
    return app;
};
const SIN_COINCIDENCIAS = 'Sin coincidencias por nombre';
const NO_ENCONTRADO = 'No encontrado';

console.log('\n— Pantalla de interacciones (vista Fármacos), red cortada de punta a punta —');
{
    red = conRed({});
    const app = nuevaApp([SINTROM, IBU]);
    await app.performInteractionAnalysis();
    const html = nodo('interactions-results').innerHTML;
    ok('NO dice «Sin coincidencias»', !html.includes(SIN_COINCIDENCIAS) && !html.includes('No se encontraron menciones'), html.slice(0, 300));
    ok('dice que no se pudo leer ninguna 4.5', html.includes('No se pudo leer la sección 4.5 de ningún medicamento'));
    ok('nombra las fichas y ofrece Reintentar', html.includes('SINTROM 4 mg') && html.includes('IBUPROFENO CINFA') && html.includes('app.performInteractionAnalysis()'));

    red = conRed({ '51001:4.5': seccion('4.5', TEXTO_45_NEUTRO), '62001:4.5': 'CORTE' });
    await app.performInteractionAnalysis();
    const h2 = nodo('interactions-results').innerHTML;
    ok('parcial sin menciones: «Búsqueda incompleta», no «Sin coincidencias»', h2.includes('Búsqueda incompleta') && h2.includes('1 de 2') && !h2.includes(SIN_COINCIDENCIAS), h2.slice(0, 300));

    red = conRed({ '51001:4.5': seccion('4.5', TEXTO_45_SINTROM), '62001:4.5': 'CORTE' });
    await app.performInteractionAnalysis();
    const h3 = nodo('interactions-results').innerHTML;
    ok('parcial CON mención: se pinta la mención y además el aviso', h3.includes('1 coincidencia') && h3.includes('Búsqueda incompleta') && h3.includes('solo de las fichas que sí se leyeron'));

    red = conRed({ '51001:4.5': seccion('4.5', TEXTO_45_NEUTRO), '62001:4.5': seccion('4.5', TEXTO_45_NEUTRO) });
    await app.performInteractionAnalysis();
    const h4 = nodo('interactions-results').innerHTML;
    ok('cero REAL: sigue diciendo «Sin coincidencias» y sin aviso', h4.includes(SIN_COINCIDENCIAS) && !h4.includes('No se pudo leer') && !h4.includes('Búsqueda incompleta'));

    red = conRed({ '51001:4.5': '204', '62001:4.5': '204' });
    await app.performInteractionAnalysis();
    const h5 = nodo('interactions-results').innerHTML;
    ok('solo 204: dice que CIMA no ofrece la sección y NO ofrece Reintentar', h5.includes('CIMA no ofrece la sección 4.5') && !h5.includes('Reintentar') && !h5.includes(SIN_COINCIDENCIAS));
}

console.log('\n— Pantalla de síntoma (vista Fármacos), red cortada de punta a punta —');
{
    red = conRed({});
    const app = nuevaApp([SINTROM, IBU, OME]);
    app._comboSymptoms = ['hemorragia'];
    await app.performSymptomAnalysis();
    const html = nodo('adverse-results').innerHTML;
    ok('NO dice «No encontrado» ni pinta el check verde', !html.includes(NO_ENCONTRADO) && !html.includes('check-circle') && !html.includes('safety-check-item safe'), html.slice(0, 300));
    ok('dice que no se pudo leer ninguna 4.8 y ofrece Reintentar', html.includes('No se pudo leer la sección 4.8 de ningún medicamento') && html.includes('app.performSymptomAnalysis()'));

    red = conRed({ '51001:4.8': seccion('4.8', TEXTO_48_SANGRADO), '62001:4.8': 'CORTE', '73001:4.8': seccion('4.8', TEXTO_48_NEUTRO) });
    await app.performSymptomAnalysis();
    const h2 = nodo('adverse-results').innerHTML;
    ok('parcial: «el resto» cuenta solo los leídos (1), no los 2 sin coincidencia', h2.includes('El resto de medicamentos leídos (1)') && !h2.includes('(2) no mencionan'), h2.match(/El resto[^<]*/)?.[0] || '(sin «el resto»)');
    ok('parcial: aviso con la ficha no leída', h2.includes('Búsqueda incompleta') && h2.includes('IBUPROFENO CINFA'));

    red = conRed({ '51001:4.8': seccion('4.8', TEXTO_48_NEUTRO), '62001:4.8': seccion('4.8', TEXTO_48_NEUTRO), '73001:4.8': seccion('4.8', TEXTO_48_NEUTRO) });
    await app.performSymptomAnalysis();
    const h3 = nodo('adverse-results').innerHTML;
    ok('cero REAL: sigue diciendo «No encontrado»', h3.includes(NO_ENCONTRADO) && !h3.includes('No se pudo leer'));

    // Dos síntomas: en uno falla la red y en el otro CIMA dice 204 para la misma ficha.
    const app2 = nuevaApp([SINTROM]);
    const unidas = app2._unirFichasNoLeidas([
        [{ nregistro: '51001', nombre: 'SINTROM', motivo: 'sin_seccion' }],
        [{ nregistro: '51001', nombre: 'SINTROM', motivo: 'fallo' }],
    ]);
    ok('varios síntomas: una ficha cuenta una vez, y manda el «fallo»', unidas.length === 1 && unidas[0].motivo === 'fallo', JSON.stringify(unidas));
}

console.log('\n— Interacciones de favoritos (Mi Perfil), red cortada —');
{
    red = conRed({});
    const app = nuevaApp([]);
    app.getFavorites = () => [
        { nregistro: SINTROM.nregistro, nombre: SINTROM.nombre, principioActivo: SINTROM.pactivos },
        { nregistro: IBU.nregistro, nombre: IBU.nombre, principioActivo: IBU.pactivos },
    ];
    nodo('btn-analyze-interactions');
    await app._runInteractionAnalysis();
    const html = nodo('interaction-analysis-result').innerHTML;
    ok('NO dice «No se detectaron menciones» ni pinta el check verde', !html.includes('No se detectaron') && !html.includes('#10b981'), html.slice(0, 300));
    ok('dice que no se pudo leer y ofrece Reintentar', html.includes('No se pudo leer la sección 4.5') && html.includes('app._runInteractionAnalysis()'));

    red = conRed({ '51001:4.5': seccion('4.5', TEXTO_45_NEUTRO), '62001:4.5': seccion('4.5', TEXTO_45_NEUTRO) });
    await app._runInteractionAnalysis();
    ok('cero REAL en favoritos: sigue el «No se detectaron menciones»', nodo('interaction-analysis-result').innerHTML.includes('No se detectaron'));
}

console.log('\n— El nombre de la ficha se escapa —');
{
    const app = nuevaApp([]);
    const html = app._avisoFichasNoLeidas([{ nregistro: '1', nombre: '<img src=x onerror=alert(1)>', motivo: 'fallo' }], '4.5', 2, false, 'x()');
    ok('sin HTML inyectado en el aviso', !html.includes('<img') && html.includes('&lt;img'));
    ok('sin fichas no leídas, el aviso está vacío', app._avisoFichasNoLeidas([], '4.5', 2, false, 'x()') === '');
}

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
