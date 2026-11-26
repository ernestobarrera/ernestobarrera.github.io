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

  // Girar el muñeco con el dedo (24/11/2026). Deslizar en horizontal lo estrecha con |cos θ|
  // y, pasados 90°, enseña la otra cara; al soltar completa el giro si pasó de 60°.
  const vista = () => ev(`document.getElementById('anatomical-svg').getAttribute('data-vista')`);
  const dedos = (type, puntos) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : puntos });
  const deslizar = async (x0, y, dx, pasos, mitad) => {
    await dedos('touchStart', [{ x: x0, y, id: 1 }]);
    let enMedio = null;
    for (let i = 1; i <= pasos; i++) {
      await dedos('touchMove', [{ x: x0 + (dx * i) / pasos, y, id: 1 }]);
      await espera(16);
      if (mitad && i === Math.round(pasos * 0.4)) enMedio = await ev(`document.getElementById('giro').getAttribute('transform')`);
    }
    await dedos('touchEnd');
    await espera(450);
    return enMedio;
  };
  comprobar('la vista anterior tiene cara y la posterior pelo en la nuca',
    await ev(`document.querySelectorAll('#vista-anterior .rasgo-relleno').length === 2 && !document.querySelector('#vista-posterior .rasgo-relleno') && !!document.querySelector('#vista-posterior .pelo')`));
  const cuerpo = await ev(`(() => { const r = document.getElementById('anatomical-svg').getBoundingClientRect(); return { x: r.x + r.width * 0.25, y: r.y + r.height * 0.45, w: r.width }; })()`);
  const estrecho = await deslizar(cuerpo.x, cuerpo.y, cuerpo.w * 0.9, 16, true);
  comprobar('al deslizar el dedo el muñeco se estrecha mientras gira', /scale\(0\.\d+ 1\)/.test(estrecho || ''), estrecho);
  comprobar('…y al soltar enseña la espalda, sin cerrar el panel ni abrir zona',
    (await vista()) === 'posterior' && (await abierto()) && !(await ev(`new URLSearchParams(location.search).get('zona')`)), await vista());
  comprobar('…sin dejar el dibujo estrechado', !(await ev(`document.getElementById('giro').getAttribute('transform')`)));
  await deslizar(cuerpo.x + 60, cuerpo.y, -30, 4);
  comprobar('un deslizamiento corto no gira', (await vista()) === 'posterior');
  await captura('movil-espalda');
  const btnAnterior = await centro(`document.querySelector('.vista-btn[data-vista="anterior"]')`);
  await tocar(btnAnterior.x, btnAnterior.y);
  await espera(600);
  comprobar('el botón Anterior gira hasta la cara', (await vista()) === 'anterior');
  const mitadSvg = await ev(`(() => { const r = document.getElementById('anatomical-svg').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const pinza = (type, d) => dedos(type, [{ x: mitadSvg.x - d, y: mitadSvg.y, id: 3 }, { x: mitadSvg.x + d, y: mitadSvg.y, id: 4 }]);
  await pinza('touchStart', 30);
  for (let i = 1; i <= 8; i++) { await pinza('touchMove', 30 + i * 6); await espera(16); }
  await pinza('touchEnd');
  await espera(300);
  const zoomPinza = await ev(`window.POCUSApp.zoomLevel`);
  comprobar('pellizcar con dos dedos amplía el dibujo', zoomPinza > 1.3, zoomPinza);
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

  // Arrastrar el muñeco con el ratón también lo gira, y el arrastre no cuenta como clic en zona.
  const svgEsc = await ev(`(() => { const r = document.getElementById('anatomical-svg').getBoundingClientRect(); return { x: r.x + r.width * 0.3, y: r.y + r.height * 0.5, w: r.width }; })()`);
  await raton('mouseMoved', svgEsc.x, svgEsc.y);
  await raton('mousePressed', svgEsc.x, svgEsc.y, { button: 'left', clickCount: 1 });
  for (let i = 1; i <= 12; i++) await raton('mouseMoved', svgEsc.x + (svgEsc.w * 0.8 * i) / 12, svgEsc.y, { buttons: 1 });
  await raton('mouseReleased', svgEsc.x + svgEsc.w * 0.8, svgEsc.y, { button: 'left', clickCount: 1 });
  await espera(450);
  comprobar('arrastrar el muñeco con el ratón lo gira sin abrir zona',
    (await ev(`document.getElementById('anatomical-svg').getAttribute('data-vista')`)) === 'posterior' &&
    (await ev(`new URLSearchParams(location.search).get('zona')`)) === 'hip',
    await ev('location.search'));
  await ev(`cambiarVistaManiqui('anterior')`);
  await espera(100);

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

  // ── Iconografía D-6 (25/11/2026) ─────────────────────────────────────────────────────────
  // pocus-audit.mjs ya exige la atribución en los datos; aquí se mira lo que solo se ve pintado:
  // que cada imagen carga de verdad (son `loading="lazy"`, así que se recorren una a una), que el
  // pie con la licencia está debajo, que en el móvil no desbordan y que «Para saber más» sale en
  // Evidencia y no en Hallazgos.
  const FICHA_ICONO = 'exploracion-pulmonar-protocolo-blue';
  for (const [nombre, ancho, alto, tactil] of [['móvil', 390, 844, true], ['escritorio', 1366, 800, false]]) {
    console.log(`\nIconografía (D-6) · ${nombre}`);
    await abrir(`${base}?ficha=${FICHA_ICONO}`, ancho, alto, tactil);
    const tarjeta = `document.querySelector('.content-card[data-ficha="${FICHA_ICONO}"]')`;
    let nFig = 0;
    for (let i = 0; i < 25 && !nFig; i++) {
      await espera(200);
      nFig = await ev(`(${tarjeta} || { querySelectorAll: () => [] }).querySelectorAll('#' + (${tarjeta} || {}).id + ' .pocus-figura').length`).catch(() => 0);
    }
    comprobar(`[${nombre}] la ficha piloto pinta sus 4 figuras en Hallazgos`, nFig === 4, nFig);

    // La línea de salto: es lo primero de Hallazgos, se ve sin desplazar y lleva a «Cómo se ve»
    // de un toque, dejando su título bajo la cabecera (no tapado por ella).
    const salto = await ev(`(() => { const b = ${tarjeta}.querySelector('[id^="findings-"] > .pocus-salto-media'); if (!b) return null; const r = b.getBoundingClientRect(); return { primero: b.parentElement.firstElementChild === b, texto: b.textContent.trim(), dentro: r.top >= 0 && r.bottom <= innerHeight, alto: Math.round(r.height) }; })()`);
    comprobar(`[${nombre}] la línea «Cómo se ve · 4 imágenes» abre Hallazgos y se ve sin desplazar`, !!salto && salto.primero && /4 imágenes/.test(salto.texto) && salto.dentro, salto);
    if (tactil) comprobar(`[${nombre}] la línea de salto mide al menos 38 px de alto para el dedo`, !!salto && salto.alto >= 38, salto);
    const pSalto = await centro(`${tarjeta}.querySelector('.pocus-salto-media')`);
    if (tactil) await tocar(pSalto.x, pSalto.y); else await clic(pSalto.x, pSalto.y);
    await espera(1200);
    const llegada = await ev(`(() => { const h = document.querySelector('header').getBoundingClientRect().bottom; const t = ${tarjeta}.querySelector('.pocus-media-cabecera').getBoundingClientRect().top; return { cabecera: Math.round(h), titulo: Math.round(t), vh: innerHeight }; })()`);
    comprobar(`[${nombre}] al pulsarla, «Cómo se ve» queda a la vista justo bajo la cabecera`, llegada.titulo >= llegada.cabecera - 1 && llegada.titulo <= llegada.cabecera + 120, llegada);
    const cargadas = await ev(`(async () => {
      const imgs = [...${tarjeta}.querySelectorAll('.pocus-figura img')];
      for (const im of imgs) { im.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 250)); }
      await Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 4000); })));
      return imgs.map(im => ({ src: im.getAttribute('src').split('/').pop(), ok: im.complete && im.naturalWidth > 0, w: Math.round(im.getBoundingClientRect().width) }));
    })()`);
    comprobar(`[${nombre}] las 4 imágenes cargan (WebP servido y decodificado)`, cargadas.length === 4 && cargadas.every(c => c.ok), cargadas);
    const pies = await ev(`[...${tarjeta}.querySelectorAll('.pocus-figura')].map(f => { const c = f.querySelector('figcaption'); const l = c && c.querySelector('a[rel~="license"]'); return !!(c && l && /creativecommons\\.org/.test(l.href) && c.querySelector('.pocus-figura-credito') && c.getBoundingClientRect().top >= f.querySelector('img').getBoundingClientRect().bottom - 1); })`);
    comprobar(`[${nombre}] cada figura lleva debajo su pie con enlace a la licencia`, pies.length === 4 && pies.every(Boolean), pies);
    d = await desbordes();
    comprobar(`[${nombre}] sin desborde horizontal con las figuras`, d.scrollW <= d.vw && d.fuera === 0, d);
    if (ancho < 500) comprobar(`[${nombre}] en el móvil las figuras van en una sola columna`, new Set(cargadas.map(c => c.w)).size === 1 && cargadas[0].w >= ancho * 0.7, cargadas.map(c => c.w));
    const saberMas = await ev(`(() => { const t = ${tarjeta}; const ev = t.querySelector('[id^="evidence-"] .pocus-saber-mas'); const hz = t.querySelector('[id^="findings-"] .pocus-saber-mas'); return { enEvidencia: ev ? ev.querySelectorAll('li a[href^="https://"]').length : 0, enHallazgos: !!hz }; })()`);
    comprobar(`[${nombre}] «Para saber más» va en Evidencia con sus 3 enlaces, no en Hallazgos`, saberMas.enEvidencia === 3 && !saberMas.enHallazgos, saberMas);
    await ev(`${tarjeta}.querySelector('.pocus-figura').scrollIntoView({ block: 'start' })`);
    await espera(300);
    await captura(`iconografia-${nombre}`);

    // ── D-7 · Visor (26/11/2026): ampliar, pasar entre las de la ficha, Esc y «atrás» ───────
    const esperadas = await ev(`[...${tarjeta}.querySelectorAll('.pocus-figura')].map(f => ({ src: f.querySelector('img').getAttribute('src').split('/').pop(), titulo: f.querySelector('.pocus-figura-titulo').textContent }))`);
    const visor = () => ev(`(() => {
      const d = document.getElementById('pocus-visor'); if (!d) return { abierto: false };
      const img = d.querySelector('.pocus-visor-escena img'), r = img.getBoundingClientRect();
      const pie = d.querySelector('.pocus-visor-pie'), rp = pie.getBoundingClientRect();
      const enMedio = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { abierto: d.open, contador: d.querySelector('.pocus-visor-contador').textContent,
        src: (img.getAttribute('src') || '').split('/').pop(), ancho: Math.round(r.width), natural: img.naturalWidth,
        dentro: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1,
        pieVisible: rp.height > 0 && rp.top < innerHeight - 20 && rp.bottom <= innerHeight + 1,
        licencia: !!pie.querySelector('a[rel~="license"][href*="creativecommons.org"]'),
        titulo: (pie.querySelector('.pocus-figura-titulo') || {}).textContent,
        foco: d.contains(document.activeElement), tapa: !!enMedio && d.contains(enMedio),
        estado: history.state && history.state.pocusVisor === true };
    })()`);
    const aviso = await ev(`(() => { const b = ${tarjeta}.querySelector('.pocus-ampliar'); const a = b && b.querySelector('.pocus-ampliar-aviso'); if (!a) return null; const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return { tag: b.tagName, texto: a.textContent.trim(), dentro: ra.width > 0 && ra.left >= rb.left && ra.right <= rb.right && ra.bottom <= rb.bottom, label: b.getAttribute('aria-label') }; })()`);
    comprobar(`[${nombre}] cada imagen es un botón con el aviso visible «Ampliar»`, !!aviso && aviso.tag === 'BUTTON' && /Ampliar/.test(aviso.texto) && aviso.dentro && /^Ampliar: /.test(aviso.label), aviso);
    // Centrada antes de pulsar: arriba del todo queda bajo la cabecera fija y el toque cae en el buscador.
    await ev(`${tarjeta}.querySelector('.pocus-ampliar').scrollIntoView({ block: 'center' })`);
    await espera(300);
    const p1 = await centro(`${tarjeta}.querySelector('.pocus-ampliar')`);
    if (tactil) await tocar(p1.x, p1.y); else await clic(p1.x, p1.y);
    await espera(500);
    let v = await visor();
    comprobar(`[${nombre}] al pulsar la imagen se abre el visor en «1 / ${esperadas.length}» con esa imagen`, v.abierto && v.contador === `1 / ${esperadas.length}` && v.src === esperadas[0].src, v);
    comprobar(`[${nombre}] la ampliación lleva su pie con título y enlace a la licencia, a la vista`, v.licencia && v.titulo === esperadas[0].titulo && v.pieVisible, v);
    comprobar(`[${nombre}] el visor tapa la página, cabe en la pantalla y tiene el foco`, v.tapa && v.dentro && v.foco, v);
    comprobar(`[${nombre}] la imagen no se amplía más de 1,5× su tamaño real`, v.natural > 0 && v.ancho <= Math.ceil(v.natural * 1.5) + 1, v);
    await captura(`visor-${nombre}`);
    if (tactil) {
      // Deslizar a la izquierda con el dedo = siguiente.
      const y = Math.round(844 / 2);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 70, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      const pSig = await centro(`document.querySelector('#pocus-visor .pocus-visor-paso[data-paso="1"]')`);
      await clic(pSig.x, pSig.y);
    }
    await espera(300);
    v = await visor();
    comprobar(`[${nombre}] ${tactil ? 'deslizar a la izquierda' : 'el botón «siguiente»'} pasa a la imagen 2 con su pie`, v.contador === `2 / ${esperadas.length}` && v.src === esperadas[1].src && v.titulo === esperadas[1].titulo, v);
    await tecla('ArrowRight', 'ArrowRight', 39);
    await espera(200);
    const trasDerecha = await visor();
    await tecla('ArrowLeft', 'ArrowLeft', 37);
    await tecla('ArrowLeft', 'ArrowLeft', 37);
    await espera(200);
    v = await visor();
    comprobar(`[${nombre}] las flechas del teclado pasan de imagen (→ a la 3, ← ← a la 1)`, trasDerecha.contador === `3 / ${esperadas.length}` && v.contador === `1 / ${esperadas.length}`, { trasDerecha: trasDerecha.contador, final: v.contador });
    await tecla('ArrowLeft', 'ArrowLeft', 37);
    await espera(200);
    v = await visor();
    comprobar(`[${nombre}] desde la primera, «anterior» da la vuelta a la última`, v.contador === `${esperadas.length} / ${esperadas.length}` && v.src === esperadas[esperadas.length - 1].src, v);
    await tecla('Escape', 'Escape', 27);
    await espera(600);
    v = await visor();
    const trasEsc = await ev(`(() => { const f = [...${tarjeta}.querySelectorAll('.pocus-figura')]; return { focoEn: f.findIndex(x => x.querySelector('.pocus-ampliar') === document.activeElement), url: location.search }; })()`);
    comprobar(`[${nombre}] Esc cierra, deshace su entrada de historial y devuelve el foco a la última imagen vista`, !v.abierto && !v.estado && trasEsc.focoEn === esperadas.length - 1 && trasEsc.url.includes('ficha='), { v, trasEsc });
    // Centrada antes de pulsar: arriba del todo queda bajo la cabecera fija y el toque cae en el buscador.
    await ev(`${tarjeta}.querySelector('.pocus-ampliar').scrollIntoView({ block: 'center' })`);
    await espera(300);
    const p2 = await centro(`${tarjeta}.querySelector('.pocus-ampliar')`);
    if (tactil) await tocar(p2.x, p2.y); else await clic(p2.x, p2.y);
    await espera(400);
    const reabierto = (await visor()).abierto;
    await ev(`history.back()`);
    await espera(900);
    v = await visor();
    const trasAtras = await ev(`({ url: location.pathname + location.search, tarjeta: !!${tarjeta} })`);
    comprobar(`[${nombre}] «atrás» cierra la ampliación y deja el atlas en la misma ficha`, reabierto && !v.abierto && /pocus\.html\?ficha=/.test(trasAtras.url) && trasAtras.tarjeta, { reabierto, v, trasAtras });
  }
  // Todas las demás fichas con medios (la iconografía escala a todo el atlas): en escritorio, que
  // cada figura cargue de verdad y lleve su pie con licencia, y que salgan la línea de salto y
  // «Para saber más». La lista sale de `pocusData` de la propia página, no de una copia aquí.
  console.log('\nIconografía (D-6) · todas las fichas con medios, escritorio');
  const conMedia = await ev(`pocusData.filter(a => a.content && Array.isArray(a.content.media) && a.content.media.length).map(a => ({ slug: pocusSlug(a.title), n: a.content.media.length, e: (a.content.enlaces || []).length }))`);
  for (const f of conMedia) {
    if (f.slug === FICHA_ICONO) continue;
    await abrir(`${base}?ficha=${f.slug}`, 1366, 800, false);
    const t = `document.querySelector('.content-card[data-ficha="${f.slug}"]')`;
    for (let i = 0; i < 25 && !(await ev(`!!${t}`).catch(() => false)); i++) await espera(200);
    const r = await ev(`(async () => {
      const c = ${t}; if (!c) return null;
      const imgs = [...c.querySelectorAll('.pocus-figura img')];
      for (const im of imgs) { im.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 200)); }
      await Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; setTimeout(r, 4000); })));
      return { figs: imgs.length, cargan: imgs.filter(im => im.complete && im.naturalWidth > 0).length,
        pies: [...c.querySelectorAll('.pocus-figura figcaption a[rel~="license"]')].length,
        salto: !!c.querySelector('[id^="findings-"] > .pocus-salto-media'),
        enlaces: c.querySelectorAll('[id^="evidence-"] .pocus-saber-mas li a').length };
    })()`);
    comprobar(`«${f.slug}»: ${f.n} figuras cargan, con pie de licencia, línea de salto y ${f.e} enlaces`,
      !!r && r.figs === f.n && r.cargan === f.n && r.pies === f.n && r.salto && r.enlaces === f.e, r);
  }

  // El control se elige de la propia página: el primer segmento en el que ninguna ficha tiene
  // medios ni enlaces. Antes era 'cardiac' fijo, y dejó de servir en cuanto FoCUS tuvo imágenes.
  const otraFicha = await ev(`(async () => {
    const tiene = (a) => a.content && ((a.content.media || []).length || (a.content.enlaces || []).length);
    const seg = [...new Set(pocusData.map(a => a.segment))].find(s => !pocusData.some(a => a.segment === s && tiene(a)));
    if (!seg) return { seg: null };
    await window.renderSegmentContent(seg);
    return { seg, bloques: document.querySelectorAll('.pocus-figura, .pocus-saber-mas, .pocus-salto-media').length };
  })()`);
  comprobar(`una ficha sin medios no pinta bloques vacíos de iconografía (segmento «${otraFicha && otraFicha.seg}»)`, !!otraFicha && !!otraFicha.seg && otraFicha.bloques === 0, otraFicha);

  // Destello del enlace profundo (26/11/2026): al quitar `.deeplink-target` a los 2,6 s, si su
  // animación había sustituido a `fadeIn`, el navegador reiniciaba `fadeIn` y la tarjeta entera
  // parpadeaba de opacidad 0 a 1. Se cuenta cualquier `fadeIn` de la tarjeta pasado el primer segundo.
  const reinicio = await ev(`(async () => {
    const slug = pocusSlug(pocusData.find(a => a.segment !== 'cardiac').title);
    const tardios = [];
    const t0 = performance.now();
    const oye = (e) => { if (e.animationName === 'fadeIn' && e.target.classList.contains('content-card') && performance.now() - t0 > 1000) tardios.push(e.target.id); };
    document.addEventListener('animationstart', oye, true);
    const ok = await window.abrirFicha(slug, { escribirUrl: false, suave: false });
    await new Promise(r => setTimeout(r, 3500));
    document.removeEventListener('animationstart', oye, true);
    return { slug, ok, tardios, sigueClase: !!document.querySelector('.deeplink-target') };
  })()`);
  comprobar(`abrir una ficha por enlace no reinicia su animación de entrada al apagarse el destello («${reinicio && reinicio.slug}»)`, !!reinicio && reinicio.ok && reinicio.tardios.length === 0 && !reinicio.sigueClase, reinicio);
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
