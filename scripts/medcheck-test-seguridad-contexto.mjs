#!/usr/bin/env node
/**
 * MedCheck — test del extracto contextual de `analyzeSafety`.
 *
 * Carga la clase REAL de assets/js/cima-api.js en Node (vm + shims mínimos) y ejercita
 * `analyzeSafety` sobre fichas sintéticas, con `getDocSeccion` stubeado. No hay red.
 *
 * Doctrina que fija este test:
 *
 *   - EL EXTRACTO ES DEL CONTEXTO. Hasta el 21/09/2026 se mostraban los primeros 400
 *     caracteres de la sección. Como embarazo y lactancia comparten la 4.6 y el embarazo
 *     va primero en casi todas las fichas, pulsar «Lactancia» enseñaba texto de embarazo.
 *     El caso `Penilevel` de abajo reproduce esa topología: la lactancia empieza pasados
 *     los primeros 400 caracteres.
 *   - LA AUSENCIA NO ES SEGURIDAD. Si no hay coincidencia literal, no se muestra el inicio
 *     arbitrario de la sección y NUNCA se dice «seguro», «sin riesgo» ni «sin hallazgo»:
 *     se manda a leer el apartado entero. Espejo, no juez, también cuando no encuentra nada.
 *   - CON CONTEXTO ACTIVO EL ESTADO NUNCA ES `safe` («Siempre Revisar, Nunca Asumir»).
 *
 * Uso: node scripts/medcheck-test-seguridad-contexto.mjs
 * Salida: exit 0 si pasa todo; exit 1 con el detalle de cada fallo.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null, createElement: () => ({ set innerHTML(v) { this.value = v; }, value: '' }) },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
vm.runInContext(`${src}\n;window.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });

const CimaAPI = sandbox.window.__CimaAPIClass;
if (typeof CimaAPI !== 'function') {
    console.error('No se pudo cargar la clase CimaAPI');
    process.exit(1);
}

let failures = 0;
function check(name, condicion, detalle = '') {
    if (condicion) { console.log(`  ok     ${name}`); return; }
    failures++;
    console.log(`  FALLO  ${name}${detalle ? `\n         ${detalle}` : ''}`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Topología real de una 4.6: embarazo primero y largo, lactancia después. El relleno
// empuja la mención de lactancia MÁS ALLÁ del carácter 400, que es exactamente donde
// el corte antiguo dejaba de mirar.
const relleno = 'No se dispone de datos clínicos suficientes sobre la exposición durante el primer trimestre. '.repeat(6);
const S46_PENILEVEL = `<p>Embarazo: los estudios en animales no han mostrado efectos teratógenos. ${relleno}</p>`
    + `<p>Lactancia: el principio activo se excreta en leche materna en pequeñas cantidades; valorar la interrupción.</p>`;

// Una 4.4 que no menciona nada renal: el caso en que la ausencia NO debe volverse seguridad.
const S44_SIN_RENAL = '<p>Advertencias: precaución en pacientes con antecedentes de reacciones alérgicas a betalactámicos.</p>';

function apiConSecciones(mapa) {
    const api = new CimaAPI();
    api.getDocSeccion = async (_nregistro, seccion) => mapa[seccion] ?? '';
    return api;
}

const contextCheck = (report, contexto) => report.checks.find(c => c.context === contexto);

console.log('\n— El extracto es del contexto, no del principio de la sección —');
{
    const api = apiConSecciones({ '4.4': S44_SIN_RENAL, '4.6': S46_PENILEVEL, '4.7': '' });
    const report = await api.analyzeSafety('TEST-1', { lactation: true });
    const lact = contextCheck(report, 'lactation');

    check('el contexto lactancia produce su propio check', !!lact);
    check('el extracto habla de lactancia, no de embarazo',
        /leche materna|lactancia/i.test(lact.excerpt || ''),
        `obtenido: ${JSON.stringify(lact.excerpt)}`);
    check('el extracto NO es el arranque de la sección (que es de embarazo)',
        !/^\s*\.*\s*Embarazo/i.test(lact.excerpt || ''),
        `obtenido: ${JSON.stringify(lact.excerpt)}`);
    check('la mención estaba pasado el carácter 400 — el corte antiguo no la veía',
        S46_PENILEVEL.replace(/<[^>]*>/g, ' ').indexOf('Lactancia') > 400);
}

console.log('\n— Embarazo y lactancia comparten la 4.6 y NO comparten el extracto —');
{
    const api = apiConSecciones({ '4.4': S44_SIN_RENAL, '4.6': S46_PENILEVEL, '4.7': '' });
    const report = await api.analyzeSafety('TEST-2', { pregnancy: true, lactation: true });
    const emb = contextCheck(report, 'pregnancy');
    const lact = contextCheck(report, 'lactation');

    check('los dos contextos producen check', !!emb && !!lact);
    check('sus extractos son distintos', emb.excerpt !== lact.excerpt,
        `ambos: ${JSON.stringify(emb.excerpt)}`);
    check('el de embarazo habla de embarazo', /embarazo|teratóg/i.test(emb.excerpt || ''));
}

console.log('\n— La ausencia de mención no se convierte en seguridad —');
{
    const api = apiConSecciones({ '4.4': S44_SIN_RENAL, '4.6': S46_PENILEVEL, '4.7': '' });
    const report = await api.analyzeSafety('TEST-3', { renal: true });
    const renal = contextCheck(report, 'renal');

    check('sin coincidencia NO se muestra el inicio arbitrario de la sección',
        renal.excerpt === null, `obtenido: ${JSON.stringify(renal.excerpt)}`);
    check('se dice que no se localizó mención literal',
        /no se localiz/i.test(renal.message), `obtenido: ${JSON.stringify(renal.message)}`);
    check('y se remite al apartado completo',
        /apartado completo/i.test(renal.message));
    check('el estado con contexto activo nunca es «safe»', renal.status !== 'safe');
    check('el mensaje no afirma seguridad ni ausencia de riesgo',
        !/\bseguro\b|sin riesgo|sin hallazgo/i.test(renal.message));
}

console.log('\n— La sección ausente conserva su degradación propia —');
{
    const api = apiConSecciones({ '4.4': '', '4.6': '', '4.7': '' });
    const report = await api.analyzeSafety('TEST-4', { renal: true });
    const renal = contextCheck(report, 'renal');

    check('sin sección se marca «unknown», no «safe»', renal.status === 'unknown');
    check('y se pide verificar la ficha técnica', /verificar ficha/i.test(renal.message));
}

if (failures) {
    console.log(`\n${failures} fallo(s)`);
    process.exit(1);
}
console.log('\nOK — todas las aserciones pasan');
