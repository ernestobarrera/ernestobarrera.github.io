#!/usr/bin/env node
/**
 * MedCheck — test del contrato único de filtrado y faceting.
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm + shims mínimos) y ejercita
 * el núcleo de filtrado sobre un fixture determinista. El núcleo es puro (no toca DOM),
 * así que se invoca sobre un `this` desnudo del prototipo con `filterState` y
 * `groupingState` inyectados.
 *
 * Doctrina que fija este test:
 *   - AND entre dimensiones distintas, OR dentro de una misma dimensión multiselección;
 *   - genérico y biosimilar son UNA dimensión ("tipo de producto"): marcar ambos es OR,
 *     nunca AND (un AND daría siempre cero y en su día lo daba en la vista Indicaciones);
 *   - los contadores son DISYUNTIVOS: cada opción cuenta con las demás dimensiones
 *     aplicadas y la suya excluida — el defecto que se corrige aquí es que el contador
 *     "Biosimilar" seguía mostrando el total del universo tras facetar por principio
 *     activo (caso `epoetina`, reproducido literalmente abajo);
 *   - "Limpiar N" cuenta exactamente los filtros que limpia;
 *   - el estado sobrevive al round-trip por URL, facetas incluidas.
 *
 * Las cifras del caso `epoetina` NO se consultan en vivo: se fijan como fixture derivado
 * del sondeo del 2026-08-03 contra CIMA (60 comercializados, 22 biosimilares, PA
 * `epoetina alfa` = 17 resultados de los que 11 son biosimilares). Un test que dependa de
 * CIMA en vivo es frágil; lo que aquí se prueba es la INVARIANTE, no el número.
 *
 * Uso: node scripts/medcheck-test-filters.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
    // `findStaticATCCategory` lee este árbol; en producción lo aporta cima-api.js, que se
    // carga antes. Aquí basta un stub de tres niveles para ejercitar la miga de pan.
    CimaAPI: {
        ATC_CATEGORIES: [{
            code: 'N', name: 'Sistema nervioso',
            subcategories: [{
                code: 'N02', name: 'Analgésicos',
                subcategories: [{ code: 'N02B', name: 'Otros analgésicos y antipiréticos' }],
            }],
        }],
    },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });

const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function') {
    console.error('No se pudo cargar la clase MedCheckApp');
    process.exit(1);
}

let failures = 0;
function check(name, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.log(`  FALLO  ${name}\n         esperado: ${JSON.stringify(expected)}\n         obtenido: ${JSON.stringify(got)}`);
    } else {
        console.log(`  ok     ${name}`);
    }
}

// ─── Fixture ──────────────────────────────────────────────────────────────────
// Universo sintético que reproduce la topología del caso real `epoetina`:
// varios principios activos bajo la misma búsqueda, con biosimilares repartidos
// de forma desigual entre ellos.
const med = (o) => ({
    nregistro: o.nr, nombre: o.nr, generico: false, biosimilar: false, receta: true, comerc: true,
    vtm: { nombre: o.pa }, principiosActivos: [{ nombre: o.pa }],
    formaFarmaceutica: { nombre: o.forma || 'SOLUCION INYECTABLE' },
    labtitular: o.lab || 'Lab A',
    viasAdministracion: [{ nombre: o.via || 'Parenteral' }],
    dosis: o.dosis || '1000 UI',
    ...o,
});

// 6 PA. `epoetina alfa`: 4 productos, 2 biosimilares. `epoetina dseta`: 3, todos biosimilares.
// `darbepoetina alfa`: 3, ninguno biosimilar.
const UNIVERSO = [
    med({ nr: 'EPREX-1', pa: 'epoetina alfa' }),
    med({ nr: 'EPREX-2', pa: 'epoetina alfa', forma: 'SOLUCION INYECTABLE EN JERINGA' }),
    med({ nr: 'BINOCRIT-1', pa: 'epoetina alfa', biosimilar: true, lab: 'Lab B' }),
    med({ nr: 'BINOCRIT-2', pa: 'epoetina alfa', biosimilar: true, lab: 'Lab B', dosis: '2000 UI' }),
    med({ nr: 'RETACRIT-1', pa: 'epoetina dseta', biosimilar: true, lab: 'Lab C' }),
    med({ nr: 'RETACRIT-2', pa: 'epoetina dseta', biosimilar: true, lab: 'Lab C', dosis: '2000 UI' }),
    med({ nr: 'SILAPO-1', pa: 'epoetina dseta', biosimilar: true, lab: 'Lab D' }),
    med({ nr: 'ARANESP-1', pa: 'darbepoetina alfa' }),
    med({ nr: 'ARANESP-2', pa: 'darbepoetina alfa', dosis: '2000 UI' }),
    med({ nr: 'ARANESP-3', pa: 'darbepoetina alfa', receta: false }),
    // Un genérico que NO es biosimilar, para probar la dimensión "tipo de producto".
    med({ nr: 'GEN-1', pa: 'epoetina beta', generico: true, lab: 'Lab E' }),
    // Un producto con otra vía/forma, para cruces de dimensiones.
    med({ nr: 'ORAL-1', pa: 'epoetina beta', via: 'Oral', forma: 'COMPRIMIDO RECUBIERTO', lab: 'Lab E' }),
];

/** Construye una app con el estado de filtros pedido. */
function appWith({ generic = false, biosimilar = false, receta = false, form = null, lab = null,
                   doses = [], routes = [], pas = [] } = {}) {
    const app = Object.create(MedCheckApp.prototype);
    app.filterState = {
        form, lab, doses: new Set(doses),
        efgOnly: generic, recetaOnly: receta, biosimilarOnly: biosimilar,
    };
    app.groupingState = {
        routeFilters: new Set(routes),
        activeIngredientFilters: new Set(pas),
        groupBy: 'activeIngredient', sortBy: 'nameAsc',
    };
    app.lastSearchFilters = { comerc: true, searchType: 'smart' };
    app.lastSearchQuery = 'epoetina';
    return app;
}
const names = (app) => app._applyResultFilters(UNIVERSO, app._filterSnapshot()).map(m => m.nregistro).sort();
const count = (app) => app._applyResultFilters(UNIVERSO, app._filterSnapshot()).length;

