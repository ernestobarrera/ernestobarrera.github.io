#!/usr/bin/env node
/**
 * MedCheck — test de la identidad galénica de la tarjeta de resultado
 * (`_splitOfficialName`, `_doseIsInName`, `_doseFingerprint`, `_galenicFamily`)
 *
 * La tarjeta dejó de mostrar el nombre oficial entero: lo parte en cabeza clínica y cola
 * galénica, y en parte de los casos mueve la dosis del título al subtítulo. Cada una de esas
 * tres decisiones puede degradar un dato clínico si se relaja, así que aquí se fija el
 * contrato.
 *
 * Doctrina que fija este test:
 *   - la cabeza es SIEMPRE prefijo literal del nombre oficial: nunca se reescribe, solo se corta;
 *   - la cola es SIEMPRE texto literal del nombre, no `formaFarmaceutica.nombre`: hay 616
 *     productos que añaden detrás información clínica ("PARCHE TRANSDÉRMICO 96 HORAS");
 *   - la dosis solo baja al subtítulo si el chip dice EXACTAMENTE lo mismo, comparando
 *     cifra, unidad y denominador. Comparar solo cifras sustituía 500 microgramos por
 *     500 mg en DAXAS (contraste con Codex, 2026-08-28);
 *   - ante cualquier divergencia se falla EN ABIERTO: no se corta y no se mueve nada.
 *
 * Uso: node scripts/medcheck-test-tarjeta.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    // DOM mínimo: `_restoreFiltersFromURL` sincroniza las casillas del buscador, que aquí
    // no existen. Devolver null/vacío es suficiente y mantiene el test sin navegador.
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox);
const app = Object.create(sandbox.window.__MedCheckAppClass.prototype);

let fallos = 0;
const ok = (cond, nombre, detalle = '') => {
    if (cond) { console.log(`✓ ${nombre}`); return; }
    fallos += 1;
    console.log(`✗ ${nombre}${detalle ? `\n    ${detalle}` : ''}`);
};

const MedCheckAppDims = () => sandbox.window.__MedCheckAppClass.FILTER_DIMENSIONS;
const MedCheckAppActions = () => sandbox.window.__MedCheckAppClass.CARD_ACTIONS;

const med = (nombre, dosis, ff, ffs = 'COMPRIMIDO') => ({
    nombre, dosis,
    formaFarmaceutica: { nombre: ff },
    formaFarmaceuticaSimplificada: { nombre: ffs },
});

/** ¿Bajaría la dosis del título al subtítulo? Réplica exacta de la condición del render. */
function bajaLaDosis(m) {
    const s = app._splitOfficialName(m);
    const d = app._displayDose(m.dosis);
    return s.cortado && app._doseIsInName(m, s.dosisNombre) && !!d.text;
}

console.log('\n— El caso DAXAS: la interfaz no puede cambiar la unidad de una dosis —');
{
    // Real, nregistro 10636002. CIMA declara "500 mg" para un producto que se llama
    // "500 MICROGRAMOS"; la ficha técnica dice microgramos. La fuente trae una errata de
    // 1000× y la tarjeta NO debe propagarla sustituyendo el nombre.
    const daxas500 = med('DAXAS 500 MICROGRAMOS COMPRIMIDOS RECUBIERTOS CON PELICULA', '500 mg', 'COMPRIMIDO RECUBIERTO CON PELÍCULA');
    ok(!bajaLaDosis(daxas500), 'DAXAS 500: la dosis se queda en el título',
        `el chip dice "${app._displayDose(daxas500.dosis).text}" y el nombre "500 MICROGRAMOS"`);

    // El mismo producto con el campo correcto sí puede soltarla.
    const daxas250 = med('DAXAS 250 MICROGRAMOS COMPRIMIDOS', '250 µg', 'COMPRIMIDO');
    ok(bajaLaDosis(daxas250), 'DAXAS 250: con µg coherente, la dosis sí baja');

    // Sentido contrario: el nombre en mg y el campo en µg.
    const bactroban = med('BACTROBAN NASAL 20 mg/g POMADA NASAL', '20 µg/g', 'POMADA NASAL', 'PRODUCTO USO NASAL');
    ok(!bajaLaDosis(bactroban), 'BACTROBAN: divergencia mg/µg en sentido inverso, se queda');
}

