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
 * LÍMITE CERRADO EL 2026-08-20: la transliteración ES/EN rompía la raíz aunque la traducción
 * fuera correcta (`micofenolico` / `mycophenolic`: mi->my, f->ph). Costaba 57 veredictos y 1458
 * productos atascados en `review`. Lo cierra `canon()`, más abajo. Aun así el parentesco SIGUE
 * sin decidir solo: la coincidencia de dos autoridades independientes manda sobre él.
 *
 * LÍMITE QUE QUEDA ABIERTO: `canon()` normaliza colas, y una raíz corta puede quedarse por
 * debajo del umbral de 5 caracteres que exige la comparación de prefijos. Medido: `polio` frente
 * a `poliomyelitis` no casa, y `vacuna anti polio` se queda en `review`. Es un falso negativo, o
 * sea el lado seguro: deja trabajo para un humano en vez de afirmar algo que no se ha probado.
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

/**
 * CANONICALIZACIÓN DE TRANSLITERACIÓN (2026-08-20). Cierra el «LÍMITE CONOCIDO» que esta misma
 * cabecera declaraba desde el principio: la grafía cruda rompía el parentesco de traducciones
 * CORRECTAS, y esos casos se quedaban en `review` esperando un criterio clínico que no hacía
 * falta, porque no había nada clínico que decidir — solo dos alfabetos escribiendo el mismo étimo.
 *
 * Medido sobre el baseline completo antes de escribir esto: **32 nombres (666 productos
 * comercializados) atascados en `review` con la traducción correcta ya propuesta por una
 * autoridad**. `tiotepa`/`thiotepa`, `espiramicina`/`spiramycin`, `hidroquinona`/`hydroquinone`,
 * `oximetazolina`/`oxymetazoline`, `xilometazolina`/`xylometazoline`… Los 32 se revisaron uno a
 * uno: los 32 eran correctos.
 *
 * Solo reglas de GRAFÍA del mismo étimo, nunca de significado. Esto NO acerca `retinol` a
 * `vitamin A` ni `eftrenonacog` a `factor ix fc fusion protein`, que es lo que la regla debe
 * seguir rechazando, ni `barnidipino` a `mepirodipine`, que son fármacos distintos.
 */
function canon(tok) {
    let t = tok;
    t = t.replace(/^es([bcdfghjklmnpqrstvwxyz])/, 's$1'); // espiramicina -> spiramicina
    t = t.replace(/ph/g, 'f');                            // mycophenolic -> mycofenolic
    t = t.replace(/th/g, 't');                            // thiotepa     -> tiotepa
    t = t.replace(/ch/g, 'c');                            // chondroitin  -> condroitin
    t = t.replace(/y/g, 'i');                             // mycofenolic  -> micofenolic
    t = t.replace(/qu/g, 'k').replace(/[cq]/g, 'k');      // uroquinasa   -> urokinasa
    t = t.replace(/z/g, 's');
    t = t.replace(/(ae|oe)/g, 'e');
    // El español escribe `nm` donde el inglés dobla la `m`: inmunoglobulina / immunoglobulin.
    // Sin esta línea, el nombre que MÁS productos arrastra de todo el corpus (546) se quedaba
    // fuera por dos letras.
    t = t.replace(/nm/g, 'm');
    t = t.replace(/([a-z])\1+/g, '$1');
    // El mismo INN cambia de cola al cruzar el idioma. Se marcan en MAYÚSCULA para que una cola
    // normalizada no pueda colisionar por accidente con letras reales del interior de la palabra.
    t = t.replace(/(ina|ine|in)$/, 'IN');
    t = t.replace(/(ato|ate)$/, 'AT');
    t = t.replace(/(ida|ide|ido)$/, 'ID');   // oxido -> oxide
    t = t.replace(/(ium|io)$/, 'I');
    t = t.replace(/(ol|ole)$/, 'OL');
    t = t.replace(/(ona|one)$/, 'ON');
    t = t.replace(/(ico|ic)$/, 'IK');
    return t;
}

// Palabras que no identifican sustancia y que, contadas, darían parentescos falsos.
//
// Las sales y contraiones se añadieron el 2026-08-20 al medir que el conjunto tenía `sodico` y
// `sodium` pero **no `sodio`**, que es como los escribe CIMA. Por esa sola palabra se quedaban en
// `review` `enoxaparina sodio -> enoxaparin` (165 productos), `dalteparina sodio -> dalteparin`
// (56) y `clorazepato dipotasio -> clorazepate` (72), con la traducción correcta ya delante.
//
// Es seguro ignorarlos AQUÍ, que solo decide parentesco: qué calificador se conserva en el
// término que se incorpora lo decide `curarTermino`, más abajo, y ese sí respeta lo que el
// español declara.
export const RUIDO = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'anti', 'para', 'en',
    'acido', 'acid', 'alfa', 'alpha', 'beta', 'human', 'humana', 'sodico', 'sodium',
    'sodio', 'potasio', 'dipotasio', 'calcio', 'magnesio', 'zinc', 'aluminio', 'bario',
    'sulfato', 'sulfate', 'cloruro', 'chloride', 'carbonato', 'carbonate',
    'bromuro', 'bromide', 'acetato', 'acetate', 'fosfato', 'phosphate']);

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
    // PARTE DE LA PLANTA (añadido 2026-08-22). RxNorm califica los botánicos con la porción
    // usada —`Rheum officinale root`, `Sambucus nigra flower`, `Cynara scolymus whole`— y CIMA
    // casi nunca la declara: dice el binomio latino y ya. Es el mismo caso que `rifamycin sv`,
    // y el precio medido es el mismo o peor: `rheum officinale root` recupera 465 registros
    // frente a los 48.146 de `Rheum officinale`, y `coriandrum sativum whole` 22 frente a 14.008.
    // Para un botánico la identidad ES el binomio; la porción es formulación.
    root: ['raiz', 'raíz'], flower: ['flor', 'flores'], leaf: ['hoja', 'hojas'],
    seed: ['semilla', 'semillas'], fruit: ['fruto', 'frutos'], bark: ['corteza'],
    top: ['sumidad', 'sumidades'], whole: ['entera', 'entero', 'planta entera'],
    preparation: ['preparacion', 'preparación'],
};

export function curarTermino(es, en) {
    const esNorm = normalizar(es);
    const fuera = new Set();
    for (const [cal, equivalentes] of Object.entries(CALIFICADORES)) {
        // SUBCADENA, no token entero. El espanol PEGA el calificador al nombre:
        // `dimetilfumarato` es una sola palabra y `esNorm.split(' ')` nunca encontraba `fumarato`,
        // asi que se retiraba `fumarate` y se incorporaba `dimethyl` a secas — un termino que no
        // nombra ningun farmaco. Medido el 20/08 al incorporarlo.
        const loDiceElEspanol = equivalentes.some(w => esNorm.includes(w));
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
    const preparar = s => paraComparar(s).split(' ')
        .filter(t => t.length > 2 && !RUIDO.has(t))
        .map(canon);
    const tes = preparar(es);
    const ten = preparar(en);
    if (!tes.length || !ten.length) return false;
    // TODOS los tokens del español deben quedar cubiertos, no solo uno: un único token
    // coincidente es exactamente lo que parece un FRAGMENTO («vacuna anti algo raro» -> «algo»).
    const cubierto = a => ten.some(b => a === b || (a.length >= 5 && b.length >= 5
        && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5)))));
    return tes.every(cubierto);
}
