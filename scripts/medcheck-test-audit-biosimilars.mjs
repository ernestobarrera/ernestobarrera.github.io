#!/usr/bin/env node
/**
 * MedCheck — pruebas del auditor de biosimilares.
 *
 * Ejercita las funciones PURAS de `medcheck-audit-biosimilars.mjs` contra fixtures
 * derivados de casos reales de CIMA. No toca la red: el auditor exporta esas funciones y
 * solo barre cuando se ejecuta directamente.
 *
 * Doctrina que fija este test:
 *   - la clasificación de familia NUNCA devuelve una relación confirmada;
 *   - los casos que el criterio automático NO puede resolver (denosumab, aflibercept,
 *     insulina glargina, epoetina dseta) tienen que salir marcados como tales, porque
 *     resolverlos mal es un riesgo clínico, no un fallo cosmético;
 *   - la autorización EMA derivada del `nregistro` va SIEMPRE marcada como heurística;
 *   - el hash de fuentes es estable al orden y sensible al contenido.
 *
 * Uso: node scripts/medcheck-test-audit-biosimilars.mjs
 */
import { emaAuthorisation, brandOf, classifyFamily, dcpSignal, sourceHash } from './medcheck-audit-biosimilars.mjs';

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

const med = (nregistro, nombre, o = {}) => ({ nregistro, nombre, biosimilar: false, ema: true, ...o });

console.log('\n— Autorización EMA (heurística de conciliación) —');
check('Hyrimoz 1181286012 → EU/1/18/1286/012',
    emaAuthorisation(med('1181286012', 'HYRIMOZ')).derived, 'EU/1/18/1286/012');
check('Humira 103256013 → EU/1/03/256/013',
    emaAuthorisation(med('103256013', 'HUMIRA')).derived, 'EU/1/03/256/013');
check('registros de la misma autorización comparten clave',
    emaAuthorisation(med('1181286012', 'HYRIMOZ')).authorisationKey
    === emaAuthorisation(med('1181286015', 'HYRIMOZ')).authorisationKey, true);
check('autorizaciones distintas NO comparten clave',
    emaAuthorisation(med('1181286012', 'HYRIMOZ')).authorisationKey
    === emaAuthorisation(med('1171216010', 'IMRALDI')).authorisationKey, false);
check('sufijo IP (importación paralela) no rompe la derivación',
    emaAuthorisation(med('1181286001IP', 'HYRIMOZ')).derived, 'EU/1/18/1286/001');
check('SIEMPRE va marcada como heurística',
    emaAuthorisation(med('1181286012', 'HYRIMOZ')).heuristic, true);
check('registro nacional (ema=false) → null',
    emaAuthorisation(med('61361', 'ALOPURINOL', { ema: false })), null);
check('nregistro que no encaja en el patrón → null',
    emaAuthorisation(med('ABC123', 'RARO')), null);

console.log('\n— Marca (heurística sobre el nombre) —');
check('corta en la dosis', brandOf('HYRIMOZ 40 MG SOLUCION INYECTABLE'), 'HYRIMOZ');
check('corta con unidad pegada al número', brandOf('Humira 40mg solucion inyectable'), 'HUMIRA');
check('marca compuesta se conserva entera', brandOf('GONAL-F 900 UI/1,5 ML'), 'GONAL-F');
check('nombre sin dosis se conserva', brandOf('NEUPOGEN'), 'NEUPOGEN');
check('nulo tolerado', brandOf(null), null);

console.log('\n— Clasificación de familia —');

// adalimumab: HUMIRA es la única marca no biosimilar → candidato.
check('una sola marca no-biosimilar → candidate',
    classifyFamily([
        med('103256013', 'HUMIRA 40 MG'),
        med('103256017', 'HUMIRA 80 MG'),
        med('1181286012', 'HYRIMOZ 40 MG', { biosimilar: true }),
        med('1171216010', 'IMRALDI 40 MG', { biosimilar: true }),
    ]),
    { status: 'candidate', reference_candidates: ['HUMIRA'],
      counts: { biosimilar_registros: 2, non_biosimilar_registros: 2 } });

