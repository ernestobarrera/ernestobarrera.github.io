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

// --- 4.6 y 4.4 (segunda tanda, en «Leer la 4.x aquí» de Seguridad) -------------------------------
bloque('4.6 y 4.4', () => {
    const C46 = App.RESALTADOS_46;
    const C44 = App.RESALTADOS_44;
    const casos46 = [
        ['No se recomienda utilizar Revolade durante el embarazo.', [['ft-indica', 'No se recomienda utilizar']]],
        ['Roxadustat está contraindicado durante el tercer trimestre del embarazo.', [['ft-indica', 'está contraindicado']]],
        // Regresión de la auditoría del 26/11: la negación previa iba fuera de la marca.
        ['Aunque la digoxina se excreta en la leche materna, la lactancia no está contraindicada.', [['ft-indica', 'no está contraindicada']]],
        ['Se debe decidir si es necesario interrumpir la lactancia o interrumpir el tratamiento.', [['ft-indica', 'Se debe decidir']]],
        // Uso condicionado sin «solo» delante: la condición va dentro de la marca.
        ['TachoSil debe administrarse a mujeres embarazadas únicamente cuando sea claramente necesario.', [['ft-indica', 'debe administrarse a mujeres embarazadas únicamente cuando sea claramente necesario']]],
        ['No se debe utilizar Jakavi durante la lactancia (ver sección 4.3).', [['ft-indica', 'No se debe utilizar']]],
        // Regresión: «solo se debe utilizar» suelto se leía como una orden; ahora con su «solo» y su condición.
        ['Solamente se debe utilizar dupilumab durante el embarazo si el beneficio potencial justifica el riesgo.', [['ft-indica', 'Solamente se debe utilizar dupilumab durante el embarazo si el beneficio potencial justifica el riesgo']]],
        ['Por tanto, DulcoLax puede administrarse durante la lactancia.', [['ft-indica', 'puede administrarse']]],
        ['Las mujeres en edad fértil deben utilizar métodos anticonceptivos efectivos.', [['ft-indica', 'deben utilizar métodos anticonceptivos']]],
        ['Como medida de precaución, es preferible evitar el uso de haloperidol durante el embarazo.', [['ft-indica', 'es preferible evitar']]],
    ];
    for (const [t, esperado] of casos46) {
        const r = una(t, C46);
        ok(`4.6 marca «${esperado[0][1].slice(0, 50)}»`, igual(r, esperado), JSON.stringify(r));
    }
    ok('4.6 no marca la base de datos (se quedó fuera por densidad)', una('Los estudios realizados en animales han mostrado toxicidad para la reproducción.', C46).length === 0);
    ok('4.6 no marca «no se puede excluir el riesgo» (describe lo que se sabe, no qué hacer)', una('No se puede excluir el riesgo en recién nacidos/niños.', C46).length === 0);
    const casos44 = [
        ['Este medicamento contiene lactosa. Los pacientes con intolerancia hereditaria a galactosa no deben tomar este medicamento.',
            [['ft-excip', 'Este medicamento contiene lactosa'], ['ft-excip', 'Los pacientes con intolerancia hereditaria a galactosa no deben tomar este medicamento']]],
        ['Este medicamento contiene menos de 1 mmol de sodio (23 mg) por comprimido; esto es, esencialmente “exento de sodio”.',
            [['ft-excip', 'Este medicamento contiene menos de 1 mmol de sodio (23 mg) por comprimido; esto es, esencialmente “exento de sodio”']]],
        ['Se debe interrumpir el tratamiento con pioglitazona si se produce cualquier empeoramiento.', [['ft-indica', 'Se debe interrumpir el tratamiento']]],
        // Regresión de la medición inicial: arrastraba palabras de más («…si vuelve»).
        ['El tratamiento se debe interrumpir si vuelve a presentarse depresión.', [['ft-indica', 'El tratamiento se debe interrumpir']]],
        ['En caso de duda, no se debe interrumpir el tratamiento sin consultar.', [['ft-indica', 'no se debe interrumpir el tratamiento']]],
    ];
    for (const [t, esperado] of casos44) {
        const r = una(t, C44);
        ok(`4.4 marca «${esperado[0][1].slice(0, 50)}»`, igual(r, esperado), JSON.stringify(r));
    }
    ok('4.4 no marca cada «precaución» (colorearía la sección entera)', una('Se debe tener precaución en pacientes con insuficiencia renal.', C44).length === 0);
    ok('«Leer la 4.x aquí» resalta la 4.4 y no la 4.6 (p90 10,2 % > 10 %) ni la 4.7',
        /\{ '4\.4': MedCheckApp\.RESALTADOS_44 \}\[seccion\]/.test(src) && !/'4\.[67]': MedCheckApp\.RESALTADOS/.test(src));
});

