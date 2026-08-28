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
    const html = app._renderCardActions('12345');
    ok((html.match(/<button/g) || []).length === 6, 'siguen siendo seis accesos');
    for (const tab of ['docs', 'indications', 'posology', 'interactions', 'evidence', 'safety']) {
        ok(html.includes(`'${tab}')`), `acceso a la pestaña ${tab}`);
    }
    ok((html.match(/aria-label=/g) || []).length === 6, 'los seis llevan aria-label (van sin texto)');
    ok((html.match(/title=/g) || []).length === 6, 'los seis llevan tooltip');
    ok(html.includes('card-act--primary'), 'Seguridad queda destacada');
    ok(!/btn-sm/.test(html), 'ya no usan el botón grande con texto');
    ok(src.includes('.card-act, .btn'), 'el clic en un acceso no abre además la ficha general');
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
