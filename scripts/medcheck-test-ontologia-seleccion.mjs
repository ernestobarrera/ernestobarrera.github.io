#!/usr/bin/env node
/**
 * MedCheck — la selección EFECTIVA de cada entrada corregida en R1, presentación a presentación.
 *
 * POR QUÉ EXISTE (R1 de la revisión de Codex, 22/11/2026). El banco de omisiones comprueba que un
 * ATC está en la lista de la entrada (`startsWith`), y eso no basta: el ATC5 monocomponente no
 * garantiza que todas sus formas y dosis tengan la indicación. De las 23 presentaciones
 * comercializadas de levonorgestrel/etinilestradiol solo Microgynon tiene la endometriosis; de las
 * 15 de progesterona, solo 4 la menopausia; Anafranil inyectable y 75 mg LP no tienen la enuresis,
 * y Octostim (desmopresina) es para la hemofilia.
 *
 * Aquí la búsqueda es la REAL (`_executeIndicationSearch` con la entrada de la ontología del repo,
 * incluida su criba 4.1 y su `atcScope`) y la red es un CIMA simulado con los nregistro y los
 * textos 4.1 leídos el 22/11/2026 (prototipos-ontologia-2026-11-22/salidas/seleccion-*.json). Para
 * cada entrada fija qué presentaciones ENTRAN, cuáles SALEN, cuáles entran SIN VERIFICAR (sin ficha
 * segmentada) y cuáles entran SIN LEER su ficha porque están fuera del alcance de la criba.
 *
 * Si la ficha de alguno cambia en CIMA, este banco no se entera: fija la selección dada una 4.1, no
 * la 4.1. Eso es trabajo de la búsqueda inversa y de la reconciliación.
 *
 * Uso: node scripts/medcheck-test-ontologia-seleccion.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const terms = JSON.parse(readFileSync(join(ROOT, 'assets/data/clinical-ontology.json'), 'utf8')).terms;

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};

// [nregistro, ATC5, nombre, comienzo o fragmento de su 4.1 (null = CIMA no la tiene segmentada)]
const FICHAS = [
    ["55962", "A01AB09", "DAKTARIN 20 MG/G GEL ORAL", "Indicaciones terapéuticas Daktarin está indicado en el tratamiento de la candidiasis orofaríngea y esofágica en adultos, niños y lactantes de 4 "],
    ["40537", "M01AB01", "INACID 25 mg CAPSULAS DURAS", "artritis anquilosante y osteoartritis. Tratamiento sintomático del ataque agudo de gota. Tratamiento sintomático de procesos musculoesqueléticos ag"],
    ["58356", "M01AB01", "INACID RETARD 75 mg CAPSULAS DURAS DE LIBERACIÓN PROLONGADA", "Indicaciones terapéuticas Tratamiento de los estadíos activos en enfermedades reumáticas crónicas inflamatorias tales como: artritis reumatoide, espondilitis an"],
    ["55005", "M01AB05", "VOLTAREN 50 mg COMPRIMIDOS GASTRORRESISTENTES", "trosis. - Reumatismo extraarticular. - Tratamiento sintomático del ataque agudo de gota. - Tratamiento sintomático de la dismenorrea primaria. - Tr"],
    ["61440", "M01AB05", "DOLO-VOLTAREN 46,5 MG COMPRIMIDOS DISPERSABLES", "Indicaciones terapéuticas Como tratamiento de corta duración de afecciones agudas inflamatorias y dolorosas, postraumáticas y postoperatorias."],
    ["54246", "M01AE02", "LUNDIRAN 250 mg Cápsulas duras", ". Tratamiento sintomático de la artritis reumatoide, artrosis, episodios agudos de gota y espondilitis anquilosante. Alivio de la sintomatología en"],
    ["83348", "M01AE02", "ACTROMADOL 660 MG COMPRIMIDOS DE LIBERACIÓN MODIFICADA", "Indicaciones terapéuticas Actromadol está indicado para el alivio sintomático de los dolores ocasionales leves o moderados, como dolores de cabeza, dentales, me"],
    ["54445", "M01AE03", "FASTUM 50 MG CÁPSULAS DURAS", "e: - Artritis reumatoide, artrosis, espondilitis anquilosante, episodios agudos de gota. Dolor agudo de intensidad leve a moderada, tales como dolo"],
    ["109564004", "L04AC08", "ILARIS 150 MG/ML SOLUCION INYECTABLE", "ado para el tratamiento sintomático de pacientes adultos con ataques frecuentes de gota artrítica (al menos 3 ataques en los 12 meses previos) en l"],
    ["43559", "B05BC01", "OSMOFUNDINA 10% SOLUCIÓN PARA PERFUSION", "r la excreción urinaria de sustancias tóxicas. Soporte de terapia sistémica del glaucoma agudo."],
    ["69695", "B05BC01", "HIDROFUNDIN FISIOLOGICO SOLUCION PARA PERFUSION", "Indicaciones terapéuticas Terapia de hidratación intravenosa de pacientes sometidos a cisplatino en casos de diuresis forzada y cuando la dosis de cisplatino es"],
    ["42568", "B05BC01", "MANITOL MEIN 10% solución para perfusión", null],
    ["40366", "N06AA02", "TOFRANIL 10 mg COMPRIMIDOS RECUBIERTOS", "ticas Adultos Depresión. Crisis de Ansiedad Dolor Crónico Población pediátrica: Enuresis nocturna (en mayores de 5 años de edad donde las terapias a"],
    ["44656", "N06AA04", "ANAFRANIL 25 MG COMPRIMIDOS RECUBIERTOS", "a con crisis de cataplejía. Población pediátrica Trastorno obsesivo-compulsivo. Enuresis nocturna (sólo en pacientes a partir de 5 años y tras exclu"],
    ["57568", "N06AA04", "ANAFRANIL 75 MG COMPRIMIDOS DE LIBERACIÓN PROLONGADA", "Indicaciones terapéuticas Adultos: Depresión de cualquier etiología, sintomatología y gravedad. Trastorno obsesivo-compulsivo. Fobias. Crisis de angustia (panic"],
    ["44657", "N06AA04", "ANAFRANIL 25 MG SOLUCIÓN INYECTABLE Y PARA PERFUSIÓN", "Indicaciones terapéuticas Adultos Depresión de cualquier etiología, sintomatología y gravedad. Trastorno obsesivo-compulsivo. Fobias. Crisis de angustia (panic "],
    ["37130", "N06AA09", "TRYPTIZOL 25 mg COMPRIMIDOS RECUBIERTOS CON PELICULA", "ultos el tratamiento profiláctico de la migraña en adultos el tratamiento de la enuresis noctura en los niños de edad igual o superior a 6 años cuan"],
    ["57185", "G04BD04", "DITROPAN 5 mg COMPRIMIDOS", "idiopática o disfunción neurógena de la vejiga (hiperactividad del detrusor). - enuresis nocturna asociada con hiperactividad del detrusor, junto co"],
    ["03270001", "G04BD04", "KENTERA 3,9 mg/24 HORAS, PARCHE TRANSDERMICO", "Indicaciones terapéuticas Tratamiento sintomático de la incontinencia de urgencia y/o del aumento de la frecuencia y urgencia miccionales que pueden observarse "],
    ["71385", "H01BA02", "DESMOPRESINA TEVA 0,2 mg COMPRIMIDOS EFG", "Indicaciones terapéuticas - Diabetes insípida central - Enuresis nocturna en niños mayores de 5 años. - Tratamiento de nictu"],
    ["62821", "H01BA02", "OCTOSTIM 1,5 mg/ml SOLUCIÓN PARA PULVERIZACIÓN NASAL", "Indicaciones terapéuticas Tratamiento terapéutico de hemorragias y prevención de hemorragias, en pacientes con hemofilia A leve y enfermedad de Von Willebrand ("],
    ["61413", "H01BA02", "MINURIN 4 MICROGRAMOS/ML SOLUCIÓN INYECTABLE", "Indicaciones terapéuticas Minurin solución inyectable está indicado para: Tratamiento de la Diabetes Insípida Central, en particular, cuando la administración p"],
    ["52612", "G03AA07", "MICROGYNON 0,15 mg / 0,03 mg COMPRIMIDOS RECUBIERTOS", "Indicaciones terapéuticas Anticoncepción. Dismenorreas. Endometriosis. Crisis ovulatorias. Anexitis. Reposo ovárico. La decisión "],
    ["65067", "G03AA07", "LOETTE 100/20 microgramos COMPRIMIDOS RECUBIERTOS CON PELICULA", "Indicaciones terapéuticas Anticoncepción oral."],
    ["52574", "G03AA07", "OVOPLEX 0,15 MG/0,030 MG COMPRIMIDOS RECUBIERTOS", "Indicaciones terapéuticas Anticoncepción por vía oral. Trastornos del ciclo menstrual. Reposo ovárico."],
    ["BE091235", "G03AA07", "MICROGYNON 0,15 mg / 0,03 mg COMPRIMIDOS RECUBIERTOS", null],
    ["60814", "G03DA04", "SEIDIGESTAN 100 mg cápsulas blandas", "l ciclo menstrual debidas a trastornos de la ovulación Síndrome premenstrual Premenopausia En la menopausia: como complemento del tratamiento estrogén"],
    ["60879", "G03DA04", "PROGEFFIK 100 mg CAPSULAS BLANDAS", "s del ciclo menstrual por disovulación o anovulación. Síndrome premenstrual. Premenopausia. Menopausia: Complemento del tratamiento estrogénico en muj"],
    ["88298", "G03DA04", "UTROGESTAN 200 MG CAPSULAS VAGINALES BLANDAS", "Indicaciones terapéuticas Utrogestan está indicado en mujeres para: Suplementación de la fase lútea durante el curso de ciclos de técnicas de reproducción asist"],
    ["82250", "G03DA04", "CYCLOGEST 400 MG OVULOS", "Indicaciones terapéuticas Cyclogest está indicado como tratamiento de soporte de la fase lútea en mujeres como parte de un procedimiento de Técnicas de Reproduc"],
    ["78108", "G03DA04", "PROLUTEX 25 MG SOLUCION INYECTABLE", "Indicaciones terapéuticas Prolutex está indicado en adultos para el soporte lúteo como parte de un programa de Tecnología de Reproducción Asistida (TRA) en muje"],
    ["55868", "G03DA04", "DARSTIN 10 mg/g GEL", "Indicaciones terapéuticas Tratamiento específico de la patología mamaria benigna. Mastodinias Tensión mamaria dolorosa aislada o asociada a: Tratamientos contra"],
    ["81213", "V01AA03", "ACARIZAX 12 SQ-HDM LIOFILIZADO SUBLINGUAL", ", persistente, de moderada a severa, a pesar del uso de medicación sintomática. Asma alérgica por ácaros del polvo doméstico, parcialmente contr"],
    ["86402", "V01AA03", "ACTAIR 100 IR & 300 IR COMPRIMIDOS SUBLINGUALES", "Indicaciones terapéuticas Actair está indicado en adolescentes (de 12 a 17 años) y en adultos para el tratamiento de la rinitis con o sin conjuntivitis alérgica"],
    ["58775", "L02AB01", "BOREA 160 mg COMPRIMIDOS", " asociada a neoplasia avanzada. el tratamiento paliativo del cáncer avanzado de mama o endometrio."],
    ["60783", "L02AB01", "MAYGACE ALTAS DOSIS 40 mg/ml SUSPENSION ORAL", "Indicaciones terapéuticas Maygace Altas Dosis 40 mg/ml suspensión oral está indicado en el tratamiento de la anorexia-caquexia, o una significativa pérdida de p"],
];
// De la misma entrada, pero fuera del alcance de su criba: tienen que entrar SIN leer su ficha.
const SIN_CRIBAR = [
    ['ALOPURINOL', 'M04AA01', 'ZYLORIC 100 mg COMPRIMIDOS'],
    ['TIMOLOL', 'S01ED01', 'TIMOFTOL 0,5 % COLIRIO'],
    ['DIENOGEST', 'G03DB08', 'VISANNE 2 mg COMPRIMIDOS'],
    ['ESTRADIOL', 'G03CA03', 'ESTRADERM MATRIX 50'],
    ['SALBUTAMOL', 'R03AC02', 'VENTOLIN 100 microgramos INHALADOR'],
];

const CASOS = {
    'candidiasis': { entran: ['55962'] },
    'gota': { entran: ['40537', '55005', '54246', '54445', '109564004', 'ALOPURINOL'], salen: ['58356', '61440', '83348'], sinLeer: ['ALOPURINOL'] },
    'glaucoma': { entran: ['43559', 'TIMOLOL'], salen: ['69695'], sinVerificar: ['42568'], sinLeer: ['TIMOLOL'] },
    'enuresis': { entran: ['44656', '57185', '71385', '40366', '37130'], salen: ['57568', '44657', '03270001', '62821', '61413'] },
    'endometriosis': { entran: ['52612', 'DIENOGEST'], salen: ['65067', '52574'], sinVerificar: ['BE091235'], sinLeer: ['DIENOGEST'] },
    'menopausia': { entran: ['60814', '60879', 'ESTRADIOL'], salen: ['88298', '82250', '78108', '55868'], sinLeer: ['ESTRADIOL'] },
    'asma': { entran: ['81213', 'SALBUTAMOL'], salen: ['86402'], sinLeer: ['SALBUTAMOL'] },
    'cáncer de mama': { entran: ['58775'], salen: ['60783'] },
};

const TODOS = [...FICHAS, ...SIN_CRIBAR.map(([n, a, nombre]) => [n, a, nombre, 'Indicación de su grupo.'])];
const SIN_SECCIONES = { error: 'No existen secciones para el medicamento indicado' };
const respuesta = (cuerpo, status = 200) => ({
    ok: status >= 200 && status < 300, status, statusText: String(status),
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(cuerpo),
});

function cargarAPI() {
    const leidas = new Map();
    const fetchImpl = async (url) => {
        const u = new URL(url, 'https://cima.test');
        if (u.pathname.endsWith('/medicamentos')) {
            const p = String(u.searchParams.get('atc') || '').toUpperCase();
            const resultados = TODOS.filter(([, a]) => a.startsWith(p)).map(([n, a, nombre]) => ({
                nregistro: n, nombre, comerc: true,
                atcs: [{ codigo: a.slice(0, 5), nombre: 'SUBGRUPO', nivel: 4 }, { codigo: a, nombre: 'SUSTANCIA', nivel: 5 }],
            }));
            return respuesta({ totalFilas: resultados.length, pagina: 1, tamanioPagina: 200, resultados });
        }
        if (u.pathname.includes('/docSegmentado/contenido/')) {
            const n = u.searchParams.get('nregistro');
            leidas.set(n, (leidas.get(n) || 0) + 1);
            const ficha = TODOS.find(([x]) => x === n);
            return respuesta(ficha?.[3] ? [{ seccion: '4.1', titulo: 'Indicaciones terapéuticas', contenido: `<p>${ficha[3]}</p>` }] : SIN_SECCIONES);
        }
        return respuesta({}, 404);
    };
    const sandbox = {
        window: {}, console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        fetch: fetchImpl, setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
        AbortSignal, AbortController, navigator: { onLine: true }, location: { search: '', href: '' },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(`${apiSrc}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    return { api: new sandbox.window.__CimaAPI(), leidas };
}

const nombreDe = (n) => TODOS.find(([x]) => x === n)?.[2] || n;
for (const [entrada, caso] of Object.entries(CASOS)) {
    console.log(`— «${entrada}» —`);
    const e = terms[entrada];
    if (!e) { ok(`la entrada «${entrada}» existe`, false); continue; }
    const { api, leidas } = cargarAPI();
    const r = await api._executeIndicationSearch({ ...e, term: entrada }, { comercializados: true });
    const porId = new Map(r.resultados.map(m => [m.nregistro, m]));
    for (const n of caso.entran || []) ok(`entra ${nombreDe(n)} (${n})`, porId.has(n) && !porId.get(n)._sectionUnverified, porId.has(n) ? 'entró sin verificar' : 'no está');
    for (const n of caso.salen || []) ok(`sale ${nombreDe(n)} (${n})`, !porId.has(n));
    for (const n of caso.sinVerificar || []) ok(`entra SIN VERIFICAR ${nombreDe(n)} (${n}), sin ficha segmentada`, porId.get(n)?._sectionUnverified === true && porId.get(n)?._sectionMotivo === 'sin-texto');
    for (const n of caso.sinLeer || []) ok(`entra sin leer su ficha (fuera de la criba): ${nombreDe(n)}`, porId.has(n) && !leidas.has(n), `lecturas: ${leidas.get(n) || 0}`);
}

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — cada entrada corregida selecciona lo que dice su ficha, presentación a presentación.');
process.exit(fallos ? 1 : 0);
