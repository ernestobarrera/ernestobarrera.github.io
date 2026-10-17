#!/usr/bin/env node
/**
 * MedCheck — test del guardián de la ontología frente a los cambios del ATC.
 *
 * Ejercita el núcleo puro de scripts/medcheck-audit-ontologia-atc.mjs sin red. El fixture
 * reproduce los casos MEDIDOS el 17/10/2026: ACOD sin dabigatrán (clase que el ATC reparte) y
 * esclerosis múltiple sin natalizumab (reorganización de L04A por la OMS).
 *
 * Doctrina que fija:
 *   - un sinónimo que es fármaco y cuyo ATC queda fuera de su entrada se avisa;
 *   - si alguno de sus ATC cae dentro, no (una sustancia puede tener varios);
 *   - un sinónimo que no es sustancia (sigla, síntoma) no se evalúa;
 *   - lo aceptado con motivo no se avisa, y lo aceptado que ya no se da se avisa como caducado;
 *   - una excepción sin motivo no silencia nada;
 *   - un vigilado (`watchSubstances`) casa por nombre exacto y, si falta del censo, se avisa;
 *   - un censo que no se puede afirmar completo es INCONCLUSO, nunca un universo más pequeño.
 *
 * Uso: node scripts/medcheck-test-ontologia-atc.mjs   ·   exit 0 si pasa todo; 1 con el detalle.
 */
import { contradicciones, norm, excepcionValida, censoComercializados, Inconcluso } from './medcheck-audit-ontologia-atc.mjs';

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

const sustancias = new Map([
    ['dabigatran', new Set(['B01AE07'])],
    ['apixaban', new Set(['B01AF02'])],
    ['natalizumab', new Set(['L04AG03'])],
    ['micofenolato mofetilo', new Set(['L04AA06'])],
    ['budesonida', new Set(['R03BA02', 'A07EA06'])],
    ['doxilamina', new Set(['R06AA09'])],
]);
const terms = {
    acod: { atc: 'B01AF', synonyms: ['naco', 'apixaban', 'dabigatran'] },
    'esclerosis múltiple': { atc: ['L03AX', 'L04AA'], synonyms: ['em', 'natalizumab'] },
    trasplante: { atc: ['L04AA'], synonyms: ['micofenolato'] },
    asma: { atc: ['R03'], synonyms: ['budesonida'] },
    'náuseas del embarazo': { atc: ['R06AA59'], synonyms: ['doxilamina'] },
};
const excepciones = [
    { entrada: 'náuseas del embarazo', sinonimo: 'doxilamina', motivo: 'asociación a propósito' },
    { entrada: 'lupus', sinonimo: 'belimumab', motivo: 'ya corregida' },
];
const r = contradicciones(terms, sustancias, excepciones);

check('ACOD sin dabigatrán: se avisa', r.nuevas.some(x => x.entrada === 'acod' && x.sinonimo === 'dabigatran'), true);
check('reorganización de L04A: natalizumab fuera de esclerosis múltiple', r.nuevas.some(x => x.sinonimo === 'natalizumab' && x.atcSustancia[0] === 'L04AG03'), true);
check('lo que sí cae dentro no se avisa (apixabán)', r.nuevas.some(x => x.sinonimo === 'apixaban'), false);
check('un sinónimo que no es sustancia no se evalúa (naco, em)', r.nuevas.some(x => ['naco', 'em'].includes(x.sinonimo)), false);
check('primera palabra: «micofenolato» es micofenolato mofetilo, y está dentro', r.nuevas.some(x => x.sinonimo === 'micofenolato'), false);
check('basta con que UNO de sus ATC caiga dentro (budesonida inhalada)', r.nuevas.some(x => x.sinonimo === 'budesonida'), false);
check('lo aceptado con motivo no se avisa', [r.nuevas.some(x => x.sinonimo === 'doxilamina'), r.aceptadas.length], [false, 1]);
check('lo aceptado que ya no se da, caducado', r.caducadas.map(x => x.sinonimo), ['belimumab']);
check('normalización: tildes y mayúsculas', norm('  Dabigatrán  ETEXILATO '), 'dabigatran etexilato');

// ─── Excepciones: sin motivo no silencian (revisión de Codex, P2, 17/10) ─────
{
    const sinMotivo = [{ entrada: 'acod', sinonimo: 'dabigatran' }];
    const x = contradicciones(terms, sustancias, sinMotivo);
    check('excepción sin motivo: la contradicción sigue siendo NUEVA', x.nuevas.some(n => n.sinonimo === 'dabigatran'), true);
    check('excepción sin motivo: se informa como inválida', x.invalidas.length, 1);
    check('motivo en blanco tampoco vale', excepcionValida({ entrada: 'a', sinonimo: 'b', motivo: '  ' }), false);
}