console.log('\n— Semántica del contrato —');

// Sin facetas: el universo entero.
check('sin facetas devuelve el universo', count(appWith()), UNIVERSO.length);

// OR dentro de la dimensión "tipo de producto".
check('solo biosimilar', count(appWith({ biosimilar: true })), 5);
check('solo genérico', count(appWith({ generic: true })), 1);
check('genérico + biosimilar = OR (no AND, que daría 0)',
    count(appWith({ generic: true, biosimilar: true })), 6);

// AND entre dimensiones distintas.
check('biosimilar AND receta', count(appWith({ biosimilar: true, receta: true })), 5);
check('biosimilar AND lab "Lab C"', count(appWith({ biosimilar: true, lab: 'Lab C' })), 2);
check('forma AND lab (dimensiones distintas)',
    count(appWith({ form: 'SOLUCION INYECTABLE', lab: 'Lab B' })), 2);
check('vía AND dosis', count(appWith({ routes: ['Parenteral'], doses: ['2000 UI'] })), 3);

// OR dentro de multiselección.
check('multiselección de PA es OR',
    count(appWith({ pas: ['epoetina alfa', 'epoetina dseta'] })), 7);
check('multiselección de vía es OR',
    count(appWith({ routes: ['Parenteral', 'Oral'] })), UNIVERSO.length);
check('multiselección de dosis es OR',
    count(appWith({ doses: ['1000 UI', '2000 UI'] })), UNIVERSO.length);

// Intersección PA + tipo de producto — el caso que originó el encargo.
check('PA epoetina alfa AND biosimilar',
    names(appWith({ pas: ['epoetina alfa'], biosimilar: true })), ['BINOCRIT-1', 'BINOCRIT-2']);
check('PA darbepoetina alfa AND biosimilar = 0 (no hay ninguno)',
    count(appWith({ pas: ['darbepoetina alfa'], biosimilar: true })), 0);

console.log('\n— Contadores disyuntivos (el defecto `epoetina`) —');

// El contador de "Biosimilar" DEBE reflejar la faceta de PA activa.
const conPA = appWith({ pas: ['epoetina alfa'] });
const snapPA = conPA._filterSnapshot();
check('resultados visibles con PA epoetina alfa', count(conPA), 4);
check('contador Biosimilar respeta la faceta de PA (antes mostraba el total del universo)',
    conPA._disjunctiveCount(UNIVERSO, snapPA, 'productType', m => m.biosimilar === true), 2);
