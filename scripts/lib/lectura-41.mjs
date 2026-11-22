/**
 * Lectura de la sección 4.1 para los scripts de Node, con EL MISMO contrato que el cliente.
 *
 * POR QUÉ EXISTE (R3 de la revisión de Codex, 22/11/2026). `medcheck-audit-ontology.mjs` leía la
 * 4.1 con su propio código y divergía del navegador en cuatro puntos, todos hacia el lado de
 * certificar sin haber leído:
 *   - quitaba cada etiqueta con un espacio: `cardia</span><span>ca` quedaba «cardia ca»;
 *   - no probaba la ficha del registro original de una importación paralela;
 *   - un array vacío llegaba como lectura con éxito y texto vacío;
 *   - el `{"error":"No existen secciones…"}` de CIMA se traducía en «ausente», y la reconciliación
 *     saltaba lo ausente: una ficha no leída salía del universo de verdad y la pasada aprobaba.
 *
 * Ahora la validación de la respuesta (`htmlSeccionCriba`: solo vale un JSON que declare la
 * sección pedida; otra sección o una página de error con HTTP 200 es inconclusa), la lectura con el original
 * (`leerSeccionCriba`), la normalización (`normalizarTextoCriba`, que pasa por `textoFT`) y el
 * casado (`casaFiltroSeccion`, `terminoEnTextoCriba`) son las funciones ESTÁTICAS de
 * `assets/js/cima-api.js`, cargadas de ese mismo archivo. Aquí solo se pone la red.
 *
 * El resultado tiene dos estados y ninguno es «no tiene la indicación» por no haber podido mirar:
 *   - `success`: `{ text (normalizado), plain (como en pantalla), fuente: 'propia'|'original', registro }`.
 *   - `unknown`: `{ reason, estado: 'sin-texto'|'error' }`. Sin texto que leer, ni propio ni del
 *     original, NO es una ausencia clínica: quien lo reciba debe dejar la pasada inconclusa.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * La clase `CimaAPI` del navegador, evaluada en un contexto aislado. Solo se usan sus funciones
 * estáticas puras. El archivo crea al final una instancia global, cuyo constructor pide la
 * ontología: aquí `fetch` falla siempre (y la instancia lo tolera), así que nada sale a la red.
 */
export function cargarCimaAPI(raiz = RAIZ) {
  const src = readFileSync(join(raiz, 'assets', 'js', 'cima-api.js'), 'utf8');
  const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('lectura-41: sin red en el contexto aislado')),
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
    AbortSignal, AbortController,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${src}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
  return sandbox.window.__CimaAPI;
}

export const CimaAPI = cargarCimaAPI();

function sinContenido(motivo) {
  const err = new Error(motivo);
  err.code = 'NO_CONTENT';
  return err;
}

/**
 * Crea `fetchSectionText(nregistro, section)` sobre la red que se le dé.
 * @param {object} p
 * @param {string} p.base - raíz de la REST de CIMA
 * @param {(url: URL, opts: object) => Promise<Response>} p.fetchWithRetry - con los reintentos del
 *   llamador; si se agotan, lanza (y eso es `unknown`)
 */
export function crearLectorSeccion({ base, fetchWithRetry }) {
  // Misma red que `CimaAPI._request`: 204 o cuerpo vacío son «aquí no hay texto»; cualquier otro
  // no-OK, o un JSON roto, es un fallo de lectura. La respuesta se devuelve SIN interpretar: la
  // valida `leerSeccionCriba` con `htmlSeccionCriba`, como en el cliente.
  const leer = async (nregistro, section) => {
    const url = new URL(`${base}/docSegmentado/contenido/1`);
    url.searchParams.set('nregistro', nregistro);
    url.searchParams.set('seccion', section);
    const r = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
    if (r.status === 204) throw sinContenido('HTTP 204');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.text();
    if (!raw) throw sinContenido('respuesta vacía');
    const tipo = r.headers?.get?.('content-type') || '';
    const data = tipo.includes('application/json') ? JSON.parse(raw) : raw;
    return data;
  };

  return async function fetchSectionText(nregistro, section = '4.1') {
    try {
      const l = await CimaAPI.leerSeccionCriba(nregistro, (nr) => leer(nr, section), section);
      if (l.estado === 'texto') {
        return { status: 'success', text: l.texto, plain: l.plano, fuente: l.fuente, registro: l.registro };
      }
      if (l.estado === 'sin-texto') {
        return { status: 'unknown', estado: 'sin-texto', text: '', reason: 'sin texto segmentado, ni propio ni del registro original' };
      }
      return { status: 'unknown', estado: 'error', text: '', reason: l.error?.message || 'lectura fallida' };
    } catch (error) {
      return { status: 'unknown', estado: 'error', text: '', reason: error.message };
    }
  };
}
