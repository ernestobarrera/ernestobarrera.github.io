#!/usr/bin/env node
/**
 * MedCheck — test del alcance de «Consultar IA» (medicamento · principio activo · grupo)
 *
 * PREGUNTA QUE RESPONDE: cuando el clínico pregunta por un GRUPO —desde Indicaciones/ATC o
 * subiendo de nivel en la ficha—, ¿el prompt lleva lo que cambia la respuesta, deja fuera lo
 * particular del producto, dice la verdad sobre lo que hay en pantalla y avisa de lo que pasó?
 *
 * Nació el 2026-10-03 de una petición de Ernesto: desde «estrógenos vaginales», preguntar si el
 * médico de familia puede prescribirlos sin exploración ginecológica, sin que el prompt arrastre
 * marcas ni presentaciones. La revisión de Codex del mismo día (a37f35c) encontró lo que la
 * primera versión de este banco no vigilaba y ahora sí:
 *   · la vía no basta: óvulo y gel de estriol, o inhalador y nebulizador de salbutamol, daban el
 *     mismo prompt → ahora viaja la forma;
 *   · «diabetes» filtrada a metformina seguía afirmando insulinas → ATC consultados ≠ presentes;
 *   · con cero resultados se preguntaba por el grupo sin filtros;
 *   · la pregunta sobre estrógenos se arrastraba a IBP;
 *   · el helper anunciaba «copiado» aunque el portapapeles fallara;
 *   · quitar la cautela de dosis/formulación seguía en verde.
 *
 * Se carga la CLASE REAL de assets/js/cima-app.js en una VM (mismo patrón que
 * medcheck-test-filters.mjs). La versión anterior extraía métodos por llaves equilibradas, que
 * Codex demostró frágil ante plantillas, regex y comentarios con llaves.
 *
 * Uso: node scripts/medcheck-test-consulta-ia.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const abiertos = [];
const sandbox = {
    window: { open: url => { abiertos.push(url); return null; } },
    document: { addEventListener() {}, getElementById: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true, clipboard: { writeText: () => Promise.resolve() } },
    location: { search: '', href: '' },
    CimaAPI: { ATC_CATEGORIES: [{ code: 'G', name: 'Genitourinario', subcategories: [{ code: 'G03C', name: 'Estrógenos', subcategories: [{ code: 'G03CA', name: 'Estrógenos naturales y semisintéticos' }] }] }] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets', 'js', 'cima-app.js'), 'utf8');
vm.runInContext(`${src}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const MedCheckApp = sandbox.window.__MedCheckAppClass;
if (typeof MedCheckApp !== 'function') { console.error('No se pudo cargar la clase MedCheckApp'); process.exit(1); }

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};

const toasts = [];
const app = Object.create(MedCheckApp.prototype);
app.showToast = (msg, tipo) => toasts.push({ msg, tipo });
app._escapeHtml = s => String(s);

const porDefecto = kind => app._consultAspects().filter(a => a.defPor.includes(kind)).map(a => a.id);
const g4 = { codigo: 'G03CA', nombre: 'Estrogenos naturales y semisinteticos, monofarmacos', nivel: 4 };
const via = v => [{ nombre: v }];

// --- 1. EL CASO DEL PARTE: G03CA filtrado a vía vaginal ------------------------------------
const vaginales = [
    { nombre: 'OVESTINON 1 mg/g CREMA VAGINAL', vtm: { nombre: 'estriol' }, formaFarmaceutica: { nombre: 'CREMA VAGINAL' }, viasAdministracion: via('VÍA VAGINAL'), labtitular: 'Aspen', atcs: [g4] },
    { nombre: 'VAGIFEM 10 MICROGRAMOS COMPRIMIDOS VAGINALES', vtm: { nombre: 'estradiol' }, formaFarmaceutica: { nombre: 'COMPRIMIDO VAGINAL' }, viasAdministracion: via('VÍA VAGINAL'), atcs: [g4] },
    { nombre: 'COLPOTROFIN 10 mg/g CREMA VAGINAL', vtm: { nombre: 'promestrieno' }, formaFarmaceutica: { nombre: 'CREMA VAGINAL' }, viasAdministracion: via('VÍA VAGINAL'), atcs: [g4] },
];
const dataAtc = { matchedIndication: { label: 'Estrógenos naturales y semisintéticos', atc: 'G03CA' } };
const grupo = app._consultScopeFromResults(dataAtc, vaginales, 'G03CA');
const duda = 'Como médico de familia, ¿se pueden prescribir sin exploración ginecológica ante síntomas locales o ITU de repetición? ¿Hay guías que lo respalden?';
const pGrupo = app._composeConsultPrompt(grupo, { selected: porDefecto('grupo'), doubt: duda });

ok('grupo: lleva la vía cuando todo el grupo filtrado comparte una', pGrupo.includes('- Vía: vaginal (responde para esta vía'));
ok('grupo: lleva los principios activos', ['estriol', 'estradiol', 'promestrieno'].every(p => pGrupo.includes(p)));
ok('grupo: lleva las formas presentes', pGrupo.includes('- Formas presentes: crema vaginal, comprimido vaginal'));
ok('grupo: NO lleva marcas ni laboratorio', !/OVESTINON|VAGIFEM|COLPOTROFIN|Aspen/i.test(pGrupo));
ok('grupo: NO lleva dosis', !/mg\/g|MICROGRAMOS|\b10 mg\b/i.test(pGrupo));
ok('grupo: NO usa la cabecera de producto', !pGrupo.includes('FÁRMACO:'));
ok('grupo: pregunta del clínico antes que los apartados',
    pGrupo.indexOf('PREGUNTA DEL CLÍNICO') > -1 && pGrupo.indexOf('PREGUNTA DEL CLÍNICO') < pGrupo.indexOf('DESPUÉS, RESPONDE'));
ok('grupo: en navegación ATC no inventa una búsqueda de origen distinta', !/Búsqueda de origen/.test(pGrupo));
ok('grupo: «Sobre» dice lo que viaja',
    app._consultScopeLabel(grupo) === 'G03CA Estrogenos naturales y semisinteticos, monofarmacos — estriol, estradiol, promestrieno — crema vaginal, comprimido vaginal — vía vaginal',
    app._consultScopeLabel(grupo));

// --- 2. Texto: lo que el prompt pide y lo que ya no pide (contratos semánticos) ------------
ok('texto: conserva la cautela de forma, concentración y población', /distingue/.test(pGrupo) && /la forma, la concentración o la población/.test(pGrupo));
ok('texto: «no mencionado» no es «innecesario»', /no mencione un requisito no significa que sea innecesario/.test(pGrupo));
ok('texto: el silencio de una guía no es discrepancia', /calle algo que dice la ficha no es una discrepancia/.test(pGrupo) && !/u omita/.test(pGrupo));
ok('texto: ficha identificada por registro, sin ficha única de clase', /número de registro y formulación/.test(pGrupo) && /no atribuyas una ficha única a la clase/.test(pGrupo));
ok('texto: separa 4.1, 4.3 y 4.4', /\(4\.1\)/.test(pGrupo) && /\(4\.3\)/.test(pGrupo) && /\(4\.4\)/.test(pGrupo));
ok('texto: ficha inaccesible = no verificado', /decláralo no verificado/.test(pGrupo));
ok('texto: no pide veredicto sí/no ni «obliga a derivar»', !/sí, no o depende/.test(pGrupo) && !/obliga a derivar/.test(pGrupo));
ok('texto: grado o certeza solo si la fuente los da', /solo si constan/.test(pGrupo) && /solo si la fuente los da/.test(pGrupo));
ok('texto: no descarta una guía vigente por su fecha', /sin descartar una guía vigente por su fecha/.test(pGrupo));

// --- 3. La forma distingue lo que la vía sola no distingue ---------------------------------
const ovulo = { vtm: { nombre: 'estriol' }, formaFarmaceutica: { nombre: 'ÓVULO' }, viasAdministracion: via('VÍA VAGINAL'), atcs: [g4] };
const gel = { vtm: { nombre: 'estriol' }, formaFarmaceutica: { nombre: 'GEL VAGINAL' }, viasAdministracion: via('VÍA VAGINAL'), atcs: [g4] };
const pOvulo = app._composeConsultPrompt(app._consultScopeFromResults(dataAtc, [ovulo], 'G03CA'), { selected: ['guias'] });
const pGel = app._composeConsultPrompt(app._consultScopeFromResults(dataAtc, [gel], 'G03CA'), { selected: ['guias'] });
ok('forma: óvulo y gel de estriol dan prompts distintos', pOvulo !== pGel);

const salbu = (forma) => ({ nombre: 'X', vtm: { nombre: 'salbutamol' }, formaFarmaceutica: { nombre: forma }, viasAdministracion: via('VÍA INHALATORIA'),
    atcs: [{ codigo: 'R03AC', nombre: 'Agonistas selectivos beta-2', nivel: 4 }, { codigo: 'R03AC02', nombre: 'Salbutamol', nivel: 5 }] });
const pInh = app._composeConsultPrompt(app._consultScopeFromMed(salbu('SUSPENSIÓN PARA INHALACIÓN EN ENVASE A PRESIÓN'), 'pa'), { selected: ['guias'] });
const pNeb = app._composeConsultPrompt(app._consultScopeFromMed(salbu('SOLUCIÓN PARA INHALACIÓN POR NEBULIZADOR'), 'pa'), { selected: ['guias'] });
ok('forma: inhalador y nebulizador de salbutamol dan prompts distintos (alcance PA)', pInh !== pNeb && pNeb.includes('nebulizador'));
ok('forma: desde la ficha la forma se rotula como referencia, no como el ámbito', pNeb.includes('Forma del medicamento de partida, como referencia'));

// --- 4. Consultados ≠ presentes: diabetes filtrada a metformina ----------------------------
const metformina = [1, 2].map(i => ({ nombre: `M${i}`, vtm: { nombre: 'metformina' }, formaFarmaceutica: { nombre: 'COMPRIMIDO RECUBIERTO CON PELÍCULA' }, viasAdministracion: via('VÍA ORAL'),
    atcs: [{ codigo: 'A10BA', nombre: 'Biguanidas', nivel: 4 }] }));
const scDiab = app._consultScopeFromResults({ matchedIndication: { label: 'Diabetes', atc: ['A10A', 'A10B', 'texto libre'] } }, metformina, null);
const pDiab = app._composeConsultPrompt(scDiab, { selected: ['guias'] });
ok('diabetes→metformina: la búsqueda de origen se rotula como tal', pDiab.includes('- Búsqueda de origen: Diabetes (ATC consultados: A10A, A10B)'));
ok('diabetes→metformina: lo que hay en pantalla es A10BA, no insulinas', pDiab.includes('ATC en pantalla: A10BA Biguanidas') && !/Insulinas/i.test(pDiab));
ok('diabetes→metformina: «Sobre» no afirma insulinas', !/A10A/.test(app._consultScopeLabel(scDiab)), app._consultScopeLabel(scDiab));
ok('indicación: descarta un «atc» que no es código', !pDiab.includes('texto libre'));

// --- 5. Conjunto vacío, asociaciones, vía no declarada, tope, selección --------------------
const scVacio = app._consultScopeFromResults(dataAtc, [], 'G03CA');
ok('vacío: cero resultados no producen prompt', app._composeConsultPrompt(scVacio, { selected: ['guias'], doubt: duda }) === '');
ok('vacío: «Sobre» lo dice', app._consultScopeLabel(scVacio) === 'ningún medicamento con estos filtros');

const asoc = [{ vtm: { nombre: 'dapagliflozina + metformina' }, viasAdministracion: via('VÍA ORAL') }, { vtm: { nombre: 'metformina' }, viasAdministracion: via('VÍA ORAL') }];
const scAsoc = app._consultScopeFromResults({ matchedIndication: { label: 'Diabetes', atc: 'A10B' } }, asoc, null);
ok('asociación: la asociación fija es UNA entrada', scAsoc.pas.includes('dapagliflozina + metformina') && scAsoc.pas.length === 2, JSON.stringify(scAsoc.pas));

const sinVia = [...vaginales, { vtm: { nombre: 'estriol' }, atcs: [g4] }];
const pSinVia = app._composeConsultPrompt(app._consultScopeFromResults(dataAtc, sinVia, 'G03CA'), { selected: ['guias'] });
ok('vía no declarada: se dice, no se calla', pSinVia.includes('- Vía no declarada en CIMA para 1 de 4 medicamentos.'));

const mixtos = [...vaginales, { vtm: { nombre: 'estradiol' }, formaFarmaceutica: { nombre: 'COMPRIMIDO' }, viasAdministracion: via('VÍA ORAL'), atcs: [g4] }];
const pMixto = app._composeConsultPrompt(app._consultScopeFromResults(dataAtc, mixtos, 'G03CA'), { selected: ['guias'] });
ok('vías mezcladas: pide distinguir por vía', pMixto.includes('Vías presentes: vaginal, oral (si la respuesta cambia con la vía, distingue por vía)'));

const muchos = Array.from({ length: 12 }, (_, i) => ({ vtm: { nombre: `PA${String(i).padStart(2, '0')}` }, viasAdministracion: via('VÍA ORAL') }));
const scMuchos = app._consultScopeFromResults(dataAtc, muchos, 'G03CA', ['PA11']);
const pMuchos = app._composeConsultPrompt(scMuchos, { selected: ['guias'] });
ok('tope: 8 principios activos y el resto contado', /y 4 más/.test(pMuchos));
ok('tope: el principio activo elegido en los chips entra aunque fuera el último', scMuchos.pas[0] === 'pa11' && pMuchos.includes('pa11'));

ok('solo pregunta: basta con la pregunta', app._composeConsultPrompt(grupo, { selected: [], doubt: duda }).includes(duda));
ok('nada: sin pregunta ni apartados no hay prompt', app._composeConsultPrompt(grupo, { selected: [], doubt: '  ' }) === '');

// --- 6. Desde la ficha: los tres niveles -------------------------------------------------
const med = {
    nombre: 'OVESTINON 1 mg/g CREMA VAGINAL', vtm: { nombre: 'estriol' },
    formaFarmaceutica: { nombre: 'CREMA VAGINAL' }, viasAdministracion: via('VÍA VAGINAL'),
    // `atcs[0]` es el nivel 3: el alcance no puede fiarse del orden.
    atcs: [{ codigo: 'G03C', nombre: 'Estrógenos', nivel: 3 }, { codigo: 'G03CA04', nombre: 'Estriol', nivel: 5 }, { codigo: 'G03CA', nombre: 'Estrógenos naturales y semisintéticos', nivel: 4 }],
};
const pProd = app._composeConsultPrompt(app._consultScopeFromMed(med, 'producto'), { selected: porDefecto('producto') });
ok('producto: cabecera de siempre con marca y ATC de nivel 5', pProd.includes('FÁRMACO: estriol (ATC G03CA04) — OVESTINON 1 mg/g CREMA VAGINAL'));
ok('producto: por defecto, monitorización (como antes)', pProd.includes('MONITORIZACIÓN') && !pProd.includes('GUÍAS Y CONSENSO'));
const pPa = app._composeConsultPrompt(app._consultScopeFromMed(med, 'pa'), { selected: porDefecto('pa') });
ok('principio activo: sin marca, con vía y ATC 5', !pPa.includes('OVESTINON') && pPa.includes('Principio activo: estriol') && pPa.includes('- Vía: vaginal') && pPa.includes('G03CA04'));
const scGF = app._consultScopeFromMed(med, 'grupo');
ok('grupo desde la ficha: ATC de nivel 4, no el 3 de atcs[0]', scGF?.atcs[0]?.codigo === 'G03CA', JSON.stringify(scGF?.atcs));
ok('grupo desde la ficha: sin ATC 4 no hay alcance de grupo', app._consultScopeFromMed({ ...med, atcs: [{ codigo: 'G03CA04', nivel: 5 }] }, 'grupo') === null);

// --- 7. La pregunta no se arrastra a otro universo ----------------------------------------
const U = (atcCode, query) => app._indAiUniverso({ atcCode, query });
ok('universo: bajar por la misma rama conserva', app._indAiMismoUniverso(U('G03C'), U('G03CA')));
ok('universo: subir por la misma rama conserva', app._indAiMismoUniverso(U('G03CA'), U('G03C')));
ok('universo: estrógenos → IBP no conserva', !app._indAiMismoUniverso(U('G03CA'), U('A02BC')));
ok('universo: misma búsqueda por término conserva', app._indAiMismoUniverso(U(null, 'Diabetes'), U(null, 'diabetes')));
ok('universo: término → ATC no conserva', !app._indAiMismoUniverso(U(null, 'Diabetes'), U('A10BA')));

// Integración con la entrada de universo real (sin DOM: la captura cae al estado guardado).
app._resetResultFilters = () => {};
app._indAi = { open: true, state: { doubt: duda, selected: ['guias'], scenarios: [] }, universo: U('G03CA') };
app._enterIndicationUniverse({ atcCode: 'G03CA', label: 'x', query: 'x', preserveFilters: true });
ok('entrada: mismo universo («Comercializado») conserva la pregunta', app._indAi.state?.doubt === duda);
app._enterIndicationUniverse({ atcCode: 'A02BC', label: 'IBP', query: 'IBP' });
ok('entrada: otra rama borra la pregunta y deja el panel abierto', app._indAi.state === null && app._indAi.open === true);

// --- 8. El helper avisa de lo que pasó, no de lo que intentó ------------------------------
const largo = 'x '.repeat(3000);
toasts.length = 0; abiertos.length = 0;
let fallback = null;
app._showPromptFallback = p => { fallback = p; };
sandbox.navigator.clipboard = { writeText: () => Promise.reject(new Error('denegado')) };
await app._openAiEngine('chatgpt', largo);
ok('portapapeles rechazado + prompt largo: sin falso «copiado»', !toasts.some(t => /copiado/i.test(t.msg) && t.tipo === 'success'), JSON.stringify(toasts));
ok('portapapeles rechazado + prompt largo: muestra el prompt para copiarlo a mano', fallback === largo);
ok('portapapeles rechazado + prompt largo: la ventana se abre igual (gesto del clínico)', abiertos.length === 1);

toasts.length = 0; fallback = null;
await app._openAiEngine('chatgpt', 'corto');
ok('portapapeles rechazado + precarga: avisa sin bloquear y sin cuadro', toasts.some(t => t.tipo === 'warning') && fallback === null);

toasts.length = 0;
sandbox.navigator.clipboard = { writeText: () => Promise.resolve() };
await app._openAiEngine('perplexity', 'corto');
ok('portapapeles correcto: éxito', toasts.some(t => t.tipo === 'success'));

// --- 9. Longitud: el caso típico se precarga en ChatGPT ------------------------------------
// Pregunta corta más los dos apartados por defecto. Por encima del umbral ChatGPT se abre vacío y
// hay que pegar, que es justo el paso que se quería ahorrar.
const cod = encodeURIComponent(pGrupo).length;
ok(`longitud: el caso típico cabe en la URL de ChatGPT (${cod} de 4000 codificado)`, cod <= 4000);

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
