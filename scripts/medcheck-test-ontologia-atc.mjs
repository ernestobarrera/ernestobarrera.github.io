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
 *   - lo aceptado con motivo no se avisa, y lo aceptado que ya no se da se avisa como caducado.
 *
 * Uso: node scripts/medcheck-test-ontologia-atc.mjs   ·   exit 0 si pasa todo; 1 con el detalle.
 */
import { contradicciones, norm } from './medcheck-audit-ontologia-atc.mjs';

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

if (failures) {
    console.log(`\n${failures} fallo(s)`);
    process.exit(1);
}
console.log('\nTodo en orden');
