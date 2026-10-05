#!/usr/bin/env node
/**
 * MedCheck — contrato del corte por tiempo y del paralelismo de `analyzeSafety`.
 *
 * POR QUÉ EXISTE. El 05/10/2026 se midió que CIMA se cuelga de forma intermitente: 5 de 40
 * búsquedas por principio activo sin respuesta en 25 s, y 3 de esas 5 CONTRA `cima.aemps.es`
 * directamente, sin pasar por el Worker. Hasta ese día `cima-api.js` no tenía ni un `signal`:
 * una petición colgada dejaba el spinner girando lo que quisiera el navegador, que son minutos.
 * En una pantalla de consulta eso es peor que un error, porque no se distingue «tarda» de
 * «se rompió».
 *
 * Y el mismo día se vio el amplificador: `analyzeSafety` pedía sus tres apartados clave en un
 * `for...await`, encadenando tres viajes de red para tres cosas que no dependen entre sí, con la
 * ficha en blanco hasta el último (`openMedDetails` los espera). 614 ms contra 73 ms, medido.
 *
 * Las dos son correcciones invisibles: si alguien las revierte, nada se pone rojo en pantalla
 * —solo se vuelve lento y mudo otra vez, que es justo lo que nadie reporta—. De ahí el banco.
 *
 * Uso: node scripts/medcheck-test-timeout.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/**
 * Sandbox con lo que `cima-api.js` toca, más `AbortSignal` real (Node 17.3+) para poder ejercitar
 * el corte de verdad en vez de simularlo. `fetch` lo inyecta cada escenario.
 */
