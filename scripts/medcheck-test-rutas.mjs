#!/usr/bin/env node
/**
 * MedCheck — guarda contra la salida escrita fuera del repo
 *
 * Origen (2026-08-26): `gen-materiales-catalog.mjs` escribía su salida en una ruta
 * ABSOLUTA a `C:\Users\ebarr\Documentos\GitHub\...`, el árbol paralelo. El catálogo de
 * materiales informativos se quedó en marzo sin que nada avisara.
 *
 * Lo que hace invisible a este fallo NO es la ruta: es que **el destino equivocado era
 * válido**. `Documentos\GitHub\...\assets\data\` existe de verdad, así que la escritura
 * tenía éxito, el script salía con 0 y hasta imprimía "Guardado". Un destino inexistente
 * habría fallado en la cara el primer día.
 *
 * De ahí la forma de esta prueba: no busca "la ruta mala", busca **cualquier ruta
 * absoluta de máquina** en los scripts del repo. La convención del repo ya era resolver
 * desde `import.meta.url` / `__dirname` o aceptar `--out`; esto la convierte en algo que
 * se comprueba en vez de algo que se recuerda.
 *
 * Uso: node scripts/medcheck-test-rutas.mjs
 * Salida: exit 0 si pasa; exit 1 con el fichero y la línea de cada ruta absoluta.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');
const EXT = /\.(mjs|js|py|ps1)$/;

// Rutas absolutas de máquina: unidad de Windows, forma MSYS (/c/Users/...) y home de
// usuario. No se veta `/tmp` ni `/dev/null`: son destinos efímeros, no árboles de trabajo.
const PATRONES = [
    { re: /[A-Za-z]:[\\/]Users[\\/]/, que: 'ruta absoluta de Windows' },
    { re: /\/c\/Users\//i, que: 'ruta absoluta en forma MSYS' },
    { re: /%USERPROFILE%/i, que: 'expansión de %USERPROFILE%' },
    { re: /Documentos[\\/]GitHub/i, que: 'referencia al árbol paralelo Documentos\\GitHub' },
];

function ficheros(dir) {
    const out = [];
    for (const e of readdirSync(dir)) {
        if (e === 'node_modules' || e === '.cache' || e === '__pycache__') continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) out.push(...ficheros(p));
        else if (EXT.test(e)) out.push(p);
    }
    return out;
}

// Esta prueba se excluye a sí misma: su tabla de patrones contiene, por fuerza, las
// mismas cadenas que persigue.
const YO = fileURLToPath(import.meta.url);

let fallos = 0;
for (const f of ficheros(SCRIPTS)) {
    if (f === YO) continue;
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
        // Los comentarios pueden citar la ruta mala para explicar el fallo: eso es
        // documentación, no un destino. Solo cuenta el código.
        const codigo = linea.replace(/^\s*(\/\/|#|\*).*$/, '');
        for (const { re, que } of PATRONES) {
            if (re.test(codigo)) {
                console.error(`✗ ${rel}:${i + 1} — ${que}`);
                console.error(`    ${linea.trim().slice(0, 110)}`);
                fallos += 1;
            }
        }
    });
}

if (fallos === 0) {
    console.log('TODO OK — ningún script escribe ni lee por ruta absoluta de máquina.');
    console.log('La salida se resuelve desde el propio script o por --out.');
}
console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
