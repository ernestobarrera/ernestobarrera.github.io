#!/usr/bin/env node
/**
 * MedCheck — banco de los resaltados del apartado 5.1 (Propiedades farmacodinámicas) en Evidencia.
 *
 * Carga la clase REAL de assets/js/cima-app.js en Node (vm, sin DOM) y ejercita `RESALTADOS_51`
 * con `_segmentarResaltados` y `_glosa51`, las mismas funciones que usa `_resaltar51` en el
 * navegador. No copia ningún patrón: si la app cambia, cambia lo que se prueba.
 *
 * LAS FRASES SON SINTÉTICAS. Están escritas imitando la redacción de las fichas en español, pero
 * NO son citas de fichas reales: desde el entorno donde se escribió este banco no había acceso a
 * CIMA. La comprobación con fichas reales es `medcheck-audit-resaltado-51.mjs`, que se ejecuta en
 * local. Lo único real aquí son las 48 secciones del fixture de menciones (4.2, 4.4, 4.6 y 4.7),
 * que sirven para comprobar que no se pierde ni un carácter y que las trampas no saltan en texto
 * que no habla de ensayos.
 *
 * Doctrina que fija este banco:
 *
 *   - ESPEJO, NO JUEZ. Un resaltado dice qué tipo de medida aparece, nunca si el efecto es bueno.
 *     Ninguna ayuda ni definición concluye que un tratamiento convenga o que un efecto importe.
 *   - SIGLAS CON CONTEXTO. «RR» es también el intervalo del ECG, «HR+» son receptores
 *     hormonales, «IC» es insuficiencia cardiaca, «(DE)» es disfunción eréctil e «IC90» una
 *     concentración inhibitoria. Ninguna de esas se marca.
 *   - TIPO NO DECLARADO, SIN CLASIFICAR. «Reducción del 21 % del riesgo» no se da por relativa.
 *   - UN PORCENTAJE SUELTO NO SE MARCA, ni «puntos» de una escala como puntos porcentuales.
 *   - UN CAMBIO RESPECTO AL BASAL ES DE GRUPO, no una diferencia entre tratamientos.
 *   - p Y SIGNIFICACIÓN, NEUTROS: la misma marca sea cual sea su valor.
 *   - NO SE PIERDE NI UN CARÁCTER: los segmentos concatenados reproducen el texto original.
 *
 * Uso: node scripts/medcheck-test-resultados-51.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8')}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
vm.runInContext(`${appSrc}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const App = sandbox.window.__MedCheckAppClass;
const CimaAPI = sandbox.window.__CimaAPI;
const app = Object.create(App.prototype);
const categorias = App.RESALTADOS_51;

let failures = 0;
function fail(name, got, expected) {
    failures += 1;
    console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
}
function cierto(name, cond, detalle) {
    if (cond) console.log(`✓ ${name}`);
    else fail(name, detalle, 'que la condición se cumpliera');
}

/** [familia, texto resaltado, término del glosario] de cada tramo, en orden. */
const marcas = texto => app._segmentarResaltados(texto, categorias)
    .filter(s => s.clase)
    .map(s => [s.clase.replace('ev51-', ''), s.texto, app._glosa51(s.texto, s.clase, categorias)?.nombre]);

/** Comprueba los tramos de una familia (y, si se da, el término del glosario de cada uno). */
function caso(name, texto, familia, esperado, terminos = null) {
    const got = marcas(texto).filter(m => m[0] === familia);
    const ok = JSON.stringify(got.map(m => m[1])) === JSON.stringify(esperado)
        && (!terminos || JSON.stringify(got.map(m => m[2])) === JSON.stringify(terminos));
    if (ok) console.log(`✓ ${name}`);
    else fail(`${name} [${familia}]`, got, terminos ? esperado.map((e, i) => [familia, e, terminos[i]]) : esperado);
}

