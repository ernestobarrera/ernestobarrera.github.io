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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');

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

console.log('\n4) el clínico sabe qué se le va a abrir antes de pulsar');
{
    ok('el enlace distingue versión web de PDF',
        /doc\.urlHtml \? 'Abrir versión web' : 'Abrir PDF'/.test(bloque));
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

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
