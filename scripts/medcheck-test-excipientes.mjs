#!/usr/bin/env node
/**
 * MedCheck — contrato de los excipientes de declaración obligatoria (EDO)
 * (`EXCIPIENTES_RIESGO`, `_excipientesEDO`, `_cuerpoPopoverExcipientes`, chip de la tarjeta)
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

console.log('\n— 1 · La clasificación: riesgo, resto y nada inventado —');
{
    // RYEQO, medido contra CIMA el 16/09/2026: lactosa (de riesgo) + manitol (no).
    const r = app._excipientesEDO({
        excipientes: [exc('MANITOL (E-421)', '51', 'mg'), exc('LACTOSA MONOHIDRATO', '78,4', 'mg')],
    });
    ok(r.total === 2, 'cuenta todos los EDO, no solo los de riesgo', `total=${r.total}`);
    ok(r.riesgo.length === 1 && r.riesgo[0].label === 'Lactosa',
        'la lactosa entra como excipiente de riesgo con su etiqueta clínica',
        JSON.stringify(r.riesgo.map(e => e.label)));
    ok(r.riesgo[0].cantidad === '78,4 mg',
        'la cantidad se compone con su unidad: sin ella el dato no decide nada',
        r.riesgo[0].cantidad);
    ok(r.otros.length === 1 && r.otros[0].nombre === 'MANITOL (E-421)',
        'lo que no es de riesgo se conserva íntegro, no se descarta',
        JSON.stringify(r.otros));
    ok(r.riesgo.length + r.otros.length === r.total,
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
        ok(Array.isArray(r.riesgo) && Array.isArray(r.otros) && Array.isArray(r.todos) && r.total === 0,
            `${caso}: devuelve listas vacías, nunca undefined`, JSON.stringify(r));
    }
}

console.log('\n— 3 · El orden del mapa manda: primera coincidencia, como el bucle original —');
{
    // «ALCOHOL BENCÍLICO» casa con `alcohol` y con `benzoato`... no: con `alcohol` solamente.
    // El caso real de solape es `etanol`/`alcohol`, ambos con la misma etiqueta de riesgo alto.
    const claves = Object.keys(Clase.EXCIPIENTES_RIESGO);
    ok(claves.indexOf('etanol') < claves.indexOf('alcohol'),
        'etanol se evalúa antes que alcohol: el literal específico gana al genérico');
    const r = app._excipientesEDO({ excipientes: [exc('ETANOL ANHIDRO')] });
    ok(r.riesgo.length === 1 && r.riesgo[0].label === 'Etanol',
        'ETANOL ANHIDRO se clasifica como Etanol, no como Alcohol', JSON.stringify(r.riesgo));
    // Un excipiente corriente no puede colarse como riesgo por un parecido lejano.
    const s = app._excipientesEDO({ excipientes: [exc('CROSCARMELOSA SODICA'), exc('CELULOSA MICROCRISTALINA')] });
    ok(s.riesgo.length === 0 && s.otros.length === 2,
        'excipientes corrientes NO se marcan como de riesgo', JSON.stringify(s.riesgo));
}

console.log('\n— 4 · Una sola clasificación para las dos superficies (prueba de fuente) —');
{
    // El mapa solo puede estar declarado una vez, como estático. Si reaparece dentro de un método
    // —que es como estaba antes del 16/09— la ficha y la tarjeta pueden divergir.
    const declaraciones = (FUENTE.match(/'parahidroxibenzoato':\s*\{/g) || []).length;
    ok(declaraciones === 1,
        'el mapa de excipientes de riesgo está declarado UNA sola vez en todo el fichero',
        `encontradas ${declaraciones}`);
    ok(/static get EXCIPIENTES_RIESGO\(\)/.test(FUENTE),
        'y vive como estático de la clase, accesible desde cualquier superficie');
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
    const vacio = app._cuerpoPopoverExcipientes({ todos: [], riesgo: [], otros: [], total: 0 });

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
        riesgo: [{ icon: 'fa-cheese', label: 'Lactosa', color: '#f59e0b', fullName: 'LACTOSA MONOHIDRATO', cantidad: '78,4 mg' }],
        otros: [], total: 1,
    });
    const vacio = app._cuerpoPopoverExcipientes({ todos: [], riesgo: [], otros: [], total: 0 });
    for (const [caso, html] of [['con excipientes', conDato], ['sin excipientes', vacio]]) {
        ok(/no es la composición completa/i.test(html) && /ficha técnica/i.test(html),
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

console.log('\n— 8 · El color llega DESPUÉS de preguntar, nunca antes —');
{
    app._excipientesCache = new Map();

    const sinConsultar = app._excipientesEstadoChip('999');
    ok(sinConsultar.estado === 'desconocido' && sinConsultar.clase === '' && sinConsultar.texto === '',
        'sin consultar: ni color ni cifra — no se sabe, y marcar sin saber es el ruido que esto evita',
        JSON.stringify(sinConsultar));

    app._excipientesCache.set('A', app._excipientesEDO({ excipientes: [exc('LACTOSA MONOHIDRATO', '78,4', 'mg'), exc('MANITOL (E-421)')] }));
    const destacado = app._excipientesEstadoChip('A');
    ok(destacado.estado === 'destacado' && /exc-riesgo/.test(destacado.clase),
        'consultado y con alguno de la lista curada: se marca en ámbar', JSON.stringify(destacado));
    ok(destacado.texto === '2',
        'la cifra es el TOTAL de EDO (2), no los destacados (1): todos llevan advertencia oficial',
        destacado.texto);
    ok(/Lactosa/.test(destacado.titulo),
        'el título nombra los que sí tienen etiqueta curada', destacado.titulo);

    app._excipientesCache.set('B', app._excipientesEDO({ excipientes: [exc('CROSCARMELOSA SODICA')] }));
    const soloEdo = app._excipientesEstadoChip('B');
    ok(soloEdo.estado === 'edo' && /exc-visto/.test(soloEdo.clase) && soloEdo.texto === '1',
        'consultado y sin etiqueta curada: atenuado pero CON CIFRA, no mudo', JSON.stringify(soloEdo));
    ok(soloEdo.clase !== destacado.clase && soloEdo.clase !== sinConsultar.clase,
        'los estados tienen apariencias distintas entre sí');

    app._excipientesCache.set('C', app._excipientesEDO({ excipientes: [] }));
    const ninguno = app._excipientesEstadoChip('C');
    ok(ninguno.estado === 'ninguno' && ninguno.texto === '0' && /no declara/i.test(ninguno.titulo),
        '«CIMA no declara ninguno» lleva un 0 explícito y esas palabras', JSON.stringify(ninguno));
    ok(ninguno.texto !== soloEdo.texto,
        'un 0 y un 2 no pueden verse igual: antes los dos salían callados');

    // El color no puede derivarse del excipiente concreto: el mapa tiene un color por excipiente
    // pero no es una escala de gravedad, y elegir «el peor» inventaría una jerarquía clínica.
    // Se acota al CUERPO del método, no a la primera mención de su nombre: la primera aparición
    // está en el render de la tarjeta, miles de líneas antes, y el trozo intermedio incluye el
    // popover —donde cada excipiente SÍ lleva su color, y con razón—. Una prueba que mira más
    // de lo que dice vigilar falla por donde no toca, que es como se acaba borrando.
    const ini = FUENTE.indexOf('_excipientesEstadoChip(nregistro) {');
    const cuerpoChip = FUENTE.slice(ini, FUENTE.indexOf('_refrescarChipsExcipientes(nregistro) {', ini));
    ok(ini > 0 && cuerpoChip.length > 0 && !/\.color/.test(cuerpoChip),
        'el chip NO pinta el color del excipiente concreto: no hay escala de gravedad que sostenga «el peor»');
}

console.log('\n— 8b · EL FALSO NEGATIVO DE CINFAHELIX (regresión reparada el 16/09) —');
{
    // Caso REAL, tal y como lo devuelve CIMA para el nregistro 81847, que Ernesto tenía en
    // pantalla cuando preguntó si esto daba falsos negativos. Sorbitol 708 mg: para una
    // intolerancia hereditaria a la fructosa es EL dato. Ninguno de los dos está en la lista
    // curada, así que el chip va atenuado — y eso está bien; lo que NO puede es decir que no
    // hay advertencia, porque el campo de CIMA es el anexo de declaración obligatoria y todo
    // lo que sale ahí la lleva.
    app._excipientesCache = app._excipientesCache || new Map();
    app._excipientesCache.set('81847', app._excipientesEDO({
        excipientes: [exc('SORBITOL LIQUIDO NO CRISTALIZABLE  (E420)', '708,00', 'mg'), exc('SORBATO POTASICO', '1,775', 'mg')],
    }));
    const e = app._excipientesEstadoChip('81847');
    ok(e.texto === '2',
        'CINFAHELIX enseña «2», no queda mudo: el sorbitol se ve desde la lista', e.texto);
    ok(!/ninguno de la lista de advertencia/i.test(e.titulo),
        'y NO dice «ninguno de la lista de advertencia», que es la frase que lo hacía parecer limpio',
        e.titulo);
    ok(/advertencia oficial/i.test(e.titulo),
        'el título afirma lo que sí es cierto: todos llevan advertencia oficial', e.titulo);
    ok(/destaca por nombre los más habituales/i.test(e.titulo),
        'y dice que lo que MedCheck destaca es un subconjunto, no el criterio de riesgo');
}

console.log('\n— 9 · Los dos alcoholes que no son etanol (regresión reparada el 16/09) —');
{
    const casos = [
        ['ALCOHOL BENCILICO', 'Alcohol bencílico'],
        ['ALCOHOL BENCÍLICO', 'Alcohol bencílico'],   // con acento: el censo tiene las dos grafías
        ['CETOESTEARILICO, ALCOHOL', 'Alcohol cetoestearílico'],
        ['ALCOHOL ETILICO (ETANOL)', 'Etanol'],
        ['ETANOL ANHIDRO', 'Etanol'],
    ];
    for (const [literal, esperado] of casos) {
        const r = app._excipientesEDO({ excipientes: [exc(literal)] });
        ok(r.riesgo[0]?.label === esperado,
            `«${literal}» se rotula «${esperado}»`, `salió «${r.riesgo[0]?.label}»`);
    }
    const benc = app._excipientesEDO({ excipientes: [exc('ALCOHOL BENCILICO')] }).riesgo[0];
    ok(benc.icon !== 'fa-wine-bottle',
        'y el bencílico NO lleva botella de vino: su advertencia es neonatal, no de bebida alcohólica',
        benc.icon);
    const claves = Object.keys(Clase.EXCIPIENTES_RIESGO);
    ok(claves.indexOf('alcohol bencilico') < claves.indexOf('alcohol')
        && claves.indexOf('cetoestearilico') < claves.indexOf('alcohol'),
        'los dos específicos se evalúan ANTES que la clave genérica `alcohol`');
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
    ok(/X-MC-Autocomplete/.test(cuerpo),
        'las peticiones del lote también son secundarias: no inflan la analítica de búsquedas');
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
    ok(chips.get('A1').innerHTML === 'pintado:destacado',
        'el que trae lactosa queda marcado', chips.get('A1').innerHTML);
    ok(chips.get('A2').innerHTML === 'pintado:edo',
        'el que trae solo manitol queda consultado y atenuado', chips.get('A2').innerHTML);
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
    ok(/getMedicamento\(nregistro, \{ headers: \{ 'X-MC-Autocomplete': '1' \} \}\)/.test(cuerpo),
        'va marcada con X-MC-Autocomplete: entra en caché y no infla la analítica de búsquedas');
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