/** Nada marcado en ninguna familia (o en las indicadas). */
function nada(name, texto, familias = null) {
    const got = marcas(texto).filter(m => !familias || familias.includes(m[0]));
    if (got.length === 0) console.log(`✓ ${name}`);
    else fail(name, got, []);
}

// --- La tabla de categorías -------------------------------------------------------------------
console.log('--- tabla de categorías ---');
cierto('siete familias, en orden de aplicación var → rel → dif → sin tipo → dispersión → grupo → IC/p',
    JSON.stringify(categorias.map(c => c.clase)) === JSON.stringify(['ev51-var', 'ev51-rel', 'ev51-dif', 'ev51-sintipo', 'ev51-disp', 'ev51-grupo', 'ev51-ic']),
    categorias.map(c => c.clase));
cierto('cada familia tiene rótulo, ayuda, patrones, glosario y un puesto de leyenda distinto',
    categorias.every(c => c.etiqueta && c.ayuda && c.patrones.length && c.terminos.length && Number.isInteger(c.leyenda))
        && new Set(categorias.map(c => c.leyenda)).size === categorias.length,
    categorias.map(c => [c.clase, c.etiqueta, c.leyenda]));
cierto('el último término de cada glosario lo recoge todo: ningún tramo resaltado se queda sin tooltip',
    categorias.every(c => c.terminos.at(-1).reconoce.test('x') && c.terminos.at(-1).reconoce.test('HR 0,74')),
    categorias.map(c => [c.clase, String(c.terminos.at(-1).reconoce)]));
cierto('todos los términos tienen nombre y definición',
    categorias.every(c => c.terminos.every(t => t.nombre && t.definicion && t.definicion.length > 40)),
    categorias.flatMap(c => c.terminos.filter(t => !(t.nombre && t.definicion)).map(t => t.nombre)));
{
    // Ni la ayuda de la leyenda ni una definición pueden valorar el tratamiento.
    const textos = categorias.flatMap(c => [c.ayuda, ...c.terminos.map(t => t.definicion)]);
    const juicio = /\b(?:favorable|beneficioso|eficaz|recomendad|clínicamente relevante|importante|conviene|mejor tratamiento|seguro para)\b/i;
    cierto('ninguna ayuda ni definición valora el resultado ni el tratamiento', textos.every(t => !juicio.test(t)), textos.filter(t => juicio.test(t)));
    cierto('el NNT y el NNH dicen que MedCheck no los calcula',
        categorias.find(c => c.clase === 'ev51-dif').terminos.filter(t => /NN[TH]/.test(t.nombre)).every(t => /no lo calcula/.test(t.definicion)));
}

// --- Cocientes ----------------------------------------------------------------------------------
console.log('--- cocientes (medidas relativas) ---');
caso('hazard ratio con su sigla y su valor', 'mostró un hazard ratio (HR) 0,74 frente a placebo', 'rel', ['hazard ratio (HR) 0,74'], ['Hazard ratio (HR) · cociente de riesgos instantáneos']);
caso('HR con «=»', 'HR = 0,80 (IC del 95 %: 0,73-0,87)', 'rel', ['HR = 0,80']);
caso('HR en la cabecera de una tabla: solo el nombre', 'HR (IC del 95 %)', 'rel', ['HR']);
caso('cabecera en mayúsculas', 'HAZARD RATIO (IC DEL 95 %)', 'rel', ['HAZARD RATIO']);
caso('cociente de riesgos instantáneos', 'un cociente de riesgos instantáneos de 0,79', 'rel', ['cociente de riesgos instantáneos de 0,79'], ['Hazard ratio (HR) · cociente de riesgos instantáneos']);
caso('«cociente de riesgos (HR)»: la sigla decide el glosario', 'cociente de riesgos (HR) 0,80', 'rel', ['cociente de riesgos (HR) 0,80'], ['Hazard ratio (HR) · cociente de riesgos instantáneos']);
caso('«razón de riesgos» sin sigla: se dice que puede ser RR o HR', 'una razón de riesgos de 0,8', 'rel', ['razón de riesgos de 0,8'], ['Razón o cociente de riesgos']);
caso('HR con el desenlace en medio: el nombre, sin cifra', 'HR para la supervivencia global de 0,74', 'rel', ['HR']);
caso('riesgo relativo y RR con valor', 'riesgo relativo (RR) 0,85; RR 1,25', 'rel', ['riesgo relativo (RR) 0,85', 'RR 1,25'], ['Riesgo relativo (RR)', 'Riesgo relativo (RR)']);
caso('odds ratio y OR', 'odds ratio de 2,1, OR 1,8 y OR (IC 95 %)', 'rel', ['odds ratio de 2,1', 'OR 1,8', 'OR'], ['Odds ratio (OR)', 'Odds ratio (OR)', 'Odds ratio (OR)']);
caso('razón de tasas e IRR', 'razón de tasas de 0,52; razón de tasas (IRR) 0,52; IRR 0,48', 'rel',
    ['razón de tasas de 0,52', 'razón de tasas (IRR) 0,52', 'IRR 0,48'], ['Razón de tasas (IRR)', 'Razón de tasas (IRR)', 'Razón de tasas (IRR)']);
