#!/usr/bin/env node
/**
 * MedCheck — banco de lo que la pestaña Información de la ficha afirma por su cuenta: el CN que
 * enseña, la cantidad del principio activo con su unidad y el seguimiento adicional (▼). Y la
 * regla de diseño que dejó Fármacos como en un teléfono con el panel de ficha abierto.
 *
 * QUÉ PASÓ (2026-10-04/05). Con QUVIVIQ 50 mg delante, Codex encontró que la fila «Código
 * Nacional» enseñaba el CN de la PRIMERA presentación (10 comprimidos, sin comercializar) y no
 * el de la comercializada (30), que el principio activo salía como «54,04» sin «mg», y que el
 * seguimiento adicional se pintaba como un «▲ Vigilancia» ROJO, cuando el símbolo oficial es un
 * triángulo NEGRO invertido y no significa que el medicamento sea menos seguro. Había cinco
 * variantes de esa insignia repartidas por la app. Ese mismo día, la regla que reserva el ancho
 * del panel en cada `.search-box` dejaba las tarjetas de Fármacos en 172 px.
 *
 * Los datos de QUVIVIQ de aquí son los que describió Codex; desde la nube no hay acceso a CIMA
 * para comprobarlos. Lo que se prueba es el código con ellos, no CIMA.
 *
 * Uso: node scripts/medcheck-test-info-ficha.mjs     Salida: exit 0 si todo pasa.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {
    window: {}, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
const css = readFileSync(join(ROOT, 'assets/css/cima-app.css'), 'utf8');
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8')}\n;window.__CimaAPI = CimaAPI;`, sandbox, { filename: 'cima-api.js' });
vm.runInContext(`${appSrc}\n;window.__App = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const App = sandbox.window.__App;
const app = Object.create(App.prototype);

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok     ${nombre}`); return; }
    fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${JSON.stringify(detalle)}` : ''}`);
};
const texto = html => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

console.log('\n— Código Nacional: el de la presentación comercializada —');
{
    const p = (cn, comerc) => ({ cn, comerc, nombre: `envase ${cn}` });
    ok('QUVIVIQ 50 mg: 760147 (10, no comercializado) y 760148 (30, comercializado) → 760148',
        texto(app._cnPrincipalHtml({ presentaciones: [p('760147', false), p('760148', true)] })) === '760148');
    ok('una sola presentación, comercializada → su CN, sin nota', texto(app._cnPrincipalHtml({ presentaciones: [p('111111', true)] })) === '111111');
    const varias = texto(app._cnPrincipalHtml({ presentaciones: [p('1', true), p('2', true), p('3', true)] }));
    ok('varias comercializadas → la primera, diciendo cuántas más y dónde verlas', varias === '1 (+2 comercializadas, ver envases)', varias);
    const ninguna = texto(app._cnPrincipalHtml({ presentaciones: [p('9', false), p('8', false)] }));
    ok('ninguna comercializada → la primera, diciendo que no lo está', ninguna === '9 (presentación no comercializada)', ninguna);
    ok('sin `comerc` se cuenta como comercializada (mismo criterio que «Presentaciones»)', texto(app._cnPrincipalHtml({ presentaciones: [{ cn: '5' }] })) === '5');
    ok('sin presentaciones → «-»', app._cnPrincipalHtml({}) === '-' && app._cnPrincipalHtml({ presentaciones: [] }) === '-');
    ok('el CN se escapa', !app._cnPrincipalHtml({ presentaciones: [{ cn: '<b>', comerc: true }] }).includes('<b>'));
    ok('la fila «Código Nacional» usa esta función y no `presentaciones[0]`',
        /Código Nacional<\/span>\s*<span class="detail-value">\$\{this\._cnPrincipalHtml\(med\)\}/.test(appSrc) && !/presentaciones\?\.\[0\]\?\.cn/.test(appSrc));
}

console.log('\n— Principio activo con su unidad —');
{
    const linea = appSrc.slice(appSrc.indexOf('    renderInfoTab(med) {'), appSrc.indexOf("            : '-';", appSrc.indexOf('    renderInfoTab(med) {')));
    const pinta = new Function('med', `${linea.split('\n').slice(1).join('\n')}            : '-'; return pActivos;`);
    ok('«DARIDOREXANT HIDROCLORURO 54,04 mg»', pinta({ principiosActivos: [{ nombre: 'DARIDOREXANT HIDROCLORURO', cantidad: '54,04', unidad: 'mg' }] }).trim() === 'DARIDOREXANT HIDROCLORURO 54,04 mg');
    ok('sin unidad en CIMA, igual que antes (no se inventa)', pinta({ principiosActivos: [{ nombre: 'X', cantidad: '5' }] }).trim() === 'X 5');
    ok('sin cantidad, sin unidad suelta', pinta({ principiosActivos: [{ nombre: 'X', unidad: 'mg' }] }).trim() === 'X');
}

console.log('\n— Seguimiento adicional (▼) —');
{
    const sa = App.SEGUIMIENTO_ADICIONAL;
    ok('el texto dice que no significa que sea inseguro y pide notificar', /No significa que sea inseguro/.test(sa.texto) && /notificar/.test(sa.texto));
    ok('el texto no valora el medicamento', !/peligros|arriesgad|evitar|precauci[óo]n|contraindic/i.test(sa.texto));
    const enlace = app._badgeSeguimientoAdicional({ enlace: true });
    ok('en la ficha: ▼ negro invertido, enlazado a la explicación de la AEMPS',
        /^<a class="badge badge-seguimiento"/.test(enlace) && enlace.includes('>▼ Seguimiento adicional</a>') && enlace.includes(`href="${sa.urlAemps}"`) && /target="_blank" rel="noopener"/.test(enlace));
    ok('en tarjetas pulsables: sin enlace dentro', /^<span class="badge badge-seguimiento"/.test(app._badgeSeguimientoAdicional()));
    ok('compacta: solo ▼, con nombre accesible', /aria-label="Seguimiento adicional">▼<\/span>$/.test(app._badgeSeguimientoAdicional({ compacto: true })));
    // Sin comentarios: el de `SEGUIMIENTO_ADICIONAL` cuenta la historia y nombra lo que había.
    const codigo = appSrc.split('\n').filter(l => !/^\s*(?:\*|\/\/|\/\*\*)/.test(l)).join('\n');
    ok('ya no queda ningún ▲ ni «Triángulo negro» ni insignia roja o ámbar de vigilancia',
        !/▲|Triángulo negro|badge-danger[^>]*>[^<]*Vigilancia|⚠️ Vigilancia/.test(codigo), (codigo.match(/.*(?:▲|Triángulo negro|⚠️ Vigilancia).*/) || [])[0]);
    ok('todas las superficies con `triangulo` usan la misma insignia',
        (appSrc.match(/(?:med|fav)\.triangulo\) \S+\.push\(/g) || []).length === 3
        && (appSrc.match(/(?:med|fav)\.triangulo\) \S+\.push\(this\._badgeSeguimientoAdicional\(/g) || []).length === 3);
    ok('Mi Perfil no pinta como «bueno» tener 0 medicamentos con ▼', !/triangulos\.length === 0 \? 'good'/.test(appSrc));

    const quviviq = { nregistro: '1221638004', nombre: 'QUVIVIQ 50 MG', triangulo: true };
    const sinContexto = app.renderModalSafetyTab(quviviq, { checks: [] });
    ok('Seguridad sin ningún contexto: el aviso sale, antes del resto', sinContexto.trimStart().startsWith('<div class="seguimiento-adicional-aviso">'), sinContexto.slice(0, 80));
    ok('con su enlace a la AEMPS y a NotificaRAM', sinContexto.includes(sa.urlAemps) && sinContexto.includes('https://www.notificaram.es/'));
    const conContexto = app.renderModalSafetyTab(quviviq, { checks: [{ status: 'warning', label: 'Embarazo', message: 'm', section: '4.6' }] });
    ok('y con un contexto activo, también', conContexto.trimStart().startsWith('<div class="seguimiento-adicional-aviso">'));
    ok('sin ▼ en CIMA, nada', !app.renderModalSafetyTab({ nregistro: '1', triangulo: false }, { checks: [] }).includes('seguimiento-adicional'));
    ok('la insignia no usa colores de alarma', /\.badge-seguimiento \{\s*background: #e5e7eb;\s*color: #111827;/.test(css));
}

console.log('\n— Fármacos con el panel de ficha abierto —');
{
    // La regla general reserva el ancho del panel en cada `.search-box`; las de Fármacos van
    // dentro de `.combo-view` (1080 px centrada) y quedaban en 172 px. La vista reserva el hueco
    // una vez y sus cajas no reservan nada más. Comprobado en Chromium a 1280, 1864 y 2560 px.
    const bloque = css.slice(css.indexOf('body:has(#med-modal:not(.hidden)) .app-main .search-box {'), css.indexOf('.modal-overlay.hidden .modal-content'));
    ok('la vista Fármacos reserva el hueco del panel', /body:has\(#med-modal:not\(\.hidden\)\) \.app-main \.combo-view \{\s*margin-right: max\(0px, calc\(var\(--flyout-ancho\) - var\(--space-lg\)\)\);/.test(bloque));
    ok('y sus cajas no lo reservan otra vez', /body:has\(#med-modal:not\(\.hidden\)\) \.app-main \.combo-view \.search-box \{\s*margin-right: 0;/.test(bloque));
    ok('las dos reglas van dentro del mismo @media de escritorio que la general', bloque.indexOf('.combo-view .search-box') > bloque.indexOf('.app-main .search-box {') && !/\n\}\n[\s\S]*\.combo-view \{/.test(bloque.slice(0, bloque.indexOf('.combo-view {'))));
}

console.log(fallos === 0 ? '\nTODO VERDE' : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