check('contador Genérico respeta la faceta de PA',
    conPA._disjunctiveCount(UNIVERSO, snapPA, 'productType', m => m.generico === true), 0);

// INVARIANTE general, independiente de cifras: para cualquier estado, el contador de una
// opción es exactamente el número de resultados que quedarían al aplicarla.
const escenarios = [
    {}, { biosimilar: true }, { receta: true }, { pas: ['epoetina alfa'] },
    { pas: ['epoetina dseta'], receta: true }, { lab: 'Lab B' },
    { form: 'SOLUCION INYECTABLE', doses: ['1000 UI'] },
    { routes: ['Parenteral'], pas: ['epoetina alfa', 'epoetina dseta'] },
];
let invarianteOk = true;
for (const esc of escenarios) {
    const a = appWith(esc);
    const snap = a._filterSnapshot();
    // Contador de "Biosimilar" == resultados al marcar biosimilar sobre ese mismo estado.
    const contador = a._disjunctiveCount(UNIVERSO, snap, 'productType', m => m.biosimilar === true);
    const real = count(appWith({ ...esc, generic: false, biosimilar: true }));
    if (contador !== real) {
        invarianteOk = false;
        console.log(`         escenario ${JSON.stringify(esc)}: contador=${contador} real=${real}`);
    }
}
check(`invariante contador==resultados en ${escenarios.length} escenarios`, invarianteOk, true);

// Un contador a cero no debe hacer desaparecer una opción ya marcada (si no, no se
// podría desmarcar). Se comprueba a nivel de dato: el conteo es 0 pero el estado sigue.
const cero = appWith({ pas: ['darbepoetina alfa'], biosimilar: true });
check('opción marcada con contador 0 conserva su estado',
    [cero._disjunctiveCount(UNIVERSO, cero._filterSnapshot(), 'productType', m => m.biosimilar === true),
     cero._filterSnapshot().biosimilar], [0, true]);

console.log('\n— "Limpiar N" —');
const varios = appWith({ biosimilar: true, receta: true, form: 'SOLUCION INYECTABLE',
    lab: 'Lab B', doses: ['1000 UI', '2000 UI'], routes: ['Parenteral'], pas: ['epoetina alfa'] });
check('cuenta cada dimensión activa (2 dosis cuentan 2)', varios._activeFilterCount(), 8);
varios._clearAllResultFilters();
check('tras limpiar, cero filtros activos', varios._activeFilterCount(), 0);
check('tras limpiar, universo íntegro', count(varios), UNIVERSO.length);

console.log('\n— Round-trip por URL —');
const origen = appWith({ biosimilar: true, receta: true, form: 'SOLUCION INYECTABLE',
    lab: 'Lab B', doses: ['2000 UI'], routes: ['Parenteral'], pas: ['epoetina alfa'] });
origen.currentView = 'search';
const params = origen._searchURLParams();
check('la URL serializa todas las facetas',
    Object.keys(params).sort(),
    ['biosimilar', 'comerc', 'dose', 'form', 'lab', 'pa', 'q', 'receta', 'route', 'type', 'view']);

const destino = appWith({});
destino.initGroupingState = function () { this.groupingState = { routeFilters: new Set(), activeIngredientFilters: new Set() }; };
destino._syncTopFilterCheckboxes = function () {};
destino._restoreFiltersFromURL(params);
check('restaurar desde la URL reproduce el mismo estado',
    destino._filterSnapshot(), origen._filterSnapshot());
check('restaurar desde la URL reproduce los mismos resultados',
    names(destino), names(origen));

// Indicaciones: hasta 2026-08-03 esta vista no serializaba NADA. Había una rama de
// restauración que leía `params.indication`, pero nadie escribía ese parámetro y apuntaba
// a un `#indication-search` inexistente, así que un enlace de Indicaciones nunca se pudo
// restaurar. Ahora comparte serializador de facetas con el buscador.
const ind = appWith({ biosimilar: true, form: 'SOLUCION INYECTABLE', pas: ['epoetina alfa'] });
ind.currentView = 'indications';
ind.lastIndicationQuery = 'anemia renal';
ind.lastATCCode = null;
const indParams = ind._indicationURLParams();
check('Indicaciones serializa la consulta y sus facetas',
    Object.keys(indParams).sort(), ['biosimilar', 'form', 'indication', 'pa', 'view']);
