#!/usr/bin/env node
/**
 * MedCheck — bump de versiones de caché (?v=YYYYMMDDx)
 *
 * Sustituye la edición manual de los cache-bust, que ha causado despistes
 * (recurso desplegado sin subir el ?v= o viceversa). Un solo comando bumpa
 * todas las referencias del recurso a la fecha de hoy con letra correlativa.
 *
 * Uso:
 *   node scripts/medcheck-bump-version.mjs              → muestra versiones actuales
 *   node scripts/medcheck-bump-version.mjs app css      → bumpa cima-app.js y cima-app.css
 *   node scripts/medcheck-bump-version.mjs all --dry    → simula el bump de todo
 *   … --sin-red                                         → no consulta origin/main (ver abajo)
 *
 * SESIONES PARALELAS (2026-10-21). La letra siguiente se calcula sobre la MAYOR entre la versión
 * local y la de `origin/main` (tras un `git fetch`). Antes solo miraba la local: el 20/10 dos ramas
 * que partían de la misma `a` subieron las dos a `c`, el rebase entró limpio porque la línea era
 * idéntica, y quien tuviera la `c` en caché no habría recibido la segunda. Bumpa AL FINAL, tras
 * rebasar sobre main, y comprueba con `node scripts/medcheck-prepublicar.mjs` antes del push.
 *
 * Objetivos: app · api · css · dict · ontology · innjson · packs · all
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// target → { file: dónde vive la referencia, pattern: qué referencia }
export const TARGETS = {
    app:      { file: 'medcheck.html',          pattern: /(assets\/js\/cima-app\.js\?v=)(\d{8}[a-z]?)/g },
    api:      { file: 'medcheck.html',          pattern: /(assets\/js\/cima-api\.js\?v=)(\d{8}[a-z]?)/g },
    css:      { file: 'medcheck.html',          pattern: /(assets\/css\/cima-app\.css\?v=)(\d{8}[a-z]?)/g },
    dict:     { file: 'medcheck.html',          pattern: /(assets\/js\/inn-dict\.js\?v=)(\d{8}[a-z]?)/g },
    ontology: { file: 'assets/js/cima-api.js',  pattern: /(clinical-ontology\.json\?v=)(\d{8}[a-z]?)/g },
    innjson:  { file: 'assets/js/inn-dict.js',  pattern: /(inn-es-en\.json\?v=)(\d{8}[a-z]?)/g },
    packs:    { file: 'assets/js/cima-app.js',  pattern: /(packs-index\.json\?v=)(\d{8}[a-z]?)/g },
    medynut:  { file: 'assets/js/cima-app.js',  pattern: /(medynut-index\.json\?v=)(\d{8}[a-z]?)/g },
    financiacion: { file: 'assets/js/cima-app.js', pattern: /(financiacion-index\.json\?v=)(\d{8}[a-z]?)/g },
    // El service worker no lleva `?v=`: lleva su propia VERSION, que nombra el caché. Subir el
    // `?v=` arregla la actualización ONLINE; subir esta VERSION arregla la OFFLINE, porque el
    // fallback usa `ignoreSearch: true` y devuelve la primera entrada insertada, que es la ANTIGUA
    // (ver la nota larga en sw.js). Faltaba en esta tabla, y por eso derivó 21 commits sin subir:
    // el script que existe para que no se olvide un bump no cubría el bump que sw.js llama
    // "ni opcional ni cosmético". Hallado el 2026-09-05.
    sw:       { file: 'sw.js',                  pattern: /(const VERSION = ')(\d{8}[a-z]?)/g },
};

// Dependencias de cache-bust: bumpar el objetivo de la izquierda obliga a bumpar el de la
// derecha. El `?v=` de packs-index.json vive DENTRO de cima-app.js, así que renovar solo
// `packs` no llega al navegador: seguiría sirviendo el cima-app.js cacheado, con la URL
// antigua del JSON. Misma cadena que ontology→api e innjson→dict.
export const IMPLICA = { packs: 'app', medynut: 'app', financiacion: 'app', ontology: 'api', innjson: 'dict' };

/** Compara dos versiones `YYYYMMDD[x]`. Sin letra cuenta como anterior a la `a`. */
export function compararVersion(a, b) {
    // El carácter anterior a la «a» en ASCII es el acento grave (96).
    const norm = v => (v && v.length === 8 ? v + String.fromCharCode(96) : String(v || ''));
    return norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0;
}