caso('reducción relativa del riesgo, en sus dos órdenes', 'una reducción del riesgo relativo (RRR) del 20 % y una reducción relativa del riesgo del 34 %', 'rel',
    ['reducción del riesgo relativo (RRR) del 20 %', 'reducción relativa del riesgo del 34 %'],
    ['Reducción o aumento relativo del riesgo (RRR)', 'Reducción o aumento relativo del riesgo (RRR)']);
caso('con verbo', 'el tratamiento redujo el riesgo relativo en un 25 %', 'rel', ['redujo el riesgo relativo en un 25 %'], ['Reducción o aumento relativo del riesgo (RRR)']);
caso('cabecera «Reducción relativa (%)»', 'Reducción relativa (%)', 'rel', ['Reducción relativa'], ['Reducción o aumento relativo del riesgo (RRR)']);
caso('eficacia vacunal', 'una eficacia vacunal del 94,1 %', 'rel', ['eficacia vacunal del 94,1 %'], ['Eficacia vacunal']);
caso('razón de medias geométricas', 'razón de medias geométricas de 1,5 y razón de las MGT de 1,2', 'rel',
    ['razón de medias geométricas de 1,5', 'razón de las MGT de 1,2'], ['Razón de medias geométricas', 'Razón de medias geométricas']);

// --- Diferencias --------------------------------------------------------------------------------
console.log('--- diferencias entre grupos ---');
caso('reducción absoluta del riesgo', 'reducción absoluta del riesgo (RAR) del 1,5 %', 'dif', ['reducción absoluta del riesgo (RAR) del 1,5 %'], ['Reducción o aumento absoluto del riesgo']);
caso('cabecera «Reducción absoluta (%)»', 'Reducción absoluta (%)', 'dif', ['Reducción absoluta'], ['Reducción o aumento absoluto del riesgo']);
caso('NNT publicado, desarrollado y en sigla', 'un número necesario a tratar (NNT) de 63 y NNT = 25', 'dif',
    ['número necesario a tratar (NNT) de 63', 'NNT = 25'], ['Número necesario a tratar (NNT)', 'Número necesario a tratar (NNT)']);
caso('NNH desarrollado gana al NNT que empieza igual', 'el número de pacientes que es necesario tratar para producir un acontecimiento adverso; NNH de 200', 'dif',
    ['número de pacientes que es necesario tratar para producir un acontecimiento adverso', 'NNH de 200'],
    ['Número necesario para dañar (NNH)', 'Número necesario para dañar (NNH)']);