// ─── watchSubstances: identidad explícita, no interviene en el matching ──────
{
    const conVigilados = {
        acod: { atc: ['B01AF', 'B01AE07'], synonyms: ['naco'], watchSubstances: ['apixabán', 'dabigatrán', 'edoxabán'] },
        trasplante: { atc: ['L04AD'], synonyms: [], watchSubstances: ['sirolimus'] },
        lupus: { atc: ['L04AA06'], synonyms: ['micofenolato'], watchSubstances: ['micofenolato mofetilo'] },
    };
    const censo = new Map([...sustancias, ['sirolimus', new Set(['L04AH01'])]]);
    const x = contradicciones(conVigilados, censo, []);
    check('vigilado que ya no está en el censo: AUSENTE (edoxabán)', x.ausentes.map(a => a.sustancia), ['edoxabán']);
    check('vigilado fuera de los códigos de su entrada: NUEVA (sirolimus en L04AH)', x.nuevas.map(n => [n.sinonimo, n.origen]), [['sirolimus', 'vigilada']]);
    check('vigilado dentro: sin aviso (dabigatrán en B01AE07)', x.nuevas.some(n => n.sinonimo === 'dabigatrán'), false);
    // Codex, P3 (17/10): el sinónimo «x» casa también con «x sal» (primera palabra), que está dentro;
    // el VTM exacto «x» está fuera y, como vigilado, tiene que avisarse igualmente.
    const p3 = contradicciones({ t: { atc: ['A'], synonyms: ['x'], watchSubstances: ['x'] } },
        new Map([['x', new Set(['B'])], ['x sal', new Set(['A'])]]), []);
    check('un sinónimo heurístico no tapa al vigilado exacto', p3.nuevas.map(n => [n.sinonimo, n.origen]), [['x', 'vigilada']]);
    const dup = contradicciones({ t: { atc: ['A'], synonyms: ['x'], watchSubstances: ['x'] } }, new Map([['x', new Set(['B'])]]), []);
    check('si el sinónimo ya lo avisó, el vigilado no lo repite', dup.nuevas.length, 1);
    check('el vigilado casa por nombre EXACTO, no por primera palabra', contradicciones({ t: { atc: ['X'], watchSubstances: ['micofenolato'] } }, censo, []).ausentes.length, 1);
}

// ─── Censo: no poder afirmar el universo entero es INCONCLUSO (Codex, P1, 17/10) ─
const pagina = (resultados, totalFilas) => ({ resultados, ...(totalFilas === undefined ? {} : { totalFilas }) });
const med = (nregistro, vtm) => ({ nregistro, vtm: { nombre: vtm } });
const idx = { 1: 'B01AE07', 2: 'R06AA09', 3: 'B01AF02' };
const servir = paginas => async p => paginas[p - 1] || pagina([], paginas[0]?.totalFilas);
async function lanza(fn) {
    try { await fn(); return 'sin error'; } catch (e) { return e instanceof Inconcluso ? 'INCONCLUSO' : `otro error: ${e.message}`; }
}
check('sin totalFilas: INCONCLUSO (antes devolvía 0 con dos sustancias)',
    await lanza(() => censoComercializados(servir([pagina([med(1, 'dabigatrán'), med(2, 'doxilamina')])]), idx)), 'INCONCLUSO');
check('página repetida: INCONCLUSO',
    await lanza(() => censoComercializados(servir([pagina([med(1, 'dabigatrán')], 3), pagina([med(1, 'dabigatrán')], 3)]), idx)), 'INCONCLUSO');
check('total que cambia a mitad del recorrido: INCONCLUSO',
    await lanza(() => censoComercializados(servir([pagina([med(1, 'dabigatrán')], 2), pagina([med(2, 'doxilamina')], 3)]), idx)), 'INCONCLUSO');
check('páginas que se acaban antes del total: INCONCLUSO',
    await lanza(() => censoComercializados(servir([pagina([med(1, 'dabigatrán')], 2)]), idx)), 'INCONCLUSO');
check('comercializado sin ATC en el índice: INCONCLUSO',
    await lanza(() => censoComercializados(servir([pagina([med(1, 'dabigatrán'), med(9, 'nuevo')], 2)]), idx)), 'INCONCLUSO');
check('total 0: INCONCLUSO', await lanza(() => censoComercializados(servir([pagina([], 0)]), idx)), 'INCONCLUSO');
{
    const m = await censoComercializados(servir([pagina([med(1, 'dabigatrán'), med(2, 'doxilamina')], 3), pagina([med(3, 'apixabán')], 3)]), idx);
    check('censo completo en dos páginas', [...m.keys()].sort(), ['apixaban', 'dabigatran', 'doxilamina']);
}

if (failures) {
    console.log(`\n${failures} fallo(s)`);
    process.exit(1);
}
console.log('\nTodo en orden');