/**
 * Siguiente versión para `hoy`, por encima de la local Y de la publicada en origin/main: así dos
 * ramas paralelas no eligen la misma letra.
 */
export function siguienteVersion(local, remota, hoy) {
    const base = remota && compararVersion(remota, local) > 0 ? remota : local;
    if (!base?.startsWith(hoy)) return `${hoy}a`;
    const letra = base.slice(8) || 'a';
    return `${hoy}${String.fromCharCode(letra.charCodeAt(0) + 1)}`;
}

/** Versión de un objetivo dentro de un texto (el fichero local o el de otra revisión). */
export function versionEn(src, target) {
    const m = new RegExp(target.pattern.source).exec(src || '');
    return m ? m[2] : null;
}

/** Contenido de un fichero en una revisión de git, o null si no se puede leer. */
export function ficheroEnRevision(rev, file) {
    try {
        return execFileSync('git', ['show', `${rev}:${file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
}

function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const dry = process.argv.includes('--dry');
    const sinRed = process.argv.includes('--sin-red');
    const pedidos = args.includes('all') ? Object.keys(TARGETS) : args;
    const conDependencias = [...new Set(pedidos.flatMap(k => (IMPLICA[k] ? [k, IMPLICA[k]] : [k])))];
    // `sw` lo arrastra CUALQUIER bump, no un objetivo concreto: la VERSION del service worker nombra
    // el caché entero, así que renovar un solo recurso versionado ya obliga a renovarla. Va aparte de
    // IMPLICA (que es 1:1) justamente porque no depende de cuál se bumpe, sino de que se bumpe algo.
    const keys = conDependencias.some(k => k !== 'sw') && !conDependencias.includes('sw')
        ? [...conDependencias, 'sw']
        : conDependencias;
    const arrastrados = keys.filter(k => !pedidos.includes(k));
    if (arrastrados.length) {
        console.log(`Se añaden por dependencia de caché: ${arrastrados.join(', ')}\n`);
    }

    // Fecha local (no UTC): de madrugada en Madrid, toISOString() daría el día anterior.
    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    const currentVersion = target => versionEn(readFileSync(join(ROOT, target.file), 'utf8'), target);

    // Lo publicado: origin/main recién traído. Sin red o sin remoto se avisa y se sigue con lo local.
    let remotoOk = false;
    if (!sinRed && keys.length) {
        try {
            execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: ROOT, stdio: 'ignore' });
            remotoOk = true;
        } catch {
            console.log('⚠ No se pudo traer origin/main: la letra se calcula solo con la versión local.\n');
        }
    }
    const remoteVersion = target => (remotoOk ? versionEn(ficheroEnRevision('origin/main', target.file), target) : null);

    if (keys.length === 0) {
        console.log('Versiones actuales:');
        for (const [name, target] of Object.entries(TARGETS)) {
            console.log(`  ${name.padEnd(9)} ${(currentVersion(target) || '—').padEnd(10)} (${target.file})`);
        }
        console.log('\nUso: node scripts/medcheck-bump-version.mjs <target...|all> [--dry] [--sin-red]');
        process.exit(0);
    }

    const invalid = keys.filter(k => !TARGETS[k]);
    if (invalid.length) {
        console.error(`Objetivo desconocido: ${invalid.join(', ')}. Válidos: ${Object.keys(TARGETS).join(' · ')} · all`);
        process.exit(1);
    }

    for (const key of keys) {
        const target = TARGETS[key];
        const path = join(ROOT, target.file);
        const src = readFileSync(path, 'utf8');
        const cur = currentVersion(target);
        if (!cur) {
            console.error(`✗ ${key}: no se encontró la referencia en ${target.file}`);
            process.exitCode = 1;
            continue;
        }
        const remota = remoteVersion(target);
        const next = siguienteVersion(cur, remota, today);
        const out = src.replace(target.pattern, `$1${next}`);
        if (!dry) writeFileSync(path, out);
        const nota = remota && compararVersion(remota, cur) > 0 ? ` · main ya iba por ${remota}` : '';
        console.log(`${dry ? '[dry] ' : ''}✓ ${key}: ${cur} → ${next} (${target.file})${nota}`);
    }
    if (!dry) console.log('\nRecuerda: commit + push para que el bump llegue a producción.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
