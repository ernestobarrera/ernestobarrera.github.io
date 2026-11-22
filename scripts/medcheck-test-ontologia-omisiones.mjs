#!/usr/bin/env node
/**
 * MedCheck — lo que se encontró que faltaba en la ontología no vuelve a faltar.
 *
 * POR QUÉ EXISTE. El 22/11/2026 «profilaxis de la migraña» salió sin amitriptilina ni los
 * anti-CGRP, aunque los dos la tienen en su 4.1. La causa era de método: la entrada se montó con
 * los candidatos conocidos, y la depuración de ruido solo miraba DENTRO de los códigos de cada
 * entrada, así que lo que faltaba fuera era invisible. Una búsqueda inversa (el 4.1 de hasta 3
 * fichas de cada sustancia del nomenclátor, cruzado con cada indicación) encontró omisiones reales
 * en unas 60 entradas. Antes, el 17/10, el cambio ATC de la OMS había sacado pregabalina y
 * gabapentina de cuatro entradas sin que ningún código quedara vacío.
 *
 * Este banco fija una muestra de esas omisiones: si una revisión futura del ATC o de la ontología
 * las vuelve a dejar fuera, falla. No sustituye a la búsqueda inversa (que hay que repetir cuando se
 * amplíe la ontología): solo impide que lo ya corregido se pierda en silencio.
 *
 * Uso: node scripts/medcheck-test-ontologia-omisiones.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const terms = JSON.parse(readFileSync(join(ROOT, 'assets/data/clinical-ontology.json'), 'utf8')).terms;

let fallos = 0;
const cubre = (entrada, atc5) => [].concat(terms[entrada]?.atc || []).some(p => atc5.startsWith(p));
const debe = (entrada, atc5, que) => {
    const ok = !!terms[entrada] && cubre(entrada, atc5);
    if (ok) console.log(`✓ «${entrada}» incluye ${que} (${atc5})`);
    else { fallos += 1; console.log(`✗ «${entrada}» NO incluye ${que} (${atc5}) — atc: ${[].concat(terms[entrada]?.atc || []).join(',')}`); }
};
const noDebe = (entrada, atc5, que) => {
    const ok = !!terms[entrada] && !cubre(entrada, atc5);
    if (ok) console.log(`✓ «${entrada}» no arrastra ${que} (${atc5})`);
    else { fallos += 1; console.log(`✗ «${entrada}» arrastra ${que} (${atc5})`); }
};

console.log('— Lo que faltaba (búsqueda inversa del 22/11/2026) —');
debe('profilaxis de la migraña', 'N06AA09', 'amitriptilina');
debe('profilaxis de la migraña', 'N02CD01', 'erenumab');
debe('profilaxis de la migraña', 'N02CD07', 'atogepant');
debe('dolor neuropático', 'N02BF02', 'pregabalina');
debe('dolor neuropático', 'N02BF01', 'gabapentina');
debe('epilepsia', 'N02BF02', 'pregabalina');
debe('epilepsia', 'N05BA09', 'clobazam');
debe('ansiedad', 'N02BF02', 'pregabalina');
debe('insomnio', 'R06AA09', 'doxilamina');
debe('tdah', 'C02AC02', 'guanfacina');
debe('benzodiacepinas', 'N05CD06', 'lormetazepam');
debe('enfermedad arterial periférica', 'B01AC04', 'clopidogrel');
debe('urticaria', 'R03DX05', 'omalizumab');
debe('hemofilia', 'B02BX06', 'emicizumab');
debe('vih', 'J05AX09', 'maraviroc');
debe('hipertensión pulmonar', 'B01AC21', 'treprostinil');
debe('mieloma múltiple', 'L01FC01', 'daratumumab');
debe('cáncer de pulmón', 'L01BA04', 'pemetrexed');
debe('cáncer de próstata', 'L01XK01', 'olaparib');
debe('faringitis', 'J01FA10', 'azitromicina');
debe('herpes', 'S01AD03', 'aciclovir oftálmico (queratitis herpética)');
debe('dispepsia', 'A03FA08', 'cinitaprida');
debe('verrugas', 'D06BB10', 'imiquimod');
// La encontró él (22/11): su ficha dice «condiloma acuminado», no «verruga». Fallo de VOCABULARIO,
// que la búsqueda inversa no ve; por eso la entrada lleva ahora los sinónimos de condiloma.
debe('verrugas', 'D06BB04', 'podofilotoxina');
{
    const sin = (terms['verrugas']?.synonyms || []).map(s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
    const ok = sin.includes('condiloma') && sin.includes('condiloma acuminado');
    if (ok) console.log('✓ «verrugas» reconoce «condiloma» y «condiloma acuminado»');
    else { fallos += 1; console.log('✗ «verrugas» no reconoce «condiloma»'); }
}

console.log('— Y el ruido quitado no vuelve —');
noDebe('hipertensión', 'C02KX01', 'bosentán (hipertensión pulmonar)');
noDebe('hipertensión', 'C02AC02', 'guanfacina (TDAH)');
noDebe('vih', 'J05AE30', 'nirmatrelvir/ritonavir (COVID-19)');
noDebe('osteoporosis', 'M05BX05', 'burosumab');
noDebe('otitis', 'J01DH02', 'meropenem');

console.log(fallos ? `\n${fallos} fallo(s).` : '\nTODO OK — lo corregido el 22/11 sigue corregido.');
process.exit(fallos ? 1 : 0);