check('…y la restauración reproduce el mismo estado', (() => {
    const dst = appWith({});
    dst.initGroupingState = function () { this.groupingState = { routeFilters: new Set(), activeIngredientFilters: new Set() }; };
    dst._syncTopFilterCheckboxes = function () {};
    dst._restoreFiltersFromURL(indParams);
    return JSON.stringify(dst._filterSnapshot()) === JSON.stringify(ind._filterSnapshot());
})(), true);
// Con navegación ATC manda el código, no el texto: son dos formas distintas de llegar.
const indAtc = appWith({ biosimilar: true });
indAtc.currentView = 'indications';
indAtc.lastIndicationQuery = 'anemia renal';
indAtc.lastATCCode = 'B03XA';
check('con drill-down ATC la URL lleva el ATC, no la consulta de texto',
    Object.keys(indAtc._indicationURLParams()).sort(), ['atc', 'biosimilar', 'view']);
// Buscador e Indicaciones comparten UNA sola lista de facetas.
check('buscador e Indicaciones usan el mismo serializador de facetas',
    JSON.stringify(ind._facetURLParams()),
    JSON.stringify(appWith({ biosimilar: true, form: 'SOLUCION INYECTABLE', pas: ['epoetina alfa'] })._facetURLParams()));

// --- Ruta ATC: mismo serializador que el resto ---------------------------------
// Antes `searchByATCCode` escribía `{view, atc, label}` a mano y descartaba las 8
// facetas y la agrupación; y la rama de restauración de `params.atc` no llamaba a
// `_restoreFiltersFromURL`, así que un enlace ATC con facetas las perdía en silencio.
const atc = appWith({ biosimilar: true, form: 'SOLUCION INYECTABLE', doses: ['1000 UI'] });
atc.currentView = 'indications';
atc.lastATCCode = 'N02BE';
atc.lastATCLabel = 'Anilidas';
check('la ruta ATC serializa código, nombre y facetas',
    Object.keys(atc._indicationURLParams()).sort(),
    ['atc', 'biosimilar', 'dose', 'form', 'label', 'view']);
atc.lastATCLabel = 'N02BE';
check('el nombre no se emite si coincide con el código',
    'label' in atc._indicationURLParams(), false);

// Miga de pan: los renderizadores leen `item.name`; la restauración construía `{code,label}`
// y por eso el breadcrumb restaurado salía sin nombres.
const bc = atc._atcBreadcrumbFromCode('N02BE', 'Anilidas');
check('la miga usa `name`, nunca `label`',
    bc.every((x) => 'name' in x && !('label' in x)), true);
check('el último nivel toma el nombre legible', bc[bc.length - 1].name, 'Anilidas');
check('y los niveles son los esperados', bc.map((x) => x.code), ['N', 'N02', 'N02B', 'N02BE']);

// --- Entrada a un universo nuevo: el P1 de la sugerencia -----------------------
// Secuencia real que rompía: drill-down ATC → sugerencia del autocomplete → tocar una
// faceta. El ATC viejo tiene precedencia en `_indicationURLParams()`, así que la URL
// anunciaba un universo distinto del mostrado.
const seq = appWith({ biosimilar: true, form: 'SOLUCION INYECTABLE', pas: ['epoetina alfa'] });
seq.currentView = 'indications';
seq._syncTopFilterCheckboxes = function () {};
seq._enterIndicationUniverse({ atcCode: 'N02BE', label: 'Anilidas', query: 'Anilidas' });
check('tras el drill-down la URL lleva el ATC', 'atc' in seq._indicationURLParams(), true);
seq._enterIndicationUniverse({ atcCode: null, query: 'migraña' });
const trasSugerencia = seq._indicationURLParams();
check('tras la sugerencia la URL lleva la indicación y NO el ATC',
    [trasSugerencia.indication, 'atc' in trasSugerencia], ['migraña', false]);