caso('diferencia de medias ajustada en % de HbA1c', 'diferencia de medias ajustada de −0,52 % frente a placebo', 'dif', ['diferencia de medias ajustada de −0,52 %'], ['Diferencia de medias']);
caso('diferencia de medias de mínimos cuadrados con su unidad', 'diferencia de medias de mínimos cuadrados (LS) −3,1 mmHg', 'dif', ['diferencia de medias de mínimos cuadrados (LS) −3,1 mmHg'], ['Diferencia de medias']);
caso('estandarizada y tamaño del efecto', 'diferencia de medias estandarizada de 0,3 y tamaño del efecto de 0,4', 'dif',
    ['diferencia de medias estandarizada de 0,3', 'tamaño del efecto de 0,4'], ['Diferencia estandarizada · tamaño del efecto', 'Diferencia estandarizada · tamaño del efecto']);
caso('diferencia de riesgos y en la tasa de respuesta', 'diferencia de riesgos del 4,2 %; diferencia en la tasa de respuesta de 12 puntos porcentuales', 'dif',
    ['diferencia de riesgos del 4,2 %', 'diferencia en la tasa de respuesta de 12 puntos porcentuales'],
    ['Diferencia de riesgos o de proporciones', 'Diferencia de riesgos o de proporciones']);
caso('diferencia entre tratamientos', 'diferencia entre tratamientos de −0,46 % (IC del 95 %: −0,61; −0,31)', 'dif', ['diferencia entre tratamientos de −0,46 %'], ['Diferencia entre tratamientos']);
caso('puntos porcentuales con su cifra', 'una mejora de 5,2 puntos porcentuales', 'dif', ['5,2 puntos porcentuales'], ['Puntos porcentuales']);
caso('diferencia en el cambio respecto al basal (eso sí compara grupos)', 'la diferencia en el cambio medio respecto al basal fue de −1,1', 'dif',
    ['diferencia en el cambio medio respecto al basal fue de −1,1'], ['Diferencia en el cambio respecto al basal']);
caso('cabecera «Diferencia (IC del 95 %)»', 'Diferencia (IC del 95 %)', 'dif', ['Diferencia'], ['Diferencia']);

// --- Sin tipo declarado --------------------------------------------------------------------------
console.log('--- cambio porcentual sin tipo declarado ---');
caso('«reducción del 21 % del riesgo» no se da por relativa', 'una reducción del 21 % del riesgo de ictus', 'sintipo', ['reducción del 21 % del riesgo']);
caso('ni con el desenlace en medio', 'reducción del riesgo de muerte cardiovascular del 20 %', 'sintipo', ['reducción del riesgo de muerte cardiovascular del 20 %']);
caso('con verbo', 'redujo el riesgo de hospitalización por insuficiencia cardiaca en un 30 %', 'sintipo', ['redujo el riesgo de hospitalización por insuficiencia cardiaca en un 30 %']);
caso('«el riesgo … se redujo en un 27 %»', 'el riesgo de ictus se redujo en un 27 %', 'sintipo', ['riesgo de ictus se redujo en un 27 %']);
caso('sobre una tasa', 'una reducción del 50 % en la tasa anual de exacerbaciones', 'sintipo', ['reducción del 50 % en la tasa']);
nada('y nada de eso cae en cociente ni en diferencia', 'una reducción del 21 % del riesgo; redujo el riesgo de ictus en un 30 %', ['rel', 'dif']);

// --- Resultado de cada grupo ---------------------------------------------------------------------
console.log('--- resultado de cada grupo ---');
caso('cambio respecto al basal es de grupo', 'cambio medio respecto al valor basal; variación porcentual respecto al basal; cambio desde el inicio', 'grupo',
    ['cambio medio respecto al valor basal', 'variación porcentual respecto al basal', 'cambio desde el inicio']);
caso('supervivencias con su sigla', 'supervivencia global (SG) y supervivencia libre de progresión (SLP)', 'grupo',
    ['supervivencia global (SG)', 'supervivencia libre de progresión (SLP)'], ['Supervivencia', 'Supervivencia']);
caso('respuesta', 'tasa de respuesta objetiva (TRO), respuesta completa, respondedores', 'grupo',
    ['tasa de respuesta objetiva (TRO)', 'respuesta completa', 'respondedores']);
