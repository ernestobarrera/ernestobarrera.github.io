#!/usr/bin/env node
/**
 * MedCheck — a dónde se manda al clínico cuando pulsa un documento de CIMA
 *
 * Origen (19/09/2026, contraste con Codex): CIMA publica cada documento en DOS superficies,
 * `url` (PDF) y `urlHtml`, y el cliente usaba siempre el PDF — `grep urlHtml assets/js/cima-app.js`
 * devolvía cero. Medido sobre 120 registros del censo de excipientes: 118 traen HTML, 1 solo PDF
 * y 1 sin ficha. MedCheck remite continuamente a la sección 6.1, y la 6.1 se lee, se busca y se
 * enlaza en el HTML; en el PDF, en un móvil, no.
 *
 * LO QUE ESTE BANCO PROTEGE DE VERDAD no es el formato: es que la URL SALGA DE LA FUENTE. El repo
 * ya tiene su escarmiento —los enlaces a REec construidos a mano dieron 404 cuando AEMPS cambió la
 * ruta—, así que `dochtml/ft/<nr>/FT_<nr>.html` no se escribe aunque hoy se cumpla. Si `urlHtml`
 * no viene, se cae al PDF y ya está.
 *
 * Uso: node scripts/medcheck-test-enlaces-docs.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');

// Para poder EJECUTAR la agrupación, no solo leerla. Mismo sandbox que medcheck-test-excipientes.
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
vm.runInContext(`${APP}
;window.__MedCheckAppClass = MedCheckApp;`, sandbox);
const Clase = sandbox.window.__MedCheckAppClass;

let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
    if (cond) { console.log(`  ok    ${nombre}`); return; }
    fallos += 1;
    console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

// El bloque que pinta los documentos de la ficha: desde `med.docs.map` hasta el cierre del map.
const iIni = APP.indexOf('${med.docs.map(doc => {');
const bloque = iIni === -1 ? '' : APP.slice(iIni, APP.indexOf('}).join(\'\')', iIni));

console.log('\n1) el destino preferido sale de la fuente, no de una plantilla');
{
    ok('el bloque de documentos existe', bloque.length > 200, `${bloque.length} caracteres`);
    ok('se prefiere `urlHtml` y se cae a `url`', /const href = doc\.urlHtml \|\| doc\.url;/.test(bloque));

    // MUTANTE: si alguien vuelve a enlazar el PDF directamente, esto se pone rojo.
    const crudos = (bloque.match(/href="\$\{doc\.url\}"/g) || []).length;
    ok('ningún enlace del bloque va ya a `doc.url` a pelo', crudos === 0, `${crudos} enlace(s)`);
    ok('y todos los que hay usan el destino preferido', /href="\$\{href\}"/.test(bloque));
}

console.log('\n2) la URL NUNCA se construye a mano (escarmiento de REec)');
{
    // No se busca dentro del bloque sino en TODO el cliente: el fallo que esto previene es que
    // alguien la arme en otro sitio y la traiga ya hecha.
    const emitido = APP.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    ok('no se compone ninguna ruta `dochtml/...` de CIMA', !/dochtml/.test(emitido));
    ok('ni ninguna ruta `cima/pdfs/...`', !/cima\/pdfs/.test(emitido));
}

console.log('\n3) el aviso de EMA mira el destino efectivo');
{
    ok('la detección de IPE externo va sobre `href`',
        /const isExternalIPE = doc\.tipo === 3 && href && href\.includes\('ema\.europa\.eu'\)/.test(bloque));
    // El texto del IPE externo se conserva: ahí lo que importa es que sale de CIMA hacia EMA,
    // no en qué formato llega.
    ok('el IPE externo sigue diciendo «Enlace directo»', /Enlace directo/.test(bloque));
}

console.log('\n4) el enlace no anuncia el formato');
{
    // Se probó el 19/09/2026 con «Abrir versión web» / «Abrir PDF» y se retiró el mismo día, a la
    // vista en producción. Tres razones, y la primera es de Ernesto: rompe la estética minimalista
    // de la lista de documentos. La segunda es de la fuente: CIMA no rotula esas dos URL como
    // «web» y «PDF», así que el texto era vocabulario nuestro con aspecto de dato. Y la tercera lo
    // remata: la versión web enlaza ella misma su PDF, de modo que anunciarlo tampoco ahorraba
    // nada — el destino ya es siempre el mejor de los dos, y cuando no hay elección no hay nada
    // que avisar.
    ok('el enlace dice «Abrir», sin anunciar formato', />\s*Abrir <i class="fas fa-external-link-alt">/.test(bloque));
    ok('MUTANTE: no ha vuelto el rótulo por formato', !/Abrir versión web|Abrir PDF/.test(bloque));
}

console.log('\n5) los materiales informativos NO entran en esta regla');
{
    // Son otro endpoint y otro tipo: el oficial declara `nombre`, `url` y `fecha`, sin `urlHtml`.
    // Si alguien «arregla» esto por simetría, estará inventando un campo que la fuente no da.
    const iMat = APP.indexOf('_renderMatCard(item) {');
    const mat = iMat === -1 ? '' : APP.slice(iMat, iMat + 1200);
    ok('la tarjeta de materiales existe', mat.length > 200);
    ok('y sigue enlazando `d.url`', /href="\$\{d\.url\}"/.test(mat));
    ok('MUTANTE: no se ha inventado `d.urlHtml`', !/d\.urlHtml/.test(mat));
}

console.log('\n6) el índice de secciones sale de CIMA, no de una lista nuestra');
{
    const iIdx = APP.indexOf('async loadIndiceFT(med)');
    const idx = iIdx === -1 ? '' : APP.slice(iIdx, APP.indexOf('\n    }', APP.indexOf('cont.innerHTML', iIdx)));
    ok('existe el cargador del índice', idx.length > 400, `${idx.length} caracteres`);

    ok('la lista de secciones se pide a la API', /this\.api\.getDocSecciones\(med\.nregistro, doc\.tipo/.test(idx));
    ok('el ancla es el identificador que devuelve CIMA', /#\$\{encodeURIComponent\(s\.seccion\)\}/.test(idx));
    ok('y el destino es el `urlHtml` de la fuente', /href="\$\{this\._escapeHtml\(doc\.urlHtml\)\}#/.test(idx));
    ok('el título es el de CIMA, no uno nuestro', /docs-idx-tit">\$\{this\._escapeHtml\(s\.titulo\)\}/.test(idx));

    // AGRUPADO POR PADRE. La primera versión pintaba una retícula plana y 4.1 y 4.2 caían en
    // columnas distintas: hermanas consecutivas que parecían ramas distintas.
    ok('las secciones se agrupan por su sección padre', idx.includes('this._agruparSecciones(secciones)'));
    ok('y el tercer nivel se distingue del segundo', /docs-idx-link--nieta/.test(idx));

    // El enlace al documento entero vive en la cabecera del índice, no en un botón aparte.
    ok('la cabecera del índice lleva el enlace al documento entero', /docs-idx-abrir[\s\S]{0,200}Abrir entera/.test(idx));
    ok('y el botón duplicado de arriba se retira solo si el índice llegó',
        /hechos\.push\(doc\.tipo\)/.test(idx) && /data-doc-tipo="\$\{tipo\}"[\s\S]{0,20}\)\?\.remove\(\)/.test(APP));

    // MUTANTE: el día que alguien escriba aquí un catálogo propio de secciones —«4.8 Reacciones
    // adversas»— habrá dejado de ser espejo y empezará a envejecer por su cuenta.
    ok('MUTANTE: no hay un catálogo de secciones escrito en el cliente',
        !/'4\.8'\s*:\s*'/.test(idx) && !/Reacciones adversas/.test(idx));

    // La petición es apoyo de navegación: sin la marca contaría como búsqueda en la analítica.
    ok('la petición va marcada como secundaria', /X-MC-Autocomplete/.test(idx));

    // Solo se piden los documentos que CIMA publica seccionados y con versión web.
    ok('solo se piden documentos con `secc` y `urlHtml`',
        /d\.secc === true && d\.urlHtml/.test(idx));

    // Un índice es una comodidad: si falla, quedan los enlaces al documento entero.
    ok('un fallo no rompe la pestaña: se calla', /catch \{[\s\S]{0,40}continue;/.test(idx));
}

console.log('\n7) la pestaña se llama como lo que hay dentro');
{
    // «Documentos» describía el continente. En consulta lo que se busca es la ficha.
    ok('la pestaña ya no se llama «Documentos»', !/>Documentos\$\{hasMateriales/.test(APP));
    ok('se llama «Ficha y prospecto»', /Ficha y prospecto\$\{hasMateriales/.test(APP));
    // El `data-tab` NO cambia: lo usan la URL del modal, la analítica y la guía.
    ok('el identificador interno sigue siendo `docs`', /data-tab="docs"/.test(APP));
}

console.log('\n8) la agrupación, ejecutada de verdad sobre la respuesta real de CIMA');
{
    // Muestra literal de `/docSegmentado/secciones/1?nregistro=83518` (PENILEVEL 500), capturada el
    // 19/09/2026. Se prueba la FUNCIÓN, no el texto del fichero: un índice mal agrupado se lee mal
    // aunque todas las expresiones regulares de arriba pasen.
    const FT = [
        { seccion: '3', titulo: 'FORMA FARMACÉUTICA', orden: 1 },
        { seccion: '4', titulo: 'DATOS CLÍNICOS', orden: 1 },
        { seccion: '4.1', titulo: 'Indicaciones terapéuticas', orden: 2 },
        { seccion: '4.2', titulo: 'Posología y forma de administración', orden: 3 },
        { seccion: '4.6', titulo: 'Fertilidad, embarazo y lactancia', orden: 11 },
        { seccion: '4.6.1', titulo: 'Embarazo', orden: 12 },
        { seccion: '4.6.2', titulo: 'Lactancia', orden: 13 },
        { seccion: '5', titulo: 'PROPIEDADES FARMACOLÓGICAS', orden: 1 },
    ];

    const app = Object.create(Clase.prototype);
    const grupos = app._agruparSecciones(FT);

    ok('un grupo por cada sección de primer nivel', grupos.length === 3,
        grupos.map(g => g.cabeza.seccion).join(', '));
    ok('«4» se lleva sus CINCO descendientes, nietas incluidas',
        grupos[1].cabeza.seccion === '4' && grupos[1].hijas.length === 5,
        `${grupos[1].hijas.length} hijas`);
    ok('«3», que no tiene hijas, no se come las del siguiente', grupos[0].hijas.length === 0);
    ok('el tercer nivel se marca como tal',
        grupos[1].hijas.filter(h => h.nivel === 3).map(h => h.seccion).join(',') === '4.6.1,4.6.2');

    // MUTANTE: el campo `orden` de CIMA trae saltos (la 4.3 de PENILEVEL viene con orden 6), así
    // que agrupar por él en vez de por el número metería secciones en el grupo equivocado.
    ok('el nivel NO sale del campo `orden`', grupos[1].hijas.every(h => h.nivel === String(h.seccion).split('.').length));

    // El prospecto empieza por la sección «0», que no tiene padre: tiene que abrir grupo igual.
    const P = [{ seccion: '0', titulo: 'Introducción' }, { seccion: '1', titulo: 'Qué es y para qué se utiliza' }];
    ok('la «0» del prospecto no se pierde', app._agruparSecciones(P).length === 2);

    // Y una lista que empieza por una hija tampoco puede tragarse la primera entrada.
    ok('una lista que empieza por hija no pierde nada',
        app._agruparSecciones([{ seccion: '4.1', titulo: 'x' }]).length === 1);
    ok('ni una lista vacía revienta', app._agruparSecciones([]).length === 0 && app._agruparSecciones(null).length === 0);
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
