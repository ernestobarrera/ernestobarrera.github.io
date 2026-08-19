/**
 * MedCheck — parentesco entre un nombre de sustancia español y un candidato inglés.
 *
 * VIVE EN UN SOLO SITIO A PROPÓSITO. La usan el compilador (medcheck-compile-identity.mjs) y la
 * promoción (medcheck-promote-identity.mjs), y una regla que vive en dos ficheros divergirá:
 * uno se corrige, el otro no, y a partir de ahí dos pasos del mismo pipeline clasifican distinto
 * el mismo término sin que nada lo señale.
 *
 * QUÉ DECIDE: si el término inglés propuesto es **la misma sustancia con otra grafía** o **otra
 * palabra**. No decide si es correcto —eso lo dicen las autoridades—, decide si es PARIENTE.
 *
 *   testosterona -> testosterone      comparte raíz  (traducción)
 *   temozolomida -> temozolomide      comparte raíz  (traducción)
 *   retinol      -> vitamin A         NO comparte    (nombre de familia)
 *   eftrenonacog -> factor ix fc...   NO comparte    (nombre de clase)
 *
 * Es la señal que separa el salto BUENO —el inglés recupera más porque el español no funcionaba
 * en ese registro— del ensanchamiento, donde el término nombra un conjunto mayor. Sin ella, la
 * guarda de ensanchamiento bloqueaba `testosterona -> testosterone`, que es justo lo que se
 * quería incorporar.
 *
 * LÍMITE CONOCIDO: la transliteración ES/EN puede romper la raíz aunque la traducción sea
 * correcta (`micofenolico` / `mycophenolic`: mi->my, f->ph). Por eso el parentesco NUNCA decide
 * solo: la coincidencia de dos autoridades independientes manda sobre él.
 */

export const normalizar = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Palabras que no identifican sustancia y que, contadas, darían parentescos falsos.
const RUIDO = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'anti', 'para', 'en',
    'acido', 'acid', 'alfa', 'alpha', 'beta', 'human', 'humana', 'sodico', 'sodium']);

/**
 * @param {string} es  nombre de sustancia en español (vtm.nombre de CIMA)
 * @param {string} en  término inglés propuesto por una autoridad
 * @returns {boolean}  true si TODOS los tokens significativos del español quedan cubiertos
 */
export function comparteRaiz(es, en) {
    const tes = normalizar(es).split(' ').filter(t => t.length > 2 && !RUIDO.has(t));
    const ten = normalizar(en).split(' ').filter(t => t.length > 2 && !RUIDO.has(t));
    if (!tes.length || !ten.length) return false;
    // TODOS los tokens del español deben quedar cubiertos, no solo uno: un único token
    // coincidente es exactamente lo que parece un FRAGMENTO («vacuna anti algo raro» -> «algo»).
    const cubierto = a => ten.some(b => a === b || (a.length >= 5 && b.length >= 5
        && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5)))));
    return tes.every(cubierto);
}