caso('porcentaje de pacientes, con y sin cifra', 'el 45 % de los pacientes frente al 30 % con placebo; (% de pacientes con respuesta)', 'grupo',
    ['45 % de los pacientes', '% de pacientes'], ['Porcentaje de pacientes', 'Porcentaje de pacientes']);
caso('tasas por tiempo', 'tasa anualizada de exacerbaciones por 100 pacientes-año', 'grupo',
    ['tasa anualizada de exacerbaciones', 'por 100 pacientes-año'], ['Tasa por paciente y año', 'Tasa por paciente y año']);
caso('Kaplan-Meier, mediana, media de mínimos cuadrados y n (%)', 'estimación de Kaplan-Meier; mediana; media de mínimos cuadrados; n (%)', 'grupo',
    ['estimación de Kaplan-Meier', 'mediana', 'media de mínimos cuadrados', 'n (%)'], ['Kaplan-Meier', 'Mediana', 'Media', 'n (%)']);
caso('duración de la respuesta', 'duración mediana de la respuesta', 'grupo', ['duración mediana de la respuesta'], ['Duración de la respuesta']);
caso('riesgo absoluto de un grupo', 'el riesgo absoluto de hemorragia fue del 2 %', 'grupo', ['riesgo absoluto'], ['Riesgo absoluto']);

// --- Intervalos y valores p ----------------------------------------------------------------------
console.log('--- intervalo de confianza y valor p ---');
caso('IC con sus límites pegados', 'IC del 95 %: 0,65 a 0,85; (IC 95 % [0,6; 0,9]); IC95%; intervalo de confianza del 95 %', 'ic',
    ['IC del 95 %: 0,65 a 0,85', 'IC 95 % [0,6; 0,9]', 'IC95%', 'intervalo de confianza del 95 %']);
caso('IC en mayúsculas', 'HAZARD RATIO (IC DEL 95 %)', 'ic', ['IC DEL 95 %']);
caso('valores p', 'p < 0,001; p=0,03; P = 0.04; valor p < 0,05', 'ic', ['p < 0,001', 'p=0,03', 'P = 0.04', 'valor p < 0,05'], ['Valor p', 'Valor p', 'Valor p', 'Valor p']);
caso('p nominal', 'valor p nominal; p nominal = 0,02', 'ic', ['valor p nominal', 'p nominal = 0,02'], ['Valor p nominal', 'Valor p nominal']);
caso('significación, también negada y con la misma marca', 'fue estadísticamente significativa; no fue estadísticamente significativa', 'ic',
    ['estadísticamente significativa', 'no fue estadísticamente significativa'], ['Significación estadística', 'Significación estadística']);
{
    const clases = (t) => marcas(t).map(m => m[0]);
    cierto('«p < 0,05» y «p = 0,40» se marcan igual: el valor no cambia la familia',
        JSON.stringify(clases('p < 0,05')) === JSON.stringify(clases('p = 0,40')), [clases('p < 0,05'), clases('p = 0,40')]);
}

// --- Dispersión --------------------------------------------------------------------------------
console.log('--- dispersión ---');
caso('desviación estándar, error estándar, RIC', 'desviación estándar (DE); error estándar (EE); rango intercuartílico (RIC)', 'disp',
    ['desviación estándar (DE)', 'error estándar (EE)', 'rango intercuartílico (RIC)'], ['Desviación estándar (DE)', 'Error estándar (EE)', 'Rango intercuartílico (RIC)']);
caso('siglas tras «media» y con su valor', 'media (DE); Cambio medio (DE) desde el inicio; (DE 1,3)', 'disp', ['(DE)', '(DE)', '(DE 1,3)']);
caso('±', '5,2 ± 1,3 y media ± EE', 'disp', ['± 1,3', '± EE'], ['±', 'Error estándar (EE)']);