// --- 4.8 ------------------------------------------------------------------------------------------
bloque('4.8', () => {
    const C = App.RESALTADOS_48;
    const casos = [
        [['Frecuentes: cefalea, mareo.'], [['ft-frec-f', 'Frecuentes']]],
        [['Poco frecuentes'], [['ft-frec-pf', 'Poco frecuentes']]],
        [['Frecuencia no conocida'], [['ft-frec-nc', 'Frecuencia no conocida']]],
        [['Desconocida'], [['ft-frec-nc', 'Desconocida']]],
        [['Muy frecuentes (≥1/10)'], [['ft-frec-mf', 'Muy frecuentes (≥1/10)']]],
        [['Raras'], [['ft-frec-r', 'Raras']]],
        [['Muy raras (<1/10.000)'], [['ft-frec-mr', 'Muy raras (<1/10.000)']]],
        [['Muy raro: angioedema.'], [['ft-frec-mr', 'Muy raro']]],
        [['Hiperpotasemia y función hepática anormal son poco frecuentes (≥ 1/1.000, <1/100) en niños.'], [['ft-frec-pf', 'poco frecuentes (≥ 1/1.000, <1/100)']]],
        // Cifra sola en una celda: el nivel sale de su límite inferior.
        [['≥1/10'], [['ft-frec-mf', '≥1/10']]],
        [['≥1/100 a <1/10'], [['ft-frec-f', '≥1/100 a <1/10']]],
        [['(≥1/1.000 a <1/100)'], [['ft-frec-pf', '(≥1/1.000 a <1/100)']]],
        [['≥1/10 000 a <1/1 000'], [['ft-frec-r', '≥1/10 000 a <1/1 000']]],
        [['<1/10.000'], [['ft-frec-mr', '<1/10.000']]],
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
    ok('4.8: tras la convención, la etiqueta de la tabla sí se marca', igual(tras, [['ft-frec-f', 'Frecuentes']]), JSON.stringify(tras));
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
    ok('la leyenda nombra las categorías', /Lo que indica la ficha/.test(l45) && /Datos disponibles/.test(l45) && /Muy frecuentes/.test(l48) && /Frecuencia no conocida/.test(l48));
    ok('la leyenda no lleva recuentos (ningún número visible)', !/\d/.test(visible(l45)) && !/\d/.test(visible(l48)));
    ok('la categoría de exclusión no sale en la leyenda', !/ft-convencion/.test(l48));
    ok('sección corta: sin leyenda', app._leyendaSeccionHtml(App.RESALTADOS_48, 'corta') === '');
    ok('sección densa: la leyenda dice por qué no hay colores', /más de una quinta parte/.test(app._leyendaSeccionHtml(App.RESALTADOS_48, 'densa')));
    const reglas = css.match(/^mark\.ft-(?:indica|datos|frec-[a-z]+)\s*\{[^}]*\}/gm) || [];
    ok('las ocho clases tienen color propio en el CSS (2 de la 4.5 + 6 de frecuencia)', reglas.length === 8, String(reglas.length));
    ok('ningún rojo en los colores del piloto (el color no dice gravedad)', reglas.length === 8 && !reglas.some(r => /239,\s*68,\s*68|#ef4444|#f87171|#dc2626|#fca5a5|danger/i.test(r)));
    // La escala de frecuencia, medida desde el CSS: contraste del texto y orden de la luminosidad.
    const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const color = clase => { const r = reglas.find(x => x.startsWith(`mark.${clase} `) || x.startsWith(`mark.${clase}{`)); return r ? { fg: r.match(/--mark-fg:\s*(#[0-9a-f]{6})/i)?.[1], bg: r.match(/--mark-bg:\s*(#[0-9a-f]{6})/i)?.[1] } : null; };
    const escala = App.CLASES_FRECUENCIA.map(color);
    ok('cada paso de frecuencia tiene fondo opaco y texto en hex (contraste medible)', escala.every(c => c?.fg && c?.bg), JSON.stringify(escala));
    ok('texto ≥ 4,5:1 sobre cada fondo de la escala', escala.every(c => c && contraste(c.fg, c.bg) >= 4.5), escala.map(c => c && contraste(c.fg, c.bg).toFixed(2)).join(' '));
    const ordinal = escala.slice(0, 5).map(c => lum(c.bg));
    ok('la escala es monótona: de muy frecuentes (más intenso) a muy raras (más tenue)', ordinal.every((l, i) => i === 0 || l < ordinal[i - 1]), ordinal.map(l => l.toFixed(3)).join(' > '));
    ok('el paso más tenue se distingue de la superficie de la ficha (≥ 2:1 sobre #222d3f)', escala[4] && contraste(escala[4].bg, '#222d3f') >= 2);
    const sat = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; };
    ok('«frecuencia no conocida» va en gris neutro, fuera de la escala', escala[5] && sat(escala[5].bg) < 0.25);
    ok('la leyenda de la 4.8 lleva su título y va de más a menos frecuente',
        /Frecuencia según la ficha/.test(app._leyendaSeccionHtml(App.RESALTADOS_48, 'aplicar', 'Frecuencia según la ficha:'))
        && /Muy frecuentes[\s\S]*Frecuentes[\s\S]*Poco frecuentes[\s\S]*Raras[\s\S]*Muy raras[\s\S]*Frecuencia no conocida/.test(l48));
    ok('la ayuda de la leyenda dice que el color es frecuencia y no gravedad', App.RESALTADOS_48.filter(c => !c.excluye).every(c => /no la gravedad/.test(c.ayuda)));
    ok('4.5 y 4.8 llaman al resaltado con su tabla',
        /_resaltarPestanaSeccion\(container\.querySelector\('\.section-text'\), MedCheckApp\.RESALTADOS_45\)/.test(src)
        && /_resaltarPestanaSeccion\(container\.querySelector\('\.section-text'\), MedCheckApp\.RESALTADOS_48, 'Frecuencia según la ficha:'\)/.test(src));
    ok('la 4.2 sigue con su propio resaltado, sin umbrales nuevos', /this\._resaltarPosologia\(textContainer\);/.test(src));
});

console.log(fallos ? `\n${fallos} fallo(s)` : '\nOK — todas las aserciones pasan');
process.exit(fallos ? 1 : 0);
