#!/usr/bin/env node
/**
 * MedCheck — test del término PubMed de GRUPO (ATC4) de la pestaña Evidencia.
 *
 * Carga la clase REAL de assets/js/cima-app.js y el diccionario INN REAL (inn-dict.js +
 * inn-es-en.json) en Node, y ejercita `_evidenceGroupTerm`, que es puro.
 *
 * Doctrina que fija este test:
 *   - el grupo es la OR de los principios monocomponente, cada uno con las MISMAS variantes que
 *     usa el modo principio activo (`_substanceIdentity`): un fármaco no se escribe de dos maneras;
 *   - el principio del medicamento abierto va primero; el resto, en orden alfabético;
 *   - un principio repetido en varios medicamentos entra una vez;
 *   - las asociaciones no aportan término propio, y un grupo hecho solo de asociaciones no da OR;
 *   - un grupo de un solo principio no se ofrece como grupo: la búsqueda sería la misma;
 *   - por encima del máximo no se construye término (la consulta deja de ser manejable);
 *   - lo que pasa sin traducción comprobada se declara, no se calla;
 *   - NO aparece ningún término MeSH: la equivalencia ATC→MeSH no existe como fuente.
 *
 * El fixture reproduce la forma de los listados de CIMA (traen `vtm`, no `pactivos`). Los
 * nombres son los de G04BD; se fijan como fixture y no se consultan en vivo.
 *
 * Uso: node scripts/medcheck-test-evidencia-grupo.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
    CimaAPI: { ATC_CATEGORIES: [] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });

const MedCheckApp = sandbox.window.__MedCheckAppClass;
const dict = sandbox.window.innDict;
if (typeof MedCheckApp !== 'function' || !dict) {
    console.error('No se pudo cargar MedCheckApp o innDict');
    process.exit(1);
}
// Mismo camino que `load()`, sin red: claves normalizadas, solo valores de texto.
const data = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8'));
for (const [k, v] of Object.entries(data.map || {})) if (typeof v === 'string') dict.map[dict.norm(k)] = v;
dict.loaded = true;

let failures = 0;
function check(name, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (!ok) {
        failures++;
        console.log(`  FALLO  ${name}\n         esperado: ${JSON.stringify(expected)}\n         obtenido: ${JSON.stringify(got)}`);
    } else {
        console.log(`  ok     ${name}`);
    }
}

const app = Object.create(MedCheckApp.prototype);
const med = (vtm, i = 0) => ({ nregistro: `${vtm}-${i}`, nombre: `${vtm.toUpperCase()} ${i} mg`, vtm: { nombre: vtm } });

// ─── G04BD con repetidos y una asociación ─────────────────────────────────────
const g04bd = [
    med('oxibutinina'), med('oxibutinina', 1),
    med('tolterodina'), med('solifenacina'), med('solifenacina', 1),
    med('fesoterodina'), med('mirabegron'), med('propiverina'),
    med('solifenacina + tamsulosina'),
];
const g = app._evidenceGroupTerm(g04bd, ['mirabegron']);
check('estado ok', g.estado, 'ok');
check('principio abierto primero, resto alfabético, sin repetidos', g.principios,
    ['mirabegron', 'fesoterodina', 'oxibutinina', 'propiverina', 'solifenacina', 'tolterodina']);
check('asociación con un componente ya incluido: absorbida (A OR (A AND B) = A)', [g.absorbidas, g.asociaciones], [1, 0]);
check('término = OR de las variantes de _substanceIdentity, en orden', g.term,
    ['mirabegron', 'fesoterodina', 'oxibutinina', 'propiverina', 'solifenacina', 'tolterodina']
        .flatMap(p => app._substanceIdentity(med(p)).components[0].variants).join(' OR '));
check('incluye la forma inglesa (PubMed indexa en inglés)', /\boxybutynin\b/.test(g.term) && /\bsolifenacin\b/.test(g.term), true);
check('sin comillas (rompen el ATM)', g.term.includes('"'), false);
check('sin MeSH ni etiquetas de campo', /\[(pa|mh|mesh|tiab)\]/i.test(g.term), false);
check('la asociación no cuela tamsulosina', /tamsulosin/.test(g.term), false);
// `trospio` no está en el diccionario (16/10/2026): pasa tal cual y la nota tiene que decirlo.
const conHueco = app._evidenceGroupTerm([med('trospio'), med('oxibutinina')], []);
check('se declara lo que pasa sin traducción comprobada', conHueco.sinVerificar, ['trospio']);
check('lo curado (diccionario o regla) no se declara', g.sinVerificar, []);

// ─── Casos sin término de grupo ───────────────────────────────────────────────
check('vacío', app._evidenceGroupTerm([], []).estado, 'vacio');
// ─── Grupo de asociaciones (G03FA, C09BA…): OR de asociaciones, cada una con AND (2026-10-16) ───
const asoc = app._evidenceGroupTerm(
    [med('lisinopril + hidroclorotiazida'), med('enalapril + hidroclorotiazida'), med('hidroclorotiazida + enalapril', 1)],
    ['enalapril', 'hidroclorotiazida']);
check('solo asociaciones: ya no se desactiva', asoc.estado, 'ok');
check('es de tipo asociaciones', asoc.tipo, 'asociaciones');
check('la asociación es la misma en cualquier orden, y la propia va primero', asoc.principios, ['enalapril + hidroclorotiazida', 'hidroclorotiazida + lisinopril']);
const v = n => app._substanceIdentity(med(n)).components[0].variants.join(' OR ');
// Dentro de cada AND, el orden es el del primer producto visto: en un AND no cambia nada.
check('término: OR de asociaciones, cada una con AND entre componentes', asoc.term,
    `((${v('enalapril')}) AND (${v('hidroclorotiazida')})) OR ((${v('lisinopril')}) AND (${v('hidroclorotiazida')}))`);
check('una sola asociación en el grupo, la abierta: la búsqueda sería la misma', app._evidenceGroupTerm([med('enalapril + hidroclorotiazida')], ['hidroclorotiazida', 'enalapril']).estado, 'unico');

// ─── Grupos mixtos: regla única con absorción (revisión de Codex, 17/10) ──────
// Patrón N02BE: paracetamol solo y asociaciones que lo contienen. Abrir la asociación NO es
// «la misma búsqueda» que el grupo: el grupo es paracetamol y se ofrece.
const n02be = app._evidenceGroupTerm([med('paracetamol'), med('paracetamol + ibuprofeno')], ['ibuprofeno', 'paracetamol']);
check('abierta A+B en un grupo cuyo único término es A: se ofrece', [n02be.estado, n02be.principios], ['ok', ['paracetamol']]);
const mixto = app._evidenceGroupTerm([med('paracetamol'), med('paracetamol + codeina'), med('ibuprofeno + arginina')], ['paracetamol']);
check('mixto: se conserva la asociación sin componente incluido', [mixto.tipo, mixto.principios, mixto.absorbidas], ['mixto', ['paracetamol', 'arginina + ibuprofeno'], 1]);
check('mixto: el término lleva el monocomponente y la asociación con AND', /((.*ibuprof.*) AND (.*))|((.*arginin.*) AND (.*))/.test(mixto.term) && mixto.term.startsWith('paracetamol'), true);
check('mixto: la asociación absorbida no entra (codeína)', /codein/.test(mixto.term), false);

// ─── Filtro por vía en el grupo ───────────────────────────────────────────────
const conVia = (vtm, ids, i = 0) => ({ ...med(vtm, i), viasAdministracion: ids.map(id => ({ id, nombre: `VÍA ${id}` })) });
const g03ca = [conVia('promestrieno', [67]), conVia('estriol', [67]), conVia('estriol', [48], 1), conVia('estradiol', [62]), conVia('estradiol', [67], 1)];
const vag = app._evidenceGroupTerm(g03ca, ['promestrieno'], { viaIds: [67] });
check('con vía vaginal entran los que tienen presentación vaginal', vag.principios, ['promestrieno', 'estradiol', 'estriol']);
check('sin vía, el grupo entero', app._evidenceGroupTerm(g03ca, ['promestrieno']).principios, ['promestrieno', 'estradiol', 'estriol']);
check('con una vía que solo tiene el abierto, «unico»', app._evidenceGroupTerm(g03ca, ['estradiol'], { viaIds: [62] }).estado, 'unico');
check('con una vía que no tiene nadie, «vacio»', app._evidenceGroupTerm(g03ca, [], { viaIds: [45] }).estado, 'vacio');

// ─── Vía del medicamento abierto ──────────────────────────────────────────────
app._consultVia = MedCheckApp.prototype._consultVia;
const viaVag = app._evidenceViaDeMed({ viasAdministracion: [{ id: 67, nombre: 'VÍA VAGINAL' }] });
check('vaginal: etiqueta e ids', [viaVag.etiqueta, viaVag.ids], ['vaginal', [67]]);
check('vaginal: descriptor MeSH + texto libre', viaVag.pubmed, '"Administration, Intravaginal"[Mesh] OR vaginal[tiab] OR intravaginal[tiab] OR vaginally[tiab]');

// ─── Valor por defecto de la vía: datos de CIMA, no farmacología (opción B, 17/10) ────────────
// Promestrieno solo es vaginal → en principio activo no se activa; G03CA tiene oral y
// transdérmica → en grupo sí. TESTOGEL o BUCCOLAM ya no se activan por ser «locales».
const promes = [conVia('promestrieno', [67]), conVia('promestrieno', [67], 1)];
const claveProm = app._evidenceClaveSustancia(med('promestrieno'));
check('sustancia con una sola vía: sin activar', app._evidenceViaPorDefecto(promes, viaVag, claveProm), { activar: false, motivo: 'unica', otras: [] });
check('grupo con otras vías: activada y dice cuáles', app._evidenceViaPorDefecto(g03ca, viaVag, null), { activar: true, motivo: 'distingue', otras: ['oral', 'transdérmica'] });
check('solo cuenta la MISMA sustancia en modo principio activo',
    app._evidenceViaPorDefecto([...promes, conVia('estradiol', [48])], viaVag, claveProm).activar, false);
const viaOral = app._evidenceViaDeMed({ viasAdministracion: [{ id: 48, nombre: 'VÍA ORAL' }] });
check('la oral nunca se activa sola', app._evidenceViaPorDefecto(g03ca, viaOral, null), { activar: false, motivo: 'oral', otras: [] });
const viaRara = app._evidenceViaDeMed({ viasAdministracion: [{ id: 127000, nombre: 'INFILTRACIÓN' }] });
check('vía sin correspondencia: sin activar', app._evidenceViaPorDefecto(g03ca, viaRara, null).motivo, 'sin-datos');
check('sin datos de CIMA: sin activar', app._evidenceViaPorDefecto([], viaVag, claveProm).motivo, 'sin-datos');
// TESTOGEL (17/10): CIMA dice «cutánea»; la testosterona también tiene parches («transdérmica») e
// inyectables. Los parches NO distinguen el gel (misma familia); los inyectables sí.
const viaCut = app._evidenceViaDeMed({ viasAdministracion: [{ id: 3, nombre: 'USO CUTÁNEO' }] });
const testo = [conVia('testosterona', [3]), conVia('testosterona', [62], 1), conVia('testosterona', [30], 2)];
check('cutánea y transdérmica son la misma familia al decidir', app._evidenceViaPorDefecto(testo, viaCut, app._evidenceClaveSustancia(med('testosterona'))).otras, ['intramuscular']);
check('solo parches como otra vía: no distingue', app._evidenceViaPorDefecto(testo.slice(0, 2), viaCut, app._evidenceClaveSustancia(med('testosterona'))).motivo, 'unica');
check('el bloque cutáneo recoge «transdermal» (gel de efecto sistémico)', /transdermal\[tiab\]/.test(viaCut.pubmed), true);
const ivim = app._evidenceViaDeMed({ viasAdministracion: [{ id: 42, nombre: 'VÍA INTRAVENOSA' }, { id: 30, nombre: 'VÍA INTRAMUSCULAR' }] });
check('varias vías: OR de bloques', [ivim.etiqueta, ivim.pubmed.startsWith('(') && ivim.pubmed.includes(') OR (')], ['intravenosa, intramuscular', true]);
check('una vía sin equivalencia se declara', app._evidenceViaDeMed({ viasAdministracion: [{ id: 127000, nombre: 'INFILTRACIÓN' }] }).sinEquivalencia, ['infiltración']);
check('sin vías, nada', app._evidenceViaDeMed({}), null);
// Cada bloque de la tabla: comillas pares, paréntesis equilibrados, solo [Mesh] y [tiab].
const malas = Object.entries(MedCheckApp._EV_VIAS).filter(([, e]) =>
    (e.pubmed.match(/"/g) || []).length % 2 || /\[(?!Mesh\]|tiab\])/.test(e.pubmed) || !e.etiqueta);
check('tabla de vías bien formada', malas.map(([id]) => id), []);

// ─── Consulta por identidad a CIMA (revisión de Codex, 17/10) ─────────────────
// El VTM no es un nombre válido de practiv1: «bromuro ipratropio» devolvía 0. Se consulta primero
// por el id del principio activo de la ficha, luego por su nombre oficial, y el VTM al final.
const atrov = { vtm: { nombre: 'bromuro ipratropio' }, principiosActivos: [{ id: 1067, nombre: 'IPRATROPIO BROMURO', orden: 1 }] };
check('orden de consultas: id, nombre oficial, VTM',
    app._evidenceConsultasSustancia(atrov, app._substanceIdentity(atrov)),
    [{ idpractiv1: 1067 }, { practiv1: 'IPRATROPIO BROMURO' }, { practiv1: 'bromuro ipratropio' }]);
check('sin ficha de detalle, solo el VTM', app._evidenceConsultasSustancia(med('estriol'), app._substanceIdentity(med('estriol'))), [{ practiv1: 'estriol' }]);
{
    const pedidas = [];
    app.api = { searchMedicamentosAll: async p => { pedidas.push(p); return p.idpractiv1 ? { resultados: [], totalFilas: 0, totalDeclarado: 0 } : { resultados: [med('ipratropio')], totalFilas: 3, totalDeclarado: 3 }; } };
    app._evSustanciaMedsCache = null;
    const r = await app._evidenceSustanciaMeds([{ idpractiv1: 1067 }, { practiv1: 'IPRATROPIO BROMURO' }]);
    check('si una consulta devuelve 0, prueba la siguiente', pedidas.map(p => Object.keys(p)[0]), ['idpractiv1', 'practiv1']);
    check('resultado truncado (1 de 3): completo = false', [r.meds.length, r.completo], [1, false]);
}

// ─── Completitud con el paginador REAL (revisión de Codex, P2, 17/10) ─────────
// `searchMedicamentosAll` de cima-api.js con un transporte controlado. Antes, una segunda página
// que repetía la primera daba completo=true, y un total ausente también (el helper lo sustituía
// por las filas recibidas). Ahora cuentan nregistros únicos contra el total que DECLARA CIMA.
{
    const apiBox = { window: {}, console: { log() {}, warn() {}, error() {} }, fetch: () => Promise.reject(new Error('sin red')), setTimeout, clearTimeout, Date, Math, JSON, Promise, Map, Set, RegExp, AbortController: class { abort() {} }, navigator: {} };
    vm.createContext(apiBox);
    vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8')}\n;window.__CimaAPIClass = CimaAPI;`, apiBox, { filename: 'cima-api.js' });
    const helper = apiBox.window.__CimaAPIClass.prototype.searchMedicamentosAll;
    const transporte = paginas => ({ searchMedicamentosAll: helper, searchMedicamentos: async p => paginas[p.pagina - 1] || { resultados: [] } });
    const atr = { nregistro: '61184', vtm: { nombre: 'bromuro ipratropio' } };
    const otro = { nregistro: '73561', vtm: { nombre: 'bromuro ipratropio' } };
    const completo = async paginas => {
        app.api = transporte(paginas);
        app._evSustanciaMedsCache = null;
        const r = await app._evidenceSustanciaMeds([{ idpractiv1: 1067 }]);
        return [r.meds.length, r.completo];
    };
    check('página repetida (Atrovent dos veces, total 2): 1 único, completo = false',
        await completo([{ resultados: [atr], totalFilas: 2 }, { resultados: [atr], totalFilas: 2 }]), [1, false]);
    check('sin totalFilas: completo = false', await completo([{ resultados: [atr] }]), [1, false]);
    check('dos páginas con dos únicos y total 2: completo = true',
        await completo([{ resultados: [atr], totalFilas: 2 }, { resultados: [otro], totalFilas: 2 }]), [2, true]);
    // Recuentos contradictorios (segunda revisión de Codex, 17/10): reproducidos con completo=true.
    const tercero = { nregistro: '82145', vtm: { nombre: 'bromuro ipratropio' } };
    check('total que cambia entre páginas (2 → 3): completo = false',
        await completo([{ resultados: [atr], totalFilas: 2 }, { resultados: [otro], totalFilas: 3 }]), [2, false]);
    check('segunda página sin total: completo = false',
        await completo([{ resultados: [atr], totalFilas: 2 }, { resultados: [otro] }]), [2, false]);
    check('más únicos que los declarados (declara 1, trae 2): completo = false',
        await completo([{ resultados: [atr, otro], totalFilas: 1 }]), [2, false]);
    check('declara 0 y trae un registro: completo = false', await completo([{ resultados: [atr], totalFilas: 0 }]), [1, false]);
    check('tres páginas coherentes: completo = true',
        await completo([{ resultados: [atr], totalFilas: 3 }, { resultados: [otro], totalFilas: 3 }, { resultados: [tercero], totalFilas: 3 }]), [3, true]);
    check('el helper expone el total declarado, o null si falta',
        [(await transporte([{ resultados: [atr], totalFilas: 1 }]).searchMedicamentosAll({})).totalDeclarado,
            (await transporte([{ resultados: [atr] }]).searchMedicamentosAll({})).totalDeclarado], [1, null]);
}

// ─── Composición en bloques: (fármaco) AND (vía) AND (acotación) ──────────────
check('fármaco y vía', app._evidenceComposeTerm('a OR b', '', 'vaginal[tiab]'), '(a OR b) AND (vaginal[tiab])');
check('fármaco, vía y acotación: la acotación la última', app._evidenceComposeTerm('a', 'x', 'v'), '(a) AND (v) AND (x)');
check('un único principio (varios medicamentos)', app._evidenceGroupTerm([med('paracetamol'), med('paracetamol', 1), med('paracetamol + codeina')], ['paracetamol']).estado, 'unico');
const muchos = Array.from({ length: 16 }, (_, i) => med(`farmaco${String.fromCharCode(97 + i)}`));
const amplio = app._evidenceGroupTerm(muchos, []);
check('por encima del máximo', amplio.estado, 'amplio');
check('por encima del máximo no se construye término', amplio.term, '');
check('en el máximo sí', app._evidenceGroupTerm(muchos.slice(0, 15), []).estado, 'ok');

// ─── La nota dice el perímetro ────────────────────────────────────────────────
app._escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nota = app._evidenceGroupNoteHtml(g, { codigo: 'G04BD', nombre: 'ANTIESPASMÓDICOS URINARIOS' });
check('la nota nombra el perímetro (comercializados en España)', nota.includes('comercializados en España'), true);
check('la nota dice que REec y ClinicalTrials siguen con el principio', nota.includes('REec y ClinicalTrials.gov siguen con el principio activo'), true);
check('la nota de un grupo inviable da el motivo', app._evidenceGroupNoteHtml(amplio, { codigo: 'L01XX', nombre: '' }).includes('máximo 15'), true);

// ─── Acotar con AND (2026-10-16) ──────────────────────────────────────────────
// Los dos lados entre paréntesis: el grupo es una cadena de OR y lo escrito a mano puede traer
// operadores propios. Sin acotación, el término queda como estaba (mismas claves de caché).
check('sin acotar, el término no cambia', app._evidenceComposeTerm('mirabegron', ''), 'mirabegron');
check('sin acotar, solo espacios tampoco', app._evidenceComposeTerm('mirabegron', '  \n '), 'mirabegron');
check('acotado: paréntesis a los dos lados', app._evidenceComposeTerm('a OR b OR c', 'overactive bladder'), '(a OR b OR c) AND (overactive bladder)');
check('los saltos de línea del textarea son espacios', app._evidenceComposeTerm('a OR\nb', 'x\n  y'), '(a OR b) AND (x y)');
check('sin término de fármaco no hay consulta', app._evidenceComposeTerm('', 'overactive'), '');

// ─── Trozo sobre el que se piden sugerencias MeSH ─────────────────────────────
check('texto simple: todo es el trozo', app._evidenceAcotarSegment('overact'), { prefijo: '', trozo: 'overact', sugerible: true });
check('tras el último operador', app._evidenceAcotarSegment('elderly AND noctur'), { prefijo: 'elderly AND ', trozo: 'noctur', sugerible: true });
check('con varios operadores, el último', app._evidenceAcotarSegment('a OR b NOT inco'), { prefijo: 'a OR b NOT ', trozo: 'inco', sugerible: true });
check('menos de 3 letras no se sugiere', app._evidenceAcotarSegment('ov').sugerible, false);
check('con sintaxis PubMed no se sugiere', app._evidenceAcotarSegment('"heart failure"[mh]').sugerible, false);
check('«and» en minúscula no es operador (PubMed tampoco lo trata así)', app._evidenceAcotarSegment('heart and lung').prefijo, '');

// ─── Interpretación de PubMed (querytranslation), respuestas REALES del 16/10/2026 ─────────────
const FECHA = '"2021/10/17 00:00":"3000/01/01 05:00"[Date - Publication]';
const MIRA = '("mirabegron"[Supplementary Concept] OR "mirabegron"[All Fields])';
const interp = (traduccion, conAcotacion, extra = {}) => app._evidenceInterpretacion({ traduccion, errorlist: null, warninglist: null, ...extra }, conAcotacion);

check('top-level AND respeta paréntesis y comillas',
    app._splitTopLevelAnd(`${MIRA} AND ("vejiga"[All Fields] AND "hiperactiva"[All Fields]) AND ${FECHA}`).length, 3);
check('«vejiga hiperactiva» queda como texto libre (el caso que motivó esto)',
    interp(`${MIRA} AND ("vejiga"[All Fields] AND "hiperactiva"[All Fields]) AND ${FECHA}`, true).acotacionLibre, ['vejiga', 'hiperactiva']);
check('una palabra suelta sin paréntesis también',
    interp(`${MIRA} AND "nicturia"[All Fields] AND ${FECHA}`, true).acotacionLibre, ['nicturia']);
check('«elderly» mapea a aged: sin aviso',
    interp(`${MIRA} AND ("aged"[MeSH Terms] OR "aged"[All Fields] OR "elderly"[All Fields]) AND ${FECHA}`, true).acotacionLibre, null);
check('el descriptor insertado mapea: sin aviso',
    interp(`${MIRA} AND ("urinary bladder, overactive"[MeSH Terms] OR ("urinary"[All Fields] AND "bladder"[All Fields])) AND ${FECHA}`, true).acotacionLibre, null);
check('sin acotación no se evalúa el último bloque (sería el fármaco)',
    interp(`"nicturia"[All Fields] AND ${FECHA}`, false).acotacionLibre, null);
check('sin fecha, el último bloque sigue siendo la acotación',
    interp(`${MIRA} AND "nicturia"[All Fields]`, true).acotacionLibre, ['nicturia']);
check('etiqueta propia del usuario ([Title/Abstract]) no se marca como libre',
    interp(`${MIRA} AND "nicturia"[Title/Abstract]`, true).acotacionLibre, null);
check('lo descartado por PubMed se declara (desfesoterodina en el grupo)',
    interp(`${MIRA} AND ${FECHA}`, false, { errorlist: { phrasesnotfound: ['desfesoterodina'], fieldsnotfound: [] } }).descartados, ['desfesoterodina']);
check('«No items found» no es un descarte',
    interp(`${MIRA}`, false, { warninglist: { phrasesignored: [], quotedphrasesnotfound: [], outputmessages: ['No items found.'] } }).descartados, []);

if (failures) {
    console.log(`\n${failures} fallo(s)`);
    process.exit(1);
}
console.log('\nTodo en orden');