// Se limpian las facetas del universo anterior (forma, lab, dosis, vía, PA), que sobre un
// conjunto distinto producían ceros inexplicables. El ÁMBITO (tipo de producto, receta)
// sobrevive, que es justo la distinción que fija `_resetResultFilters`.
const trasSnap = seq._filterSnapshot();
check('las facetas del universo ATC anterior quedaron limpias',
    [trasSnap.form, trasSnap.lab, trasSnap.doses.size, trasSnap.routes.size, trasSnap.pas.size],
    [null, null, 0, 0, 0]);
check('…y el ámbito sobrevive al cambio de universo', trasSnap.biosimilar, true);
// Autoverificación: el comportamiento antiguo (no limpiar el ATC) seguiría escribiéndolo.
const viejo = appWith({});
viejo.currentView = 'indications';
viejo.lastATCCode = 'N02BE';
viejo.lastIndicationQuery = 'migraña';
check('el detector cazaría la regresión (ATC obsoleto con precedencia)',
    'atc' in viejo._indicationURLParams(), true);

// `preserveFilters` respeta lo que acaba de leerse del enlace.
const preserva = appWith({ biosimilar: true, form: 'SOLUCION INYECTABLE' });
preserva._syncTopFilterCheckboxes = function () {};
preserva._enterIndicationUniverse({ atcCode: 'N02BE', label: 'Anilidas', preserveFilters: true });
check('preserveFilters no limpia las facetas', preserva._activeFilterCount(), 2);

// Round-trip cuando NO hay facetas: la URL no debe arrastrar claves vacías.
const limpio = appWith({});
limpio.currentView = 'search';
check('sin facetas la URL solo lleva lo esencial',
    Object.keys(limpio._searchURLParams()).sort(), ['comerc', 'q', 'type', 'view']);

console.log('\n— Ámbito vs faceta: qué sobrevive a una búsqueda nueva —');
// Regresión real: al unificar el contrato, genérico/receta/biosimilar pasaron a
// `filterState` y `_resetResultFilters()` lo vaciaba entero, de modo que buscar otro
// fármaco DESMARCABA esas tres casillas en silencio. Son ámbito (viven junto al buscador,
// como `Comercializado`), no faceta de resultado.
const ambito = appWith({ biosimilar: true, receta: true, generic: true,
    form: 'SOLUCION INYECTABLE', lab: 'Lab B', doses: ['1000 UI'],
    routes: ['Parenteral'], pas: ['epoetina alfa'] });
ambito._syncTopFilterCheckboxes = function () {};
ambito._resetResultFilters();
const tras = ambito._filterSnapshot();
check('una búsqueda nueva CONSERVA tipo de producto y receta',
    [tras.generic, tras.biosimilar, tras.receta], [true, true, true]);
check('…y limpia las facetas de resultado',
    [tras.form, tras.lab, tras.doses.size, tras.routes.size, tras.pas.size],
    [null, null, 0, 0, 0]);
// "Limpiar N" sí lo limpia todo: ahí el usuario lo ha pedido explícitamente.
const todo = appWith({ biosimilar: true, receta: true, generic: true, form: 'X' });
todo._syncTopFilterCheckboxes = function () {};
todo._clearAllResultFilters();
check('"Limpiar" sí limpia también tipo de producto y receta',
    todo._activeFilterCount(), 0);

console.log('\n— Regresiones de honestidad —');
// Estas dos condiciones eran inalcanzables (los campos no existen en CIMA) y una de ellas
// estaba explicada en la guía interactiva. El test impide que vuelvan.
const fuente = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
const sinComentarios = fuente.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
check('no vuelve la insignia "€ Económico"', /€\s*Económico/.test(sinComentarios), false);
check('no vuelve el uso de med.precioMenor', /med\.precioMenor/.test(sinComentarios), false);
check('no vuelve el uso de med.estupiTemp', /med\.estupiTemp/.test(sinComentarios), false);
check('la insignia biosimilar no afirma la regla de sustitución',
    /biosimilar[^<>"]*[—-][^<>"]*no sustituible/i.test(sinComentarios), false);
check('no se afirma "biológico original"', /[Bb]iológico original/.test(sinComentarios), false);
check('no se llama a genérico/biosimilar "alternativas de menor coste"',
    /alternativas de menor coste/i.test(fuente), false);
