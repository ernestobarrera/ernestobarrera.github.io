#!/usr/bin/env node
/**
 * MedCheck — la pantalla nunca llama «verificado» a lo que la criba 4.1 no pudo leer.
 *
 * POR QUÉ EXISTE (R2 de la revisión de Codex, 22/11/2026). Una candidata sin texto que leer daba
 * `{checked:0, matched:1, errors:1}` y la cabecera decía «verificados en ficha (4.1): 1 de 1», con
 * un título que afirmaba que su 4.1 recogía el uso. El único aviso específico era un toast, que se
 * pierde al primer repintado; la tarjeta no decía nada y el contexto que viaja a la IA tampoco.
 *
 * LO QUE ESTE BANCO FIJA:
 *   1. la cabecera cuenta SOLO lo confirmado como confirmado, y lo no leído en su propia etiqueta;
 *      también con resúmenes anteriores, cuyo `matched` sumaba los no verificables;
 *   2. el aviso de lo no verificado es persistente (va en el render) y dice por qué;
 *   3. cada tarjeta no verificada lo dice, y la confirmada con la ficha del original dice de cuál;
 *   4. el contexto de IA lo transmite: «Sobre:» y el prompt;
 *   5. el reintento suma todas las cuentas nuevas.
 *
 * Uso: node scripts/medcheck-test-criba-41-pantalla.mjs
 */
import { fuenteApp } from './lib/cargar-app.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = fuenteApp(ROOT);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};

const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
    AbortSignal, AbortController, navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${appSrc}\n;window.__C = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const MedCheckApp = sandbox.window.__C;
const nuevaApp = () => {
    const app = Object.create(MedCheckApp.prototype);
    app._describeATCCode = () => '';
    app.showToast = () => {};
    app.lastSearchFilters = { comerc: true };
    return app;
};
const med = (nregistro, extra = {}) => ({
    nregistro: String(nregistro), nombre: `MED ${nregistro}`, comerc: true,
    atcs: [{ codigo: 'N04BC', nombre: 'GRUPO', nivel: 4 }, { codigo: 'N04BC05', nombre: 'SUSTANCIA', nivel: 5 }],
    vtm: { nombre: 'pramipexol' }, ...extra,
});
// El caso de Codex: una candidata, sin texto que leer.
const RESUMEN_CODEX = { section: '4.1', candidates: 1, checked: 0, confirmed: 0, excluded: 0, errors: 1, sinTexto: 1, porFallo: 0, porTiempo: 0, viaOriginal: 0, sinCribar: 0, shown: 1, matched: 0 };
const datos = (resultados, filterSummary) => ({
    resultados, totalFilas: resultados.length,
    matchedIndication: { label: 'Piernas inquietas', term: 'piernas inquietas', atc: ['N04BC'], section41Filter: { section: '4.1', includeAny: ['piernas inquietas'] }, filterSummary },
    consulta: { intentados: ['N04BC'], completos: ['N04BC'], fallidos: [], candidatos: resultados.map(m => m.nregistro) },
});

console.log('— 1. Cabecera —');
{
    const app = nuevaApp();
    const html = app._criba41NotaHtml(RESUMEN_CODEX, datos([], RESUMEN_CODEX).matchedIndication);
    ok('el caso de Codex ya no dice «verificados en ficha (4.1): 1 de 1»', !html.includes('1 de 1') && !html.includes('verificados en ficha'), html);
    ok('dice 0 confirmados de 1', html.includes('confirmados en ficha (4.1): 0 de 1'), html);
    ok('y lo no leído en su propia etiqueta', html.includes('1 sin verificar') && html.includes('match-filter--sin-verificar'), html);
    const viejo = app._criba41NotaHtml({ candidates: 1, checked: 0, matched: 1, errors: 1 });
    ok('un resumen anterior (matched con los no verificables) tampoco lo cuenta como confirmado', viejo.includes('0 de 1') && viejo.includes('1 sin verificar'), viejo);
    const limpio = app._criba41NotaHtml({ candidates: 3, checked: 3, confirmed: 2, excluded: 1, errors: 0, matched: 2, shown: 2 });
    ok('sin no verificables, ninguna etiqueta de «sin verificar»', limpio.includes('2 de 3') && !limpio.includes('sin verificar'), limpio);
    const parcial = app._criba41NotaHtml({ candidates: 23, confirmed: 1, errors: 2, sinCribar: 40 }, { section41Filter: { atcScope: ['G03AA07'] } });
    ok('con atcScope, el título dice qué se criba y qué entra sin leer', parcial.includes('G03AA07') && parcial.includes('los otros 40'), parcial);
}

