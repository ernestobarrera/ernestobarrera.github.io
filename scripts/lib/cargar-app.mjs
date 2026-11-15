/**
 * Cargador único del código de la app para los bancos de pruebas (B3 de la revisión del 14/11/2026).
 *
 * 49 bancos leían `assets/js/cima-app.js` por su ruta, y eso era lo que impedía partir el fichero:
 * mover un método a otro rompía decenas de bancos sin que cambiara el comportamiento. Ahora lo
 * leen por aquí, y el fuente de la app es lo que `medcheck.html` declara: los `<script>` de
 * `assets/js/cima-app*.js`, en su orden, concatenados. Con un solo fichero (hoy) el resultado es
 * idéntico byte a byte al de antes; el día que se parta, los bancos no se enteran.
 *
 * `cima-api.js` e `inn-dict.js` NO entran: son otros módulos y los bancos que los necesitan los
 * cargan aparte, como siempre.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Rutas (relativas a la raíz) de los ficheros de la app, en el orden en que los carga la página. */
export function ficherosApp(raiz) {
  const html = join(raiz, 'medcheck.html');
  const declarados = existsSync(html)
    ? [...readFileSync(html, 'utf8').matchAll(/<script[^>]*\ssrc="(assets\/js\/cima-app[^"?]*\.js)(?:\?[^"]*)?"/g)].map(m => m[1])
    : [];
  const rutas = declarados.length ? declarados : ['assets/js/cima-app.js'];
  for (const r of rutas) {
    if (!existsSync(join(raiz, r))) throw new Error(`cargar-app: medcheck.html declara ${r} y no existe`);
  }
  return rutas;
}

/** Fuente completo de la app (UTF-8), listo para `vm.runInContext` o para buscar en él. */
export function fuenteApp(raiz) {
  return ficherosApp(raiz).map(r => readFileSync(join(raiz, r), 'utf8')).join('\n');
}
