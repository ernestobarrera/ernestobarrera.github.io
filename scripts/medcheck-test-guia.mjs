#!/usr/bin/env node
/**
 * Regresiones del tour: volver desde el modal, usar resultados reales, conservar el
 * borrador de IA y no iluminar paneles ocultos. Ejecuta la clase real sin arrancar
 * la aplicación, con DOM mínimo y sin red ni acceso a datos del usuario.
 * Uso: node scripts/medcheck-test-guia.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'assets/js/cima-app.js'), 'utf8');
const timers = [];
const elements = new Map();
const queries = new Map();
const classList = (...initial) => {
    const values = new Set(initial);
    return { contains: v => values.has(v), add: v => values.add(v), remove: v => values.delete(v) };
};
// Un DOMRect real expone left/top/right/bottom/width/height como getters de su PROTOTIPO, no
// como propiedades propias del objeto. `{ ...rect }` o `Object.assign({}, rect)` los pierde en
// silencio (quedan `undefined`): así se coló el bug del 8/10/2026, invisible con un objeto
// literal de prueba. Este helper replica esa forma para que la regresión lo detecte.
const domRectProto = { get left() { return this._l; }, get top() { return this._t; },
    get right() { return this._r; }, get bottom() { return this._b; } };
const domRect = ({ left, top, right, bottom }) =>
    Object.assign(Object.create(domRectProto), { _l: left, _t: top, _r: right, _b: bottom });
const document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: id => elements.get(id) || null,
    querySelector: q => (queries.get(q) || [])[0] || null,
    querySelectorAll: q => queries.get(q) || [],
};
const frames = [];
const App = runInNewContext(`${src}\nMedCheckApp;`, {
    document, window: { innerWidth: 1280, innerHeight: 800 },
    setTimeout: fn => { timers.push(fn); },
    // Devuelve un identificador truthy: el filtro de reentrada del observador de tamaño lo usa
    // para no encadenar frames, y con un `rAF` que devolvía `undefined` ese filtro no se probaba.
    requestAnimationFrame: fn => frames.push(fn),
    cancelAnimationFrame: id => { frames[id - 1] = null; },
});
let passed = 0;
async function test(name, body) {
    await body();
    passed++;
    console.log(`✓ ${name}`);
}
function setup() {
    elements.clear(); queries.clear(); timers.length = 0; frames.length = 0;
    const app = Object.create(App.prototype);
    app.guideTour = 'core'; app.currentView = 'search'; app.guideStep = 0;
    app.modal = { classList: classList('hidden') };
    app._guideWait = async () => {};
    app.closeModal = () => app.modal.classList.add('hidden');
    app.loadView = async view => { app.currentView = view; };
    const overlay = { classList: classList(), innerHTML: '', querySelector: () => null };
    elements.set('guide-overlay', overlay);
    return { app, overlay };
}
const card = nregistro => ({ dataset: { nregistro } });
const plain = value => JSON.parse(JSON.stringify(value));

await test('todos los pasos tienen acciones reconocidas y contenido', () => {
    const { app } = setup();
    const types = new Set(['view', 'modal', 'modalTab', 'profileSection', 'searchResults', 'modalList', 'indicationAi', 'evidence51']);
    for (const tour of Object.values(app._guideTours())) {
        assert.ok(tour.steps.length && tour.label && tour.desc);
        for (const step of tour.steps) {
            assert.ok(step.title && step.body);
            assert.ok(!step.action || types.has(step.action.type));
        }
    }
});
await test('recorrido rápido abierto desde Perfil: cierra modal, va a Buscar sin historial', async () => {
    const { app } = setup();
    app.currentView = 'profile'; app.modal.classList.remove('hidden');
    app.loadView = async view => { assert.equal(app._guideNavigating, true); app.currentView = view; };
    await app._prepareGuideTour('core');
    assert.equal(app.currentView, 'search');
    assert.ok(app.modal.classList.contains('hidden'));
    assert.equal(app._guideNavigating, undefined);
});
await test('retroceder desde Perfil a Guardar vuelve a abrir el modal', async () => {
    const { app } = setup();
    app.currentView = 'profile';
    app._ensureGuideModal = async tab => { assert.equal(tab, 'info'); app.modal.classList.remove('hidden'); };
    const step = app._guideTours().core.steps.find(s => s.title === '7. Guardar lo relevante');
    await app._runGuideStepAction(step);
    assert.ok(!app.modal.classList.contains('hidden'));
});
await test('retroceder desde la ficha PGx recupera la vista de su subguía', async () => {
    const { app } = setup();
    app.guideTour = 'pgx'; app.currentView = 'pharmacogenomics'; app.modal.classList.remove('hidden');
    await app._runGuideStepAction(app._guideTours().pgx.steps[1]);
    assert.ok(app.modal.classList.contains('hidden'));
    assert.equal(app.currentView, 'pharmacogenomics');
});
await test('Buscar: reutiliza una lista visible sin repetir la consulta', async () => {
    const { app } = setup();
    app._tarjetasDeLista = () => [card('1')];
    app.performSearch = () => assert.fail('no debe consultar');
    await app._runGuideStepAction({ action: { type: 'searchResults' } });
});
await test('comparación: crea ejemplo solo si falta lista y abre una tarjeta real', async () => {
    const { app } = setup();
    elements.set('search-input', { value: '' });
    let cards = []; let opened;
    app.currentMed = { nregistro: 'fuera' };
    app._tarjetasDeLista = () => cards;
    app.performSearch = async () => { assert.equal(elements.get('search-input').value, 'clopidogrel'); cards = [card('1'), card('2')]; };
    app.openMedDetails = async (...args) => { opened = args; };
    await app._runGuideStepAction({ action: { type: 'modalList', tab: 'posology' } });
    assert.deepEqual(opened, ['1', 'posology']);
    assert.equal(app._guideOpenedModal, true);
});
await test('comparación: conserva el producto actual si pertenece a la lista', async () => {
    const { app } = setup();
    app.currentMed = { nregistro: '2' }; app._tarjetasDeLista = () => [card('1'), card('2')];
    app.openMedDetails = async id => assert.equal(id, '2');
    await app._runGuideStepAction({ action: { type: 'modalList' } });
});
await test('búsqueda fallida: no abre un producto ajeno presentado como resultado', async () => {
    const { app } = setup();
    elements.set('search-input', { value: '' }); app._tarjetasDeLista = () => [];
    app.performSearch = async () => {};
    app.openMedDetails = () => assert.fail('no debe abrir una ficha');
    await app._runGuideStepAction({ action: { type: 'modalList' } });
    assert.match(app._guideStepNotice, /No hay tarjetas/);
});
await test('IA de grupo: conserva resultados filtrados y borrador ya abierto', async () => {
    const { app } = setup();
    app.currentView = 'indications';
    const ctx = { filtered: [{ nregistro: '3' }] }; app._indAiCtx = ctx;
    const state = { doubt: 'Pregunta existente', selected: ['guias'] }; app._indAi = { open: true, state };
    queries.set('.ind-ai-toggle', [{}]); elements.set('ind-ai-panel', {});
    app.searchByATCCode = () => assert.fail('no debe cambiar el grupo');
    app.toggleIndAiPanel = () => assert.fail('no debe cerrar el borrador');
    await app._runGuideStepAction({ action: { type: 'indicationAi' } });
    assert.equal(app._indAiCtx, ctx); assert.equal(app._indAi.state, state);
});
await test('IA de grupo: abre ejemplo ATC y panel una vez cuando no hay resultados', async () => {
    const { app } = setup(); let toggles = 0;
    app._describeATCCode = () => 'Grupo de ejemplo';
    app._atcBreadcrumbFromCode = (code, name) => [{ code, name }];
    app.searchByATCCode = async (code, label, breadcrumb) => {
        assert.equal(app.currentView, 'indications'); assert.equal(code, 'A02BC');
        assert.deepEqual(plain(breadcrumb), [{ code, name: label }]);
        queries.set('.ind-ai-toggle', [{}]);
    };
    app.toggleIndAiPanel = () => { toggles++; elements.set('ind-ai-panel', {}); };
    await app._runGuideStepAction({ action: { type: 'indicationAi' } });
    assert.equal(toggles, 1);
});
await test('IA de grupo: fallo de carga no intenta abrir un panel inexistente', async () => {
    const { app } = setup();
    app._describeATCCode = () => ''; app._atcBreadcrumbFromCode = () => [];
    app.searchByATCCode = async () => {};
    app.toggleIndAiPanel = () => assert.fail('no hay botón ni resultados');
    await app._runGuideStepAction({ action: { type: 'indicationAi' } });
    assert.match(app._guideStepNotice, /No se ha podido cargar/);
});
await test('spotlight: ignora primer panel oculto y elige alternativa visible', async () => {
    const { app, overlay } = setup();
    const hidden = { classList: classList(), getBoundingClientRect: () => ({ width: 0, height: 0 }) };
    let y = 1200;
    const visible = {
        classList: classList(),
        getBoundingClientRect: () => ({ x: 0, y, width: 500, height: 200 }),
        scrollIntoView: () => { y = 0; },
    };
    app._guideSteps = () => [{ target: '.hidden, .visible', title: 'Título', body: '<p>Texto</p>', icon: 'fa-search' }];
    app._runGuideStepAction = async () => assert.equal(app._guideNavigating, true);
    queries.set('.hidden', [hidden]); queries.set('.visible', [visible]);
    await app._renderGuideStep();
    assert.ok(!hidden.classList.contains('guide-spotlight-target'));
    assert.ok(visible.classList.contains('guide-spotlight-target'));
    assert.match(overlay.innerHTML, /mask id="guide-mask"/);
    assert.equal(y, 0, 'desplaza el destino antes de medir el spotlight');
    assert.equal(app._guideNavigating, false);
});
await test('spotlight: prioriza la pestaña frente al contenedor padre alternativo', async () => {
    const { app } = setup();
    const element = () => ({ classList: classList(), getBoundingClientRect: () => ({ x: 0, y: 0, width: 500, height: 200 }) });
    const tab = element(); const parent = element();
    app._guideSteps = () => [{ target: '.tab, .parent', title: 'Título', body: '<p>Texto</p>', icon: 'fa-search' }];
    app._runGuideStepAction = async () => {};
    queries.set('.tab', [tab]); queries.set('.parent', [parent]);
    await app._renderGuideStep();
    assert.ok(tab.classList.contains('guide-spotlight-target'));
    assert.ok(!parent.classList.contains('guide-spotlight-target'));
});
await test('sin destino visible: paso centrado, sin hueco de tamaño cero', async () => {
    const { app, overlay } = setup();
    app._guideSteps = () => [{ target: '.hidden', title: 'Título', body: '<p>Texto</p>', icon: 'fa-search' }];
    app._runGuideStepAction = async () => {};
    queries.set('.hidden', [{ getBoundingClientRect: () => ({ width: 0, height: 0 }) }]);
    await app._renderGuideStep();
    assert.match(overlay.innerHTML, /guide-card centered/);
    assert.doesNotMatch(overlay.innerHTML, /guide-mask/);
});
await test('ejemplo no disponible: explica el fallo dentro de la tarjeta del tour', async () => {
    const { app, overlay } = setup();
    app._guideSteps = () => [{ title: 'Título', body: '<p>Texto</p>', icon: 'fa-search' }];
    app._runGuideStepAction = async () => { app._guideStepNotice = 'No hay datos <en pantalla>'; };
    await app._renderGuideStep();
    assert.match(overlay.innerHTML, /Demostración no disponible/);
    assert.match(overlay.innerHTML, /No hay datos &lt;en pantalla&gt;/);
});
await test('fallo de acción: libera la guarda de historial', async () => {
    const { app } = setup();
    app._guideSteps = () => [{}]; app._runGuideStepAction = async () => { throw new Error('fallo esperado'); };
    await assert.rejects(app._renderGuideStep(), /fallo esperado/);
    assert.equal(app._guideNavigating, false);
});
await test('cerrar menú: el temporizador no borra un menú reabierto', () => {
    const { app, overlay } = setup(); overlay.innerHTML = 'antiguo';
    app.closeGuideMenu(); overlay.innerHTML = 'nuevo'; overlay.classList.add('active');
    timers.shift()(); assert.equal(overlay.innerHTML, 'nuevo');
});
await test('terminar: el temporizador no borra un tour iniciado después', () => {
    const { app, overlay } = setup();
    app.guideTour = 'consult'; app.endGuide();
    app.guideActive = true; overlay.innerHTML = 'nuevo tour'; overlay.classList.add('active');
    timers.shift()(); assert.equal(overlay.innerHTML, 'nuevo tour');
});
await test('siguiente repetido: solo una transición mientras la acción está pendiente', async () => {
    const { app } = setup(); let release; let calls = 0;
    app._guideSteps = () => [{}, {}, {}];
    app._renderGuideStep = () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const pending = app.nextGuideStep();
    await app.nextGuideStep(); assert.equal(app.guideStep, 1); assert.equal(calls, 1);
    release(); await pending; assert.equal(app._guideBusy, false);
});

await test('colocación: deja la caja de Buscar visible en un portátil', () => {
    const { app } = setup();
    const p = app._guidePlacement({ left: 24, top: 201, right: 435, bottom: 257 }, { width: 420, height: 500 }, { width: 1280, height: 720 });
    assert.equal(p.side, 'right'); assert.ok(p.left > 435);
    assert.ok(p.top >= 12 && p.top + 500 <= 708);
});
await test('colocación: en móvil reduce la tarjeta bajo la búsqueda sin taparla', () => {
    const { app } = setup();
    const p = app._guidePlacement({ left: 24, top: 201, right: 351, bottom: 257 }, { width: 351, height: 520 }, { width: 375, height: 720 });
    assert.equal(p.side, 'bottom'); assert.equal(p.top, 273);
    assert.equal(p.maxHeight, 435); assert.ok(p.top + p.maxHeight <= 708);
});
await test('colocación: usa el espacio a la izquierda de una ficha lateral', () => {
    const { app } = setup();
    const p = app._guidePlacement({ left: 640, top: 24, right: 1256, bottom: 500 }, { width: 420, height: 400 }, { width: 1280, height: 720 });
    assert.equal(p.side, 'left'); assert.ok(p.left + 420 < 640);
});
await test('colocación: prueba arriba antes de limitar un desbordamiento inferior', () => {
    const { app } = setup();
    const p = app._guidePlacement({ left: 100, top: 520, right: 380, bottom: 555 }, { width: 420, height: 350 }, { width: 600, height: 720 });
    assert.equal(p.side, 'top'); assert.equal(p.top + 350, 504);
});
// `box` lo construye un método de la clase evaluada en el contexto vm: aunque sus campos
// coincidan uno a uno con un literal del módulo, su prototipo es el del otro realm y
// `assert.deepEqual` lo rechaza («same structure but are not reference-equal»). Se compara
// campo a campo, como ya hace el resto de pruebas de colocación con sus objetos devueltos.
const sameBox = (box, expected) => {
    for (const k of ['x', 'y', 'width', 'height']) assert.equal(box[k], expected[k], k);
};
await test('ficha abierta: oscurecer solo el cajón, no la página de detrás', () => {
    const { app } = setup();
    app.modal.classList.remove('hidden');
    const panel = { getBoundingClientRect: () => ({ left: 565, top: 0, width: 618, height: 721 }),
        contains: el => el === target };
    app.modal.querySelector = sel => (sel === '.modal-content' ? panel : null);
    const target = { id: 'tab-interactions' };
    sameBox(app._guideDarkenBox(target), { x: 565, y: 0, width: 618, height: 721 });
});
await test('ficha abierta pero destino fuera de ella: oscurecer toda la pantalla', () => {
    const { app } = setup();
    app.modal.classList.remove('hidden');
    const panel = { getBoundingClientRect: () => ({ left: 565, top: 0, width: 618, height: 721 }), contains: () => false };
    app.modal.querySelector = () => panel;
    sameBox(app._guideDarkenBox({ id: 'disfagia-toggle' }), { x: 0, y: 0, width: 1280, height: 800 });
});
await test('sin ficha abierta: oscurecer toda la pantalla como siempre', () => {
    const { app } = setup(); // app.modal sigue 'hidden' por defecto
    sameBox(app._guideDarkenBox({ id: 'cualquiera' }), { x: 0, y: 0, width: 1280, height: 800 });
});
await test('colocación dentro de la ficha: por defecto a la izquierda, no sobre sus propias pestañas', () => {
    const { app } = setup();
    app.modal.classList.remove('hidden');
    // `getBoundingClientRect` real: left/top/right/bottom en el prototipo, no propiedades
    // propias. Con un objeto literal de prueba este caso no habría detectado el bug del
    // 8/10/2026 (el spread «{ ...rect, left }» de la implementación los perdía en silencio).
    const target = { id: 'tab-interactions', getBoundingClientRect: () => domRect({ left: 845, top: 170, right: 960, bottom: 206 }) };
    const panel = { getBoundingClientRect: () => ({ left: 565, top: 0, width: 618, height: 721 }), contains: el => el === target };
    app.modal.querySelector = () => panel;
    const card = { style: {}, offsetWidth: 420, offsetHeight: 400 };
    elements.set('guide-card', card);
    app._guideTargetEl = target;
    // Sin `position` explícito: antes caía en 'bottom' y tapaba la segunda fila de pestañas de
    // la ficha (Evidencia, Financiación, Consultar IA). Ahora usa el hueco real a la izquierda
    // del cajón, que en una ficha (máximo 650px) siempre existe en escritorio.
    app._positionGuideCard({});
    assert.ok(parseFloat(card.style.left) + 420 <= 565, 'la tarjeta no invade el cajón');
    assert.ok(!Number.isNaN(parseFloat(card.style.top)), 'el top no debe quedar NaN');
});
await test('colocación dentro de la ficha: un `position` explícito del paso se respeta', () => {
    const { app } = setup();
    app.modal.classList.remove('hidden');
    const target = { id: 'tab-interactions', getBoundingClientRect: () => domRect({ left: 845, top: 170, right: 960, bottom: 206 }) };
    const panel = { getBoundingClientRect: () => ({ left: 565, top: 0, width: 618, height: 721 }), contains: el => el === target };
    app.modal.querySelector = () => panel;
    const card = { style: {}, offsetWidth: 420, offsetHeight: 400 };
    elements.set('guide-card', card);
    app._guideTargetEl = target;
    app._positionGuideCard({ position: 'bottom' });
    assert.ok(parseFloat(card.style.top) > 206, 'se coloca debajo, como pedía el paso');
});
await test('colocación dentro de una ficha sin hueco a la izquierda: no arrastra NaN y no cae sobre el destino', () => {
    const { app } = setup();
    app.modal.classList.remove('hidden');
    // El entorno de pruebas fija la ventana en 1280×800 (no hay forma de simular 375 px aquí),
    // pero `scoped.left = 0` basta para forzar lo mismo que en móvil: 'left' no cabe (hueco
    // negativo) y el código prueba 'bottom'/'top'/'right'. Esas tres dependían de top/right/bottom
    // del DOMRect, justo los campos que el spread perdía — con el bug, SIEMPRE caían en el
    // "overlap" final (la tarjeta tapando su propio destino) en cualquier paso dentro de la ficha
    // sin margen lateral, que es exactamente el caso real de la ficha en un móvil a 375 px.
    const target = { id: 'tab-posology', getBoundingClientRect: () => domRect({ left: 242, top: 202, right: 314, bottom: 227 }) };
    const panel = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 314, height: 800 }), contains: el => el === target };
    app.modal.querySelector = () => panel;
    const card = { style: {}, offsetWidth: 351, offsetHeight: 497 };
    elements.set('guide-card', card);
    app._guideTargetEl = target;
    app._positionGuideCard({});
    const top = parseFloat(card.style.top);
    assert.ok(!Number.isNaN(top), 'el top no debe quedar NaN');
    assert.ok(top >= 227 + 16 - 1, `debe quedar debajo del destino, no sobre él (top=${top})`);
});
await test('finalizar: libera observador y escuchas de scroll y resize', () => {
    const { app } = setup(); let disconnected = false;
    app._guideGeometryHandler = () => {};
    app._guideResizeObserver = { disconnect: () => { disconnected = true; } };
    app._clearGuideLayout();
    assert.equal(disconnected, true); assert.equal(app._guideGeometryHandler, null);
    assert.equal(app._guideTargetEl, null);
});
await test('Evidencia: el paso de filtros no señala el nuevo acordeón 5.1', () => {
    const { app } = setup();
    const tour = app._guideTours().evidence;
    assert.equal(tour.steps[0].target, '#ev51 .ev51-summary');
    assert.equal(tour.steps.find(s => /Combinar filtros/.test(s.title)).target, '#tab-evidence .evidence-filter-row');
    assert.equal(app._guideTours().core.steps[1].target, '#search-input');
});
await test('5.1: abre el acordeón real y espera su carga antes de señalar las medidas', async () => {
    const { app } = setup(); const details = { open: false, dataset: {} }; let loads = 0;
    elements.set('ev51', details); app._guideStepNotice = '';
    app._ensureGuideModal = async () => true; app._selectGuideModalTab = async () => true;
    app._cargarFT51 = async (_, d) => { assert.equal(d.open, true); loads++; d.dataset.estado = 'listo'; };
    await app._runGuideStepAction({ action: { type: 'evidence51' } });
    await app._runGuideStepAction({ action: { type: 'evidence51' } });
    assert.equal(loads, 1);
});
await test('repintado: medir una tarjeta encogida no alterna su colocación', () => {
    const { app } = setup();
    const card = { style: { maxHeight: '180px' }, offsetWidth: 420,
        get offsetHeight() { return this.style.maxHeight.startsWith('calc') ? 460 : parseFloat(this.style.maxHeight); } };
    elements.set('guide-card', card);
    app._guideTargetEl = { getBoundingClientRect: () => ({ left: 12, right: 1268, top: 350, bottom: 400 }) };
    app._positionGuideCard({}); const first = { ...card.style };
    app._positionGuideCard({}); assert.deepEqual(card.style, first);
});
await test('tamaño: el observador difiere la recolocación, no la hace en su propio callback', () => {
    const { app } = setup(); let recolocadas = 0;
    app._guideGeometryHandler = () => { recolocadas++; };
    app._onGuideResize();
    // Dentro del callback no se toca el layout: si se tocara, el alto de la tarjeta cambiaría
    // durante la entrega y Chrome registraría «ResizeObserver loop».
    assert.equal(recolocadas, 0);
    assert.equal(frames.length, 1);
    app._onGuideResize(); app._onGuideResize();
    assert.equal(frames.length, 1, 'con un frame vivo no se encadenan más');
    frames[0]();
    assert.equal(recolocadas, 1);
    app._onGuideResize();
    assert.equal(frames.length, 2, 'consumido el frame, el siguiente cambio vuelve a programar');
});
await test('tamaño: terminar cancela el frame pendiente y no recoloca después', () => {
    const { app } = setup(); let recolocadas = 0;
    app._guideGeometryHandler = () => { recolocadas++; };
    app._onGuideResize();
    app._clearGuideLayout();
    assert.equal(app._guideResizeFrame, 0);
    assert.equal(frames[0], null);
    assert.equal(recolocadas, 0);
});
console.log(`\n${passed} regresiones de guía verificadas (sin red).`);
const tours = Object.values(Object.create(App.prototype)._guideTours());
console.log(`${tours.length} recorridos · ${tours.reduce((sum, tour) => sum + tour.steps.length, 0)} pasos.`);