console.log('\n— Concentraciones: no se pierde el denominador —');
{
    const amoxi = med('AMOXICILINA NORMON 250 MG/5 ML POLVO PARA SUSPENSIÓN ORAL EFG', '250 mg', 'POLVO PARA SUSPENSIÓN ORAL', 'SOLUCIÓN/SUSPENSIÓN ORAL');
    ok(!bajaLaDosis(amoxi), 'una concentración "250 mg/5 ml" no se degrada a "250 mg"');

    const adolonta = med('ADOLONTA 100 mg/ml SOLUCION ORAL', '100 mg/ml', 'SOLUCIÓN ORAL', 'SOLUCIÓN/SUSPENSIÓN ORAL');
    ok(bajaLaDosis(adolonta), 'si campo y nombre traen la misma concentración, sí baja');
}

console.log('\n— Denominador cualitativo: no es una magnitud —');
{
    const cipla = med(
        'BUDESONIDA/FORMOTEROL CIPLA 160 MICROGRAMOS/4,5 MICROGRAMOS/INHALACION POLVO PARA INHALACION (UNIDOSIS)',
        '160 MICROGRAMOS/4,5 MICROGRAMOS', 'POLVO PARA INHALACIÓN (UNIDOSIS)', 'INHALACIÓN PULMONAR');
    ok(bajaLaDosis(cipla), '"/INHALACION" en el nombre no impide bajar: no cambia la potencia');

    ok(app._doseFingerprint('100 mcg/dosis') === app._doseFingerprint('100 microgramos'),
        'la firma ignora el denominador cualitativo');
    ok(app._doseFingerprint('500 mg/2 ml') !== app._doseFingerprint('500 mg'),
        'la firma NO ignora un denominador de volumen');
    ok(app._doseFingerprint('500 microgramos') !== app._doseFingerprint('500 mg'),
        'la firma distingue microgramos de miligramos');
}

console.log('\n— Autoverificación: ¿caza el detector la regresión conocida? —');
{
    // La regla ANTERIOR comparaba solo cifras. Se reconstruye aquí para comprobar que el
    // caso DAXAS realmente pasaba, y que por tanto este test lo cazaría si volviese.
    const soloCifras = (m, dosisNombre) => {
        const cifras = (s) => (String(s || '').match(/\d+/g) || []);
        const campo = cifras(m.dosis);
        return campo.length > 0 && campo.every(c => cifras(dosisNombre).includes(c));
    };
    const daxas = med('DAXAS 500 MICROGRAMOS COMPRIMIDOS RECUBIERTOS CON PELICULA', '500 mg', 'COMPRIMIDO RECUBIERTO CON PELÍCULA');
    const s = app._splitOfficialName(daxas);
    ok(soloCifras(daxas, s.dosisNombre) === true,
        'la regla antigua (solo cifras) SÍ bajaba DAXAS → el test lo cazaría');
}