// Comentarios que describían como AND una semántica que es OR. Había tres; se corrigió
// uno y sobrevivieron dos hasta que Codex los señaló.
check('ningún comentario describe los chips de PA como AND',
    /activeIngredientFilters.*AND semantics|PA filter chips \(AND/i.test(fuente), false);
// Estado muerto: `#filter-show-brands` no existe en ninguna plantilla.
check('no queda lectura del control inexistente #filter-show-brands',
    /getElementById\('filter-show-brands'\)/.test(sinComentarios), false);
// `renderSearch` debe marcar las casillas desde la fuente única, no desde
// `lastSearchFilters`, donde `performSearch` ya no escribe esas tres claves.
check('renderSearch no lee generic/receta/biosimilar de lastSearchFilters',
    /lastSearchFilters\.(generic|receta|biosimilar)\b/.test(sinComentarios), false);
// Código muerto retirado tras el contrato: los dos envoltorios quedaron sin llamadores al
// pasar los renderizadores al núcleo, y `loadMoreResults` nunca se invocó (el "Ver más"
// real de Indicaciones es `groupingState.expandedGroups`).
check('no vuelven los envoltorios muertos del contrato',
    /_apply(PA|Route)Filter\s*\(/.test(sinComentarios), false);
check('no vuelve la paginación muerta',
    /loadMoreResults|resultsDisplayedCount/.test(sinComentarios), false);
// La ruta ATC no puede volver a construir su URL a mano ni a perder la miga de pan.
check('searchByATCCode no escribe la URL a mano',
    /updateURL\(\{\s*view:\s*'indications'/.test(sinComentarios), false);
check('no quedan onclick inline de searchByATCCode',
    /onclick="app\.searchByATCCode/.test(sinComentarios), false);
// Las tres ramas de restauración leen las facetas del enlace: buscador, indicación y ATC.
check('las 3 ramas de restauración llaman a _restoreFiltersFromURL',
    (fuente.match(/this\._restoreFiltersFromURL\(params\)/g) || []).length, 3);

console.log('\n— Autoverificación: ¿los detectores cazan la regresión conocida? —');
// Un detector que nunca ha demostrado detectar nada no es una red de seguridad, es
// decoración (lección de S39). Se reintroducen aquí, en memoria, los dos defectos
// corregidos y se comprueba que el test los vería.

// 1. Contador NO disyuntivo — el comportamiento anterior: contar sobre el universo
//    entero ignorando las demás facetas.
const viejoContador = (universe, m) => universe.filter(x => x.biosimilar === true).length;
const appPA = appWith({ pas: ['epoetina alfa'] });
const realConPA = count(appWith({ pas: ['epoetina alfa'], biosimilar: true }));
check('el contador antiguo (no disyuntivo) discrepa del real → el test lo cazaría',
    viejoContador(UNIVERSO) !== realConPA, true);

// 2. Semántica AND en tipo de producto — lo que hacía la vista Indicaciones.
const viejoAnd = UNIVERSO.filter(m => m.generico && m.biosimilar).length;
check('genérico AND biosimilar daba siempre 0 → el test lo cazaría', viejoAnd, 0);

// 3. Los detectores de honestidad casan contra el texto que perseguían.
const textoAntiguo = `
    if (med.precioMenor) badges.push('<span class="badge badge-gold" title="Precio menor entre equivalentes">€ Económico</span>');
    if (med.estupiTemp) badges.push('<span class="badge badge-dark">Estupef.</span>');
    badges.push('<span title="Medicamento biosimilar — No sustituible automáticamente">Biosimilar</span>');
    badges.push('<span title="Medicamento biológico original — No sustituible automáticamente">Biológico</span>');
`;
check('detector "€ Económico" caza el texto retirado', /€\s*Económico/.test(textoAntiguo), true);
check('detector precioMenor caza el texto retirado', /med\.precioMenor/.test(textoAntiguo), true);
check('detector estupiTemp caza el texto retirado', /med\.estupiTemp/.test(textoAntiguo), true);
check('detector de fusión identidad/regla caza el título retirado',
    /biosimilar[^<>"]*[—-][^<>"]*no sustituible/i.test(textoAntiguo), true);
check('detector "biológico original" caza el título retirado',
    /[Bb]iológico original/.test(textoAntiguo), true);

console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
process.exit(failures === 0 ? 0 : 1);
