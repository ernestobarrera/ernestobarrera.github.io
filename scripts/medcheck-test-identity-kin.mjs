#!/usr/bin/env node
/**
 * MedCheck — contrato del parentesco de sustancia (`comparteRaiz`, medcheck-identity-kin.mjs)
 *
 * Esta regla no decide si una traducción es CORRECTA —eso lo dicen las dos autoridades— sino si
 * el candidato inglés es **la misma sustancia con otra grafía** o **otra palabra**. Es la red que
 * separa el salto bueno (el inglés recupera más porque el español no funcionaba en ese registro)
 * del ensanchamiento (el término nombra un conjunto mayor).
 *
 * Vive en tensión permanente entre dos fallos opuestos, y este proyecto ya cometió los dos:
 *   - Demasiado estricta: bloqueó 10 de 12 traducciones CORRECTAS (`testosterona -> testosterone`)
 *     porque su salto en ensayos parecía ensanchamiento. Era el arreglo, no el problema.
 *   - Demasiado laxa: dejaría pasar `retinol -> vitamin A`, que es una familia, no la molécula.
 *
 * Por eso el test tiene DOS mitades y las dos importan igual. Aflojar la regla sin fijar los
 * negativos es exactamente cómo se rompe la mitad que hoy funciona.
 *
 * Uso: node scripts/medcheck-test-identity-kin.mjs
 */
import { comparteRaiz, curarTermino } from './medcheck-identity-kin.mjs';

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── MITAD 1 · SÍ son parientes: la traducción correcta no puede quedar bloqueada ────────────
// Las nueve primeras ya funcionaban. Las demás estaban atascadas en `review` esperando un
// criterio clínico que no hacía falta: no había nada clínico que decidir, solo dos alfabetos
// escribiendo el mismo étimo. Medido sobre el baseline: 32 nombres, 666 productos.
const PARIENTES = [
    ['testosterona', 'testosterone'],          ['temozolomida', 'temozolomide'],
    ['ketamina', 'ketamine'],                  ['folitropina alfa', 'follitropin alfa'],
    ['esketamina', 'esketamine'],
    // th / t
    ['tiotepa', 'thiotepa'],                   ['tiopental sodio', 'thiopental'],
    ['clotiapina', 'clothiapine'],             ['metacolina', 'methacholine'],
    ['metilnaltrexona', 'methylnaltrexone'],   ['tirotrofina alfa', 'thyrotropin alfa'],
    // y / i
    ['oximetazolina', 'oxymetazoline'],        ['xilometazolina', 'xylometazoline'],
    ['cistina', 'cystine'],                    ['hipromelosa', 'hypromellose'],
    ['silibinina', 'silybin'],
    // hidro / hydro
    ['hidroxocobalamina', 'hydroxocobalamin'], ['hidroquinona', 'hydroquinone'],
    ['peróxido de hidrógeno', 'hydrogen peroxide'], ['dihidrocodeina', 'dihydrocodeine'],
    // ph / f, qu / k
    ['amfotericina B', 'amphotericin'],        ['uroquinasa', 'urokinase'],
    ['tocofersolán', 'tocophersolan'],         ['glicerofosfato sodio', 'sodium glycerophosphate'],
    // es- inicial
    ['espiramicina', 'spiramycin'],
    // -ido / -ide
    ['oxido nitrico', 'nitric oxide'],         ['oxido nitroso', 'nitrous oxide'],
    // sal o contraión que el español declara y el inglés no repite
    ['enoxaparina sodio', 'enoxaparin'],       ['dalteparina sodio', 'dalteparin'],
    ['clorazepato dipotasio', 'clorazepate'],  ['acetilcolina cloruro', 'acetylcholine'],
    ['tiosulfato de sodio', 'sodium thiosulfate'],
    ['pentosano polisulfato de sodio', 'pentosan polysulfate'],
    // otros
    ['piridostigmina', 'pyridostigmine'],      ['ácido hialurónico', 'hyaluronic acid'],
    ['alanilglutamina', 'alanylglutamine'],    ['glicerol', 'glycerin'],
    ['lantano carbonato', 'lanthanum carbonate'],
];
let malos = PARIENTES.filter(([es, en]) => !comparteRaiz(es, en));
check(`1 · ${PARIENTES.length} traducciones correctas se reconocen como parientes`,
    malos.length === 0, malos.map(p => p.join(' -> ')).join(' · '));