console.log('\n— La cola es literal, no la forma declarada —');
{
    const parche = med('DUROGESIC MATRIX 25 microgramos/h PARCHE TRANSDERMICO 96 HORAS', '25 µg/h', 'PARCHE TRANSDÉRMICO', 'PARCHE TRANSDERMICO');
    const s = parche && app._splitOfficialName(parche);
    ok(s.cortado && /96 HORAS/i.test(s.forma), 'se conserva "96 HORAS" tras la forma',
        `forma devuelta: "${s.forma}"`);

    const pluma = med('AMGEVITA 40 MG SOLUCION INYECTABLE EN PLUMA PRECARGADA', '40 mg', 'SOLUCIÓN INYECTABLE', 'INYECTABLE');
    const p = app._splitOfficialName(pluma);
    ok(p.cortado && /PLUMA PRECARGADA/i.test(p.forma), 'se conserva "EN PLUMA PRECARGADA"',
        `forma devuelta: "${p.forma}"`);
    ok(p.formaDeclarada === 'SOLUCIÓN INYECTABLE', 'la forma declarada sigue disponible para el tooltip');

    const efg = med('ACECLOFENACO STADA 100 MG COMPRIMIDOS RECUBIERTOS CON PELICULA EFG', '100 mg', 'COMPRIMIDO RECUBIERTO CON PELÍCULA');
    ok(!/EFG/i.test(app._splitOfficialName(efg).forma), 'el EFG se descuenta de la cola (ya viaja como insignia)');
}

console.log('\n— Fallo en abierto: cuando no se puede demostrar, no se toca —');
{
    const ambroxol = med('AMBROXOL NORMON 3 mg/ml SOLUCION ORAL EFG', '15 mg/5 ml', 'JARABE', 'SOLUCIÓN/SUSPENSIÓN ORAL');
    const s = app._splitOfficialName(ambroxol);
    ok(!s.cortado && s.cabeza === ambroxol.nombre,
        'si la forma declarada no aparece en el nombre, el nombre se muestra íntegro');

    const loitin = med('LOITIN CAPSULAS DURAS 100 mg', '100 mg', 'CÁPSULA DURA', 'CAPSULA');
    ok(!app._splitOfficialName(loitin).cortado,
        'si la cabeza se quedaría sin cifras que el nombre sí tenía, no se corta');

    const sinForma = { nombre: 'ALGO 10 mg COMPRIMIDOS', dosis: '10 mg' };
    ok(!app._splitOfficialName(sinForma).cortado, 'sin formaFarmaceutica no se corta');
}

console.log('\n— La cabeza nunca reescribe el nombre —');
{
    const casos = [
        med('SYMBICORT FORTE TURBUHALER 320 microgramos/9 microgramos/INHALACION POLVO PARA INHALACION', '320 µg budesonida/9 µg de formoterol/inhalación', 'POLVO PARA INHALACIÓN', 'INHALACIÓN PULMONAR'),
        med('BETADINE 100 MG/ML SOLUCIÓN CUTÁNEA', '100 mg/ml', 'SOLUCIÓN CUTÁNEA', 'LIQUIDO USO TOPICO'),
        med('AMLODIPINO/VALSARTAN/HIDROCLOROTIAZIDA STADA 10 MG/160 MG/12,5 MG COMPRIMIDOS RECUBIERTOS CON PELICULA EFG', '10 mg/160 mg/12,5 mg', 'COMPRIMIDO RECUBIERTO CON PELÍCULA'),
    ];
    const norm = (x) => x.replace(/\s+/g, ' ').trim().toUpperCase();
    let todas = true;
    for (const m of casos) {
        const s = app._splitOfficialName(m);
        if (!s.cortado) continue;
        if (!norm(m.nombre).startsWith(norm(s.cabeza))) todas = false;
        if (s.dosisNombre && norm(`${s.marca} ${s.dosisNombre}`) !== norm(s.cabeza)) todas = false;
    }
    ok(todas, 'la cabeza es prefijo literal del nombre y marca + dosis la reconstruyen');
}

console.log('\n— Familia galénica: vocabulario cerrado, desconocido explícito —');
{
    const fam = (ffs) => app._galenicFamily({ formaFarmaceuticaSimplificada: { nombre: ffs } });
    ok(fam('LIQUIDO USO TOPICO').icon === 'hand-holding-droplet', 'solución cutánea no es una jeringuilla');
    ok(fam('LIQUIDO RECTAL').icon === 'capsules', 'un enema no es una jeringuilla');
    ok(fam('LÍQUIDO OTICO').icon === 'ear-listen', 'las gotas óticas tienen icono propio');
    ok(fam('PULVERIZACION BUCAL').icon === 'tooth', 'un colutorio no es una jeringuilla');
    ok(fam('INHALACIÓN PULMONAR').icon === 'lungs', 'inhalado');
    ok(fam('INYECTABLE').icon === 'syringe', 'inyectable sí');
    ok(fam('UNA FORMA QUE NO EXISTE').id === 'otros', 'un valor nuevo cae en `otros`, no hereda icono');
    ok(fam(undefined).id === 'otros', 'sin forma simplificada, `otros`');
}

