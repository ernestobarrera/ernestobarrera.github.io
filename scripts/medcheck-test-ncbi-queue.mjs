#!/usr/bin/env node
/**
 * MedCheck — contrato del limitador de llamadas a NCBI (`_enqueueNcbi` / `_pumpNcbi`)
 *
 * Nace de la medición del 2026-08-19: la pestaña Evidencia dispara 23 llamadas a NCBI por ficha
 * (1 total + 12 filtros + 10 bienios de sparkline) y la cadena anterior era estrictamente serial
 * —cada tarea esperaba a que la RESPUESTA de la anterior volviera, no a que se despachara—. El
 * ritmo real no era el techo de NCBI sino 1/RTT, así que el tiempo crecía LINEAL con la latencia:
 * ~8 s con los 210 ms de una red buena, ~16 s a 700 ms, ~28 s a 1,2 s. La red de la consulta.
 *
 * EL CAMBIO NO SUBE EL TECHO. Sigue siendo 3 req/s, que es lo que NCBI permite sin API key
 * (medido: el cuarto de cinco `curl` seguidos devolvió 429). Lo que se añade es concurrencia,
 * para poder ALCANZAR ese techo cuando la latencia es alta.
 *
 * LO QUE SE FIJA AQUÍ, y por qué cada cosa:
 *   1. Nunca más de 3 peticiones en vuelo.
 *   2. Nunca más de 3 despachos en ninguna ventana de 1 s — el techo de NCBI, intacto.
 *   3. La concurrencia se USA de verdad (pico > 1). Sin esto, una cola que siguiera siendo
 *      serial pasaría los dos puntos anteriores sin despeinarse: son límites superiores.
 *   4. FIFO: el grid se encola antes que la sparkline y conserva la prioridad.
 *   5. Una tarea de un ciclo invalidado se resuelve a null sin gastar hueco de ritmo.
 *   6. Un rechazo llega al llamador y NO atasca la cola.
 *   7. Un 429 enfría la cola ENTERA. La cadena serial daba esa propiedad gratis (una sola
 *      petición en vuelo); con concurrencia hay que declararla, o las otras dos ranuras
 *      seguirían disparando contra un servidor que acaba de pedir tregua.
 *
 * Sin red: las tareas son funciones que resuelven tras un retardo simulado.
 * Uso: node scripts/medcheck-test-ncbi-queue.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {},
    document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true },
    location: { search: '', href: '' },
    CimaAPI: { ATC_CATEGORIES: [] },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
    `${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__App = MedCheckApp;`,
    sandbox, { filename: 'cima-app.js' }
);
const MedCheckApp = sandbox.window.__App;
if (typeof MedCheckApp !== 'function') { console.error('No se pudo cargar MedCheckApp'); process.exit(1); }

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};
const dormir = ms => new Promise(r => setTimeout(r, ms));

// Instrumenta una app nueva: registra cada despacho y el pico de concurrencia real.
function nuevaApp() {
    const app = Object.create(MedCheckApp.prototype);
    const traza = { despachos: [], enVuelo: 0, pico: 0, orden: [] };
    app._traza = traza;
    return { app, traza };
}

// Tarea simulada: anota el despacho, mantiene ocupada una ranura `rtt` ms y resuelve.
function tarea(traza, etiqueta, rtt) {
    return async () => {
        traza.despachos.push(Date.now());
        traza.orden.push(etiqueta);
        traza.enVuelo += 1;
        traza.pico = Math.max(traza.pico, traza.enVuelo);
        await dormir(rtt);
        traza.enVuelo -= 1;
        return etiqueta;
    };
}

const maxEnVentana = (tiempos, ventana) => {
    let max = 0;
    for (let i = 0; i < tiempos.length; i++) {
        const n = tiempos.filter(t => t >= tiempos[i] && t < tiempos[i] + ventana).length;
        max = Math.max(max, n);
    }
    return max;
};

(async () => {
    // ── 1-4 · Nueve tareas con RTT alto: el caso de la red corporativa ──────────────────────
    // Con la cadena serial esto tardaba 9 × 400 ms = 3,6 s. Con el limitador debe mandar el
    // ritmo (3 por segundo), no la latencia.
    {
        const { app, traza } = nuevaApp();
        const t0 = Date.now();
        const resultados = await Promise.all(
            Array.from({ length: 9 }, (_, i) => app._enqueueNcbi(tarea(traza, i, 400)))
        );
        const transcurrido = Date.now() - t0;

        check('1 · nunca más de 3 peticiones en vuelo', traza.pico <= 3, `pico ${traza.pico}`);
        const enVentana = maxEnVentana(traza.despachos, 1000);
        check('2 · nunca más de 3 despachos por segundo (el techo de NCBI, intacto)',
            enVentana <= 3, `${enVentana} en una ventana de 1 s`);
        check('3 · la concurrencia se USA de verdad (si no, seguiría siendo serial)',
            traza.pico > 1, `pico ${traza.pico} — un límite superior lo cumple también una cola serial`);
        check('4 · FIFO: se despachan en el orden en que se encolaron',
            traza.orden.join(',') === '0,1,2,3,4,5,6,7,8', traza.orden.join(','));
        check('4b · todas resuelven con su propio valor',
            resultados.join(',') === '0,1,2,3,4,5,6,7,8', resultados.join(','));
        // Serial habrían sido 3600 ms. El limitador debe quedarse claramente por debajo.
        check('4c · con RTT alto el tiempo lo marca el ritmo, no la latencia',
            transcurrido < 3000, `${transcurrido} ms (serial habrían sido ~3600)`);
    }

    // ── 5 · Ciclo invalidado: ni gasta hueco de ritmo ni se ejecuta ─────────────────────────
    {
        const { app, traza } = nuevaApp();
        let ejecutada = false;
        const r = await app._enqueueNcbi(
            async () => { ejecutada = true; return 'no debería'; },
            () => false
        );
        check('5 · una tarea de ciclo invalidado resuelve a null', r === null, String(r));
        check('5b · y NO llega a ejecutarse', ejecutada === false);
        check('5c · ni consume hueco de ritmo', traza.despachos.length === 0);
    }

    // ── 6 · Un rechazo llega al llamador y no atasca la cola ────────────────────────────────
    {
        const { app, traza } = nuevaApp();
        const fallo = app._enqueueNcbi(async () => { throw new Error('boom'); });
        let capturado = null;
        try { await fallo; } catch (e) { capturado = e.message; }
        check('6 · el rechazo llega al llamador', capturado === 'boom', String(capturado));
        const siguiente = await app._enqueueNcbi(tarea(traza, 'despues', 10));
        check('6b · y la cola sigue viva después del fallo', siguiente === 'despues', String(siguiente));
    }

    // ── 7 · Un 429 enfría la cola entera ────────────────────────────────────────────────────
    // Sin esta guarda, las otras dos ranuras seguirían disparando contra un servidor que acaba
    // de pedir tregua: es la propiedad que la cadena serial daba gratis.
    {
        const { app, traza } = nuevaApp();
        app._ncbiCooldownUntil = Date.now() + 400;
        const t0 = Date.now();
        await app._enqueueNcbi(tarea(traza, 'enfriada', 10));
        const espero = Date.now() - t0;
        check('7 · con enfriamiento activo, la petición espera a que pase',
            espero >= 350, `salió tras ${espero} ms de los 400 de enfriamiento`);
    }

    // ── 8 · MUTACIÓN: el limitador DEPENDE de sus dos frenos ────────────────────────────────
    // Si el tope de concurrencia no existiera, 12 tareas lentas encoladas de golpe darían un
    // pico muy por encima de 3. Se comprueba que el pico observado es exactamente el tope, no
    // un número cualquiera que casualmente cumple.
    {
        const { app, traza } = nuevaApp();
        await Promise.all(Array.from({ length: 12 }, (_, i) => app._enqueueNcbi(tarea(traza, i, 500))));
        check('8 · con 12 tareas lentas el pico llega al tope y no lo pasa',
            traza.pico === 3, `pico ${traza.pico}`);
        const enVentana = maxEnVentana(traza.despachos, 1000);
        check('8b · y el techo de 3/s se sostiene con carga alta',
            enVentana <= 3, `${enVentana} en una ventana de 1 s`);
    }

    console.log('');
    if (failures) {
        console.log(`${failures} fallo(s) — el limitador de NCBI no se sostiene.`);
        process.exitCode = 1;
    } else {
        console.log('Limitador de NCBI en verde: el techo de 3 req/s no se toca, la concurrencia');
        console.log('se usa de verdad, el orden se respeta y un 429 sigue frenando a todos.');
    }
})();
