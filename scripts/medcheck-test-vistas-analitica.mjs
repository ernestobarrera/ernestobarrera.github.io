#!/usr/bin/env node
/**
 * MedCheck — contrato de las listas escritas a mano que describen las vistas y pestañas
 *
 * Nació de la auditoría del 30/09/2026. Una pestaña nueva del modal tiene que darse de alta en
 * CUATRO sitios que nadie cruzaba: el propio botón `data-tab`, `validModalTabs` (enlaces ?tab=),
 * `TAXONOMY` de analytics.html y `VISTAS_VALIDAS` del Worker, que vive en otro repositorio. Ese día
 * se encontró, todo verificado en navegador:
 *
 *   - `?tab=consult` y `?tab=financing` abrían Información (la app escribe esas URL al pulsar).
 *   - «Consultar IA» no se registró nunca: /track rechaza entero el evento de una vista desconocida.
 *   - la vista «Fármacos» (combo) llegaba al Worker como `combo` y se guardaba nula.
 *   - al cerrar una ficha, lo siguiente que se buscaba se registraba como su última pestaña.
 *   - Mi vademécum guardaba el ATC de nivel 3 (`atcs[0]`), y con metformina guardada SADMANS y
 *     monitorización afirmaban «ninguno».
 *
 * Las dos últimas se prueban EJECUTANDO el código real extraído de cima-app.js, no buscando texto.
 * Los contratos del Worker salen INCONCLUSO si no está el repo hermano, nunca en verde.
 *
 * Uso: node scripts/medcheck-test-vistas-analitica.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
const HTML = readFileSync(join(RAIZ, 'medcheck.html'), 'utf8');
const ANALYTICS = readFileSync(join(RAIZ, 'analytics.html'), 'utf8');

let fallos = 0;
let inconclusos = 0;
const ok = (nombre, cond, detalle) => {
  if (cond) { console.log(`  ok    ${nombre}`); return; }
  fallos++;
  console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

/** Cuerpo de un método de la clase: del primer `{` tras la firma a su llave de cierre. */
function cuerpoMetodo(firma) {
  const i = APP.indexOf(firma);
  if (i < 0) return null;
  const inicio = APP.indexOf('{', i + firma.length - 1);
  let prof = 0;
  for (let j = inicio; j < APP.length; j++) {
    if (APP[j] === '{') prof++;
    else if (APP[j] === '}' && --prof === 0) return APP.slice(inicio + 1, j);
  }
  return null;
}

// ─── Inventario del cliente ───────────────────────────────────────────────────────────────────
const pestanas = [...new Set([...APP.matchAll(/data-tab="([a-z_-]+)"/g)].map(m => m[1]))];
// Guarda: si el patrón dejara de casar, todo lo de abajo pasaría en verde sobre una lista vacía.
ok(`se localizan las pestañas del modal (${pestanas.length})`, pestanas.length >= 14, pestanas.join(','));

const listaTabs = (APP.match(/const validModalTabs = \[([^\]]*)\]/) || [])[1] || '';
const validModalTabs = [...listaTabs.matchAll(/'([a-z_-]+)'/g)].map(m => m[1]);
ok('se localiza validModalTabs', validModalTabs.length > 0);
for (const t of pestanas) ok(`?tab=${t} es un enlace válido`, validModalTabs.includes(t));

const mapaTxt = (APP.match(/MedCheckApp\._VIEW_ANALYTICS_MAP = \{([\s\S]*?)\};/) || [])[1] || '';
const mapa = Object.fromEntries([...mapaTxt.matchAll(/^\s*([a-z]+):\s*'([a-z]+)'/gm)].map(m => [m[1], m[2]]));
const vistasNav = [...new Set([...HTML.matchAll(/class="nav-tab[^"]*"[^>]*data-view="([a-z]+)"|data-view="([a-z]+)"[^>]*class="nav-tab/g)]
  .map(m => m[1] || m[2]))];
ok(`se localizan las vistas de navegación (${vistasNav.length})`, vistasNav.length >= 9, vistasNav.join(','));
const vistasEmitidas = vistasNav.map(v => mapa[v] || v);
for (const v of vistasNav) ok(`la vista ${v} se traduce para la analítica`, v in mapa, `emitiría «${v}» en crudo`);