console.log('\n— Iconos de vía: el desconocido se abstiene —');
{
    ok(app.getRouteIcon('VÍA INHALATORIA') === '💨', 'VÍA INHALATORIA (329 productos) no es una pastilla');
    ok(app.getRouteIcon('VÍA ÓTICA') !== app.getRouteIcon('VÍA ORAL'), 'ótica y oral se distinguen');
    ok(app.getRouteIcon('VÍA SUBCUTÁNEA') === '💉', 'subcutánea es parenteral');
    ok(app.getRouteIcon('USO CUTÁNEO') === '🧴', 'cutánea no cae en parenteral por "subcutánea"');
    ok(app.getRouteIcon('OTRA VÍA') === '❔', 'lo desconocido no afirma una vía');
}

console.log('\n— Artículos intercalados en la forma —');
{
    // El nombre dice "EN UNA JERINGA" y la forma declarada "EN JERINGA". Exigir contigüidad
    // dejaba sin cortar los 11 BINOCRIT y los NOVORAPID: un grupo entero de resultados.
    const binocrit = med('BINOCRIT, 10.000 UI/1 ml, SOLUCION INYECTABLE EN UNA JERINGA PRECARGADA',
        '10000 UI', 'SOLUCIÓN INYECTABLE EN JERINGA PRECARGADA', 'INYECTABLE');
    const s = app._splitOfficialName(binocrit);
    ok(s.cortado, 'BINOCRIT: un artículo intercalado no impide el corte', `cabeza: "${s.cabeza}"`);
    ok(s.cabeza === 'BINOCRIT, 10.000 UI/1 ml', 'la cabeza queda limpia de la coma final');
    ok(/UNA JERINGA/i.test(s.forma), 'la cola conserva el literal con el artículo');

    // Pero una palabra CON contenido sí corta el intento.
    const falso = med('ALGO 10 mg SOLUCION INYECTABLE ESTERIL JERINGA PRECARGADA',
        '10 mg', 'SOLUCIÓN INYECTABLE EN JERINGA PRECARGADA', 'INYECTABLE');
    ok(!app._splitOfficialName(falso).cortado,
        'una palabra con contenido intercalada NO se salta');
}

console.log('\n— Filtro por familia galénica —');
{
    const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    ok(MedCheckAppDims().includes('galenic'), 'la familia galénica es una dimensión del contrato');

    const app2 = Object.create(sandbox.window.__MedCheckAppClass.prototype);
    app2.filterState = app2._emptyFilterState();
    app2.groupingState = { routeFilters: new Set(), activeIngredientFilters: new Set() };
    ok(app2._filterSnapshot().galenics instanceof Set, 'el snapshot expone `galenics`');
    ok(app2._activeFilterCount(app2._filterSnapshot()) === 0, 'sin filtros, el contador es 0');

    app2.filterState.galenics = new Set(['inhalado']);
    const snap = app2._filterSnapshot();
    ok(app2._activeFilterCount(snap) === 1, '«Limpiar N» cuenta también la familia galénica');

    const pred = app2._filterPredicate('galenic', snap);
    const inhalador = { formaFarmaceuticaSimplificada: { nombre: 'INHALACIÓN PULMONAR' } };
    const comprimido = { formaFarmaceuticaSimplificada: { nombre: 'COMPRIMIDO' } };
    ok(pred(inhalador) === true && pred(comprimido) === false, 'el predicado filtra por familia');

    ok(app2._facetURLParams(snap).galenic === 'inhalado', 'se serializa en la URL');
    app2._restoreFiltersFromURL({ galenic: 'inhalado|nasal' });
    ok(app2.filterState.galenics.size === 2, 'se restaura desde la URL');
    app2._clearAllResultFilters();
    ok(app2.filterState.galenics.size === 0, '«Limpiar» la vacía');

    ok(/data-galenic="\$\{familia\.id\}"/.test(src), 'el icono de la tarjeta lleva la familia');
    ok(src.includes('_wireGalenicIcons'), 'los iconos están cableados');
    ok(src.includes('renderGalenicFilterChips'), 'hay chip para retirar el filtro cuando está activo');
}

