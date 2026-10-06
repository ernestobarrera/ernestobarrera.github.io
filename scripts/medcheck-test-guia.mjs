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
const document = {
    addEventListener() {}, removeEventListener() {},
    getElementById: id => elements.get(id) || null,
    querySelector: q => (queries.get(q) || [])[0] || null,
    querySelectorAll: q => queries.get(q) || [],
};
const App = runInNewContext(`${src}\nMedCheckApp;`, {
    document, window: { innerWidth: 1280, innerHeight: 800 },
    setTimeout: fn => { timers.push(fn); }, requestAnimationFrame() {},
});
let passed = 0;
async function test(name, body) {
    await body();
    passed++;
    console.log(`✓ ${name}`);
}
function setup() {
    elements.clear(); queries.clear(); timers.length = 0;
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
console.log(`\n${passed} regresiones de guía verificadas (sin red).`);
const tours = Object.values(Object.create(App.prototype)._guideTours());
console.log(`${tours.length} recorridos · ${tours.reduce((sum, tour) => sum + tour.steps.length, 0)} pasos.`);
