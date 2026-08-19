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

/**
 * Forma de comparación: además de lo anterior, COLAPSA LETRAS DOBLADAS.
 *
 * El español y el inglés doblan consonantes en sitios distintos dentro del mismo INN, y esa
 * diferencia de una letra rompía la comparación de prefijos: `folitropina` frente a
 * `follitropin` daba `folit` contra `folli` y el parentesco salía negativo, con lo que una
 * traducción correcta se bloqueaba como si nombrara una familia.
 *
 * Colapsar dobles es seguro para lo que aquí se decide: no acerca `retinol` a `vitamin A` ni
 * `eftrenonacog` a `factor ix fc fusion protein`, que es lo que la regla tiene que seguir
 * rechazando.
 */
const paraComparar = s => normalizar(s).replace(/([a-z])\1+/g, '$1');

// Palabras que no identifican sustancia y que, contadas, darían parentescos falsos.
const RUIDO = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'anti', 'para', 'en',
    'acido', 'acid', 'alfa', 'alpha', 'beta', 'human', 'humana', 'sodico', 'sodium']);

/**
 * CURACIÓN DEL TÉRMINO INCORPORADO — criterio del responsable (19/08/2026), literal:
 * «sv no aporta, no es una forma; extract tampoco; la sal es demasiado específico; human tampoco
 * aporta, porque es CIMA».
 *
 * Las autoridades devuelven a veces el término con un calificador que CIMA no dice: la forma
 * (`rifamycin sv`), la preparación (`Ginkgo biloba extract`), la sal (`rimegepant sulfate`) o el
 * origen (`insulin aspart, human`). Incorporarlo tal cual añade una especificidad que el nombre
 * español no afirma, y estrecha la búsqueda por una precisión que no tenemos: `rifamycin sv`
 * pierde el 94 % de los ensayos de rifamicina.
 *
 * REGLA: se retira el calificador SOLO si el español no lo dice. `ferroglicina sulfato` conserva
 * `sulfate`, porque ahí la sal sí es parte de lo que CIMA identifica. No se quita nunca lo que
 * el responsable sí declaró.
 *
 * Esto NO se aplica al baseline, que sigue registrando lo que dijo la autoridad —espejo—, sino
 * al término que se incorpora al diccionario, que es una decisión curada.
 */
const CALIFICADORES = {
    // inglés          equivalente español que, si aparece, obliga a conservarlo
    extract: ['extracto', 'extract'],
    human: ['humana', 'humano', 'human'],
    sv: ['sv'],
    sulfate: ['sulfato'], sulphate: ['sulfato'],
    hydrochloride: ['clorhidrato', 'hidrocloruro'],
    mesylate: ['mesilato'], besylate: ['besilato'], maleate: ['maleato'],
    tartrate: ['tartrato'], citrate: ['citrato'], acetate: ['acetato'],
    fumarate: ['fumarato'], succinate: ['succinato'], phosphate: ['fosfato'],
    carbonate: ['carbonato'], bromide: ['bromuro'], chloride: ['cloruro'],
};

export function curarTermino(es, en) {
    const esNorm = normalizar(es);
    const fuera = new Set();
    for (const [cal, equivalentes] of Object.entries(CALIFICADORES)) {
        const loDiceElEspanol = equivalentes.some(w => esNorm.split(' ').includes(w));
        if (!loDiceElEspanol) fuera.add(cal);
    }
    const tokens = normalizar(en).split(' ').filter(t => t && !fuera.has(t));
    const curado = tokens.join(' ').trim();
    // EXCEPCIÓN MEDIDA (19/08/2026). La regla vale cuando el calificador AÑADE especificidad
    // (`sv`, `extract`, la sal). Falla cuando el calificador es lo único que HACE específico al
    // término: quitar `human` a `insulin, regular, human` deja «insulin regular», dos palabras
    // comunes que en PubMed casan 520.632 registros frente a los 2.647 del término completo.
    // Señal barata y suficiente: si lo que queda son solo palabras cortas y comunes, no se cura.
    const COMUNES = new Set(['regular', 'simple', 'complex', 'natural', 'compound', 'solution', 'purified']);
    if (tokens.some(t => COMUNES.has(t))) return normalizar(en);
    // Si al quitar calificadores no queda nada útil, se conserva el original: vaciar un término
    // seria peor que dejarlo especifico.
    return curado.length >= 3 ? curado : normalizar(en);
}

/**
 * @param {string} es  nombre de sustancia en español (vtm.nombre de CIMA)
 * @param {string} en  término inglés propuesto por una autoridad
 * @returns {boolean}  true si TODOS los tokens significativos del español quedan cubiertos
 */
export function comparteRaiz(es, en) {
    const tes = paraComparar(es).split(' ').filter(t => t.length > 2 && !RUIDO.has(t));
    const ten = paraComparar(en).split(' ').filter(t => t.length > 2 && !RUIDO.has(t));
    if (!tes.length || !ten.length) return false;
    // TODOS los tokens del español deben quedar cubiertos, no solo uno: un único token
    // coincidente es exactamente lo que parece un FRAGMENTO («vacuna anti algo raro» -> «algo»).
    const cubierto = a => ten.some(b => a === b || (a.length >= 5 && b.length >= 5
        && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5)))));
    return tes.every(cubierto);
}