// denosumab: Prolia (60 mg, osteoporosis) y Xgeva (120 mg, eventos óseos) son DOS
// referentes distintos con indicaciones distintas. Elegir uno automáticamente induciría
// a pensar que un biosimilar de Prolia sustituye a Xgeva.
check('varias marcas no-biosimilares → ambiguous (denosumab)',
    classifyFamily([
        med('1090618001', 'PROLIA 60 MG'),
        med('1110703001', 'XGEVA 120 MG'),
        med('1231700001', 'JUBBONTI 60 MG', { biosimilar: true }),
    ]).status, 'ambiguous');

// aflibercept: Eylea es intravítreo (oftalmología) y Zaltrap intravenoso (oncología).
// Es el caso más peligroso del catálogo: misma sustancia, vía e indicación distintas.
const afli = classifyFamily([
    med('1120797001', 'EYLEA 40 MG/ML'),
    med('1120814001', 'ZALTRAP 25 MG/ML'),
    med('1231800001', 'AFQLIR 40 MG/ML', { biosimilar: true }),
]);
check('aflibercept sale ambiguous, no resuelto', afli.status, 'ambiguous');
check('aflibercept expone ambos candidatos sin elegir',
    afli.reference_candidates, ['EYLEA', 'ZALTRAP']);

// epoetina dseta: todos sus productos son biosimilares; el referente (Eprex) vive en
// otro VTM (epoetina alfa). La familia CRUZA el VTM.
check('ningún no-biosimilar → none (epoetina dseta)',
    classifyFamily([
        med('1070419001', 'RETACRIT 1000 UI', { biosimilar: true }),
        med('1070420001', 'SILAPO 1000 UI', { biosimilar: true }),
    ]),
    { status: 'none', reference_candidates: [],
      counts: { biosimilar_registros: 2, non_biosimilar_registros: 0 } });

// insulina glargina: Lantus (100 U/ml) y Toujeo (300 U/ml) son del mismo titular, pero
// Toujeo NO es referente de los biosimilares. Automatizar aquí sería un error de dosis.
check('insulina glargina sale ambiguous',
    classifyFamily([
        med('1000102001', 'LANTUS 100 U/ML'),
        med('1140944001', 'TOUJEO 300 U/ML'),
        med('1140854001', 'ABASAGLAR 100 U/ML', { biosimilar: true }),
    ]).status, 'ambiguous');

check('NINGÚN estado es "confirmed"',
    ['candidate', 'ambiguous', 'none'].includes(afli.status), true);

console.log('\n— Señal por DCP: NO debe resolver el referente —');
// Fixtures tomados de la pasada real del 2026-08-03. Los dos son casos en los que el DCP
// produce una respuesta que PARECE resolver la familia y es FALSA. Si alguien convierte
// algún día esta señal en resolución automática, estos dos tests lo cazan.

// somatropina: Omnitrope comparte 6,7 mg/ml en cartucho con Norditropin Simplexx, pero su
// referente es Genotropin (Genotonorm en España).
const soma = dcpSignal([
    { marca: 'NORDITROPIN SIMPLEXX', biosimilar: false, presentaciones: [{ dcp_id: 1, dcp_nombre: 'Somatropina 6,7 mg/ml inyectable 1,5 ml cartuchos' }] },
    { marca: 'OMNITROPE', biosimilar: true, presentaciones: [{ dcp_id: 1, dcp_nombre: 'Somatropina 6,7 mg/ml inyectable 1,5 ml cartuchos' }] },
    { marca: 'GENOTONORM KABIPEN', biosimilar: false, presentaciones: [{ dcp_id: 2, dcp_nombre: 'Somatropina 5,3 mg inyectable' }] },
]);
check('somatropina: la señal empareja Omnitrope con Norditropin (emparejamiento FALSO)',
    soma.subfamilias.find((s) => s.biosimilar.includes('OMNITROPE')).no_biosimilar,
    ['NORDITROPIN SIMPLEXX']);
check('…y por eso la señal lleva warning explícito', typeof soma.warning === 'string' && soma.warning.length > 0, true);
check('…y NO expone ningún campo que parezca una resolución',
    Object.keys(soma).sort(), ['subfamilias', 'subfamilias_huerfanas', 'warning']);