// ─── analytics.html ───────────────────────────────────────────────────────────────────────────
const taxTxt = (ANALYTICS.match(/const TAXONOMY = \{([\s\S]*?)\n\};/) || [])[1] || '';
const taxonomia = new Set([...taxTxt.matchAll(/^\s*'?([a-z-]+)'?\s*:\s*\{/gm)].map(m => m[1]));
ok(`se localiza TAXONOMY (${taxonomia.size})`, taxonomia.size >= 20);
for (const t of pestanas) ok(`analytics.html rotula modal-${t}`, taxonomia.has(`modal-${t}`));
for (const v of vistasEmitidas) ok(`analytics.html rotula la vista ${v}`, taxonomia.has(v));
ok('analytics.html ya no llama «Documentos» a la pestaña docs', !/'modal-docs':\s*\{\s*label:\s*'Ficha — Documentos'/.test(ANALYTICS));

// ─── Worker (repo hermano) ────────────────────────────────────────────────────────────────────
const rutaWorker = join(RAIZ, '..', 'medcheck-worker', 'index.js');
if (!existsSync(rutaWorker)) {
  inconclusos++;
  console.log('INCONCLUSO: no está el repo hermano `medcheck-worker`, así que VISTAS_VALIDAS NO se comprueba aquí');
} else {
  const WORKER = readFileSync(rutaWorker, 'utf8');
  const setTxt = (WORKER.match(/const VISTAS_VALIDAS = new Set\(\[([\s\S]*?)\]\);/) || [])[1] || '';
  const validas = new Set([...setTxt.matchAll(/'([a-z-]+)'/g)].map(m => m[1]));
  ok(`se localiza VISTAS_VALIDAS (${validas.size})`, validas.size >= 20);
  for (const t of pestanas) ok(`el Worker acepta modal-${t}`, validas.has(`modal-${t}`), '/track rechazaría el evento entero');
  for (const v of vistasEmitidas) ok(`el Worker acepta la vista ${v}`, validas.has(v), 'se guardaría nula');
}

// ─── Vista de analítica al cerrar la ficha ────────────────────────────────────────────────────
{
  const cuerpo = cuerpoMetodo('    closeModal() {');
  ok('se localiza closeModal', !!cuerpo);
  const global = {};
  const app = { modal: { classList: { contains: () => false, add() {} } }, currentView: 'combo', isPopstateNavigation: true, _marcarTarjetaEnPanel() {} };
  new Function('window', 'MedCheckApp', 'document', cuerpo).call(app, global, { _VIEW_ANALYTICS_MAP: mapa }, { activeElement: null });
  ok('al cerrar la ficha la vista vuelve a la de fondo', global._mcCurrentView === 'interacciones', `quedó «${global._mcCurrentView}»`);
}

// ─── Favorito: ATC hoja y reglas por prefijo ──────────────────────────────────────────────────
{
  // Cadena real de CIMA para DIANBEN 850 mg (nregistro 55211), 30/09/2026.
  const dianben = {
    nregistro: '55211', nombre: 'DIANBEN 850 mg COMPRIMIDOS RECUBIERTOS CON PELICULA', pactivos: 'METFORMINA HIDROCLORURO',
    atcs: [
      { codigo: 'A10B', nombre: 'FARMACOS HIPOGLUCEMIANTES EXCLUYENDO INSULINAS', nivel: 3 },
      { codigo: 'A10BA', nombre: 'Biguanidas', nivel: 4 },
      { codigo: 'A10BA02', nombre: 'Metformina', nivel: 5 },
    ],
  };
  const construir = new Function('med', 'extra', cuerpoMetodo('    _buildFavoriteRecord(med, extra = {}) {'));
  const incompleto = new Function('f', cuerpoMetodo('    _favAtcIncompleto(f) {'));
  const reglasTxt = (APP.match(/this\.SADMANS_RULES = (\[[\s\S]*?\]);/) || [])[1];
  const ctx = { _inferAtcLetter: () => '', SADMANS_RULES: new Function(`return ${reglasTxt}`)() };
  const sadmans = new Function('f', cuerpoMetodo('    _sadmansRuleCategory(f) {'));

  const fav = construir.call(ctx, dianben, {});
  ok('el favorito guarda el ATC de nivel 5', fav.atcCodigo === 'A10BA02', `guardó ${fav.atcCodigo}`);
  ok('el rótulo de grupo sigue siendo el de nivel 3', fav.atcNombre === 'FARMACOS HIPOGLUCEMIANTES EXCLUYENDO INSULINAS');
  ok('agrupación L1/L2 intacta', fav.atcNivel1 === 'A' && fav.atcNivel2 === 'A10');
  ok('marca atcHoja', fav.atcHoja === true);
  ok('metformina entra en SADMANS', sadmans.call(ctx, fav) === 'Metformina');
  ok('un favorito nuevo no pide reparación', incompleto.call(ctx, fav) === false);

  // MUTANTE: el registro tal como se guardaba antes del arreglo.
  const antiguo = { ...fav, atcCodigo: 'A10B' };
  delete antiguo.atcHoja;
  ok('MUTANTE: con el ATC de nivel 3 SADMANS no casa (por eso se avisa)', sadmans.call(ctx, antiguo) === null);
  ok('un favorito antiguo pide reparación', incompleto.call(ctx, antiguo) === true);
  ok('un ATC inferido por nombre no pide reparación eterna', incompleto.call(ctx, { ...antiguo, atcInferido: true }) === false);

  // Reparar: el favorito antiguo con la ficha encima recupera la hoja.
  const reparado = construir.call(ctx, { ...antiguo, ...dianben }, { tags: ['x'] });
  ok('reparar sustituye el ATC truncado', reparado.atcCodigo === 'A10BA02' && reparado.atcHoja === true && reparado.tags[0] === 'x');

  // Sin nivel 5 (hay registros así): la hoja más profunda disponible, no el nivel 3.
  const sinCinco = construir.call(ctx, { ...dianben, atcs: dianben.atcs.slice(0, 2) }, {});
  ok('sin nivel 5 se toma el más profundo', sinCinco.atcCodigo === 'A10BA');
}

console.log(`\n${fallos === 0 ? 'OK' : `${fallos} FALLO(S)`}${inconclusos ? ` · ${inconclusos} INCONCLUSO` : ''}`);
process.exit(fallos === 0 ? 0 : 1);