console.log('— 2. Aviso persistente —');
{
    const app = nuevaApp();
    const aviso = app._criba41AvisoHtml(datos([], RESUMEN_CODEX));
    ok('hay aviso, con cuántos y por qué', aviso.includes('1 medicamento sin verificar en ficha técnica') && aviso.includes('sin ficha segmentada'), aviso);
    ok('dice que se muestran sin estar confirmados', aviso.includes('no está confirmado'), aviso);
    const varios = app._criba41AvisoHtml(datos([], { candidates: 5, errors: 3, sinTexto: 1, porFallo: 1, porTiempo: 1 }));
    ok('separa los motivos (sin texto, CIMA no respondió, tiempo)', varios.includes('3 medicamentos') && varios.includes('no respondió') && varios.includes('se agotó el tiempo'), varios);
    ok('sin no verificables no hay aviso', app._criba41AvisoHtml(datos([], { candidates: 2, confirmed: 2, errors: 0 })) === '');
    // En el render, no en un toast: el render completo necesita estado de la app que este sandbox
    // no monta, así que se comprueba sobre el fuente, como el aviso de lista incompleta.
    const disp = MedCheckApp.prototype.displayGroupedIndicationResults.toString();
    ok('el aviso va en el render (persistente)', disp.includes('this._criba41AvisoHtml(data)'));
    ok('la cabecera usa la nota nueva', disp.includes('this._criba41NotaHtml(miFs, mi)') && !disp.includes('verificados en ficha (4.1)'));
}

console.log('— 3. Tarjeta —');
{
    const app = nuevaApp();
    const sinVer = app._insigniaCriba41Html({ nregistro: '1', _sectionUnverified: true, _sectionMotivo: 'red' });
    ok('la no verificada lleva «4.1 sin verificar» y el motivo', sinVer.includes('4.1 sin verificar') && sinVer.includes('no respondió'), sinVer);
    const original = app._insigniaCriba41Html({ nregistro: '97051006IP', _sectionFuente: 'original', _sectionRegistro: '97051006' });
    ok('la confirmada con el original dice de qué registro', original.includes('4.1 del original') && original.includes('97051006'), original);
    ok('la confirmada con su propia ficha no lleva insignia', app._insigniaCriba41Html({ nregistro: '2', _sectionFuente: 'propia' }) === '');
    const tarjeta = MedCheckApp.prototype.renderIndicationMedCard.toString();
    ok('renderIndicationMedCard pinta la insignia', tarjeta.includes('_insigniaCriba41Html(med)'));
}

console.log('— 4. Contexto de IA —');
{
    const app = nuevaApp();
    const lista = [med('A', { _sectionUnverified: true, _sectionMotivo: 'sin-texto' }), med('B', { _sectionFuente: 'propia' })];
    const d = datos(lista, { ...RESUMEN_CODEX, candidates: 2, confirmed: 1, matched: 1, shown: 2, checked: 1 });
    const scope = app._consultScopeFromResults(d, lista);
    ok('el alcance cuenta los no verificados de la lista en pantalla', scope.criba41 === true && scope.sinVerificar41 === 1, JSON.stringify({ c: scope.criba41, n: scope.sinVerificar41 }));
    const prompt = app._composeConsultPrompt(scope, { selected: ['guias'] });
    ok('el prompt dice que se incluyen SIN confirmar la indicación', prompt.includes('SIN confirmar') && prompt.includes('No afirmes que todos la tienen'), prompt);
    ok('la línea «Sobre:» también', app._consultScopeLabel(scope).includes('1 sin verificar en ficha técnica (4.1)'), app._consultScopeLabel(scope));
    const soloB = app._consultScopeFromResults(d, [lista[1]]);
    ok('filtrando a lo confirmado, el aviso desaparece y queda que se acotó por 4.1', soloB.sinVerificar41 === 0 && app._composeConsultPrompt(soloB, { selected: ['guias'] }).includes('se acotó leyendo la sección 4.1'));
    const sinCriba = app._consultScopeFromResults({ ...d, matchedIndication: { label: 'x', atc: ['N04BC'] } }, lista);
    ok('sin criba 4.1, el prompt no habla de ella', !sinCriba.criba41 && !app._composeConsultPrompt(sinCriba, { selected: ['guias'] }).includes('sección 4.1'));
}

console.log('— 5. Reintento —');
{
    const app = nuevaApp();
    const d = datos([med('A')], { candidates: 2, checked: 1, confirmed: 1, excluded: 0, errors: 1, sinTexto: 1, matched: 1, shown: 2 });
    app._fusionarReintentoIndicacion(d, { completos: ['N04BC'], fallidos: [] }, { candidatos: [med('B')], resultados: [med('B')] },
        { candidates: 1, checked: 0, confirmed: 0, excluded: 0, errors: 1, porFallo: 1, matched: 0, shown: 1 });
    const fs = d.matchedIndication.filterSummary;
    ok('suma confirmados, no verificables y sus motivos', fs.confirmed === 1 && fs.errors === 2 && fs.sinTexto === 1 && fs.porFallo === 1 && fs.candidates === 3, JSON.stringify(fs));
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — lo no leído nunca se rotula verificado.');
process.exit(fallos ? 1 : 0);
