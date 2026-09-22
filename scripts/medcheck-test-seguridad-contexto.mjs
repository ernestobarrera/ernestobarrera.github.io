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

console.log('\n— El TÍTULO de la sección no es el cuerpo de la sección —');
{
    // LA TOPOLOGÍA REAL, que los bloques de arriba no reproducían. `getDocSeccion` antepone el
    // título de la sección como <strong>, y el de la 4.6 es «Fertilidad, embarazo y lactancia»:
    // **contiene las palabras de los dos contextos que comparten el apartado**. Con la búsqueda
    // plana, «lactancia» casaba en ese rótulo —carácter ~5— y jamás llegaba al subapartado real,
    // así que el extracto de Lactancia volvía a ser el de Embarazo. Es el mismo defecto que
    // 2fcfea4 corrigió el 21/09 a medias, y que Ernesto vio en producción el 22/09 con ANTIDOL.
    const S46_CON_TITULO = '<strong>Fertilidad, embarazo y lactancia</strong><br>'
        + '<strong>Embarazo</strong><br>Una gran cantidad de datos en mujeres embarazadas indican la '
        + 'ausencia de toxicidad fetal o malformaciones congénitas. '
        + 'Se recomienda usar la dosis eficaz más baja durante el menor tiempo posible. '.repeat(4)
        + '<strong>Lactancia</strong><br>Aunque en la leche materna se han medido concentraciones '
        + 'máximas del principio activo, no se han descrito problemas en humanos.';

    const api = apiConSecciones({ '4.4': S44_SIN_RENAL, '4.6': S46_CON_TITULO, '4.7': '' });
    const report = await api.analyzeSafety('TEST-5', { pregnancy: true, lactation: true });
    const emb = contextCheck(report, 'pregnancy');
    const lact = contextCheck(report, 'lactation');

    check('el rótulo de la 4.6 nombra los dos contextos (es la trampa)',
        /embarazo/i.test(S46_CON_TITULO.slice(0, 60)) && /lactancia/i.test(S46_CON_TITULO.slice(0, 60)));
    check('lactancia NO se queda en el rótulo: el extracto habla de leche materna',
        /leche materna/i.test(lact.excerpt || ''), `obtenido: ${JSON.stringify(lact.excerpt)}`);
    check('y no arrastra el texto de embarazo',
        !/mujeres embarazadas/i.test(lact.excerpt || ''), `obtenido: ${JSON.stringify(lact.excerpt)}`);
    check('los dos extractos siguen siendo distintos', emb.excerpt !== lact.excerpt);

    // LA CONTRAPARTIDA, que es lo que impide "arreglarlo" descartando los títulos sin más: en la
    // 4.2 el título de la subsección ES la coincidencia buena, y muchas veces la única. Medido el
    // 22/09 sobre 13 fichas: `elderly` aparece en la 4.2 en 13/13 —y SOLO ahí en 6— casi siempre
    // como rótulo «Pacientes de edad avanzada» / «Uso en ancianos».
    const S44_SOLO_ROTULO = '<strong>Advertencias y precauciones especiales de empleo</strong><br>'
        + '<strong>Uso en ancianos</strong><br>Se recomienda vigilancia clínica periódica.';
    const api2 = apiConSecciones({ '4.4': S44_SOLO_ROTULO, '4.6': '', '4.7': '' });
    const report2 = await api2.analyzeSafety('TEST-6', { elderly: true });
    const mayor = contextCheck(report2, 'elderly');

    check('una coincidencia que solo está en un rótulo SÍ se reporta (no se descarta)',
        !!mayor.excerpt && /ancianos/i.test(mayor.excerpt),
        `obtenido: ${JSON.stringify(mayor.excerpt)}`);
    check('y sigue sin decirse «safe»', mayor.status !== 'safe');
}

console.log('\n— Los acentos de CIMA llegan como entidades, y aun así tienen que casar —');
{
    // CIMA manda TODOS los acentos como entidades numéricas: «disfunci&#243;n hep&#225;tica y
    // renal grave». Buscando sobre el texto crudo no podía casar NINGUNA keyword con tilde: 32 de
    // las 125 declaradas en `contextMapping` (insuficiencia hepática, función renal, conducción,
    // pacientes geriátricos…). Y las variantes sin tilde que alguien añadió para compensar tampoco,
    // porque la tilde SÍ está en la fuente, solo que codificada. Medido el 22/09/2026 sobre la 4.4
    // de ANTIDOL 1 G; en 6 fichas reales cambiaron 28 de 36 extractos.
    const S44_ENTIDADES = '<strong>Advertencias y precauciones especiales de empleo</strong><br>'
        + '<p>Paracetamol se debe administrar con precauci&#243;n, evitando tratamientos '
        + 'prolongados en pacientes con disfunci&#243;n hep&#225;tica y renal grave.</p>';

    const api = apiConSecciones({ '4.4': S44_ENTIDADES, '4.6': '', '4.7': '' });
    const report = await api.analyzeSafety('TEST-7', { hepatic: true });
    const hep = contextCheck(report, 'hepatic');

    check('una keyword con tilde casa contra una entidad numérica de CIMA',
        !!hep.excerpt, `obtenido: ${JSON.stringify(hep.message)}`);
    check('y el extracto se muestra ya decodificado, no con «hep&#225;tica»',
        /hep[áa]tica/i.test(hep.excerpt || '') && !/&#\d+;/.test(hep.excerpt || ''),
        `obtenido: ${JSON.stringify(hep.excerpt)}`);

    // Y por el otro lado: la lista mezcla «insuficiencia hepática» con «insuficiencia hepatica»
    // porque nadie sabía de qué lado estaba el fallo. Plegar acentos hace irrelevante cómo se
    // escriba cada una, así que da igual si la keyword lleva tilde y el texto no, o al revés.
    const S44_SIN_TILDE = '<p>Se recomienda precaucion en pacientes con insuficiencia hepatica.</p>';
    const api2 = apiConSecciones({ '4.4': S44_SIN_TILDE, '4.6': '', '4.7': '' });
    const hep2 = contextCheck(await api2.analyzeSafety('TEST-8', { hepatic: true }), 'hepatic');
    check('la comparación pliega acentos por los DOS lados', !!hep2.excerpt,
        `obtenido: ${JSON.stringify(hep2.message)}`);

    // LÍNEA ROJA: el extracto se inserta como HTML en el modal, así que decodificar NUNCA puede
    // devolver caracteres de marcado. `&lt;script&gt;` se queda como está.
    const S44_MARCADO = '<p>Aclaramiento de creatinina &lt;script&gt;alert(1)&lt;/script&gt; menor de 30 ml/min.</p>';
    const api3 = apiConSecciones({ '4.4': S44_MARCADO, '4.6': '', '4.7': '' });
    const ren3 = contextCheck(await api3.analyzeSafety('TEST-9', { renal: true }), 'renal');
    check('decodificar NO puede convertir texto de la ficha en marcado',
        !/<script/i.test(ren3.excerpt || ''), `obtenido: ${JSON.stringify(ren3.excerpt)}`);
}

if (failures) {
    console.log(`\n${failures} fallo(s)`);
    process.exit(1);
}
console.log('\nOK — todas las aserciones pasan');
