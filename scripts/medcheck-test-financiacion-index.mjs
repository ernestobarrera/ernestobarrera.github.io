#!/usr/bin/env node
/**
 * MedCheck — test del índice de financiación en la LISTA de resultados
 *
 * La financiación llega ahora a la lista por un camino distinto del de la ficha: la ficha
 * consulta el Worker CN a CN y clasifica TEXTO de BIFIMED (`_classifyFinSit`); la lista lee
 * `financiacion-index.json` y clasifica CÓDIGOS de lista oficial. Dos caminos, un solo veredicto:
 * ambos desembocan en `_financingSummaryFromCounts`.
 *
 * Lo que fija este test, y por qué cada cosa:
 *   - los dos caminos coinciden. Es el riesgo central del diseño: si divergen, la tarjeta y la
 *     ficha del mismo medicamento dirían cosas distintas, que es exactamente lo que el índice
 *     existe para evitar;
 *   - la ausencia de dato NUNCA se lee como "no financiado". Hay 1.331 medicamentos visibles sin
 *     ficha en BIFIMED (medido 2026-09-08), 993 de ellos importaciones paralelas;
 *   - la faceta falla en CERRADO: sin índice utilizable, el predicado no filtra. Mostrar de menos
 *     sin avisar esconde resultados sin que nadie pueda notarlo;
 *   - el orden de las columnas del índice es contrato con el ETL. Reordenarlas no rompe nada
 *     visible, y por eso hay que fijarlo aquí.
 *
 * Uso: node scripts/medcheck-test-financiacion-index.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
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
const app = Object.create(MedCheckApp.prototype);

let failures = 0;
function check(name, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (ok) {
        console.log(`✓ ${name}`);
    } else {
        failures += 1;
        console.log(`✗ ${name}\n    esperado: ${JSON.stringify(expected)}\n    obtenido: ${JSON.stringify(got)}`);
    }
}

// Fila del índice: [total comercializadas, si, si_det, no_incluido, excluido, no_fin_resol, estudio]
const fila = (...v) => v;
const estadoDesdeIndice = (f) => app._financingSummaryFromIndexRow(f)?.estado ?? null;
// El camino de la ficha: Map cn -> {found, sit} con los textos literales del Excel de BIFIMED.
const estadoDesdeFicha = (sits) => app._computeFinancingSummary(new Map(
    sits.map((s, i) => [String(i), s === null ? { found: false, sit: '' } : { found: true, sit: s }])
)).estado;

// --- El contrato con el ETL ---------------------------------------------------
console.log('— Orden de las columnas (contrato con scripts/etl-financiacion) —');
check('los seis códigos, en el orden del ETL',
    MedCheckApp.FIN_INDEX_CODES, ['1', '2', '5', '6', '7', '666']);
check('código 1 → financiado', MedCheckApp.FIN_CODE_TO_CLASS['1'], 'fin');
check('código 2 → condicionado', MedCheckApp.FIN_CODE_TO_CLASS['2'], 'cond');
check('códigos 5, 6 y 7 → no financiado (son los tres estados negativos)',
    [5, 6, 7].map(c => MedCheckApp.FIN_CODE_TO_CLASS[String(c)]), ['nofin', 'nofin', 'nofin']);
check('código 666 → en estudio o sin petición, NO "no financiado"',
    MedCheckApp.FIN_CODE_TO_CLASS['666'], 'estudio');

// --- Los dos caminos dan el mismo veredicto -----------------------------------
// Es la aserción que sostiene todo el diseño. Cada caso se expresa dos veces: como fila del
// índice (códigos) y como respuesta del Worker (textos del Excel, con su mojibake real).
console.log('\n— Índice y ficha coinciden —');
const pares = [
    ['todo financiado', fila(2, 2, 0, 0, 0, 0, 0), ['Si', 'Si']],
    ['todo condicionado', fila(1, 0, 1, 0, 0, 0, 0), ['Si para determinadas indicaciones/condiciones']],
    ['no financiado por resolución', fila(1, 0, 0, 0, 0, 1, 0), ['No financiado por resolución']],
    ['no incluido', fila(1, 0, 0, 1, 0, 0, 0), ['No incluido']],
    ['excluido', fila(1, 0, 0, 0, 1, 0, 0), ['Excluido']],
    ['en estudio o sin petición', fila(1, 0, 0, 0, 0, 0, 1), ['Estudio o sin petición financiación']],
    ['YASMIN: una negativa y una en estudio', fila(2, 0, 0, 0, 0, 1, 1),
        ['No financiado por resolución', 'Estudio o sin petición financiación']],
    ['financiación parcial', fila(3, 1, 0, 0, 0, 2, 0),
        ['Si', 'No financiado por resolución', 'No financiado por resolución']],
    ['financiado con una presentación sin dato', fila(2, 1, 0, 0, 0, 0, 0), ['Si', null]],
    ['ningún dato', fila(2, 0, 0, 0, 0, 0, 0), [null, null]],
];
for (const [nombre, f, sits] of pares) {
    check(`${nombre} — mismo veredicto por los dos caminos`,
        estadoDesdeIndice(f), estadoDesdeFicha(sits));
}

// --- La ausencia de dato no es una negativa -----------------------------------
console.log('\n— Lo que no se sabe no se convierte en "no financiado" —');
check('sin ningún CN en BIFIMED → sin datos', estadoDesdeIndice(fila(2, 0, 0, 0, 0, 0, 0)), 'sindato');
check('sin datos NO es "no financiado"', estadoDesdeIndice(fila(2, 0, 0, 0, 0, 0, 0)) === 'no', false);
check('sin presentaciones comercializadas → sin datos, no negativa',
    estadoDesdeIndice(fila(0, 0, 0, 0, 0, 0, 0)), 'sindato');
check('una financiada y una sin dato → NO asciende a "financiado" a secas',
    estadoDesdeIndice(fila(2, 1, 0, 0, 0, 0, 0)), 'parcial');

console.log('\n— La importación paralela explica su hueco en vez de callar —');
check('nregistro con sufijo IP se reconoce', app._esImportacionParalela('04276007IP1'), true);
check('IP sin dígito también', app._esImportacionParalela('113882002IP'), true);
check('un nregistro ordinario no', app._esImportacionParalela('63575'), false);
check('la heurística vieja por prefijo 24 ya no decide',
    app._esImportacionParalela('2490401'), false);
const tagIP = app._financingTagFromRow(fila(2, 0, 0, 0, 0, 0, 0), '04276007IP1');
check('su etiqueta corta es la misma "Sin datos" que el resto de la incertidumbre',
    tagIP.short, 'Sin datos');
check('pero el detalle explica el motivo, que es donde se mira si interesa',
    /no publica/.test(tagIP.title), true);
check('y NUNCA dice que no esté cubierto', /Sin cobertura/.test(tagIP.short), false);
const tagSinEnvases = app._financingTagFromRow(fila(0, 0, 0, 0, 0, 0, 0), '63575');
check('sin envases comercializados también cae en "Sin datos"',
    tagSinEnvases.short, 'Sin datos');
check('con su motivo propio en el detalle',
    /no tiene ninguna presentación comercializada/.test(tagSinEnvases.title), true);

console.log('\n— Dos grises, no seis: la tarjeta agrupa, la ficha conserva —');
const corto = (f) => app._financingTagFromRow(f, '63575').short;
check('no financiado por resolución', corto(fila(1, 0, 0, 0, 0, 1, 0)), 'Sin cobertura del SNS');
check('no incluido', corto(fila(1, 0, 0, 1, 0, 0, 0)), 'Sin cobertura del SNS');
check('excluido', corto(fila(1, 0, 0, 0, 1, 0, 0)), 'Sin cobertura del SNS');
check('en estudio o sin petición', corto(fila(1, 0, 0, 0, 0, 0, 1)), 'Sin cobertura del SNS');
check('la mezcla de negativas también', corto(fila(2, 0, 0, 0, 0, 1, 1)), 'Sin cobertura del SNS');
check('sin dato NO cae en el gris de "sin cobertura"', corto(fila(1, 0, 0, 0, 0, 0, 0)), 'Sin datos');
// El detalle sigue distinguiendo lo que la etiqueta agrupa: es la mitad del trato.
check('el detalle conserva la categoría oficial que la etiqueta agrupa',
    app._financingTagFromRow(fila(2, 0, 0, 0, 0, 1, 1), '63575').title,
    'Sin cobertura SNS actual: 1 no financiada · 1 en estudio/sin petición');
check('y distingue "en estudio" de una resolución denegatoria',
    /[Ee]n estudio/.test(app._financingTagFromRow(fila(1, 0, 0, 0, 0, 0, 1), '63575').title), true);

// --- Filas que no se pueden interpretar ---------------------------------------
console.log('\n— Una fila ilegible no produce marca —');
check('fila ausente', app._financingSummaryFromIndexRow(undefined), null);
check('fila de longitud incorrecta', app._financingSummaryFromIndexRow([2, 1, 0]), null);
check('fila que no es array', app._financingSummaryFromIndexRow({ total: 2 }), null);
check('sin fila no hay etiqueta', app._financingTagFromRow(undefined, '63575'), null);

// --- El predicado de la faceta ------------------------------------------------
console.log('\n— La faceta agrupa cobertura, y falla en cerrado —');
check('financiación ordinaria cuenta como cobertura',
    app._financingRowHasCoverage(fila(1, 1, 0, 0, 0, 0, 0)), true);
check('la condicionada TAMBIÉN cuenta (es lo que agrupa la casilla)',
    app._financingRowHasCoverage(fila(1, 0, 1, 0, 0, 0, 0)), true);
check('una sola presentación cubierta basta',
    app._financingRowHasCoverage(fila(3, 1, 0, 0, 0, 2, 0)), true);
check('sin cobertura', app._financingRowHasCoverage(fila(2, 0, 0, 0, 0, 1, 1)), false);
check('sin dato NO cuenta como cobertura',
    app._financingRowHasCoverage(fila(2, 0, 0, 0, 0, 0, 0)), false);
check('fila ausente no cuenta como cobertura', app._financingRowHasCoverage(undefined), false);

const snapOn = { financiado: true };
app._financingIndex = { 63575: fila(2, 0, 0, 0, 0, 1, 1), 8472008: fila(1, 1, 0, 0, 0, 0, 0) };
app._financingIndexUsable = false;
check('índice NO utilizable → el predicado no filtra (fail-open en la lista)',
    app._filterPredicate('financiacion', snapOn), null);
app._financingIndexUsable = true;
check('casilla apagada → no filtra',
    app._filterPredicate('financiacion', { financiado: false }), null);
const pred = app._filterPredicate('financiacion', snapOn);
check('casilla encendida e índice bueno → sí filtra', typeof pred, 'function');
check('deja pasar al financiado', pred({ nregistro: '8472008' }), true);
check('excluye al que no tiene cobertura', pred({ nregistro: '63575' }), false);
check('excluye al que no está en el índice (ausencia ≠ financiado)',
    pred({ nregistro: '99999999' }), false);

// --- Esquema 2: el Nomenclátor como segunda fuente (2026-09-10) ----------------
//
// EL CASO QUE LO MOTIVA, con sus datos reales: JENTADUETO 2,5/850 mg de importación paralela
// (nregistro 12780006IP3, CN 763083). BIFIMED no lo conoce —`found:false`—, así que la lista lo
// pintaba «Sin datos»; el Nomenclátor lo tiene de ALTA con aportación ESPECIAL, y por eso al
// abrir la ficha SÍ se veía financiación. El mismo medicamento decía dos cosas según por dónde
// se mirara. Lo trajo Ernesto el 2026-09-10.
//
// Medido ese día: BIFIMED deja 1.331 medicamentos comercializados sin ningún dato (993 son
// importaciones paralelas) y el Nomenclátor cubre 1.017 de ellos, todos de alta.
console.log('\n— El Nomenclátor cubre lo que BIFIMED no publica —');
const filaN = (...v) => v; // [total, 1, 2, 5, 6, 7, 666, nomenclator]
check('la fila de 8 columnas se acepta (esquema 2)',
    estadoDesdeIndice(filaN(1, 0, 0, 0, 0, 0, 0, 1)), 'si_nom');
check('el caso JENTADUETO deja de ser "sin datos"',
    estadoDesdeIndice(filaN(1, 0, 0, 0, 0, 0, 0, 1)) === 'sindato', false);
check('y se dice de dónde sale, sin ascenderlo a resolución de BIFIMED',
    app._financingSummaryFromIndexRow(filaN(1, 0, 0, 0, 0, 0, 0, 1)).label,
    'Financiado (consta de alta en el Nomenclátor)');
check('en la tarjeta responde la misma pregunta que el resto',
    app._financingTagFromRow(filaN(1, 0, 0, 0, 0, 0, 0, 1), '12780006IP3').short, 'Financiado por el SNS');
check('y el tooltip nombra la fuente que lo respalda',
    /Nomenclátor de facturación/.test(app._financingTagFromRow(filaN(1, 0, 0, 0, 0, 0, 0, 1), '12780006IP3').title), true);
check('cuenta como cobertura para la faceta',
    app._financingRowHasCoverage(filaN(1, 0, 0, 0, 0, 0, 0, 1)), true);

// La columna nueva NO puede tapar una negativa: si BIFIMED dice que no, sigue diciendo que no.
check('una negativa de BIFIMED no la borra el Nomenclátor',
    estadoDesdeIndice(filaN(2, 0, 0, 0, 0, 1, 0, 1)), 'parcial');
check('con todo negativo, el veredicto no cambia',
    estadoDesdeIndice(filaN(1, 0, 0, 0, 0, 1, 0, 0)), 'no');

// Retrocompatibilidad: el esquema 1 tiene que seguir leyéndose EXACTAMENTE igual. Si el ETL del
// Nomenclátor falla un día, el índice vuelve a 7 columnas y la lista no puede quedarse muda.
console.log('\n— El esquema 1 sigue leyéndose igual (el ETL nuevo puede fallar) —');
for (const [nombre, f7] of [
    ['financiado', fila(1, 1, 0, 0, 0, 0, 0)],
    ['sin dato', fila(2, 0, 0, 0, 0, 0, 0)],
    ['no financiado', fila(1, 0, 0, 0, 0, 1, 0)],
    ['parcial', fila(3, 1, 0, 0, 0, 2, 0)],
]) {
    check(`${nombre} — mismo veredicto con 7 columnas que antes`,
        estadoDesdeIndice(f7), estadoDesdeIndice([...f7, 0]));
}
// Y un ancho que no es ni 7 ni 8 sigue sin producir marca: una fila que no se entiende no se
// interpreta a medias.
check('9 columnas no se interpretan', app._financingSummaryFromIndexRow([1, 0, 0, 0, 0, 0, 0, 0, 1]), null);
check('6 columnas tampoco', app._financingSummaryFromIndexRow([1, 0, 0, 0, 0, 0]), null);

// El predicado de la faceta y la etiqueta salen del MISMO resolutor. Sin esto, la casilla "solo
// financiados" escondería medicamentos que la tarjeta acaba de anunciar como financiados.
console.log('\n— Etiqueta y faceta no pueden discrepar —');
for (const f of [
    filaN(1, 0, 0, 0, 0, 0, 0, 1), filaN(2, 1, 0, 0, 0, 0, 0, 1), filaN(1, 0, 0, 0, 0, 1, 0, 0),
    filaN(2, 0, 0, 0, 0, 0, 0, 0), filaN(3, 1, 0, 0, 0, 2, 0, 0), fila(1, 0, 1, 0, 0, 0, 0),
]) {
    const tag = app._financingTagFromRow(f, '63575');
    const cubre = app._financingRowHasCoverage(f);
    const anuncia = /^Financiado/.test(tag?.short || '');
    check(`[${f.join(',')}] la faceta coincide con lo que anuncia la tarjeta`, cubre, anuncia);
}

// --- La FICHA se alimenta del índice (2026-09-14) ------------------------------
//
// EL CASO QUE LO MOTIVA, con sus datos reales, verificados en vivo el 2026-09-14: A.A.S. 100 mg
// COMPRIMIDOS (nregistro 42991). Tiene dos presentaciones —CN 686580 comercializada y CN 614537
// retirada— y BIFIMED dice de ellas cosas OPUESTAS: "Si" (aportación NORMAL, estado ALTA) de la
// primera y "Estudio o sin petición financiación" de la segunda. La tarjeta leía el índice, que
// descarta `comerc === false`, y anunciaba «Financiado por el SNS»; la ficha consultaba el Worker
// con LOS DOS CN y decía «Financiación parcial (1 de 2 presentaciones)». El mismo medicamento
// diciendo dos cosas en la misma pantalla.
//
// No era un fallo de cálculo —ambos caminos desembocan en `_financingSummaryFromCounts` y ambos
// contaban bien— sino DOS POBLACIONES sin declarar. Y no es un caso raro: de las 67.163
// presentaciones del censo, 39.608 (59 %) están retiradas.
console.log('\n— La ficha y la tarjeta cuentan la MISMA población —');

// Las presentaciones tal y como las devuelve CIMA para 42991.
const AAS_PRESENTACIONES = [
    { cn: '686580', comerc: true },
    { cn: '614537', comerc: false },
];
const AAS_FILA = filaN(1, 1, 0, 0, 0, 0, 0, 0); // la fila real del índice de producción

check('el camino en vivo descarta la presentación retirada',
    app._financingCnsForLiveSummary({ presentaciones: AAS_PRESENTACIONES }), ['686580']);
check('y usa el mismo criterio que el ETL (`comerc !== false`, no `=== true`)',
    app._financingCnsForLiveSummary({ presentaciones: [{ cn: '1' }, { cn: '2', comerc: false }] }), ['1']);
check('sin presentaciones, ningún CN', app._financingCnsForLiveSummary({}), []);

// El guardián del caso: SIN filtrar, los dos caminos discrepan. Esta aserción es la que caería si
// alguien devolviera la población entera a la ficha, y por eso se expresa como la divergencia
// original en vez de como su ausencia.
const aasFichaSinFiltrar = estadoDesdeFicha(['Si', 'Estudio o sin petición financiación']);
check('DIVERGENCIA ORIGINAL: contando la retirada, la ficha decía "parcial"', aasFichaSinFiltrar, 'parcial');
check('mientras la tarjeta decía "financiado"', estadoDesdeIndice(AAS_FILA), 'si');
check('…es decir, discrepaban', aasFichaSinFiltrar === estadoDesdeIndice(AAS_FILA), false);
// Y con la población ya filtrada, coinciden. Es el criterio de hecho de todo el cambio.
check('filtrada la población, los dos caminos dicen lo mismo',
    estadoDesdeFicha(['Si']), estadoDesdeIndice(AAS_FILA));

console.log('\n— La ficha resuelve desde el índice, que es la fila de la tarjeta —');
app._financingIndex = {
    42991: AAS_FILA,                                  // A.A.S.: financiado
    4040: filaN(1, 0, 0, 0, 0, 0, 0, 1),              // LOBIVON: solo el Nomenclátor lo respalda
    63575: filaN(2, 0, 0, 0, 0, 1, 1, 0),             // sin cobertura
    8472008: filaN(0, 0, 0, 0, 0, 0, 0, 0),           // sin envases comercializados
    '04276007IP1': filaN(2, 0, 0, 0, 0, 0, 0, 0),     // importación paralela sin dato
};
app._financingIndexUsable = true;
const fichaEstado = (nreg) => app._financingSummaryFromIndex(nreg)?.resumen.estado ?? null;
const fichaNota = (nreg) => app._financingSummaryFromIndex(nreg)?.nota ?? null;

check('A.A.S. 42991: la ficha dice lo mismo que la tarjeta', fichaEstado('42991'), 'si');
check('y el nregistro numérico también resuelve (la ficha lo trae como número)', fichaEstado(42991), 'si');

// SEGUNDA DIVERGENCIA, medida el 2026-09-14 sobre el índice de producción: 1.015 medicamentos cuya
// ÚNICA cobertura es el Nomenclátor de facturación. La ficha solo consultaba BIFIMED —nunca el
// Nomenclátor— así que decía «Sin datos de financiación» de medicamentos que el SNS factura.
// Verificado en vivo: LOBIVON 5 mg (4040), DELTIUS 10.000 UI (7547) y LIPOCOMB (22082) tienen
// `found:false` en BIFIMED y constan ALTA en el Nomenclátor.
check('LOBIVON 4040: deja de decir "sin datos" lo que el Nomenclátor respalda',
    fichaEstado('4040'), 'si_nom');
check('y NO se asciende a resolución de BIFIMED', fichaEstado('4040') === 'si', false);
check('el camino viejo, solo con BIFIMED, decía "sin datos"', estadoDesdeFicha([null]), 'sindato');

console.log('\n— El motivo del hueco llega también a la ficha, no solo al tooltip —');
check('importación paralela: la ficha explica por qué falta el dato',
    /no publica/.test(fichaNota('04276007IP1') || ''), true);
check('sin envases comercializados: la ficha lo dice',
    fichaNota('8472008'), MedCheckApp.FIN_NOTE_SIN_COMERCIALIZADAS);
check('el Nomenclátor nombra su fuente',
    /Nomenclátor de facturación/.test(fichaNota('4040') || ''), true);
// La causa solo se atribuye cuando es cierta. Medido el 2026-09-14 sobre el índice: de los 1.015
// medicamentos que solo respalda el Nomenclátor, 237 (23 %) NO son importación paralela — LOBIVON
// (nebivolol), DELTIUS (colecalciferol), LIPOCOMB (rosuvastatina/ezetimiba)—, y a esos la frase les
// explicaba el hueco con un motivo que no es el suyo.
check('LOBIVON no es importación paralela: no se le atribuye esa causa',
    /importaciones paralelas/.test(fichaNota('4040') || ''), false);
check('pero la fuente que lo respalda sí se nombra igual',
    /BIFIMED no publica su situación de financiación$/.test(fichaNota('4040') || ''), true);
app._financingIndex['12780006IP3'] = filaN(1, 0, 0, 0, 0, 0, 0, 1);
check('y en una importación paralela de verdad, la causa sí se da',
    /cosa habitual en las importaciones paralelas$/.test(fichaNota('12780006IP3') || ''), true);
check('y donde el veredicto se explica solo, no hay nota que estorbe', fichaNota('63575'), null);
// La nota es LA MISMA frase en la tarjeta y en la ficha, no una copia que pueda divergir.
for (const nreg of ['04276007IP1', '8472008', '4040']) {
    check(`[${nreg}] tarjeta y ficha dan el mismo motivo`,
        app._financingTagFromRow(app._financingIndex[nreg], nreg).title, fichaNota(nreg));
}
// Y va VISIBLE en la ficha, no en un `title` inalcanzable con el dedo o el teclado.
const htmlIP = app._financingSummaryValueHtml(
    app._financingSummaryFromIndex('04276007IP1').resumen, fichaNota('04276007IP1'));
check('la nota se pinta como texto, no como atributo', /no publica/.test(htmlIP) && !/title=/.test(htmlIP), true);
check('sin nota ni fecha, la línea queda como estaba',
    app._financingSummaryValueHtml(app._financingSummaryFromIndex('63575').resumen).includes('<div'), false);

// La fecha del DATO en la ficha. «Financiado por el SNS» es una afirmación sin tiempo y la sostiene
// un espejo mensual; con la fecha delante el médico juzga por su cuenta si le sirve. Va en la ficha
// y no en la tarjeta por el mismo criterio que la nota: aquí hay sitio y un `title` no se alcanza
// con el dedo ni con el teclado.
const htmlFecha = app._financingSummaryValueHtml(
    app._financingSummaryFromIndex('63575').resumen, null, '2026-09-09');
check('la fecha del dato se pinta visible, en formato de aquí',
    /Según BIFIMED de 09\/09\/2026\./.test(htmlFecha) && !/title=/.test(htmlFecha), true);
check('con nota Y fecha, ambas caben en la misma segunda línea',
    (() => { const h = app._financingSummaryValueHtml(
        app._financingSummaryFromIndex('04276007IP1').resumen, fichaNota('04276007IP1'), '2026-09-09');
        return /no publica/.test(h) && /09\/09\/2026/.test(h) && (h.match(/<div/g) || []).length === 1; })(), true);
// Una fecha que no se entiende NO se pinta: la procedencia no se inventa.
for (const mala of [null, undefined, '', 'ayer', '9 de septiembre']) {
    check(`fecha ilegible (${JSON.stringify(mala)}) → no se inventa procedencia`,
        app._financingSummaryValueHtml(app._financingSummaryFromIndex('63575').resumen, null, mala).includes('<div'), false);
}

console.log('\n— Degradación: hacia lo lento, nunca hacia lo incorrecto —');
app._financingIndexUsable = false;
check('índice no utilizable → la ficha NO resuelve por él', app._financingSummaryFromIndex('42991'), null);
app._financingIndexUsable = true;
check('medicamento ausente del índice → tampoco (ausencia no es veredicto)',
    app._financingSummaryFromIndex('99999999'), null);
check('fila ilegible → tampoco', (app._financingIndex['99999998'] = [1, 2, 3],
    app._financingSummaryFromIndex('99999998')), null);
// Lo que se pierde al degradar queda dicho: sin índice no hay columna del Nomenclátor, así que el
// caso LOBIVON vuelve a "sin datos". Es decir MENOS, no decir algo falso.
check('degradado, lo del Nomenclátor vuelve a "sin datos", que NO es una negativa',
    estadoDesdeFicha([null]) === 'no', false);

// --- La dimensión está en el contrato -----------------------------------------
console.log('\n— La dimensión pertenece al contrato de filtros —');
check('financiacion es una dimensión declarada',
    MedCheckApp.FILTER_DIMENSIONS.includes('financiacion'), true);
// El snapshot se DERIVA del real en vez de escribirse a mano: un snapshot sintético se queda
// incompleto en cuanto se añade una dimensión, y entonces el test falla por su propia omisión en
// vez de por un defecto del código. Pasó al añadir el filtro hospitalario.
const snapDe = (filterState) => app._filterSnapshot.call({ filterState, groupingState: {} });
check('"Limpiar N" cuenta la faceta de financiación',
    app._activeFilterCount(snapDe({ financiadoOnly: true })), 1);
check('y el estado limpio no cuenta ninguna',
    app._activeFilterCount(snapDe(app._emptyFilterState())), 0);
check('el estado vacío la apaga', app._emptyFilterState().financiadoOnly, false);
check('el snapshot la lee de financiadoOnly',
    app._filterSnapshot.call({ filterState: { financiadoOnly: true }, groupingState: {} }).financiado, true);
check('y por defecto está apagada',
    app._filterSnapshot.call({ filterState: {}, groupingState: {} }).financiado, false);

console.log(failures === 0 ? '\nOK — todas las aserciones pasan' : `\nFALLOS: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
