/**
 * MedCheck — funciones puras del ETL de Informes de Posicionamiento Terapéutico (IPT)
 *
 * Viven aparte del constructor para poder probarlas sin red (`medcheck-test-ipt.mjs`): el
 * análisis del título, la verificación marca→registro y la detección de actualizaciones son las
 * tres piezas que, si fallan en silencio, pondrían un IPT en el medicamento equivocado o
 * esconderían que se ha actualizado.
 *
 * DE DÓNDE SALE EL DATO. La página de IPT de la AEMPS es un módulo Angular
 * (`/modules/ng-ipt-system/main.js`) que lee `https://www.aemps.gob.es/assets/data/IPT/ddbb.json`:
 * una entrada por IPT con `group` (ATC1), `subgroup` (ATC2), `title`, `date`, `link`, `version` e
 * `illness`. NO trae número de registro ni principio activo: eso se saca del título y se verifica
 * contra CIMA. No es una API documentada, así que el constructor valida el esquema y aborta sin
 * sobrescribir el índice bueno si cambia.
 *
 * CONDICIONES DE REUTILIZACIÓN (aviso legal de la AEMPS, comprobado el 30/09/2026): se autoriza
 * reproducir citando el origen y mencionando la fecha de la última actualización. Por eso el índice
 * guarda el TÍTULO LITERAL junto a lo que se deriva de él, y la fecha de cada IPT.
 */

export const FUENTE_URL = 'https://www.aemps.gob.es/assets/data/IPT/ddbb.json';
export const FUENTE_PAGINA = 'https://www.aemps.gob.es/medicamentos-de-uso-humano/evaluacion-de-tecnologias-sanitarias/informes-de-posicionamiento-terapeutico/';
export const AEMPS_ORIGEN = 'https://www.aemps.gob.es';

/**
 * Quita SOLO etiquetas HTML reales (`<sup>`, `</sup>`). No vale `/<[^>]+>/`: la fuente trae texto
 * clínico con `<` y `>` sueltos («FVIII < 1%», «(> 150 mg/dL)») y esa expresión se comería todo lo
 * que hubiera entre uno y otro.
 */
export function quitarEtiquetas(texto) {
    return String(texto ?? '').replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*)?>/gi, '');
}

