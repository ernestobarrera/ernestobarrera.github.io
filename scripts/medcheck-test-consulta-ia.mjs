#!/usr/bin/env node
/**
 * MedCheck — test del alcance de «Consultar IA» (medicamento · principio activo · grupo)
 *
 * PREGUNTA QUE RESPONDE: cuando el clínico pregunta por un GRUPO —desde Indicaciones/ATC o
 * subiendo de nivel en la ficha—, ¿el prompt lleva lo que cambia la respuesta y deja fuera lo
 * particular del producto?
 *
 * Nació el 2026-10-03 de una petición suya: desde «estrógenos vaginales», preguntar si el médico
 * de familia puede prescribirlos sin exploración ginecológica, sin que el prompt arrastre marcas ni
 * presentaciones. El caso enseña la trampa que este test vigila: G03CA mezcla estrógenos
 * sistémicos y vaginales, así que generalizar quitando también la VÍA cambia la pregunta.
 *
 * Se ejecuta el CUERPO REAL de las funciones extraído de assets/js/cima-app.js. Una copia tecleada
 * aquí se quedaría atrás en silencio y el test seguiría verde sobre código muerto.
 *
 * Uso: node scripts/medcheck-test-consulta-ia.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSrc = readFileSync(join(ROOT, 'assets', 'js', 'cima-app.js'), 'utf8');

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`); }
};

/** Extrae un método `{...}` equilibrado a partir de su firma (ignora llaves en cadenas y plantillas). */
function bloqueDesde(src, firma) {
    const i = src.indexOf(firma);
    if (i === -1) throw new Error(`no se encontró "${firma}" en el fuente`);
    const j = src.indexOf('{', i + firma.length - 1);
    let prof = 0;
    let cadena = null;
    for (let k = j; k < src.length; k++) {
        const c = src[k];
        if (cadena) {
            if (c === '\\') { k++; continue; }
            if (c === cadena) cadena = null;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') { cadena = c; continue; }
        if (c === '{') prof++;
        else if (c === '}') { prof--; if (!prof) return src.slice(i, k + 1); }
    }
    throw new Error(`bloque sin cerrar para "${firma}"`);
}

const FIRMAS = [
    '_consultAspects() {',
    '_consultVia(nombre) {',
    '_consultListaPas(pas, max = 8) {',
    "_consultScopeFromMed(med, kind = 'producto') {",
    '_consultScopeFromResults(data, filtered, atcCode = null) {',
    '_consultScopeLabel(scope) {',
    "_composeConsultPrompt(scope, { selected = [], scenarios = [], doubt = '' } = {}) {",
    'extractUniquePrincipiosActivos(results) {',
];
// eslint-disable-next-line no-new-func
const app = new Function(`return { ${FIRMAS.map(f => bloqueDesde(appSrc, f)).join(',\n')} };`)();
app._describeATCCode = c => ({ G03CA: 'Estrógenos naturales y semisintéticos', G03C: 'Estrógenos' }[c] || '');

const porDefecto = kind => app._consultAspects().filter(a => a.defPor.includes(kind)).map(a => a.id);

// --- 1. EL CASO DEL PARTE: estrógenos vaginales desde el árbol ATC, filtrados por forma -------
const vaginales = [
    { nombre: 'OVESTINON 1 mg/g CREMA VAGINAL', pactivos: 'ESTRIOL', viasAdministracion: [{ nombre: 'VÍA VAGINAL' }], labtitular: 'Aspen' },
    { nombre: 'VAGIFEM 10 MICROGRAMOS COMPRIMIDOS VAGINALES', pactivos: 'ESTRADIOL', viasAdministracion: [{ nombre: 'VÍA VAGINAL' }] },
    { nombre: 'COLPOTROFIN 10 mg/g CREMA VAGINAL', pactivos: 'PROMESTRIENO', viasAdministracion: [{ nombre: 'VÍA VAGINAL' }] },
];
const dataAtc = { matchedIndication: { label: 'Estrógenos naturales y semisintéticos', atc: 'G03CA' } };
const grupo = app._consultScopeFromResults(dataAtc, vaginales, 'G03CA');
const duda = 'Como médico de familia, ¿se pueden prescribir sin exploración ginecológica ante síntomas locales o ITU de repetición? ¿Hay guías que lo respalden?';
const pGrupo = app._composeConsultPrompt(grupo, { selected: porDefecto('grupo'), doubt: duda });

ok('grupo: lleva la vía cuando todo el grupo filtrado comparte una', pGrupo.includes("- Vía: vaginal (responde para esta vía"), pGrupo.split('\n').find(l => /V[ií]a/.test(l)));
ok('grupo: lleva los principios activos', ['estriol', 'estradiol', 'promestrieno'].every(p => pGrupo.includes(p)));
ok('grupo: lleva el ATC con su nombre', pGrupo.includes('G03CA Estrógenos naturales y semisintéticos'));
ok('grupo: NO lleva marcas', !/OVESTINON|VAGIFEM|COLPOTROFIN/i.test(pGrupo));
ok('grupo: NO lleva dosis ni presentaciones', !/mg\/g|MICROGRAMOS|COMPRIMIDOS VAGINALES|CREMA/i.test(pGrupo));
ok('grupo: NO lleva laboratorio', !/Aspen/i.test(pGrupo));
ok('grupo: NO usa la cabecera de producto', !pGrupo.includes('FÁRMACO:'));
ok('grupo: la pregunta del clínico va antes que los apartados',
    pGrupo.indexOf('PREGUNTA DEL CLÍNICO') > -1 && pGrupo.indexOf('PREGUNTA DEL CLÍNICO') < pGrupo.indexOf('DESPUÉS DE LA PREGUNTA'));
ok('grupo: por defecto pide guías y contraste con la ficha española',
    pGrupo.includes('GUÍAS Y CONSENSO') && pGrupo.includes('GUÍA FRENTE A FICHA TÉCNICA ESPAÑOLA'));
ok('grupo: busca en documentos de consenso', /documentos de consenso/.test(pGrupo));
ok('grupo: en navegación ATC no inventa una «indicación»', !/- Indicación:/.test(pGrupo));
ok('grupo: la línea «Sobre» dice lo que viaja',
    app._consultScopeLabel(grupo) === 'G03CA Estrógenos naturales y semisintéticos — estriol, estradiol, promestrieno — vía vaginal',
    app._consultScopeLabel(grupo));

// --- 2. Sin filtrar la vía, el prompt no elige una: obliga a distinguir --------------------
const mixtos = [...vaginales, { nombre: 'X 2 mg COMPRIMIDOS', pactivos: 'ESTRADIOL', viasAdministracion: [{ nombre: 'VÍA ORAL' }] }];
const pMixto = app._composeConsultPrompt(app._consultScopeFromResults(dataAtc, mixtos, 'G03CA'), { selected: ['guias'] });
ok('vías mezcladas: pide distinguir por vía', pMixto.includes('Vías presentes: vaginal, oral (si la respuesta cambia con la vía, distingue por vía)'));

// --- 3. Desde una búsqueda por indicación sí se lleva la indicación -----------------------
const pInd = app._composeConsultPrompt(
    app._consultScopeFromResults({ matchedIndication: { label: 'Menopausia', atc: ['G03C', 'texto libre'] } }, vaginales, null),
    { selected: ['guias'] });
ok('indicación: se lleva la indicación buscada', pInd.includes('- Indicación: Menopausia'));
ok('indicación: descarta un «atc» que no es código', !pInd.includes('texto libre'));

// --- 4. Un grupo grande no se convierte en un listado ------------------------------------
const muchos = Array.from({ length: 12 }, (_, i) => ({ nombre: `M${i}`, pactivos: `PA${String(i).padStart(2, '0')}` }));
const pMuchos = app._composeConsultPrompt(app._consultScopeFromResults(dataAtc, muchos, 'G03CA'), { selected: ['guias'] });
ok('tope: 8 principios activos y el resto contado', /pa07 y 4 más/.test(pMuchos) && !pMuchos.includes('pa08'));

// --- 5. Sin pregunta ni apartados no hay prompt (el aviso lo da quien llama) ----------------
ok('vacío: sin pregunta ni apartados devuelve cadena vacía', app._composeConsultPrompt(grupo, { selected: [], doubt: '  ' }) === '');
ok('solo pregunta: basta con la pregunta', app._composeConsultPrompt(grupo, { selected: [], doubt: duda }).includes(duda));

// --- 6. Desde la ficha: los tres niveles -------------------------------------------------
const med = {
    nombre: 'OVESTINON 1 mg/g CREMA VAGINAL',
    vtm: { nombre: 'estriol' },
    viasAdministracion: [{ nombre: 'VÍA VAGINAL' }],
    // CIMA entrega los niveles desordenados y `atcs[0]` es el 3: el alcance no puede fiarse del orden.
    atcs: [
        { codigo: 'G03C', nombre: 'Estrógenos', nivel: 3 },
        { codigo: 'G03CA04', nombre: 'Estriol', nivel: 5 },
        { codigo: 'G03CA', nombre: 'Estrógenos naturales y semisintéticos', nivel: 4 },
    ],
};
const pProd = app._composeConsultPrompt(app._consultScopeFromMed(med, 'producto'), { selected: porDefecto('producto') });
ok('producto: cabecera de siempre con marca y ATC de nivel 5', pProd.includes('FÁRMACO: estriol (ATC G03CA04) — OVESTINON 1 mg/g CREMA VAGINAL'));
ok('producto: por defecto, monitorización (como antes)', pProd.includes('MONITORIZACIÓN') && !pProd.includes('GUÍAS Y CONSENSO'));

const pPa = app._composeConsultPrompt(app._consultScopeFromMed(med, 'pa'), { selected: porDefecto('pa') });
ok('principio activo: sin marca, con vía y ATC 5', !pPa.includes('OVESTINON') && pPa.includes('Principio activo: estriol') && pPa.includes('vaginal') && pPa.includes('G03CA04'));

const scGrupoFicha = app._consultScopeFromMed(med, 'grupo');
const pGrupoFicha = app._composeConsultPrompt(scGrupoFicha, { selected: porDefecto('grupo') });
ok('grupo desde la ficha: ATC de nivel 4, no el 3 de atcs[0]', scGrupoFicha?.atcs[0]?.codigo === 'G03CA', JSON.stringify(scGrupoFicha?.atcs));
ok('grupo desde la ficha: sin marca ni principio activo concreto, con vía',
    !pGrupoFicha.includes('OVESTINON') && !/Principio activo:/.test(pGrupoFicha) && pGrupoFicha.includes('- Vía: vaginal'));
ok('grupo desde la ficha: sin ATC 4 no hay alcance de grupo', app._consultScopeFromMed({ ...med, atcs: [{ codigo: 'G03CA04', nivel: 5 }] }, 'grupo') === null);

// --- 7. Longitud: lo que pasa con la URL de ChatGPT (umbral 4000 en `_openAiEngine`) --------
// El caso de uso típico —pregunta corta más los dos apartados por defecto— tiene que precargarse.
// Por encima del umbral ChatGPT se abre vacío y hay que pegar, que es justo el paso que se quería ahorrar.
const largo = encodeURIComponent(pGrupo).length;
ok(`longitud: el caso típico cabe en la URL de ChatGPT (${largo} de 4000 codificado)`, largo <= 4000);

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