console.log('\n— Accesos de la tarjeta —');
{
    const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    // Con ficha seccionada: es el caso en que los seis accesos deben estar operativos.
    const conFicha = { nregistro: '12345', docs: [{ tipo: 1, secc: true }] };
    const html = app._renderCardActions('12345', conFicha);
    ok((html.match(/<button/g) || []).length === 6, 'siguen siendo seis accesos');
    for (const tab of ['docs', 'indications', 'posology', 'interactions', 'evidence', 'safety']) {
        ok(html.includes(`'${tab}')`), `acceso a la pestaña ${tab}`);
    }
    ok((html.match(/aria-label=/g) || []).length === 6, 'los seis llevan aria-label');
    for (const sig of ['FT', 'IND', 'POS', 'INT', 'EVI', 'SEG']) {
        ok(html.includes('>' + sig + '<'), 'lleva la sigla visible ' + sig);
    }
    ok(new Set(MedCheckAppActions().map(a => a[2])).size === 6, 'las seis siglas son distintas entre sí');
    ok((html.match(/title=/g) || []).length === 6, 'los seis llevan tooltip');
    ok(html.includes('card-act--primary'), 'Seguridad queda destacada');
    ok(!/btn-sm/.test(html), 'ya no usan el botón grande con texto');
    ok(src.includes('.card-act, .btn'), 'el clic en un acceso no abre además la ficha general');
}