// ── MITAD 2 · NO son parientes: la red tiene que seguir sujetando ───────────────────────────
// Si aflojar la transliteración rompiera alguno de estos, la regla habría dejado de servir para
// lo único que existe: distinguir la molécula de la familia y del nombre de clase.
const NO_PARIENTES = [
    ['retinol', 'vitamin A'],                      // familia, no molécula
    ['eftrenonacog alfa', 'factor ix fc fusion protein'], // nombre de clase
    ['octocog alfa', 'antihemophilic factor, human recombinant'],
    ['barnidipino', 'mepirodipine'],               // FÁRMACO DISTINTO
    ['vacuna anti rotavirus', 'rotavirus'],        // el virus no es la vacuna
    ['vacuna anti hepatitis A', 'hepatitis a'],
    ['citicolina', 'cytidine diphosphate choline'],// descripción química, no el INN
    ['agua estéril para preparaciones inyectables', 'water'],
    ['proteína plasma humano', 'plasma'],
];
malos = NO_PARIENTES.filter(([es, en]) => comparteRaiz(es, en));
check(`2 · ${NO_PARIENTES.length} NO parientes siguen rechazados`,
    malos.length === 0, malos.map(p => p.join(' -> ')).join(' · '));

// ── 3 · MUTACIÓN: la canonicalización no puede ser un comodín ───────────────────────────────
// Dos INN sin relación no pueden acabar pareciéndose por el camino de las reglas de grafía.
const AJENOS = [
    ['paracetamol', 'ibuprofen'], ['metformina', 'insulina'], ['omeprazol', 'amoxicillin'],
    ['atorvastatina', 'simvastatin'], ['tiotepa', 'tiotropium'],
];
malos = AJENOS.filter(([es, en]) => comparteRaiz(es, en));
check('3 · sustancias ajenas NO se vuelven parientes por la canonicalización',
    malos.length === 0, malos.map(p => p.join(' -> ')).join(' · '));

// ── 4 · La curación del término no cambia con esto ──────────────────────────────────────────
// `comparteRaiz` ignora las sales para decidir PARENTESCO; `curarTermino` decide qué se
// INCORPORA y ahí la sal sí se conserva si el español la dice. Son dos preguntas distintas y
// tienen que seguir respondiéndose distinto.
check('4 · la sal se conserva al incorporar si el español la dice',
    curarTermino('ferroglicina sulfato', 'ferroglycine sulfate').includes('sulfate'),
    curarTermino('ferroglicina sulfato', 'ferroglycine sulfate'));
// 5 · EL CALIFICADOR PEGADO. El español no siempre separa la sal: `dimetilfumarato` es una
// sola palabra. La comprobación por token entero no la veía, se retiraba `fumarate` y se
// incorporaba `dimethyl` a secas, que no nombra ningún fármaco. Medido al incorporarlo el 20/08.
check('5 · el calificador PEGADO al nombre también cuenta como declarado',
    curarTermino('dimetilfumarato', 'dimethyl fumarate') === 'dimethyl fumarate',
    curarTermino('dimetilfumarato', 'dimethyl fumarate'));
check('5b · y separado por preposición igual',
    curarTermino('fumarato de diroximel', 'diroximel fumarate').includes('fumarate'),
    curarTermino('fumarato de diroximel', 'diroximel fumarate'));

// 6 · LÍMITE DECLARADO, NO DISIMULADO. El parentesco NO puede separar dos INN distintos que
// comparten prefijo: `acido gadoterico` (Dotarem) y `gadoteridol` (ProHance) son dos medios de
// contraste diferentes, y el sondeo aproximado de RxNav propuso el segundo para el primero.
// Ninguna regla ortográfica los distingue —`glicerol`/`glycerin` diverge igual y SÍ es correcto—,
// así que aquí solo se deja constancia de que el parentesco los acepta. Lo que los caza es la
// lista MÍRALOS del promotor, que compara recuperación, y un humano mirándola.
check('6 · el parentesco NO distingue dos INN de prefijo común (límite conocido)',
    comparteRaiz('acido gadoterico', 'gadoteridol'),
    'si esto empieza a fallar, la guarda se ha vuelto más fina y hay que revisar el comentario');

check('4b · y se retira si el español NO la dice',
    !curarTermino('rimegepant', 'rimegepant sulfate').includes('sulfate'),
    curarTermino('rimegepant', 'rimegepant sulfate'));

console.log('');
if (failures) {
    console.log(`${failures} fallo(s) — el parentesco de sustancia no se sostiene.`);
    process.exitCode = 1;
} else {
    console.log('Parentesco en verde: la transliteración deja pasar la traducción correcta,');
    console.log('la familia y el nombre de clase siguen fuera, y dos INN ajenos no se tocan.');
}