// --- Variable y tipo de análisis ---------------------------------------------------------------
console.log('--- variable y tipo de análisis ---');
caso('variables y criterios', 'variable principal de eficacia; criterio de valoración principal; criterio principal de valoración; variables secundarias clave', 'var',
    ['variable principal de eficacia', 'criterio de valoración principal', 'criterio principal de valoración', 'variables secundarias clave'],
    ['Variable o criterio principal', 'Variable o criterio principal', 'Variable o criterio principal', 'Variable o criterio secundario']);
caso('análisis y poblaciones', 'análisis post hoc; análisis de subgrupos; población por intención de tratar (ITT); margen de no inferioridad; fue no inferior',
    'var', ['análisis post hoc', 'análisis de subgrupos', 'población por intención de tratar (ITT)', 'margen de no inferioridad', 'no inferior'],
    ['Análisis exploratorio o post hoc', 'Subgrupos', 'Intención de tratar (ITT)', 'Margen de no inferioridad', 'No inferioridad']);
caso('tiempo hasta el evento', 'el tiempo hasta la primera exacerbación', 'var', ['tiempo hasta la primera exacerbación'], ['Tiempo hasta el evento']);
caso('compuesto', 'criterio de valoración compuesto', 'var', ['criterio de valoración compuesto'], ['Criterio de valoración compuesto']);

// --- Una frase entera, con varias familias -------------------------------------------------------
console.log('--- frase completa ---');
{
    const f = 'La variable principal compuesta se redujo con un hazard ratio (HR) 0,74 (IC del 95 %: 0,65-0,85; p < 0,001).';
    const got = marcas(f).map(m => `${m[0]}:${m[1]}`);
    const esperado = ['var:variable principal compuesta', 'rel:hazard ratio (HR) 0,74', 'ic:IC del 95 %: 0,65-0,85', 'ic:p < 0,001'];
    if (JSON.stringify(got) === JSON.stringify(esperado)) console.log('✓ variable, HR, IC y p en su sitio, sin solaparse');
    else fail('frase completa', got, esperado);
}

// --- Trampas: lo que NO se puede marcar ---------------------------------------------------------
console.log('--- trampas ---');
nada('«intervalo RR» y «QT/RR» son del ECG', 'se observó una prolongación del intervalo RR y del QT/RR');
nada('«RR» con milisegundos tampoco', 'RR de 850 ms; intervalos RR 900 ms; Intervalo RR = 820 ms');
nada('«HR+» y «HR positivo» son receptores hormonales', 'cáncer de mama HR+/HER2− y tumores HR positivos; receptores hormonales (HR) positivos');
nada('siglas sin contexto o dentro de otra palabra', 'RR y OR sin valor; FACTOR ORAL; HRQoL; el ORR fue');
nada('«IC» de insuficiencia cardiaca', 'pacientes con insuficiencia cardiaca (IC) e IC grave');
nada('«IC90» e «IC50» son concentraciones inhibitorias', 'IC90 de 0,5 µg/ml frente a IC50 de 2 nM');
nada('«DE» y «SE» en un encabezado en mayúsculas no son dispersión', 'SE ANALIZARON LOS DATOS DE TODOS LOS PACIENTES', ['disp']);
nada('«(DE)» de disfunción eréctil y «(EE)» de estado epiléptico', 'pacientes con disfunción eréctil (DE) y estado epiléptico (EE)');
nada('«p. ej.» no es un valor p', 'p. ej., en pacientes ancianos; p.ej.');
nada('«puntos» de una escala no son puntos porcentuales', 'una mejora de 4 puntos en la escala MADRS');
nada('porcentajes sueltos', 'el 20 %; un 35 % más; aumentó un 12 %');
nada('«mediana edad», «media mañana», «dosis media»', 'adultos de mediana edad; a media mañana; la dosis media');
nada('«significativo» sin «estadísticamente» ni «diferencias» sin más', 'un aumento significativo de la exposición; no hubo diferencias en la farmacocinética');
nada('«objetivo» y «tiempo» sueltos', 'el objetivo del tratamiento; tiempo de protrombina');
caso('el cambio respecto al basal NO es una diferencia entre grupos', 'cambio respecto al basal de −1,2 %', 'dif', []);