console.log('\n— Accesos que dependen de la ficha técnica —');
{
    // OMNIC OCAS tiene ocho registros del mismo producto entre importaciones paralelas y el
    // nacional. Solo el nacional publica ficha técnica SECCIONADA; en el resto, pulsar
    // Posología abría un modal vacío y había que ir probando hasta dar con el que responde.
    const conFicha = {
        nregistro: '66678', nombre: 'OMNIC OCAS 0,4 mg COMPRIMIDOS DE LIBERACION PROLONGADA',
        docs: [{ tipo: 1, secc: true }, { tipo: 2, secc: true }],
    };
    const importacionParalela = {
        nregistro: '11429IP2', nombre: 'OMNIC OCAS 0,4 MG COMPRIMIDOS DE LIBERACION PROLONGADA',
        docs: [{ tipo: 2, secc: false }],
    };
    const fichaSinSecciones = { nregistro: 'X', nombre: 'X', docs: [{ tipo: 1, secc: false }] };
    const antiguoSinDocs = { nregistro: '54341', nombre: 'GOBEMICINA 1g INYECTABLE', docs: [] };

    ok(app._hasFichaTecnicaSeccionada(conFicha), 'el registro nacional tiene ficha seccionada');
    ok(!app._hasFichaTecnicaSeccionada(importacionParalela), 'la importación paralela, no');
    ok(!app._hasFichaTecnicaSeccionada(fichaSinSecciones),
        'una ficha SIN secciones tampoco vale: el modal pide secciones, no el PDF');
    ok(!app._hasFichaTecnicaSeccionada(antiguoSinDocs), 'un medicamento antiguo sin documentos, tampoco');
    ok(!app._hasFichaTecnicaSeccionada({}), 'sin `docs` no revienta');

    const inertes = (m) => (app._renderCardActions(m.nregistro, m).match(/card-act--inerte/g) || []).length;
    ok(inertes(conFicha) === 0, 'con ficha, los seis accesos quedan activos');
    ok(inertes(importacionParalela) === 4, 'sin ficha se apagan exactamente cuatro: IND, POS, INT y SEG');

    const html = app._renderCardActions(importacionParalela.nregistro, importacionParalela);
    ok(!/card-act--inerte[^>]*>\s*<i class="fas fa-file-medical"/.test(html) && html.includes('fa-file-medical'),
        'Documentos sigue activo: ofrece el prospecto aunque no haya ficha');
    ok((html.match(/disabled/g) || []).length === 4, 'los apagados van `disabled`, no solo atenuados');
    ok(!/onclick[^"]*'posology'/.test(html), 'un acceso apagado no conserva su onclick');
    ok(/no disponible/.test(html), 'el tooltip explica por qué está apagado');

    // La cuenta debe hacerse con el dato que YA viene en la lista, sin pedir el detalle.
    const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    ok(/_hasFichaTecnicaSeccionada\(med\)/.test(src), 'la tarjeta lo decide con el `med` de la lista');
    ok(src.includes('badge-sin-ft'), 'la tarjeta avisa antes de pulsar');
}

console.log('\n— Orden: el registro con ficha va delante de sus hermanos —');
{
    // Un mismo medicamento puede tener varios registros —el nacional y sus importaciones
    // paralelas— y solo algunos publican ficha con secciones. En vez de agruparlos, que
    // introduce un "medicamento" agregado que la fuente no define y rompe la
    // correspondencia tarjeta↔nregistro sobre la que se apoyan el índice de envases, el de
    // PGx y el de suministro, se ORDENA: el registro útil arriba. No se oculta nada.
    const app2 = Object.create(sandbox.window.__MedCheckAppClass.prototype);
    app2.groupingState = { sortBy: 'nameAsc' };
    const r = (nregistro, nombre, conFicha) => ({
        nregistro, nombre, docs: conFicha ? [{ tipo: 1, secc: true }] : [],
    });

    const lista = [
        r('11429IP', 'OMNIC OCAS 0,4 mg COMPRIMIDOS DE LIBERACION PROLONGADA', false),
        r('66678', 'OMNIC OCAS 0,4 mg COMPRIMIDOS DE LIBERACION PROLONGADA', true),
        r('11429IP2', 'OMNIC OCAS 0,4 MG COMPRIMIDOS DE LIBERACION PROLONGADA', false),
    ];
    app2._applySortState(lista);
    ok(lista[0].nregistro === '66678', 'el registro con ficha encabeza el bloque');
    ok(lista.length === 3, 'y los otros dos siguen ahí: ordenar no oculta');

    // La diferencia de caja no debe partir el bloque: "0,4 mg" y "0,4 MG" son el mismo
    // medicamento escrito por dos titulares.
    ok(lista.every(m => /OMNIC OCAS/.test(m.nombre)), 'el bloque queda contiguo pese a mayúsculas distintas');

    // Ni la puntuación: AVAMYS difiere solo en una coma; MICRALAX, en un espacio.
    const avamys = [
        r('07434003IP4', 'AVAMYS 27,5 MICROGRAMOS/PULVERIZACION SUSPENSION PARA PULVERIZACION NASAL', false),
        r('07434003', 'AVAMYS 27,5 MICROGRAMOS/PULVERIZACION, SUSPENSION PARA PULVERIZACION NASAL', true),
    ];
    app2._applySortState(avamys);
    ok(avamys[0].nregistro === '07434003', 'una coma de más tampoco parte el bloque');

    // El orden tiene que seguir siendo reproducible: una URL compartida debe dar lo mismo.
    const base = [r('C', 'X 10 mg COMPRIMIDOS', false), r('A', 'X 10 mg COMPRIMIDOS', true), r('B', 'Y 5 mg COMPRIMIDOS', false)];
    const uno = base.slice(); app2._applySortState(uno);
    const otro = base.slice().reverse(); app2._applySortState(otro);
    ok(uno.every((m, i) => m.nregistro === otro[i].nregistro), 'el orden es determinista, venga como venga la entrada');

    // Y no se ha reintroducido el plegado, que se retiró por crear un agregado inexistente.
    const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    ok(!src.includes('_clusterDuplicates'), 'no vuelve el plegado de duplicados');
    ok(!src.includes('dedupe-toggle'), 'ni su casilla');
}

console.log('\n— Registros duplicados sin ficha: fuera por defecto —');
{
    const app2 = Object.create(sandbox.window.__MedCheckAppClass.prototype);
    app2.filterState = app2._emptyFilterState();
    app2.groupingState = { routeFilters: new Set(), activeIngredientFilters: new Set() };

    const reg = (nregistro, nombre, conFicha, ff = 'COMPRIMIDO RECUBIERTO CON PELÍCULA', dosis = '12,5 mg') => ({
        nregistro, nombre, dosis,
        formaFarmaceutica: { nombre: ff },
        formaFarmaceuticaSimplificada: { nombre: 'COMPRIMIDO' },
        docs: conFicha ? [{ tipo: 1, secc: true }] : [],
    });

    // ALMOGRAN: un registro nacional con ficha y varias autorizaciones sin ella. Algunas
    // llevan sufijo IP y otras conservan el número del país de origen: por eso la regla no
    // mira el identificador, mira si hay un hermano que sí publique la ficha.
    const nacional = reg('62877', 'ALMOGRAN 12,5 mg COMPRIMIDOS RECUBIERTOS CON PELICULA', true);
    const conSufijo = reg('355614-6IP1', 'ALMOGRAN 12,5mg comprimidos recubiertos con pelicula', false);
    const sinSufijo = reg('3400935860705', 'ALMOGRAN 12,5 MG COMPRIMIDOS RECUBIERTOS CON PELICULA', false);
    const universo = [nacional, conSufijo, sinSufijo];
    const idx = app2._buildDuplicateIndex(universo);

    ok(!app2._isRedundantRecord(nacional, idx), 'el registro con ficha nunca se oculta');
    ok(app2._isRedundantRecord(conSufijo, idx), 'se oculta el duplicado con sufijo IP');
    ok(app2._isRedundantRecord(sinSufijo, idx),
        'y también el que conserva el número del país de origen, que el sufijo no cazaba');

    // GARANTÍA 1: nunca se oculta el único registro de un medicamento. Hay 39 marcas que
    // solo se comercializan como importación paralela (ALMOGRAN aparte).
    const soloParalela = [
        reg('BE117591IP', 'MICRODIOL comprimidos', false),
        reg('BE117591IP2', 'MICRODIOL comprimidos', false),
    ];
    const idx2 = app2._buildDuplicateIndex(soloParalela);
    ok(soloParalela.every(m => !app2._isRedundantRecord(m, idx2)),
        'sin ningún hermano con ficha, no se oculta ninguno');

    // GARANTÍA 2: no se confunde una filial con una importación paralela. La regla anterior
    // por `labtitular ≠ labcomercializador` barría 352 productos legítimos.
    const krka = reg('81664', 'IVABRADINA KRKA 5 MG COMPRIMIDOS RECUBIERTOS CON PELICULA', false, 'COMPRIMIDO RECUBIERTO CON PELÍCULA', '5 mg');
    krka.labtitular = 'Krka D.D. Novo Mesto';
    krka.labcomercializador = 'Krka Farmaceutica S.L.';
    ok(!app2._isRedundantRecord(krka, app2._buildDuplicateIndex([krka])),
        'un producto sin hermano con ficha se conserva aunque cambie el laboratorio');

    // Dispositivos distintos NO son hermanos: AMGEVITA en jeringa y en pluma.
    const jeringa = reg('1161164012', 'AMGEVITA 40 MG SOLUCION INYECTABLE EN JERINGA PRECARGADA', true, 'SOLUCIÓN INYECTABLE EN JERINGA PRECARGADA', '40 mg');
    const pluma = reg('1161164015', 'AMGEVITA 40 MG SOLUCION INYECTABLE EN PLUMA PRECARGADA', false, 'SOLUCIÓN INYECTABLE EN PLUMA PRECARGADA', '40 mg');
    ok(app2._duplicateProfile(jeringa) !== app2._duplicateProfile(pluma),
        'jeringa y pluma tienen perfiles distintos: no se ocultan entre sí');
    ok(!app2._isRedundantRecord(pluma, app2._buildDuplicateIndex([jeringa, pluma])),
        'y por tanto la pluma sobrevive aunque la jeringa tenga ficha');

    // Comportamiento del filtro: fuera por defecto, la casilla los devuelve.
    const visible = app2._applyResultFilters(universo, app2._filterSnapshot());
    ok(visible.length === 1 && visible[0] === nacional, 'por defecto solo queda el registro con ficha');
    app2.filterState.paralelas = true;
    ok(app2._applyResultFilters(universo, app2._filterSnapshot()).length === 3,
        'marcando la casilla vuelven los tres');

    ok(app2._activeFilterCount(app2._filterSnapshot()) === 1, 'marcada cuenta como filtro activo');
    ok(app2._facetURLParams().paralelas === '1', 'se serializa en la URL');
    app2._restoreFiltersFromURL({ paralelas: '1' });
    ok(app2.filterState.paralelas === true, 'se restaura desde la URL');
    app2._clearAllResultFilters();
    ok(app2.filterState.paralelas === false, '«Limpiar» la devuelve a su estado por defecto');
    app2.filterState.paralelas = true;
    app2._resetResultFilters();
    ok(app2.filterState.paralelas === true, 'una búsqueda nueva respeta la elección del usuario');

    const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    ok(!src.includes('_isParallelImport'),
        'no queda la detección por sufijo IP, que solo cubría 718 de 931');
    ok(src.includes('Incluir duplicados'), 'la etiqueta dice lo que hace la casilla');
    // El texto visible no puede afirmar lo que la regla no comprueba. No se ha verificado
    // en la documentación de la API que estos registros sean importaciones paralelas, y
    // decirlo en la interfaz sería atribuir una condición regulatoria a productos de
    // terceros sin respaldo documental.
    ok(!/casi siempre importaciones paralelas/.test(src),
        'el tooltip no atribuye una condición regulatoria sin verificar');
    ok(!/no añaden información clínica/.test(src),
        'ni emite un juicio sobre el producto de un laboratorio');
    ok(!/como en la web de CIMA|igual que hace la web de CIMA/.test(src),
        'no se afirma que CIMA los excluya por defecto: no lo hace');
}

console.log('\n— Filtro de forma del modal de alternativas —');
{
    const src = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
    ok(!src.includes('cardForm.includes(selectedForm)'),
        'el filtro no usa `includes` sobre un vocabulario cerrado');
    ok(src.includes('cardForm === selectedForm'), 'el filtro compara por igualdad');
    ok(/data-forma="\$\{this\._escapeHtml\(formaSimp\)\}"/.test(src),
        'la tarjeta de alternativa emite `data-forma` (sin él, el filtro vaciaba la lista)');
    ok(src.includes('data-generico="${med.generico === true}"'),
        'la tarjeta de alternativa emite `data-generico`');
    ok((src.match(/^\s{4}renderAlternativeCard\(/gm) || []).length === 1,
        'solo queda UN renderAlternativeCard (el duplicado se pisaba en silencio)');
    ok(!/^\s{4}renderMedCard\(/m.test(src), 'renderMedCard sigue retirado');
    ok(/RETIRADAS 2026-08-03/.test(src) && /precioMenor/.test(src),
        'la nota de trazabilidad de las insignias retiradas sobrevive');
}

console.log(fallos === 0 ? '\nOK — todas las aserciones pasan\n' : `\n${fallos} FALLO(S)\n`);
process.exit(fallos === 0 ? 0 : 1);