/** Minúsculas, sin acentos ni ®/™, signos a espacio y espacios colapsados. */
export function normalizar(texto) {
    return String(texto ?? '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[®™]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// El prefijo, SIN bandera `i`: con ella `(?=[A-ZÁÉÍÓÚ])` aceptaría minúsculas y el «de» pegado
// («deAvatrombopag», que existe en la fuente) se comería el principio de «denosumab». La
// variante en minúsculas del prefijo también existe, así que se declara letra a letra.
const RE_PREFIJO = /^(?:Informe de [Pp]osicionamiento [Tt]erap[eé]utico|IPT)\s+(?:del?\s+|de(?=[A-ZÁÉÍÓÚ]))?/;

const separarMarcas = texto => texto
    .replace(/®\s*-\s*/g, '®/')          // «Mekinist®-Tafinlar®» son dos marcas
    .replace(/[®™]/g, '')
    .split(/\s*\/\s*|\s*,\s*|\s+y\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 3);

/**
 * Analiza el título literal. Devuelve `{ dci, marcas, indicacion }` o `null`.
 *
 * Tres formas reales, todas en la fuente:
 *   - «de empagliflozina (Jardiance®) en…»  → la marca es el paréntesis.
 *   - «de Doptelet® (avatrombopag) en…»     → la marca va DELANTE y el paréntesis es el principio.
 *   - «de lutecio (177Lu) oxodotreotida (Lutathera®)…» → varios paréntesis: manda el que lleva ®.
 *
 * `dci` puede ser `null`: hay títulos que solo dan la marca («de (Onivyde®) en cáncer de
 * páncreas…»). No es un fallo: la verificación contra CIMA se hace entonces por ATC.
 */
export function analizarTitulo(titulo) {
    const limpio = quitarEtiquetas(titulo).replace(/\s+/g, ' ').trim();
    const p = limpio.match(RE_PREFIJO);
    if (!p) return null;
    const resto = limpio.slice(p[0].length);
    const grupos = [...resto.matchAll(/\(([^()]*)\)/g)];
    if (grupos.length === 0) return null;

    const conMarca = grupos.find(g => g[1].includes('®'));
    const previo = resto.slice(0, grupos[0].index);
    let marcas, dci, indicacion;
    if (!conMarca && /®/.test(previo)) {
        // «Doptelet® (avatrombopag)»: la marca delante, el principio activo entre paréntesis.
        marcas = [...previo.matchAll(/([\p{L}\d][\p{L}\d-]*)\s*®/gu)].map(m => m[1]);
        dci = grupos[0][1].trim();
        indicacion = resto.slice(grupos[0].index + grupos[0][0].length);
    } else {
        const g = conMarca || grupos[0];
        marcas = separarMarcas(g[1]);
        // El principio activo es lo que va delante, sin los paréntesis intermedios («(177Lu)»).
        dci = resto.slice(0, g.index).replace(/\([^()]*\)/g, ' ');
        indicacion = resto.slice(g.index + g[0].length);
    }
    if (!marcas || marcas.length === 0) return null;
    dci = String(dci).replace(/\s+/g, ' ').trim() || null;
    indicacion = String(indicacion).trim().replace(/^,\s*/, '') || null;
    return { dci, marcas, indicacion };
}

/** `2022/07/28` → `2022-07-28`; cualquier otra forma → `null` (no se inventa una fecha). */
export function fechaIso(fecha) {
    const m = String(fecha ?? '').match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** El enlace tal como lo da la fuente; el único relativo que hay se resuelve contra la AEMPS. */
export function urlAbsoluta(link) {
    const l = String(link ?? '').trim();
    if (!l) return null;
    if (/^https?:\/\//i.test(l)) return l;
    if (l.startsWith('/')) return AEMPS_ORIGEN + l;
    return null;
}

/**
 * ¿El nombre de CIMA es de esta marca? Prefijo por PALABRA COMPLETA: «XARELTO 10 mg» sí es
 * Xarelto, pero «VICTOZAX» no sería Victoza. Sin esta frontera, una marca corta arrastraría
 * a cualquier producto que empezara igual.
 */
export function esDeLaMarca(nombreCima, marca) {
    const n = normalizar(nombreCima);
    const m = normalizar(marca);
    if (!m) return false;
    return n === m || n.startsWith(m + ' ');
}

function levenshtein(a, b) {
    if (a === b) return 0;
    const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let previo = fila[0];
        fila[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = fila[j];
            fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
            previo = tmp;
        }
    }
    return fila[b.length];
}

/**
 * ¿El principio activo del título casa con el VTM de CIMA? Tolerante a grafías, porque la
 * fuente las tiene: CIMA escribe «donamemab» donde la AEMPS escribe «donanemab». Basta con que
 * UNA palabra de 5+ letras del título esté a distancia ≤ 1 de una palabra del VTM. No ≤ 2:
 * «empagliflozina» y «dapagliflozina» están a distancia 2.
 */
export function casaDci(dci, vtmNombre) {
    const pal = s => normalizar(s).split(' ').filter(w => w.length >= 5);
    const a = pal(dci);
    const b = pal(vtmNombre);
    if (a.length === 0 || b.length === 0) return false;
    return a.some(x => b.some(y => x === y || (Math.abs(x.length - y.length) <= 1 && levenshtein(x, y) <= 1)));
}

/**
 * Verificación marca→registro. Se exige la marca por palabra completa Y una segunda prueba
 * independiente: o el principio activo casa con el VTM, o el ATC5 del registro (Nomenclátor,
 * `atc-index.json`) cae dentro del subgrupo ATC2 que la AEMPS asigna al IPT. Devuelve la vía por
 * la que se verificó (`'dci'` | `'atc'`) o `null`.
 */
export function verificarRegistro({ med, marca, dci, subgrupo, atcDe }) {
    if (!med || !esDeLaMarca(med.nombre, marca)) return null;
    if (dci && casaDci(dci, med.vtm?.nombre)) return 'dci';
    const atc = atcDe(med.nregistro);
    if (atc && subgrupo && String(atc).toUpperCase().startsWith(String(subgrupo).toUpperCase())) return 'atc';
    return null;
}

/**
 * Identificador estable de un IPT: se fija la primera vez que se ve y se hereda después.
 * Enlace Y título, porque el enlace solo no es único en la fuente: Maviret y Descovy comparten
 * el mismo PDF (error de la AEMPS, visto el 30/09/2026).
 */
export function idNuevo(url, titulo, crypto) {
    return 'ipt-' + crypto.createHash('sha1').update(`${url}|${normalizar(titulo)}`).digest('hex').slice(0, 10);
}

/**
 * La fuente lista a veces DOS versiones del mismo IPT con el mismo enlace (Senshio v1 y v2).
 * Se queda la vigente —mayor versión y, a igualdad, la fecha más reciente— y se cuenta cuántas
 * se retiraron, para que no se pinten dos veces.
 */
export function colapsarVersiones(entradas) {
    const porClave = new Map();
    let retiradas = 0;
    for (const e of entradas) {
        const clave = `${e.u}|${normalizar(e.t)}`;
        const previa = porClave.get(clave);
        if (!previa) { porClave.set(clave, e); continue; }
        retiradas++;
        if (e.v > previa.v || (e.v === previa.v && (e.f || '') > (previa.f || ''))) porClave.set(clave, e);
    }
    return { entradas: [...porClave.values()], retiradas };
}

/**
 * Empareja cada entrada de la fuente con la del índice anterior y decide si es nueva, igual o
 * actualizada. La fuente guarda normalmente UNA entrada por IPT con su versión vigente, así que
 * una actualización solo se ve comparando con lo que había.
 *
 * POR PASADAS, de la coincidencia más fuerte a la más débil, para que una entrada no se quede
 * con la previa que le corresponde exactamente a otra: primero enlace y título a la vez; luego
 * solo título (la AEMPS renombra el PDF al subir versión); luego solo enlace (título retocado).
 * Una previa asignada no se reutiliza: con enlaces compartidos, casar solo por enlace fundiría
 * dos IPT distintos.
 *
 * `anterior`: mapa id → entrada del índice previo (o `{}` en la primera pasada).
 * Devuelve, en el mismo orden que `entradas`, `{ id, estado: 'nuevo'|'igual'|'actualizado', previa }`.
 */
export function emparejarTodas(entradas, anterior, crypto) {
    const previas = Object.entries(anterior || {});
    const reclamadas = new Set();
    const res = new Array(entradas.length).fill(null);
    const criterios = [
        (e, p) => p.u === e.u && normalizar(p.t) === normalizar(e.t),
        (e, p) => normalizar(p.t) === normalizar(e.t),
        (e, p) => p.u === e.u,
    ];
    for (const casa of criterios) {
        entradas.forEach((e, i) => {
            if (res[i]) return;
            const hallada = previas.find(([id, p]) => !reclamadas.has(id) && casa(e, p));
            if (!hallada) return;
            const [id, previa] = hallada;
            reclamadas.add(id);
            const cambio = previa.v !== e.v || previa.f !== e.f || previa.u !== e.u;
            res[i] = { id, estado: cambio ? 'actualizado' : 'igual', previa };
        });
    }
    return res.map((r, i) => r || { id: idNuevo(entradas[i].u, entradas[i].t, crypto), estado: 'nuevo', previa: null });
}

/**
 * Comprobaciones de esquema de la fuente. Devuelve la lista de problemas; vacía = válida.
 * Un problema aquí ABORTA la generación: mejor un índice de hace una semana que uno roto.
 */
export function validarFuente(datos, { minimoAnterior = 0 } = {}) {
    const problemas = [];
    if (!Array.isArray(datos)) return ['la raíz no es un array'];
    if (datos.length < 500) problemas.push(`solo ${datos.length} entradas (se esperaban más de 500)`);
    if (minimoAnterior && datos.length < Math.floor(minimoAnterior * 0.9)) {
        problemas.push(`${datos.length} entradas frente a ${minimoAnterior} en la pasada anterior (caída > 10 %)`);
    }
    const campos = ['subgroup', 'title', 'date', 'link', 'version'];
    for (const c of campos) {
        const faltan = datos.filter(r => r == null || r[c] == null || r[c] === '').length;
        if (faltan > datos.length * 0.01) problemas.push(`al campo «${c}» le faltan ${faltan} valores`);
    }
    return problemas;
}
