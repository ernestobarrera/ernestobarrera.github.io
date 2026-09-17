#!/usr/bin/env node
/**
 * MedCheck — contrato de los excipientes de declaración obligatoria (EDO)
 * (`EXCIPIENTES_NOMBRE_ES`, `_excipientesEDO`, `_leerFT61`, `_cuerpoPopoverExcipientes`, chip)
 *
 * LA REGLA QUE ORDENA ESTE MÓDULO, en palabras de Ernesto (17/09/2026): «prefiero una no señal si
 * obliga a confirmar que una señal que omite avisos». De ahí sale todo lo que vigila este banco.
 *
 * Desde el 2026-09-16 los excipientes se ven DESDE LA LISTA, sin abrir la ficha. Lo que este
 * banco fija no es el aspecto, son las tres decisiones que pueden degradar un dato clínico:
 *
 *   1. UNA SOLA CLASIFICACIÓN. La ficha y el chip de la tarjeta llaman a la MISMA función. El mapa
 *      de excipientes de riesgo vivía dentro del render de la ficha; si alguien lo vuelve a
 *      declarar ahí, las dos superficies pueden acabar diciendo cosas distintas del mismo
 *      medicamento, que es el defecto que este proyecto persigue desde la divergencia de
 *      financiación entre lista y ficha. Hay prueba de fuente que lo impide.
 *
 *   2. TRES ESTADOS, TRES FRASES. «aún no lo sé» (consultando), «no he podido preguntar» (error) y
 *      «CIMA no declara ninguno» son afirmaciones distintas. Fundir las dos últimas en «no hay»
 *      sería afirmar una ausencia que no consta — el mismo fail-open que en financiación obligó a
 *      separar «sin datos» de «sin cobertura».
 *
 *   3. EL ALCANCE VIAJA CON EL DATO. CIMA publica solo los de declaración obligatoria y lo rotula
 *      «información orientativa, consulte la FT/P». La cautela va SIEMPRE que haya respuesta, al
 *      pie y visible, no en un tooltip: quien mira excipientes suele estar decidiendo por una
 *      alergia.
 *
 * Y una decisión de coste que también se fija, porque es la que se va a querer «optimizar»: la
 * petición del detalle va marcada como SECUNDARIA (`X-MC-Autocomplete`). Sin esa marca no entra en
 * la caché del cliente y además infla la analítica de búsquedas con algo que no es una búsqueda.
 *
 * Uso: node scripts/medcheck-test-excipientes.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');

const sandbox = {
    window: {},
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
vm.runInContext(`${FUENTE}\n;window.__MedCheckAppClass = MedCheckApp;`, sandbox);
const Clase = sandbox.window.__MedCheckAppClass;
const app = Object.create(Clase.prototype);

let fallos = 0;
const ok = (cond, nombre, detalle = '') => {
    if (cond) { console.log(`✓ ${nombre}`); return; }
    fallos += 1;
    console.log(`✗ ${nombre}${detalle ? `\n    ${detalle}` : ''}`);
};

const exc = (nombre, cantidad = null, unidad = null) => ({ nombre, cantidad, unidad });

console.log('\n— 1 · La clasificación: con nombre en español, resto, y nada inventado —');
{
    // RYEQO, medido contra CIMA el 16/09/2026: lactosa (de riesgo) + manitol (no).
    const r = app._excipientesEDO({
        excipientes: [exc('MANITOL (E-421)', '51', 'mg'), exc('LACTOSA MONOHIDRATO', '78,4', 'mg')],
    });
    ok(r.total === 2, 'cuenta todos los EDO, no solo los de riesgo', `total=${r.total}`);
    ok(r.nombrados.length === 1 && r.nombrados[0].label === 'Lactosa',
        'la lactosa recibe su nombre en español (apoyo de lectura, NO categoría de riesgo)',
        JSON.stringify(r.nombrados.map(e => e.label)));
    ok(r.nombrados[0].cantidad === '78,4 mg',
        'la cantidad se compone con su unidad: sin ella el dato no decide nada',
        r.nombrados[0].cantidad);
    ok(r.resto.length === 1 && r.resto[0].nombre === 'MANITOL (E-421)',
        'lo que no tiene nombre propio se conserva íntegro: también es declarable',
        JSON.stringify(r.resto));
    ok(r.nombrados.length + r.resto.length === r.total,
        'la partición es exhaustiva: ningún excipiente se pierde por el camino');
}

console.log('\n— 2 · Ausencia de dato ≠ lista rota —');
{
    for (const [caso, med] of [
        ['sin campo excipientes', { nregistro: '1' }],
        ['excipientes vacío', { excipientes: [] }],
        ['med undefined', undefined],
        ['excipientes con huecos', { excipientes: [null, undefined] }],
    ]) {
        const r = app._excipientesEDO(med);
        ok(Array.isArray(r.nombrados) && Array.isArray(r.resto) && Array.isArray(r.todos) && r.total === 0,
            `${caso}: devuelve listas vacías, nunca undefined`, JSON.stringify(r));
    }
}

console.log('\n— 3 · El orden del mapa manda: primera coincidencia, como el bucle original —');
{
    // «ALCOHOL BENCÍLICO» casa con `alcohol` y con `benzoato`... no: con `alcohol` solamente.
    // El caso real de solape es `etanol`/`alcohol`, ambos con la misma etiqueta de riesgo alto.
    const claves = Object.keys(Clase.EXCIPIENTES_NOMBRE_ES);
    ok(claves.indexOf('etanol') < claves.indexOf('alcohol'),
        'etanol se evalúa antes que alcohol: el literal específico gana al genérico');
    const r = app._excipientesEDO({ excipientes: [exc('ETANOL ANHIDRO')] });
    ok(r.nombrados.length === 1 && r.nombrados[0].label === 'Etanol',
        'ETANOL ANHIDRO se clasifica como Etanol, no como Alcohol', JSON.stringify(r.nombrados));
    // Un excipiente corriente no puede colarse como riesgo por un parecido lejano.
    const s = app._excipientesEDO({ excipientes: [exc('CROSCARMELOSA SODICA'), exc('CELULOSA MICROCRISTALINA')] });
    ok(s.nombrados.length === 0 && s.resto.length === 2,
        'lo que no tiene nombre curado queda en «resto», no desaparece', JSON.stringify(s.nombrados));
}

console.log('\n— 4 · Una sola clasificación para las dos superficies (prueba de fuente) —');
{
    // El mapa solo puede estar declarado una vez, como estático. Si reaparece dentro de un método
    // —que es como estaba antes del 16/09— la ficha y la tarjeta pueden divergir.
    const declaraciones = (FUENTE.match(/'parahidroxibenzoato':/g) || []).length;
    ok(declaraciones === 1,
        'el mapa está declarado UNA sola vez en todo el fichero',
        `encontradas ${declaraciones}`);
    ok(/static get EXCIPIENTES_NOMBRE_ES\(\)/.test(FUENTE),
        'y vive como estático de la clase, accesible desde cualquier superficie');
    // EL MAPA NO PUEDE VOLVER A PINTAR NADA. Se llamaba `EXCIPIENTES_RIESGO` y traía icono y
    // color, y con eso la tarjeta pintaba de ámbar «hay alguno de esta lista»: 42 de 47 tarjetas
    // en la búsqueda de dextrometorfano, con el sorbitol mudo. Sin color ni icono la señal no se
    // reconstruye por descuido — habría que devolvérselos a propósito, y entonces esto se cae.
    const mapa = FUENTE.slice(FUENTE.indexOf('static get EXCIPIENTES_NOMBRE_ES()'),
        FUENTE.indexOf('_excipientesEDO(med) {'));
    ok(mapa.length > 100 && !/color:/.test(mapa) && !/icon:/.test(mapa),
        'y NO lleva color ni icono: es un diccionario, no una señal');
    // Se mira el CÓDIGO, no los comentarios: la nota que explica por qué se retiró el nombre tiene
    // que poder nombrarlo, o la historia se pierde y alguien lo reintroduce sin saber qué costó.
    ok(!/get EXCIPIENTES_RIESGO|MedCheckApp\.EXCIPIENTES_RIESGO/.test(FUENTE),
        'el identificador «EXCIPIENTES_RIESGO» no vuelve: era lo que lo hacía leer como categoría clínica');
    ok(Object.values(Clase.EXCIPIENTES_NOMBRE_ES).every(v => typeof v === 'string'),
        'cada entrada es solo un nombre, no un objeto con presentación');
    // La ficha tiene que CONSUMIR el clasificador, no reimplementarlo.
    const usos = (FUENTE.match(/_excipientesEDO\(/g) || []).length;
    ok(usos >= 3,
        'la ficha y el popover llaman al mismo clasificador (definición + al menos dos usos)',
        `apariciones=${usos}`);
}

console.log('\n— 5 · Tres estados y tres frases distintas —');
{
    app._escapeHtml = app._escapeHtml || (s => String(s));
    const cargando = app._cuerpoPopoverExcipientes(null);
    const error = app._cuerpoPopoverExcipientes('error');
    const vacio = app._cuerpoPopoverExcipientes({ todos: [], nombrados: [], resto: [], total: 0 });

    ok(cargando !== error && error !== vacio && cargando !== vacio,
        'consultando, error y «CIMA no declara ninguno» NO dicen lo mismo');
    ok(/no se ha podido consultar/i.test(error),
        'el error dice que no se ha podido preguntar, no que no haya excipientes', error);
    ok(/no declara/i.test(vacio) && !/no se ha podido/i.test(vacio),
        'la ausencia declarada por CIMA se afirma como tal, sin mezclarla con el fallo de red', vacio);
    ok(!/orientativa/i.test(cargando) && !/orientativa/i.test(error),
        'mientras no hay respuesta NO se enseña el alcance del dato: no se ha consultado nada');
}

console.log('\n— 6 · El alcance del dato viaja siempre con el dato —');
{
    const conDato = app._cuerpoPopoverExcipientes({
        todos: [exc('LACTOSA MONOHIDRATO', '78,4', 'mg')],
        nombrados: [{ label: 'Lactosa', fullName: 'LACTOSA MONOHIDRATO', cantidad: '78,4 mg' }],
        resto: [], total: 1,
    });
    const vacio = app._cuerpoPopoverExcipientes({ todos: [], nombrados: [], resto: [], total: 0,
        confirmado: true, ft61: 'Celulosa microcristalina, talco.' });
    for (const [caso, html] of [['con excipientes', conDato], ['cero confirmado', vacio]]) {
        ok(/no la composición completa/i.test(html) && /ficha técnica/i.test(html),
            `${caso}: dice que NO es la composición completa y remite a la ficha técnica`);
    }
    ok(/declaración obligatoria/i.test(conDato),
        'y nombra el alcance real: solo los de declaración obligatoria');
}

console.log('\n— 7 · El chip de la tarjeta: botón de verdad y en todas —');
{
    ok(/<button type="button" class="med-detail-tag med-detail-tag--exc\$\{excEstado\.clase\}"/.test(FUENTE),
        'es un <button> con su clase base más la del estado: se alcanza tabulando y responde a Intro');
    ok(/aria-label="Ver los excipientes de declaración obligatoria/.test(FUENTE),
        'lleva aria-label: el icono solo no dice nada a un lector de pantalla');
    // No puede nacer condicionado a que HAYA excipientes: ese dato no existe al pintar la lista.
    const bloque = FUENTE.slice(FUENTE.indexOf('const excTag'), FUENTE.indexOf('const excTag') + 700);
    ok(!/\?\s*`<button/.test(bloque),
        'el chip NO es condicional: la lista de CIMA no trae excipientes, así que no se puede saber');
    ok(/app\.openMedExcipients\('\$\{med\.nregistro\}', this\)/.test(FUENTE),
        'pasa el propio botón como ancla, para poder colocar el popover junto a él');
    ok(/data-exc-nreg="\$\{med\.nregistro\}"/.test(FUENTE),
        'lleva su nregistro en el DOM: es lo que permite repintarlo cuando llega la respuesta');
}

console.log('\n— 8 · Los CINCO estados, y ninguno es una escala de gravedad —');
{
    app._excipientesCache = new Map();
    app._excVistaActiva = true;

    const sinConsultar = app._excipientesEstadoChip('999');
    ok(sinConsultar.estado === 'desconocido' && sinConsultar.clase === '' && sinConsultar.texto === '',
        'sin consultar: ni marca ni cifra — no se sabe, y marcar sin saber es el ruido que esto evita',
        JSON.stringify(sinConsultar));

    app._excipientesCache.set('A', app._excipientesEDO({ excipientes: [
        exc('LACTOSA MONOHIDRATO', '78,4', 'mg'), exc('MANITOL (E-421)')] }));
    const declara = app._excipientesEstadoChip('A');
    ok(declara.estado === 'declara' && declara.texto === '2',
        'declara N: una sola marca con la cifra, que es el TOTAL de declarables',
        JSON.stringify(declara));

    // LO QUE SE RETIRÓ EL 17/09, y es el corazón de este bloque. Antes había DOS marcas para los
    // que declaran —ámbar si alguno estaba en la lista de nombres, atenuado si no— y esa
    // diferencia era de vocabulario nuestro, no clínica. Medido en dextrometorfano: 42 de 47 en
    // ámbar, encendidas por sacarina o benzoato, con el sorbitol callado. Ahora los dos casos
    // tienen que verse EXACTAMENTE IGUAL.
    app._excipientesCache.set('B', app._excipientesEDO({ excipientes: [
        exc('CROSCARMELOSA SODICA'), exc('BETADEX')] }));
    const sinNombre = app._excipientesEstadoChip('B');
    ok(sinNombre.estado === declara.estado && sinNombre.clase === declara.clase,
        'dos que declaran 2 se ven IGUAL, tenga uno nombre en español o no',
        `${JSON.stringify(sinNombre.clase)} vs ${JSON.stringify(declara.clase)}`);
    ok(sinNombre.texto === declara.texto,
        'y con la misma cifra: la marca cuenta advertencias, no vocabulario nuestro');
    ok(!/entre ellos|destaca|habituales/i.test(declara.titulo),
        'el título ya no enumera «los destacados»: no hay destacados', declara.titulo);
    ok(/advertencia oficial/i.test(declara.titulo),
        'y sí dice lo que es cierto de todos: cada uno lleva advertencia oficial', declara.titulo);

    // EL CERO, EN SUS DOS NATURALEZAS.
    app._excipientesCache.set('C0', { todos: [], nombrados: [], resto: [], total: 0,
        confirmado: true, ft61: 'Celulosa microcristalina, talco, estearato de magnesio.' });
    const cero = app._excipientesEstadoChip('C0');
    ok(cero.estado === 'cero' && cero.texto === '0',
        'cero CONFIRMADO: se afirma, con su 0', JSON.stringify(cero));

    app._excipientesCache.set('C1', { todos: [], nombrados: [], resto: [], total: 0, confirmado: false });
    const incon = app._excipientesEstadoChip('C1');
    ok(incon.estado === 'inconcluso',
        'cero SIN confirmar: estado propio, no se mezcla con el confirmado', JSON.stringify(incon));
    ok(incon.texto !== '0',
        'y NUNCA enseña un 0: un cero ahí sería tranquilizar sin base', incon.texto);
    ok(/NO CONSTA/.test(incon.titulo) && /No significa que no los tenga/i.test(incon.titulo),
        'lo dice con esas palabras, y desmiente la lectura tranquilizadora', incon.titulo);
    ok(incon.clase !== cero.clase,
        'los dos ceros no pueden verse igual');
}

console.log('\n— 8b · Los casos reales que costaron cada regla —');
{
    app._excVistaActiva = true;
    // CINFAHELIX (81847): sorbitol 708 mg. Con la señal vieja salía atenuado y «ninguno de la
    // lista de advertencia»; ahora es un «declara 2» idéntico a cualquier otro.
    app._excipientesCache.set('81847', app._excipientesEDO({ excipientes: [
        exc('SORBITOL LIQUIDO NO CRISTALIZABLE  (E420)', '708,00', 'mg'),
        exc('SORBATO POTASICO', '1,775', 'mg')] }));
    const cinfa = app._excipientesEstadoChip('81847');
    ok(cinfa.estado === 'declara' && cinfa.texto === '2',
        'CINFAHELIX: el sorbitol se ve desde la lista, sin jerarquía que lo esconda', JSON.stringify(cinfa));
    ok(!/ninguno de la lista de advertencia/i.test(cinfa.titulo),
        'y sin la frase que lo hacía parecer limpio');

    // CINFATOS ANTITUSIVO 10 mg: cuatro declarables, ninguno con nombre curado. Antes: atenuado.
    app._excipientesCache.set('CINFATOS', app._excipientesEDO({ excipientes: [
        exc('MALTITOL (E965)', '1134,9', 'mg'), exc('SACARINA SODICA', '2,0', 'mg'),
        exc('BETADEX', '168,5', 'mg'), exc('CICLAMATO DE SODIO', '20,0', 'mg')] }));
    const cinfatos = app._excipientesEstadoChip('CINFATOS');
    ok(cinfatos.estado === 'declara' && cinfatos.texto === '4',
        'CINFATOS ANTITUSIVO: sus cuatro cuentan igual que los de cualquier otro', JSON.stringify(cinfatos));

    // PENILEVEL 500 (83518): siete excipientes en su ficha, ninguno declarable. El cero es
    // correcto Y comprobable, y por eso el popover enseña la 6.1.
    app._escapeHtml = app._escapeHtml || (t => String(t));
    const penilevel = app._cuerpoPopoverExcipientes({ todos: [], nombrados: [], resto: [], total: 0,
        confirmado: true, ft61: 'Celulosa microcristalina, talco, estearato de magnesio, gelatina, '
            + 'dióxido de titanio (E-171), indigotina (E-132) y amarillo de quinolina (E-104).' });
    ok(/amarillo de quinolina/.test(penilevel),
        'PENILEVEL 500: el cero viene con la ficha 6.1 literal, para poder juzgarlo');
    ok(/6.1/.test(penilevel),
        'y se dice de dónde sale ese texto');

    // EVRA IP: cero sin ficha con que contrastarlo. No se afirma.
    const evra = app._cuerpoPopoverExcipientes({ todos: [], nombrados: [], resto: [], total: 0, confirmado: false });
    ok(/No consta/i.test(evra) && /exc-popover__aviso/.test(evra),
        'EVRA (importación paralela): se dice «no consta» y va como aviso, no como dato', evra.slice(0, 120));
    ok(/No significa que no los tenga/i.test(evra),
        'y se desmiente explícitamente la lectura tranquilizadora');
}

console.log('\n— 8d · Desmarcar DESHACE, pero no desaprende —');
{
    // Parte suyo del 17/09: «al desmarcar excipientes se siguen viendo salvo que refresque».
    // Tenía razón: una casilla que no deshace lo que hizo no es una casilla.
    const a = Object.create(Clase.prototype);
    a._excipientesCache = new Map([
        ['M1', app._excipientesEDO({ excipientes: [exc('LACTOSA')] })],      // lo pintó el modo
        ['H1', app._excipientesEDO({ excipientes: [exc('LACTOSA')] })],      // lo abrió él a mano
    ]);
    a._excAbiertosAMano = new Set(['H1']);

    a._excVistaActiva = true;
    ok(a._excipientesEstadoChip('M1').estado === 'declara',
        'con el modo encendido, lo consultado se ve marcado');

    a._excVistaActiva = false;
    ok(a._excipientesEstadoChip('M1').estado === 'desconocido',
        'al desmarcar, la marca que puso el MODO desaparece sin refrescar la página');
    ok(a._excipientesEstadoChip('H1').estado === 'declara',
        'pero la del que abrió A MANO se queda: ese clic es suyo, no lo puso el modo');
    ok(a._excipientesCache.size === 2,
        'y el DATO no se pierde: volver a marcar no cuesta ninguna petición',
        String(a._excipientesCache.size));

    a._excVistaActiva = true;
    ok(a._excipientesEstadoChip('M1').estado === 'declara',
        'al volver a marcar reaparece al instante, desde la caché');

    // Y QUE EL CONJUNTO SE LLENE DE VERDAD AL ABRIR. La prueba de arriba lo rellena a mano, así
    // que aprobaba con la línea que lo puebla borrada: mutante superviviente en la primera
    // versión de este bloque. Aquí se EJECUTA la ruta del usuario y se exige la postcondición.
    {
        const b = Object.create(Clase.prototype);
        Object.assign(b, {
            _excipientesCache: new Map(),
            _excVistaActiva: false,
            api: { getMedicamento: async () => ({ excipientes: [exc('LACTOSA')] }) },
            _pintarPopoverExcipientes() {},
            _refrescarChipsExcipientes() {},
        });
        await b.openMedExcipients('X9', null);
        ok(b._excAbiertosAMano instanceof Set && b._excAbiertosAMano.has('X9'),
            'abrir un chip a mano lo registra como suyo',
            JSON.stringify([...(b._excAbiertosAMano || [])]));
        ok(b._excipientesEstadoChip('X9').estado === 'declara',
            'y su marca se ve aunque el modo esté apagado, que es para lo que sirve el registro');
    }

    // El interruptor tiene que repintar en los DOS sentidos, o el estado sería correcto por dentro
    // y falso en pantalla — que es exactamente el defecto que se está arreglando.
    const cuerpo = FUENTE.slice(FUENTE.indexOf('_toggleVistaExcipientes(activa)'),
        FUENTE.indexOf('_excVistaEstado(texto)'));
    ok((cuerpo.match(/_refrescarTodosLosChipsExcipientes\(\)/g) || []).length === 2,
        'el interruptor repinta al encender Y al apagar',
        `apariciones: ${(cuerpo.match(/_refrescarTodosLosChipsExcipientes\(\)/g) || []).length}`);
}

console.log('\n— 8e · En el popover no hay excipientes de segunda clase —');
{
    app._escapeHtml = app._escapeHtml || (s => String(s));
    // Caso REAL: CINFATOS ANTITUSIVO 10 mg pastillas. Ninguno de sus cuatro está en la lista
    // curada, así que antes salían los cuatro como texto corrido detrás de una fila de colores
    // vacía — y eso se lee como «estos no cuentan». Son los cuatro declarables.
    const cuatro = app._excipientesEDO({ excipientes: [
        exc('MALTITOL (E965)', '1134,9', 'mg'), exc('SACARINA SODICA', '2,0', 'mg'),
        exc('BETADEX', '168,5', 'mg'), exc('CICLAMATO DE SODIO', '20,0', 'mg')] });
    const html = app._cuerpoPopoverExcipientes(cuatro);
    ok((html.match(/<span class="badge-excipient/g) || []).length === 4,
        'los cuatro salen como chip, ninguno como texto corrido',
        `chips encontrados: ${(html.match(/<span class="badge-excipient/g) || []).length}`);
    ok(!/excipientes-list|exc-popover__resto/.test(html),
        'ya no existe la segunda lista de «los otros»');
    ok(/1134,9 mg/.test(html) && /168,5 mg/.test(html),
        'y cada uno lleva su cantidad, que es lo que permite juzgar');

    // Mezcla: uno curado y uno no. Los dos tienen que estar, y el curado conserva su etiqueta.
    const mezcla = app._cuerpoPopoverExcipientes(app._excipientesEDO({ excipientes: [
        exc('LACTOSA MONOHIDRATO', '78,4', 'mg'), exc('MANITOL (E-421)', '51', 'mg')] }));
    ok((mezcla.match(/<span class="badge-excipient/g) || []).length === 2,
        'con uno curado y uno no, salen los dos y en la misma lista');
    ok(/Lactosa/.test(mezcla) && /MANITOL/.test(mezcla),
        'el curado conserva su nombre en español y el otro el de CIMA');
    // SE CUENTAN, no se busca la clase. Con `--llano` solo en el no curado, buscar la cadena
    // aprobaba igual: el mutante que devuelve la jerarquía al popover sobrevivía. Lo que hay que
    // exigir es que la lleven TODOS — es decir, que no haya dos tratamientos.
    const total = (mezcla.match(/<span class="badge-excipient/g) || []).length;
    const llanos = (mezcla.match(/badge-excipient--llano/g) || []).length;
    ok(total === 2 && llanos === 2,
        'TODOS los chips llevan el mismo tratamiento: no hay dos clases de excipiente',
        `chips=${total} llanos=${llanos}`);
    ok(!/--exc-color|style="/.test(mezcla),
        'y ninguno lleva color propio: el color era la jerarquía que se retiró');
    ok(!/color/i.test(mezcla),
        'y el aviso ya ni menciona el color: desde el 17/09 no hay colores que explicar');
    ok(/declaración obligatoria/i.test(mezcla) && /6\.1/.test(mezcla),
        'lo que sí dice es el alcance del dato y dónde está el resto');
}

console.log('\n— 9b · «Ver excipientes» es un MODO, no un filtro —');
{
    // La línea que no se cruza: este control NO puede esconder resultados. Si algún día alguien lo
    // mete en el contrato de filtrado, la lista empezaría a recortarse por marcar una casilla que
    // el usuario entiende como «enséñame más», que es la peor dirección posible para un fallo.
    ok(!Clase.FILTER_DIMENSIONS.includes('excipientes') && !Clase.FILTER_DIMENSIONS.includes('excVista'),
        'no es una dimensión del contrato de filtrado: no puede esconder resultados',
        JSON.stringify(Clase.FILTER_DIMENSIONS));
    const vacio = app._emptyFilterState();
    ok(!('excVista' in vacio) && !('verExcipientes' in vacio),
        'no vive en filterState, así que «Limpiar N» no lo cuenta ni lo apaga');
    const snap = app._filterSnapshot.call({ filterState: vacio, groupingState: {} });
    ok(app._activeFilterCount(snap) === 0,
        'con el modo encendido o apagado, el recuento de filtros activos no cambia');

    // Tope y concurrencia son contrato, no gusto: una búsqueda por ATC puede traer 2.000
    // resultados (`searchMedicamentosAll` pagina 10 × 200) y a ~75 pet./s eso es medio minuto.
    ok(Clase.EXC_VISTA_TOPE > 0 && Clase.EXC_VISTA_TOPE <= 400,
        'hay tope de tarjetas por lote, y es del orden de la búsqueda más grande realista',
        String(Clase.EXC_VISTA_TOPE));
    ok(Clase.EXC_VISTA_CONCURRENCIA > 0 && Clase.EXC_VISTA_CONCURRENCIA <= 6,
        'la concurrencia está acotada: medimos 174 peticiones sin un solo error a 4',
        String(Clase.EXC_VISTA_CONCURRENCIA));

    const cuerpo = FUENTE.slice(FUENTE.indexOf('async _consultarExcipientesVisibles('),
        FUENTE.indexOf('_toggleFinanciacion(valor, encendido)'));
    ok(/!this\._excipientesCache\.has\(n\)/.test(cuerpo),
        'no vuelve a pedir lo que ya sabe: cruza contra la misma caché que llena el chip');
    ok(/slice\(0, tope\)/.test(cuerpo),
        'el lote se recorta al tope, no se lanza la lista entera');
    ok(/restantes > 0/.test(cuerpo) && /faltan \$\{restantes\}/.test(cuerpo),
        'y cuando recorta LO DICE, con cuántas quedan: un parcial mudo parecería completo');
    ok(/_consultarExcipientesDe\(nreg\)/.test(cuerpo),
        'el lote consulta por el MISMO camino que el chip de uno en uno, así que no pueden divergir');
    ok((cuerpo.match(/vivo\(\)/g) || []).length >= 3,
        'comprueba que el lote sigue vivo en cada paso: apagar la casilla tiene que parar de verdad',
        `apariciones de vivo(): ${(cuerpo.match(/vivo\(\)/g) || []).length}`);
    ok(/fallos > 10 && fallos > hechas \/ 2/.test(cuerpo),
        'abandona ante fallo sostenido en vez de seguir martilleando a CIMA');

    // Apagar no desaprende: el chip ya consultado conserva su marca.
    const apagar = FUENTE.slice(FUENTE.indexOf('_toggleVistaExcipientes(activa)'),
        FUENTE.indexOf('_excVistaEstado(texto)'));
    ok(!/_excipientesCache\s*=\s*new Map|_excipientesCache\.clear/.test(apagar),
        'apagar el modo NO vacía la caché: lo averiguado no se desaprende');
}

console.log('\n— 9c · El lote, EJECUTADO contra un CIMA de mentira —');
{
    // Análisis de fuente aparte, aquí se corre la ruta que usa el consumidor y se exige la
    // postcondición: qué se pidió, qué quedó marcado y qué NO se pidió. Es la diferencia entre
    // «el código dice que cachea» y «no volvió a pedirlo».
    const chips = new Map();                       // nregistro -> objeto que imita al <button>
    const hacerChip = (n) => {
        const c = { dataset: { excNreg: n }, title: '', innerHTML: '', className: '',
            classList: { add() {}, remove() {} } };
        chips.set(n, c);
        return c;
    };
    const nregs = ['A1', 'A2', 'A3', 'A4', 'A5'];
    nregs.forEach(hacerChip);

    const pedidos = [];
    const lote = Object.create(Clase.prototype);
    Object.assign(lote, {
        _excVistaActiva: true,
        _excipientesCache: new Map([['A3', app._excipientesEDO({ excipientes: [exc('LACTOSA')] })]]),
        api: {
            getMedicamento: async (n) => {
                pedidos.push(n);
                if (n === 'A4') throw new Error('204');
                return { excipientes: n === 'A1' ? [exc('LACTOSA MONOHIDRATO', '10', 'mg')] : [exc('MANITOL')] };
            },
        },
    });
    // DOM mínimo: el lote busca los chips por `[data-exc-nreg]` y repinta por el mismo selector.
    const doc = {
        querySelectorAll: () => [...chips.values()],
        getElementById: () => null,
    };
    lote._refrescarChipsExcipientes = function (n) {
        const c = chips.get(String(n));
        if (c) c.innerHTML = `pintado:${this._excipientesEstadoChip(n).estado}`;
    };

    await lote._consultarExcipientesVisibles(doc);

    ok(!pedidos.includes('A3'),
        'NO se pide el que ya estaba en caché — el chip pulsado antes no se vuelve a pagar',
        JSON.stringify(pedidos));
    ok(pedidos.length === 4 && ['A1','A2','A4','A5'].every(n => pedidos.includes(n)),
        'se piden exactamente los cuatro que faltaban', JSON.stringify(pedidos));
    ok(lote._excipientesCache.size === 4,
        'los que respondieron entran en la caché; el que falló NO se guarda como «sin excipientes»',
        String(lote._excipientesCache.size));
    ok(!lote._excipientesCache.has('A4'),
        'un fallo de red no se convierte en «CIMA no declara ninguno», que sería inventarse el dato');
    ok(chips.get('A1').innerHTML === 'pintado:declara',
        'el que trae lactosa queda marcado', chips.get('A1').innerHTML);
    ok(chips.get('A2').innerHTML === 'pintado:declara',
        'el que trae solo manitol también cuenta: se ve igual que cualquier otro', chips.get('A2').innerHTML);
    ok(chips.get('A4').innerHTML === '',
        'y el que falló se queda NEUTRO: se distingue a simple vista de los consultados');

    // Apagar a mitad tiene que parar de verdad.
    const pedidos2 = [];
    const abortar = Object.create(Clase.prototype);
    Object.assign(abortar, {
        _excVistaActiva: true,
        _excipientesCache: new Map(),
        _refrescarChipsExcipientes() {},
        api: { getMedicamento: async (n) => { pedidos2.push(n); abortar._excVistaActiva = false; return { excipientes: [] }; } },
    });
    const muchos = Array.from({ length: 40 }, (_, i) => ({ dataset: { excNreg: `B${i}` } }));
    await abortar._consultarExcipientesVisibles({ querySelectorAll: () => muchos, getElementById: () => null });
    ok(pedidos2.length < 40,
        'apagar la casilla a mitad detiene el lote en vez de terminarlo por inercia',
        `peticiones lanzadas: ${pedidos2.length} de 40`);
}

console.log('\n— 10 · La petición del detalle es SECUNDARIA —');
{
    const i = FUENTE.indexOf('async openMedExcipients(');
    const cuerpo = FUENTE.slice(i, FUENTE.indexOf('_cuerpoPopoverExcipientes(datos)', i));
    ok(/_consultarExcipientesDe\(nregistro\)/.test(cuerpo),
        'el chip consulta por el camino único, donde vive también la confirmación del cero');
    // LA RED DE SEGURIDAD DEL CERO, atada aquí porque es la única afirmación que MedCheck hace
    // por su cuenta sobre un medicamento: «no tiene ninguno declarable».
    const unico = FUENTE.slice(FUENTE.indexOf('async _consultarExcipientesDe('),
        FUENTE.indexOf('_excipientesEstadoChip(nregistro) {'));
    ok(/X-MC-Autocomplete/.test(unico),
        'esa consulta va marcada como SECUNDARIA: entra en caché y no infla la analítica');
    ok(/datos\.total === 0/.test(unico) && /_leerFT61/.test(unico),
        'y CONFIRMA el cero contra la ficha 6.1 antes de guardarlo en caché');
    const ft = FUENTE.slice(FUENTE.indexOf('async _leerFT61('),
        FUENTE.indexOf('async _consultarExcipientesDe('));
    ok(/texto\.length >= 10 \? texto : null/.test(ft),
        'una sección 6.1 presente pero vacía NO confirma: es lo mismo que no tenerla');
    ok(/X-MC-Autocomplete/.test(ft),
        'y leer la 6.1 también es una petición secundaria');
    ok(/_excipientesCache/.test(cuerpo),
        'y además cachea por nregistro, para que reabrir el mismo chip no vuelva a la red');
    // SE CUENTAN LAS GUARDAS, no se busca la cadena. Después del `await` hay DOS caminos que
    // pintan —la respuesta buena y el error— y los dos tienen que comprobar que el popover sigue
    // siendo el de este medicamento. Buscar la cadena una sola vez aprobaba con una de las dos
    // guardas quitada, porque la otra la seguía conteniendo: mutante M6, superviviente en la
    // primera versión de este banco. Es el mismo defecto del 16/08 en la skill de Cabecera —una
    // prueba que solo puede fallar por una cadena concreta tiene que comparar la cadena, y si hay
    // varias instancias, contarlas.
    const guardas = (cuerpo.match(/if \(this\._excPopoverNreg === clave\) this\._pintarPopoverExcipientes/g) || []).length;
    ok(guardas === 2,
        'los DOS caminos posteriores al await (respuesta y error) comprueban que el popover sigue siendo el suyo',
        `guardas encontradas: ${guardas}`);
}

console.log(fallos === 0
    ? '\nExcipientes en verde: una sola clasificación para ficha y tarjeta, tres estados que no se\nconfunden, el alcance del dato siempre a la vista y una petición por medicamento preguntado.'
    : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
