#!/usr/bin/env node
/**
 * MedCheck — banco de los resaltados de 4.5 y 4.8 (piloto del 26/11/2026)
 *
 * PREGUNTAS QUE RESPONDE:
 *   1. ¿Se marca lo que debe, con su negación dentro, y nada de lo que no? Casos reales de CIMA,
 *      sacados de la auditoría `medcheck-audit-resaltado-secciones.mjs`.
 *   2. ¿La frase que DEFINE la convención de frecuencias de la 4.8 queda sin marcar, también cuando
 *      CIMA la parte en varios nodos de texto (el «≥» va en su propio <span>)? Ese caso se escapaba
 *      en la primera versión y solo lo vio la auditoría.
 *   3. ¿Se cumplen las tres reglas de densidad? Sección corta (< 400 caracteres) y sección densa
 *      (> 20 % coloreado) se pintan sin colores.
 *   4. ¿Se cumple la doctrina? Ni enzimas en la 4.5 (23 % de sus menciones van negadas), ni rojo, ni
 *      recuentos en la leyenda.
 *
 * Se ejecuta el CÓDIGO REAL de assets/js/cima-app.js (mismo cargador que los demás bancos).
 * Contraprueba: contra el código anterior (`ef9bde9`) no existen `RESALTADOS_45`, `RESALTADOS_48`
 * ni `_planResaltado`, y las aserciones de comportamiento fallan.
 *
 * Uso: node scripts/medcheck-test-resaltado-secciones.mjs
 */
