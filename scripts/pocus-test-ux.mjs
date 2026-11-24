#!/usr/bin/env node
/**
 * pocus-test-ux.mjs — prueba de navegación y uso del atlas POCUS en un navegador real.
 *
 * Nació el 24/11/2026. Los otros bancos del atlas leen pocus.html como texto o ejecutan trozos
 * en `vm`; ninguno veía la página pintada. Así pasaron sin que nadie lo notara un estilo
 * `.nav-chip.active` que ningún código aplicaba, una URL que no cambiaba al pinchar en el
 * maniquí, pestañas ocultas en tablet y una cabecera que en el móvil ocupaba un tercio de la
 * pantalla. Esto abre Chrome headless por el protocolo de DevTools (sin dependencias: Node 22+
 * trae `WebSocket`), sirve el repo en local con el gate de acceso desactivado SOLO en memoria, y
 * mide en tres anchos: móvil (390×844, táctil), tablet (820×1180, táctil) y escritorio (1366×800).
 *
 * Lo que NO cubre: si algo se entiende mal o está feo. Mide desbordes, estados, alturas y la
 * coherencia de la URL; el juicio visual sigue siendo de una persona.
 *
 * Contrato de tres estados, igual que pocus-audit.mjs:
 *   0  todas las aserciones pasan
 *   1  alguna falla
 *   2  inconcluso: no hay Chrome, no arranca o la página no llega a pintarse. Una prueba que
 *      aprueba por no haber podido mirar es peor que no tenerla.
 *
 *   node scripts/pocus-test-ux.mjs
 *   CHROME_PATH=/ruta/a/chrome node scripts/pocus-test-ux.mjs
 *   node scripts/pocus-test-ux.mjs --capturas=<carpeta>   (guarda una PNG por paso)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import process from 'process';
import { spawn } from 'child_process';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const HTML = path.join(RAIZ, 'pocus.html');
const argCapturas = process.argv.find((a) => a.startsWith('--capturas='));
const CAPTURAS = argCapturas ? path.resolve(argCapturas.split('=')[1]) : null;

const inconcluso = (msg) => {
  console.log(`INCONCLUSO: ${msg}`);
  limpiar();
  process.exit(2);
};

// ── Chrome ──────────────────────────────────────────────────────────────────────────────────
const candidatos = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = candidatos.find((c) => fs.existsSync(c));

// ── Servidor local: el repo tal cual, con el gate desactivado en memoria ────────────────────
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const GATE = 'async function checkPocusGate() {';
let servidor, chrome, perfil, ws;

function limpiar() {
  try { ws && ws.close(); } catch {}
  try { chrome && chrome.kill(); } catch {}
  try { servidor && servidor.close(); } catch {}
  // Chrome tarda un instante en soltar el perfil en Windows; si no se deja borrar, se queda en temp.
  try { perfil && fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Aserciones ──────────────────────────────────────────────────────────────────────────────
let total = 0;
const fallos = [];
function comprobar(nombre, ok, detalle) {
  total++;
  if (ok) console.log(`  ok  ${nombre}`);
  else {
    console.log(`  FALLA  ${nombre}${detalle !== undefined ? ' — ' + JSON.stringify(detalle) : ''}`);
    fallos.push(nombre);
  }
}

async function main() {
  if (!fs.existsSync(HTML)) inconcluso(`no encuentro ${HTML}`);
  if (typeof WebSocket === 'undefined') inconcluso(`este Node (${process.version}) no trae WebSocket; hace falta Node 22 o superior`);
  if (!CHROME) inconcluso('no encuentro Chrome, Chromium ni Edge; indica la ruta con CHROME_PATH');

  const original = fs.readFileSync(HTML, 'utf8');
  if (!original.includes(GATE)) inconcluso(`no encuentro «${GATE}» en pocus.html: sin él no puedo abrir la página`);

  servidor = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.resolve(RAIZ, '.' + ruta);
    if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    let cuerpo = fs.readFileSync(f);
    if (ruta === '/pocus.html') cuerpo = original.replace(GATE, GATE + ' return true;');
    res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' });
    res.end(cuerpo);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}/pocus.html`;

  perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'pocus-ux-'));
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });

  // Chrome escribe el puerto que ha elegido en DevToolsActivePort
  let puerto;
  for (let i = 0; i < 60 && !puerto; i++) {
    try { puerto = fs.readFileSync(path.join(perfil, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(); } catch {}
    if (!puerto) await espera(250);
  }
  if (!puerto) inconcluso('Chrome no ha abierto el puerto de depuración');
  let wsUrl;
  for (let i = 0; i < 20 && !wsUrl; i++) {
    try {
      const lista = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
      wsUrl = (lista.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
    } catch {}
    if (!wsUrl) await espera(250);
  }
  if (!wsUrl) inconcluso('Chrome no ofrece ninguna página por DevTools');

  let id = 0;
  const pendientes = new Map();
  ws = new WebSocket(wsUrl);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pendientes.has(d.id)) {
      const p = pendientes.get(d.id);
      pendientes.delete(d.id);
      d.error ? p.ko(new Error(d.error.message)) : p.ok(d.result);
    }
  };
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('WebSocket')); });
  const send = (method, params = {}) => new Promise((ok, ko) => {
    const i = ++id;
    pendientes.set(i, { ok, ko });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
  let nCaptura = 0;
  const captura = async (nombre) => {
    if (!CAPTURAS) return;
    fs.mkdirSync(CAPTURAS, { recursive: true });
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(CAPTURAS, `${String(++nCaptura).padStart(2, '0')}-${nombre}.png`), Buffer.from(r.data, 'base64'));
  };
  const abrir = async (url, ancho, alto, tactil) => {
    await send('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: tactil });
    await send('Emulation.setTouchEmulationEnabled', tactil ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
    await send('Page.navigate', { url });
    // La página está lista cuando el gate ha quitado su clase y, si hay zona, las tarjetas existen.
    for (let i = 0; i < 60; i++) {
      await espera(200);
      try {
        const lista = await ev(`!document.documentElement.classList.contains('pocus-gate-pending') && !!document.querySelector('header') && (!/[?&]zona=/.test(location.search) || document.querySelectorAll('.content-card').length > 0)`);
        if (lista) { await espera(400); return; }
      } catch {}
    }
    inconcluso(`la página no llega a pintarse en ${ancho}×${alto} (${url})`);
  };
  const raton = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra });
  const clic = async (x, y) => {
    await raton('mouseMoved', x, y);
    await raton('mousePressed', x, y, { button: 'left', clickCount: 1 });
    await raton('mouseReleased', x, y, { button: 'left', clickCount: 1 });
  };
  const tocar = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await espera(120);
  };
  const tecla = async (key, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  };
  const marcados = () => ev(`[...document.querySelectorAll('#system-nav .active')].map(e => e.innerText.trim().replace(/\\s+/g, ' ') + (e.getAttribute('aria-current') ? ' [actual]' : ''))`);
  const menuVisible = (i) => ev(`getComputedStyle(document.querySelectorAll('.nav-chip-dropdown')[${i}]).display !== 'none'`);
  const centro = (expr) => ev(`(() => { const r = (${expr}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, bottom: r.bottom }; })()`);
  const desbordes = () => ev(`(() => { const vw = innerWidth; return { scrollW: document.documentElement.scrollWidth, vw, fuera: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed'; }).length }; })()`);
  const MSK = `document.querySelectorAll('.nav-chip-has-dropdown')[3]`;

  // ── Móvil ────────────────────────────────────────────────────────────────────────────────
  console.log('\nMóvil 390×844, táctil');
  await abrir(base, 390, 844, true);
  let d = await desbordes();
  comprobar('portada sin desborde horizontal', d.scrollW <= d.vw && d.fuera === 0, d);
  comprobar('portada sin zona marcada en la barra', (await marcados()).length === 0, await marcados());
  await captura('movil-portada');

  await abrir(base + '?zona=shoulder', 390, 844, true);
  d = await desbordes();
  comprobar('zona abierta sin desborde horizontal', d.scrollW <= d.vw && d.fuera === 0, d);
  let m = await marcados();
  comprobar('enlace ?zona=shoulder marca «MSK/Reuma · Hombro» y la opción Hombro', m.includes('MSK/Reuma · Hombro ▾') && m.includes('Hombro [actual]'), m);
  comprobar('sin ratón, pasar por encima no abre el desplegable', !(await menuVisible(3)));
  const altoChip = await ev(`Math.min(...[...document.querySelectorAll('.nav-chip')].map(c => c.getBoundingClientRect().height))`);
  comprobar('chips de al menos 38 px de alto con dedo', altoChip >= 38, altoChip);
  await captura('movil-hombro');

  // Desplazamiento programado (como al ir a una zona): la cabecera no se retira
  await ev(`window.scrollTo(0, 900)`);
  await espera(400);
  comprobar('un desplazamiento programado no retira la cabecera', !(await ev(`document.querySelector('header').classList.contains('cabecera-retirada')`)));
  // Gesto del usuario: bajar la retira, subir la devuelve
  await ev(`window.dispatchEvent(new Event('touchmove')); window.scrollTo(0, 1500)`);
  await espera(300);
  comprobar('al bajar con el dedo la cabecera se retira', await ev(`document.querySelector('header').classList.contains('cabecera-retirada')`));
  await captura('movil-leyendo');
  await ev(`window.dispatchEvent(new Event('touchmove')); window.scrollTo(0, 1300)`);
  await espera(300);
  comprobar('al subir con el dedo la cabecera vuelve', !(await ev(`document.querySelector('header').classList.contains('cabecera-retirada')`)));
  const altoCabecera = await ev(`Math.round(document.querySelector('header').getBoundingClientRect().height)`);
  console.log(`  (informativo) cabecera completa: ${altoCabecera} px de 844`);

  // Maniquí a pantalla completa
  await abrir(base, 390, 844, true);
  const abierto = () => ev(`document.body.classList.contains('maniqui-abierto')`);
  const hayBoton = await ev(`(() => { const b = document.getElementById('abrir-maniqui'); return !!b && getComputedStyle(b).display !== 'none'; })()`);
  comprobar('el botón flotante «Maniquí» se ve en el móvil', hayBoton);
  // Sin botón, el resto de esta parte no se puede ejecutar: cuenta como fallo, no como inconcluso.
  if (hayBoton) {
  comprobar('el panel del maniquí sigue oculto hasta pedirlo', await ev(`getComputedStyle(document.querySelector('.anatomy-container')).display === 'none'`));
  const chipManiqui = await centro(`document.getElementById('abrir-maniqui')`);
  await tocar(chipManiqui.x, chipManiqui.y);
  await espera(500);
  const panel = await ev(`(() => { const p = document.querySelector('.anatomy-container').getBoundingClientRect(); const s = document.getElementById('anatomical-svg').getBoundingClientRect(); return { top: Math.round(p.top), alto: Math.round(p.height), svgArriba: Math.round(s.top), svgAbajo: Math.round(s.bottom), svgAncho: Math.round(s.width), vh: innerHeight, expandido: document.getElementById('abrir-maniqui').getAttribute('aria-expanded'), bloqueo: getComputedStyle(document.body).overflow }; })()`);
  comprobar('al tocar «Maniquí» el panel cubre la pantalla', (await abierto()) && panel.top === 0 && panel.alto === panel.vh, panel);
  // Medir el rectángulo no basta: el panel ocupaba la pantalla y aun así la cabecera quedaba
  // encima. Lo que cuenta es qué elemento recibe el toque en cada punto.
  const tapados = await ev(`[[195, 20], [195, 120], [20, 422], [370, 422], [195, 830]].filter(([x, y]) => { const e = document.elementFromPoint(x, y); return !e || !e.closest('.anatomy-container'); })`);
  comprobar('nada queda por encima del maniquí abierto (ni la cabecera ni el botón)', tapados.length === 0, tapados);
  comprobar('el dibujo entero cabe en la pantalla sin desplazar', panel.svgArriba >= 0 && panel.svgAbajo <= panel.vh, panel);
  comprobar('aria-expanded del botón y página bloqueada detrás', panel.expandido === 'true' && panel.bloqueo === 'hidden', panel);
  const zonaMenor = await ev(`Math.round(Math.min(...[...document.querySelectorAll('#vista-anterior .anatomy-segment')].map(s => { const r = s.getBoundingClientRect(); return Math.min(r.width, r.height); })))`);
  console.log(`  (informativo) dibujo de ${panel.svgAncho}×${panel.svgAbajo - panel.svgArriba} px; la zona más pequeña mide ${zonaMenor} px de lado (con zoom crece)`);
  await captura('movil-maniqui');

  const altoAntes = await ev(`document.getElementById('anatomical-svg').getBoundingClientRect().height`);
  const mas = await centro(`document.getElementById('zoom-in-btn')`);
  await tocar(mas.x, mas.y);
  await tocar(mas.x, mas.y);
  await espera(300);
  const altoDespues = await ev(`document.getElementById('anatomical-svg').getBoundingClientRect().height`);
  comprobar('el zoom agranda el dibujo dentro del marco', altoDespues > altoAntes * 1.15, { altoAntes, altoDespues });
  await ev(`resetZoom()`);
  await espera(200);

  const rodillaMovil = await centro(`document.querySelector('#vista-anterior .anatomy-segment[data-segment="knee"]')`);
  await tocar(rodillaMovil.x, rodillaMovil.y);
  await espera(1500);
  comprobar('al tocar una zona el maniquí se cierra', !(await abierto()) && (await ev(`getComputedStyle(document.body).overflow`)) !== 'hidden');
  comprobar('…y abre esa zona (URL, barra y fichas)', (await ev(`new URLSearchParams(location.search).get('zona')`)) === 'knee' && (await marcados()).includes('Rodilla [actual]') && (await ev(`document.querySelectorAll('.content-card').length`)) > 0, await marcados());
  comprobar('…sin dejar el tooltip de la zona flotando', !(await ev(`document.getElementById('tooltip').classList.contains('show')`)));
  await captura('movil-tras-maniqui');

  await ev(`window.scrollTo(0, 0)`);
  await espera(200);
  await tocar(chipManiqui.x, chipManiqui.y);
  await espera(300);
  const cruz = await centro(`document.getElementById('maniqui-cerrar')`);
  await tocar(cruz.x, cruz.y);
  await espera(300);
  comprobar('la cruz cierra el maniquí', !(await abierto()));
  await ev(`abrirManiquiMovil()`);
  await tecla('Escape', 'Escape', 27);
  await espera(200);
  comprobar('Escape cierra el maniquí', !(await abierto()));
  }

  // ── Tablet ───────────────────────────────────────────────────────────────────────────────
  console.log('\nTablet 820×1180, táctil');
  await abrir(base + '?zona=knee', 820, 1180, true);
  const pestanasCortadas = await ev(`[...document.querySelectorAll('.tab-bar-scroll')].flatMap(barra => { const lim = barra.getBoundingClientRect(); return [...barra.querySelectorAll('.tab-button')].filter(b => b.getBoundingClientRect().right > lim.right + 1).map(b => b.textContent.trim()); })`);
  comprobar('ninguna pestaña de tarjeta queda fuera de su barra', pestanasCortadas.length === 0, pestanasCortadas);
  m = await marcados();
  comprobar('tablet muestra la subzona en el chip («MSK/Reuma · Rodilla»)', m.includes('MSK/Reuma · Rodilla ▾'), m);
  await captura('tablet-rodilla');

  // ── Escritorio ───────────────────────────────────────────────────────────────────────────
  console.log('\nEscritorio 1366×800, ratón');
  await abrir(base, 1366, 800, false);
  comprobar('en escritorio no aparece el botón «Maniquí» (el panel ya está a la vista)', await ev(`(() => { const b = document.getElementById('abrir-maniqui'); return !!b && getComputedStyle(b).display === 'none'; })()`));
  const chip = await centro(MSK);
  await raton('mouseMoved', chip.x, chip.y);
  await espera(150);
  comprobar('pasar el ratón por el chip abre el desplegable', await menuVisible(3));
  await raton('mouseMoved', chip.x, chip.bottom + 2);
  await espera(80);
  comprobar('el desplegable sigue abierto al cruzar el hueco hacia él', await menuVisible(3));
  const cadera = await centro(`document.querySelectorAll('.nav-chip-dropdown')[3].querySelectorAll('button')[2]`);
  await clic(cadera.x, cadera.y);
  await espera(1500);
  comprobar('al elegir, el desplegable se cierra aunque el ratón siga encima', !(await menuVisible(3)));
  m = await marcados();
  comprobar('elegir Cadera marca el chip MSK/Reuma y la opción', m.includes('MSK/Reuma ▾') && m.includes('Cadera [actual]'), m);
  comprobar('en escritorio el chip no repite la subzona', !m.some((t) => t.includes('·')), m);
  await captura('escritorio-cadera');
  await raton('mouseMoved', 1300, 700);
  await espera(80);
  await raton('mouseMoved', chip.x, chip.y);
  await espera(120);
  comprobar('tras salir y volver, el hover reabre el desplegable', await menuVisible(3));
  await raton('mouseMoved', 1300, 700);
  await espera(80);

  const rodilla = await centro(`document.querySelector('#vista-anterior .anatomy-segment[data-segment="knee"]')`);
  await clic(rodilla.x, rodilla.y);
  await espera(1500);
  comprobar('clic en el maniquí escribe la zona en la URL', await ev(`new URLSearchParams(location.search).get('zona')`) === 'knee', await ev('location.search'));
  m = await marcados();
  comprobar('clic en el maniquí marca la zona en la barra', m.includes('Rodilla [actual]'), m);

  await ev(`document.querySelector('#vista-anterior .anatomy-segment[data-segment="cardiac"]').focus()`);
  await tecla('Enter', 'Enter', 13);
  await espera(1500);
  comprobar('Enter sobre una zona del maniquí con el foco la abre', (await marcados()).includes('Cardíaco [actual]'), await marcados());
  const paradas = await ev(`(() => { const vistas = {}; document.querySelectorAll('.anatomy-segment[tabindex="0"]').forEach(s => { const v = (s.closest('[id^="vista-"]') || {}).id || 'comunes'; const k = v + '|' + s.dataset.segment; vistas[k] = (vistas[k] || 0) + 1; }); return Object.values(vistas).filter(n => n > 1).length; })()`);
  comprobar('una sola parada de tabulador por zona y vista', paradas === 0, paradas);

  await ev(`resetToWelcome()`);
  await espera(300);
  comprobar('volver al inicio desmarca la barra', (await marcados()).length === 0, await marcados());

  await ev(`document.body.focus()`);
  let enCuello = false;
  for (let i = 0; i < 40 && !enCuello; i++) {
    await tecla('Tab', 'Tab', 9);
    enCuello = await ev(`document.activeElement.textContent.trim().startsWith('Cuello')`);
  }
  comprobar('con el teclado, el foco en «Cuello» abre su desplegable', enCuello && (await menuVisible(0)));
}

main()
  .then(() => {
    limpiar();
    console.log(`\nAtlas POCUS en navegador — ${total} comprobaciones, ${fallos.length} fallan.`);
    if (fallos.length) process.exit(1);
    console.log('Todas pasan.');
    process.exit(0);
  })
  .catch((e) => inconcluso(`error del arnés, no de la página: ${e.message}`));