function cargarAPI(fetchImpl, { conDomParser = false } = {}) {
    const sandbox = {
        window: {},
        document: { addEventListener() { }, getElementById: () => null },
        console: { log() { }, warn() { }, error() { } },
        localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
        fetch: fetchImpl,
        setTimeout, clearTimeout, setInterval, clearInterval,
        Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams, Error,
        AbortSignal, AbortController,
        navigator: { onLine: true },
        location: { search: '', href: '' },
        // Un muñeco: existir es todo lo que se le pide. Solo sirve para que `analyzeSafety` tome
        // la rama de navegador, que es la única con precalentado. Ver el escenario 5.
        ...(conDomParser ? { DOMParser: class { parseFromString() { throw new Error('muñeco'); } } } : {}),
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    const src = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
    vm.runInContext(`${src}\n;window.__CimaAPIClass = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
    const Clase = sandbox.window.__CimaAPIClass;
    return { api: new Clase(), Clase };
}

/** Una respuesta JSON mínima, con la forma que `_request` espera. */
const respuestaJson = (cuerpo) => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify(cuerpo),
});

// ---------------------------------------------------------------------------
// 1. El corte existe y se declara como tal
// ---------------------------------------------------------------------------
{
    // Un `fetch` que no contesta nunca, salvo que lo aborten: exactamente el CIMA colgado.
    const colgado = (url, opts) => new Promise((_, reject) => {
        const signal = opts?.signal;
        if (!signal) return; // sin señal no hay corte posible: el test de abajo lo caza
        signal.addEventListener('abort', () => reject(signal.reason));
    });

    const { api } = cargarAPI(colgado);
    // VIGILANTE CON PALABRAS. Si alguien quita el corte, la petición no vuelve nunca y el proceso
    // moriría con un «unsettled top-level await»: rojo, sí, pero ilegible. Esta carrera convierte
    // ese caso en una aserción que dice qué pasó. Y de paso mantiene vivo el bucle de eventos:
    // el temporizador de `AbortSignal.timeout` va sin `ref` y, si fuera lo único pendiente, Node
    // saldría antes de que saltara el corte.
    let vigilanteId;
    const vigilante = new Promise((resolve) => { vigilanteId = setTimeout(() => resolve('SIN_CORTE'), 3000); });
    const t0 = Date.now();
    let error = null, veredicto = null;
    try {
        veredicto = await Promise.race([
            api._request('/medicamentos?nombre=omeprazol', { timeoutMs: 150 }).then(() => 'RESPONDIO'),
            vigilante,
        ]);
    } catch (e) { error = e; }
    const transcurrido = Date.now() - t0;
    clearTimeout(vigilanteId);

    check('una petición colgada se corta, no espera indefinidamente', error !== null,
        veredicto === 'SIN_CORTE' ? 'la petición siguió esperando a los 3 s: NO hay corte por tiempo' : `devolvió ${veredicto}`);
    check('el corte respeta `timeoutMs`', transcurrido < 2000, `tardó ${transcurrido} ms`);
    check('el error se identifica como TIMEOUT', error?.code === 'TIMEOUT', `code=${error?.code}`);
    check('el error dice que la fuente es CIMA', /CIMA/.test(error?.message || ''), error?.message);
    check('el error lleva el endpoint que se quedó sin respuesta',
        String(error?.endpoint || '').includes('/medicamentos'), error?.endpoint);
    check('una petición colgada marca la API como no disponible', api.isOnline === false);
}

// ---------------------------------------------------------------------------
// 2. El timeout por defecto está puesto y es razonable
// ---------------------------------------------------------------------------
{
    const { Clase } = cargarAPI(() => Promise.reject(new Error('sin red')));
    const porDefecto = Clase.REQUEST_TIMEOUT_MS;
    check('hay un timeout por defecto declarado', typeof porDefecto === 'number' && porDefecto > 0, String(porDefecto));
    // El p95 medido contra CIMA es 1,9 s. Por debajo de 5 s se cortarían peticiones buenas en una
    // conexión mala; por encima de 30 s el corte deja de servir para lo que se puso.
    check('el timeout por defecto está entre 5 s y 30 s', porDefecto >= 5000 && porDefecto <= 30000, `${porDefecto} ms`);
}

// ---------------------------------------------------------------------------
// 3. Toda petición A CIMA sale con señal de corte
//
// El alcance es `_request`, que es por donde pasa TODO lo que va a CIMA: búsqueda, detalle y
// apartados de ficha. En `cima-api.js` quedan ocho `fetch` que no pasan por aquí —la ontología
// y el índice ATC (ficheros del propio sitio) y seis endpoints del Worker: farmacogenómica,
// utilización y las dos capas genéricas—. Esos NO llevan corte y este banco no finge que sí:
// leen de KV y no de CIMA, que es la fuente que se cuelga. Queda escrito para que quien lo mire
// sepa que es una decisión y no un olvido.
// ---------------------------------------------------------------------------
{
    let vistas = 0, conSignal = 0;
    const espia = (url, opts) => {
        // Solo lo que sale por `_request`: la ontología y el índice ATC se cargan solos y van
        // por su propio `fetch`.
        if (/\/(medicamentos|medicamento|docSegmentado)/.test(String(url))) {
            vistas += 1;
            if (opts?.signal) conSignal += 1;
        }
        return Promise.resolve(respuestaJson({ resultados: [] }));
    };
    const { api } = cargarAPI(espia);
    await api._request('/medicamentos?nombre=a');
    await api.getDocSeccion('82921', '4.4').catch(() => {});
    check('toda petición a CIMA lleva señal de corte', vistas > 0 && conSignal === vistas, `${conSignal}/${vistas}`);
}

// ---------------------------------------------------------------------------
// 4. `analyzeSafety` pide sus apartados clave A LA VEZ, no en cadena
// ---------------------------------------------------------------------------
{
    // Se cuenta la concurrencia SOLO de los apartados de ficha: la ontología y el índice ATC
    // también vuelan en ese momento y contarlos mediría otra cosa.
    let enVuelo = 0, maxSimultaneas = 0;
    const pedidas = [];
    const esSeccion = (url) => /docSegmentado.*seccion=/.test(String(url));
    const lento = (url) => {
        if (!esSeccion(url)) return Promise.resolve(respuestaJson({}));
        pedidas.push(String(url));
        enVuelo += 1;
        maxSimultaneas = Math.max(maxSimultaneas, enVuelo);
        return new Promise((resolve) => setTimeout(() => {
            enVuelo -= 1;
            // Un cuerpo largo para pasar el umbral de 50 caracteres que exige el core.
            resolve(respuestaJson([{ seccion: '4.4', titulo: 'T', contenido: 'x'.repeat(400), orden: 1 }]));
        }, 60));
    };

    const { api } = cargarAPI(lento);
    const t0 = Date.now();
    // Sin contextos activos: solo las tres secciones core, que es el caso de todos los días.
    const informe = await api.analyzeSafety('82921', {});
    const transcurrido = Date.now() - t0;

    const core = pedidas.filter(u => /seccion=4\.(4|6|7)/.test(u));
    check('se piden los tres apartados clave (4.4, 4.6, 4.7)', core.length === 3, `${core.length}: ${core.join(' ')}`);
    check('los tres salen a la vez, no encadenados', maxSimultaneas === 3, `máximo simultáneas: ${maxSimultaneas}`);
    // Tres de 60 ms en serie serían ~180 ms; a la vez, ~60 ms. El margen absorbe un runner lento.
    check('el reloj refleja el paralelismo', transcurrido < 150, `${transcurrido} ms`);

    // El contrato de salida NO cambia: mismo orden de checks que con el bucle en serie.
    const etiquetas = (informe.checks || []).filter(c => c.isCore).map(c => c.section);
    check('el orden de los apartados lo fija el código, no el orden de llegada',
        etiquetas.join(',') === '4.4,4.6,4.7', etiquetas.join(','));
}

// ---------------------------------------------------------------------------
// 5. Los contextos activos tampoco se encadenan
//
// El bucle que pinta los contextos sigue siendo secuencial a propósito (el orden de los checks
// es el de `patientContext`), así que lo que evita las esperas en cadena es el PRECALENTADO que
// lanza todos los apartados antes de entrar. Era el tramo más caro: 5,3 s medidos con los siete
// contextos encendidos en un momento de CIMA lento.
//
// Solo se activa en navegador, así que hace falta un `DOMParser` presente. El de aquí es un
// muñeco: basta con que exista para tomar esa rama. El análisis del texto fallará y el propio
// código lo degradará a 'unknown' —que es su contrato cuando no puede leer un apartado—; lo que
// se mide aquí es cuántas peticiones vuelan a la vez, no qué se extrae de ellas.
// ---------------------------------------------------------------------------
{
    let enVuelo = 0, maxSimultaneas = 0;
    const pedidas = new Set();
    const lento = (url) => {
        if (!/docSegmentado.*seccion=/.test(String(url))) return Promise.resolve(respuestaJson({}));
        pedidas.add(String(url).match(/seccion=([\d.]+)/)[1]);
        enVuelo += 1;
        maxSimultaneas = Math.max(maxSimultaneas, enVuelo);
        return new Promise((resolve) => setTimeout(() => {
            enVuelo -= 1;
            resolve(respuestaJson([{ seccion: '4.4', titulo: 'T', contenido: 'z'.repeat(400), orden: 1 }]));
        }, 60));
    };

    const { api } = cargarAPI(lento, { conDomParser: true });
    const todos = { pregnancy: true, lactation: true, elderly: true, hepatic: true, renal: true, dysphagia: true, driving: true };
    await api.analyzeSafety('82921', todos);

    // Siete contextos que comparten apartados: 4.6 (embarazo y lactancia), 4.2 y 4.4 (mayor,
    // hepática y renal), 3/4.2/6.6 (disfagia) y 4.7 (conducción) — más las tres core.
    check('los apartados repetidos se piden UNA vez', pedidas.size <= 6, `${pedidas.size}: ${[...pedidas].join(' ')}`);
    check('los contextos no esperan unos por otros', maxSimultaneas >= 4, `máximo simultáneas: ${maxSimultaneas}`);
}

// ---------------------------------------------------------------------------
// 6. Un apartado que CIMA no sirve no tumba a los demás
// ---------------------------------------------------------------------------
{
    const caprichoso = (url) => {
        if (/seccion=4\.6/.test(String(url))) return Promise.reject(new Error('CIMA 500'));
        return Promise.resolve(respuestaJson([{ seccion: '4.4', titulo: 'T', contenido: 'y'.repeat(400), orden: 1 }]));
    };
    const { api } = cargarAPI(caprichoso);
    const informe = await api.analyzeSafety('82921', {});
    const secciones = (informe.checks || []).filter(c => c.isCore).map(c => c.section);
    check('la sección que falla se omite y las otras se pintan',
        secciones.join(',') === '4.4,4.7', secciones.join(','));
}

console.log(`\n${failures === 0 ? 'OK' : `${failures} fallo(s)`}`);
process.exit(failures === 0 ? 0 : 1);