import { fuenteApp } from './lib/cargar-app.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = fuenteApp(ROOT);
const css = readFileSync(join(ROOT, 'assets', 'css', 'cima-app.css'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};
const bloque = (nombre, fn) => { try { fn(); } catch (e) { ok(nombre, false, e.message); } };

const sandbox = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red')), setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${src}\n;window.__App = MedCheckApp;`, sandbox);
const App = sandbox.window.__App;
const app = Object.create(App.prototype);

const RELLENO = ' Texto de la ficha sin nada que marcar, añadido para pasar del mínimo de caracteres.'.repeat(8);
/** Marcas [clase, texto] que pintaría la app en estos nodos (con relleno para no caer en «corta»). */
function marcas(nodos, categorias) {
    const plan = app._planResaltado([...nodos, RELLENO], categorias);
    if (plan.estado !== 'aplicar') return { estado: plan.estado, marcas: [] };
    return { estado: plan.estado, marcas: plan.segmentos.flatMap(s => (s || []).filter(x => x.clase).map(x => [x.clase, x.texto])) };
}
const una = (texto, cats) => marcas([texto], cats).marcas;
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- 4.5 ------------------------------------------------------------------------------------------
bloque('4.5', () => {
    const C = App.RESALTADOS_45;
    const casos = [
        ['No se recomienda el uso concomitante.', [['ft-indica', 'No se recomienda']]],
        ['El uso de fenobarbital está contraindicado en pacientes con deficiencia.', [['ft-indica', 'está contraindicado']]],
        ['No es necesario ajustar la dosis.', [['ft-indica', 'No es necesario ajustar la dosis']]],
        ['No es necesario ningún ajuste de dosis.', [['ft-indica', 'No es necesario ningún ajuste de dosis']]],
        ['Puede ser necesario un ajuste de la dosis de los antidiabéticos.', [['ft-indica', 'Puede ser necesario un ajuste de la dosis']]],
        ['Diversas sustancias pueden requerir el ajuste de la dosis de insulina.', [['ft-indica', 'pueden requerir el ajuste de la dosis']]],
        ['Se recomienda precaución en pacientes tratados con sustratos de la CYP2D6.', [['ft-indica', 'Se recomienda precaución']]],
        ['Se debe tener precaución cuando se administre junto con lopinavir.', [['ft-indica', 'Se debe tener precaución']]],
        ['Pasireotida se debe utilizar con precaución en pacientes que reciben…', [['ft-indica', 'se debe utilizar con precaución']]],
        ['Se recomienda una monitorización estricta de los valores de la hormona.', [['ft-indica', 'Se recomienda una monitorización estricta']]],
        ['Por ello, deben controlarse frecuentemente los niveles de glucosa.', [['ft-indica', 'deben controlarse']]],
        ['Esta combinación debe ser evitada.', [['ft-indica', 'debe ser evitada']]],
        ['Se requiere una estrecha monitorización cuando dabigatrán se administra…', [['ft-indica', 'Se requiere una estrecha monitorización']]],
        ['Puede ser necesaria una reducción de la dosis con algunos inhibidores.', [['ft-indica', 'Puede ser necesaria una reducción de la dosis']]],
        ['No se han realizado estudios de interacciones.', [['ft-datos', 'No se han realizado estudios de interacciones']]],
        ['Dabigatrán no se ha estudiado clínicamente junto con tacrólimus.', [['ft-datos', 'no se ha estudiado']]],
    ];
    for (const [t, esperado] of casos) {
        const r = una(t, C);
        ok(`4.5 marca «${esperado.map(e => e[1]).join(' + ')}»`, igual(r, esperado), JSON.stringify(r));
    }
    ok('4.5: la negación va dentro de la marca (resaltar no es afirmar)', una('No se recomienda la combinación.', C)[0]?.[1].startsWith('No '));
    for (const t of [
        'Se espera que los inhibidores potentes del CYP3A4 aumenten la exposición.',
        'La vamorolona no es un sustrato de P-gp, BCRP, OATP1B1 ni OATP1B3.',
        'Para evitar una reducción significativa en la absorción, tomar dos horas antes.',
        'Las pacientes deben mantener un buen control metabólico.',
        'El AUC aumentó 2,6 veces.',
    ]) ok(`4.5 no marca: «${t.slice(0, 50)}…»`, una(t, C).length === 0, JSON.stringify(una(t, C)));
    ok('4.5 sin enzimas ni transportadores en sus patrones (23 % de menciones negadas)',
        !C.some(c => c.patrones.some(p => /CYP|P-?gp|OATP|BCRP|UGT|citocromo|glicoproteína/i.test(p.source))));
});

// --- 4.8 ------------------------------------------------------------------------------------------
bloque('4.8', () => {
    const C = App.RESALTADOS_48;
    const casos = [
        [['Frecuentes: cefalea, mareo.'], [['ft-frecuencia', 'Frecuentes']]],
        [['Poco frecuentes'], [['ft-frecuencia', 'Poco frecuentes']]],
        [['Frecuencia no conocida'], [['ft-frecuencia', 'Frecuencia no conocida']]],
        [['Desconocida'], [['ft-frecuencia', 'Desconocida']]],
        [['Muy frecuentes (≥1/10)'], [['ft-frecuencia', 'Muy frecuentes (≥1/10)']]],
        [['≥1/100 a <1/10'], [['ft-frecuencia', '≥1/100 a <1/10']]],
        [['Muy raro: angioedema.'], [['ft-frecuencia', 'Muy raro']]],
        [['Hiperpotasemia y función hepática anormal son poco frecuentes (≥ 1/1.000, <1/100) en niños.'], [['ft-frecuencia', 'poco frecuentes (≥ 1/1.000, <1/100)']]],
    ];
    for (const [nodos, esperado] of casos) {
        const r = marcas(nodos, C).marcas;
        ok(`4.8 marca «${esperado[0][1]}»`, igual(r, esperado), JSON.stringify(r));
    }
    for (const t of [
        'Las reacciones adversas más frecuentes son cefalea y náuseas.',
        'Las reacciones adversas notificadas de forma más frecuente (>10 %) fueron…',
        'Se han notificado casos raros de hepatitis.',
        'La frecuencia de las reacciones se basa en los ensayos.',
    ]) ok(`4.8 no marca: «${t.slice(0, 50)}…»`, marcas([t], C).marcas.length === 0, JSON.stringify(marcas([t], C).marcas));

    // La convención, en un nodo y partida en varios (como llega de CIMA).
    const enUno = 'Las frecuencias se definen como: muy frecuentes (≥1/10); frecuentes (≥1/100 a <1/10); poco frecuentes (≥1/1.000 a <1/100); raras (≥1/10.000 a <1/1.000); muy raras (<1/10.000); frecuencia no conocida (no puede estimarse a partir de los datos disponibles).';
    ok('4.8: la frase que define la convención no se marca', marcas([enUno], C).marcas.length === 0, JSON.stringify(marcas([enUno], C).marcas));
    const partida = ['Las frecuencias se definen como: muy frecuentes (', '≥', '1/10); frecuentes (', '≥', '1/100 a', '<', '1/10); poco frecuentes (', '≥', '1/1.000 a <1/100); raras (≥1/10.000 a <1/1.000)'];
    ok('4.8: tampoco cuando CIMA la parte en varios nodos', marcas(partida, C).marcas.length === 0, JSON.stringify(marcas(partida, C).marcas));
    const conDosPuntos = ['muy frecuentes: ≥ 1/10; frecuentes: ≥ 1/100 a?1/10; poco frecuentes: ≥ 1/1.000 a?1/100; raras: ≥ 1/10.000 a?1/1.000; muy raras: ? 1/10.000; no conocida: no puede estimarse a partir de los datos disponibles'];
    ok('4.8: ni en su forma con dos puntos y «?» por «<» (como llega en algunas fichas)', marcas(conDosPuntos, C).marcas.length === 0, JSON.stringify(marcas(conDosPuntos, C).marcas));
    // Tras la convención, las etiquetas de la tabla sí se marcan.
    const tras = marcas([enUno, 'Trastornos del sistema nervioso', 'Frecuentes', 'Cefalea'], C).marcas;
    ok('4.8: tras la convención, la etiqueta de la tabla sí se marca', igual(tras, [['ft-frecuencia', 'Frecuentes']]), JSON.stringify(tras));
    // Cabecera de tabla con cifra en celdas contiguas: no es una cadena (sin separador), se marca.
    const cabecera = marcas(['Muy frecuentes (≥1/10)', 'Frecuentes (≥1/100 a <1/10)'], C).marcas;
    ok('4.8: dos celdas de cabecera con su cifra se marcan (no son la frase-convención)', cabecera.length === 2, JSON.stringify(cabecera));
});

// --- Densidad -------------------------------------------------------------------------------------
bloque('densidad', () => {
    const u = App.UMBRAL_RESALTADO;
    ok('umbrales del informe: 400 caracteres y 20 %', u.minCaracteres === 400 && u.maxFraccion === 0.2);
    ok('sección corta (< 400): sin colores', app._planResaltado(['No se han realizado estudios de interacciones.'], App.RESALTADOS_45).estado === 'corta');
    const densa = Array.from({ length: 120 },(_, i) => (i % 2 ? 'Frecuentes' : 'Cefalea'));
    const pd = app._planResaltado([...densa, ' '.repeat(10)], App.RESALTADOS_48);
    ok('sección densa (> 20 % coloreado): sin colores', pd.estado === 'densa' && pd.marcado / pd.total > 0.2, `${pd.estado} ${pd.marcado}/${pd.total}`);
    const normal = app._planResaltado(['No se recomienda la combinación.', RELLENO], App.RESALTADOS_45);
    ok('sección normal: se aplica y lo marcado es lo pintado', normal.estado === 'aplicar' && normal.marcado === 'No se recomienda'.length);
    const conConv = app._planResaltado(['muy frecuentes (≥1/10); frecuentes (≥1/100 a <1/10); raras (≥1/10.000 a <1/1.000)', RELLENO], App.RESALTADOS_48);
    ok('lo excluido (la convención) no cuenta como marcado', conConv.marcado === 0);
});

// --- Leyenda y doctrina ---------------------------------------------------------------------------
bloque('leyenda y doctrina', () => {
    const visible = html => html.replace(/title="[^"]*"/g, '').replace(/<[^>]+>/g, ' ');
    const l45 = app._leyendaSeccionHtml(App.RESALTADOS_45, 'aplicar');
    const l48 = app._leyendaSeccionHtml(App.RESALTADOS_48, 'aplicar');
    ok('la leyenda nombra las categorías', /Lo que indica la ficha/.test(l45) && /Datos disponibles/.test(l45) && /Frecuencia/.test(l48));
    ok('la leyenda no lleva recuentos (ningún número visible)', !/\d/.test(visible(l45)) && !/\d/.test(visible(l48)));
    ok('la categoría de exclusión no sale en la leyenda', !/ft-convencion/.test(l48));
    ok('sección corta: sin leyenda', app._leyendaSeccionHtml(App.RESALTADOS_48, 'corta') === '');
    ok('sección densa: la leyenda dice por qué no hay colores', /más de una quinta parte/.test(app._leyendaSeccionHtml(App.RESALTADOS_48, 'densa')));
    const reglas = css.match(/^mark\.ft-(?:indica|datos|frecuencia)\s*\{[^}]*\}/gm) || [];
    ok('las tres clases tienen color propio en el CSS', reglas.length === 3);
    ok('ningún rojo en los colores del piloto (el color no dice gravedad)', reglas.length === 3 && !reglas.some(r => /239,\s*68,\s*68|#ef4444|#f87171|#dc2626|#fca5a5|danger/i.test(r)));
    ok('4.5 y 4.8 llaman al resaltado con su tabla',
        /_resaltarPestanaSeccion\(container\.querySelector\('\.section-text'\), MedCheckApp\.RESALTADOS_45\)/.test(src)
        && /_resaltarPestanaSeccion\(container\.querySelector\('\.section-text'\), MedCheckApp\.RESALTADOS_48\)/.test(src));
    ok('la 4.2 sigue con su propio resaltado, sin umbrales nuevos', /this\._resaltarPosologia\(textContainer\);/.test(src));
});

console.log(fallos ? `\n${fallos} fallo(s)` : '\nOK — todas las aserciones pasan');
process.exit(fallos ? 1 : 0);