// --- El texto real del fixture ------------------------------------------------------------------
console.log('--- secciones reales del fixture (4.2, 4.4, 4.6, 4.7) ---');
{
    const fixture = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/medcheck-menciones-ft.json'), 'utf8'));
    let secciones = 0;
    let perdidas = [];
    const marcado = [];
    for (const [nr, secs] of Object.entries(fixture.responses)) {
        for (const [sec, resp] of Object.entries(secs)) {
            const html = (Array.isArray(resp) ? resp : [resp]).map(x => x.contenido || '').join(' ');
            const texto = CimaAPI.textoFT(html);
            const segs = app._segmentarResaltados(texto, categorias);
            secciones++;
            if (segs.map(s => s.texto).join('') !== texto) perdidas.push(`${nr}/${sec}`);
            segs.filter(s => s.clase).forEach(s => marcado.push(`${s.clase}:${s.texto}`));
        }
    }
    cierto(`no se pierde ni un carácter en las ${secciones} secciones`, secciones === 48 && perdidas.length === 0, perdidas);
    cierto('en apartados que no describen ensayos no salta ninguna sigla (RR, HR, OR, IC, DE…)',
        marcado.every(m => !/:(?:RR|HR|OR|IRR|IC|DE|EE|SE|NNT)\b/.test(m)), marcado);
    cierto('y lo poco que se marca es vocabulario estadístico explícito', marcado.length <= 6, marcado);
}

// --- La pantalla: lo que el código de la pestaña promete -----------------------------------------
console.log('--- acordeón de Evidencia ---');
{
    const cuerpo = (firma) => { const i = appSrc.indexOf(firma); return i === -1 ? '' : appSrc.slice(i, appSrc.indexOf('\n    }\n', i)); };
    const cargar = cuerpo('    async _cargarFT51(med, details) {');
    const render = cuerpo('    renderEvidenceTab(med) {');
    cierto('el acordeón va antes que PubMed en Evidencia',
        render.indexOf('this._acordeonFT51Html()') > -1 && render.indexOf('this._acordeonFT51Html()') < render.indexOf('Literatura científica · PubMed'));
    cierto('nace cerrado (sin `open`) y se carga al abrirlo', !/<details class="evidence-section ev51"[^>]*\bopen\b/.test(appSrc) && /addEventListener\('toggle'/.test(cuerpo('    _conectarFT51(med, details) {')));
    cierto('usa el lector existente y la compactación existente', /this\.api\.getDocSeccion\(med\.nregistro, '5\.1'\)/.test(cargar) && /this\._compactarTextoFT\(texto\)/.test(cargar));
    cierto('compacta antes de resaltar', cargar.indexOf('this._compactarTextoFT(texto)') < cargar.indexOf('this._resaltar51(texto)'));
    cierto('una respuesta tardía no se pinta si el panel ya es otro medicamento', /this\._nregEnPanel === panel/.test(cargar) && /if \(!vigente\(\)\) return;/.test(cargar));
    cierto('error de carga y «sin texto» son estados distintos del de «sin coincidencias»',
        /No se ha podido cargar el apartado 5\.1/.test(cargar) && /CIMA no devuelve texto para el apartado 5\.1/.test(cargar) && /ev51-sin-marcas-aviso/.test(cargar));
    cierto('la leyenda no lleva recuentos por familia', !/c\.etiqueta\}[^`]*\$\{[^}]*(?:length|count|marcas)/.test(cargar));
    cierto('ningún mensaje afirma ausencia de medidas («no hay medidas…», «solo ofrece…»)',
        !/no hay medidas|solo (?:ofrece|da|recoge) medidas|no contiene resultados/i.test(cargar));
    cierto('se pueden apagar los resaltados para leer el original', /ev51-plano/.test(cargar) && /ev51-activar/.test(cargar));
}

console.log(failures === 0 ? '\nTODO VERDE' : `\n${failures} FALLO(S)`);
process.exit(failures === 0 ? 0 : 1);
