#!/usr/bin/env node
/**
 * MedCheck — un enlace con frase resaltada debe abrirse AISLADO
 *
 * Origen (2026-09-25): para que una consulta no dejara doce pestañas de CIMA detrás, todos los
 * enlaces a la ficha pasaron a un destino con nombre (`CIMA_VENTANA`), que exige quitar
 * `rel="noopener"`. Nadie notó que así el navegador deja de resaltar el `:~:text=`: la
 * especificación de *text fragments* solo lo permite entre orígenes distintos si la pestaña
 * destino está sola en su grupo de contextos, o sea, abierta con `noopener`. Durante un día
 * ningún enlace de MedCheck resaltó, tampoco los «4.x en CIMA» de Seguridad, que funcionaban
 * desde la sesión 73. Lo vio Ernesto al preguntar por qué no salía el texto marcado.
 *
 * Lo que hizo invisible el fallo: el enlace SEGUÍA FUNCIONANDO. Llevaba al apartado correcto;
 * solo faltaba el marcado, que es justo lo que no se echa de menos si no se sabe que existía.
 *
 * Qué fija esta prueba (estática: `cima-app.js` no se puede cargar en Node):
 *   1. `_destinoCima`: con frase → `_blank` + `noopener`; sin frase → la pestaña compartida.
 *   2. `_conEnlaceAlPasaje`, que crea el enlace por DOM y no pasa por `_destinoCima`, lo abre
 *      aislado.
 *   3. El nombre compartido solo se usa como destino DENTRO de `_destinoCima`. Si alguien lo
 *      vuelve a poner a mano en un enlace, este banco lo caza.
 *
 * Uso: node scripts/medcheck-test-destino-cima.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'assets/js/cima-app.js'), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0;
const check = (nombre, ok, detalle = '') => {
    if (ok) return;
    fallos++;
    console.error(`FALLO ${nombre}${detalle ? `: ${detalle}` : ''}`);
};

/** Cuerpo de un método de la clase: desde su firma hasta la llave que cierra a 4 espacios. */
const metodo = nombre => {
    const inicio = src.search(new RegExp(`\\n    ${nombre}\\([^)]*\\) \\{\\n`));
    if (inicio < 0) return null;
    const fin = src.indexOf('\n    }\n', inicio);
    return fin < 0 ? null : src.slice(inicio, fin + 6);
};

// 1. La regla, ejecutada de verdad sobre el código real.
const cuerpoDestino = metodo('_destinoCima');
check('existe _destinoCima', !!cuerpoDestino);
const nombreVentana = src.match(/const CIMA_VENTANA = '([^']+)';/)?.[1];
check('existe CIMA_VENTANA', !!nombreVentana);
if (cuerpoDestino && nombreVentana) {
    const retorno = cuerpoDestino.slice(cuerpoDestino.indexOf('{') + 1, cuerpoDestino.lastIndexOf('}'));
    const destino = new Function('CIMA_VENTANA', 'url', retorno);
    const conFrase = destino(nombreVentana, 'https://cima.aemps.es/cima/dochtml/ft/1/FT_1.html#4.4:~:text=Insuficiencia%20renal');
    const sinFrase = destino(nombreVentana, 'https://cima.aemps.es/cima/dochtml/ft/1/FT_1.html#4.4');
    check('con frase abre pestaña nueva', /target="_blank"/.test(conFrase), conFrase);
    check('con frase va con noopener', /rel="noopener"/.test(conFrase), conFrase);
    check('con frase NO usa la pestaña compartida', !conFrase.includes(nombreVentana), conFrase);
    check('sin frase reutiliza la pestaña compartida', sinFrase.includes(`target="${nombreVentana}"`), sinFrase);
    check('sin frase no lleva noopener (lo impediría)', !/noopener/.test(sinFrase), sinFrase);
    check('url ausente no rompe', /target=/.test(destino(nombreVentana, null)));
}

// 2. El enlace por pasaje, que se construye por DOM.
const cuerpoPasaje = metodo('_conEnlaceAlPasaje');
check('existe _conEnlaceAlPasaje', !!cuerpoPasaje);
if (cuerpoPasaje) {
    check('el pasaje abre pestaña nueva', /enlace\.target = '_blank';/.test(cuerpoPasaje));
    check('el pasaje va con noopener', /enlace\.rel = 'noopener';/.test(cuerpoPasaje));
    check('el pasaje no usa la pestaña compartida', !/CIMA_VENTANA/.test(cuerpoPasaje));
}

// 3. Nadie pone el nombre compartido a mano como destino.
const usosComoDestino = [...src.matchAll(/target="\$\{CIMA_VENTANA\}"/g)].map(m => m.index);
check('el nombre compartido solo aparece como destino dentro de _destinoCima',
    usosComoDestino.length === 1 && cuerpoDestino && src.indexOf(cuerpoDestino) < usosComoDestino[0]
        && usosComoDestino[0] < src.indexOf(cuerpoDestino) + cuerpoDestino.length,
    `${usosComoDestino.length} usos`);
check('ningún enlace asigna la pestaña compartida por DOM',
    !/\.target = CIMA_VENTANA/.test(src));
const llamadas = (src.match(/this\._destinoCima\(/g) || []).length;
check('los cuatro enlaces a apartados pasan por _destinoCima', llamadas >= 4, `${llamadas} llamadas`);

console.log(`Destino de enlaces a CIMA: ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