// insulina asparta: Dazparda comparte 100 U/ml en cartucho de 3 ml con Fiasp, pero su
// referente es NovoRapid.
const asparta = dcpSignal([
    { marca: 'FIASP', biosimilar: false, presentaciones: [{ dcp_id: 10, dcp_nombre: 'Insulina asparta 100 U/ml inyectable 3 ml cartucho' }] },
    { marca: 'DAZPARDA', biosimilar: true, presentaciones: [{ dcp_id: 10, dcp_nombre: 'Insulina asparta 100 U/ml inyectable 3 ml cartucho' }] },
    { marca: 'NOVORAPID PENFILL', biosimilar: false, presentaciones: [{ dcp_id: 11, dcp_nombre: 'Insulina asparta 100 U/ml inyectable 3 ml pluma' }] },
]);
check('insulina asparta: la señal empareja Dazparda con Fiasp (emparejamiento FALSO)',
    asparta.subfamilias.find((s) => s.biosimilar.includes('DAZPARDA')).no_biosimilar, ['FIASP']);

// denosumab: aquí la señal SÍ separa bien (Prolia 60 mg / Xgeva 120 mg). Se fija para que
// una regresión no la rompa — pero sigue siendo señal, no resolución.
const deno = dcpSignal([
    { marca: 'PROLIA', biosimilar: false, presentaciones: [{ dcp_id: 20, dcp_nombre: 'Denosumab 60 mg' }] },
    { marca: 'JUBBONTI', biosimilar: true, presentaciones: [{ dcp_id: 20, dcp_nombre: 'Denosumab 60 mg' }] },
    { marca: 'XGEVA', biosimilar: false, presentaciones: [{ dcp_id: 21, dcp_nombre: 'Denosumab 120 mg' }] },
    { marca: 'WYOST', biosimilar: true, presentaciones: [{ dcp_id: 21, dcp_nombre: 'Denosumab 120 mg' }] },
]);
check('denosumab: la señal separa 60 mg de 120 mg', deno.subfamilias.length, 2);
check('…sin mezclar Prolia con los biosimilares de Xgeva',
    deno.subfamilias.find((s) => s.biosimilar.includes('WYOST')).no_biosimilar, ['XGEVA']);

// Subfamilia huérfana: biosimilares cuyo DCP no contiene ningún no-biosimilar (caso real
// de epoetina dseta, cuyo referente vive en otro VTM).
const huerfana = dcpSignal([
    { marca: 'RETACRIT', biosimilar: true, presentaciones: [{ dcp_id: 30, dcp_nombre: 'Epoetina dseta 1000 UI' }] },
]);
check('subfamilia sin no-biosimilar se marca huérfana', huerfana.subfamilias[0].huerfana, true);
check('y se cuenta', huerfana.subfamilias_huerfanas, 1);

console.log('\n— Hash de fuentes —');
const A = [
    { nregistro: '1', nombre: 'A', biosimilar: true, comerc: true, ema: true, vtm: { id: 9 } },
    { nregistro: '2', nombre: 'B', biosimilar: false, comerc: true, ema: true, vtm: { id: 9 } },
];
check('estable al orden de las filas', sourceHash(A) === sourceHash([...A].reverse()), true);
check('sensible a un cambio de contenido',
    sourceHash(A) === sourceHash([{ ...A[0], biosimilar: false }, A[1]]), false);
check('sensible a una fila de menos', sourceHash(A) === sourceHash([A[0]]), false);

console.log('\n— Autoverificación de los detectores —');
// Si `classifyFamily` volviera a "elegir el primero" ante varias marcas (que es lo que
// haría un criterio ingenuo), estos dos casos dejarían de ser ambiguos. Se comprueba que
// el test lo vería.
const ingenuo = (productos) => {
    const noBio = productos.filter((p) => p.biosimilar !== true);
    return noBio.length ? 'candidate' : 'none';
};
check('un clasificador ingenuo daría candidate en aflibercept → el test lo cazaría',
    ingenuo([med('1', 'EYLEA 40 MG/ML'), med('2', 'ZALTRAP 25 MG/ML'), med('3', 'AFQLIR', { biosimilar: true })]),
    'candidate');
check('y el real NO lo hace', afli.status, 'ambiguous');

console.log(`\n${failures === 0 ? 'TODO OK' : `${failures} FALLO(S)`}`);
process.exit(failures === 0 ? 0 : 1);
