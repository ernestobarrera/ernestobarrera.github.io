#!/usr/bin/env node
/**
 * MedCheck — índice de resolución a MedyNut (SENPE)
 *
 * MedyNut (medynut.com) es la base del Grupo de Farmacia en Nutrición Artificial de SENPE:
 * efectos de los fármacos sobre el estado nutricional (apetito, peso, gusto, xerostomía,
 * disfagia, mucositis, digestivo, micronutrientes). Es un recurso EXTERNO que se ENLAZA;
 * no se ingiere ni se reproduce su contenido clínico.
 *
 * ── Por qué hace falta un índice y no basta con construir la URL ──────────────────────
 * Los slugs NO son derivables del nombre. Medidos el 2026-08-26:
 *     ceftriaxona  -> /medicamentos/cefotaxima-copia
 *     cloxacilina  -> /medicamentos/amoxicilina-clavulanico-copia-8e00cb28-3460-4b59-...
 * Son restos de duplicar registros en su gestor. Calcular la URL enviaría al médico a la
 * ficha de OTRO fármaco, que es el peor fallo posible aquí.
 *
 * ── Por qué índice local y no consultar su API en vivo ────────────────────────────────
 * Su `search.json` no manda cabeceras CORS: el navegador no puede llamarlo desde GitHub
 * Pages. Y aunque pudiera, convertiría una ayuda opcional en dependencia viva de un
 * servidor ajeno pequeño, en cada apertura de ficha.
 *
 * ── Quién decide el emparejamiento: CIMA, no nosotros ─────────────────────────────────
 * El nombre de MedyNut se contrasta contra la MAESTRA OFICIAL de principios activos de la
 * AEMPS (`/maestras?maestra=1`) y solo se acepta la **igualdad exacta** tras normalizar.
 * Ni parecidos, ni distancias, ni "el primer resultado".
 *
 * Esto no es celo: el repo tiene su escarmiento. `ácido gadotérico` se emparejó con
 * `gadoteridol` por parecido, y son DOS medios de contraste distintos (Dotarem vs
 * ProHance). Y aquí un emparejamiento por parecido propondría cosas como
 * `Citrato sodio` -> `citrato erbio (169Er)`, que es un radiofármaco, o
 * `Insulina Glargina` -> `insulina regular`. Lo que no coincide exacto NO se publica.
 *
 * La clave del índice es el `baseEs` que produce el resolutor real del repo sobre el
 * nombre de CIMA — es decir, exactamente lo que la app buscará en tiempo de ejecución.
 * Así `LOSARTAN POTASICO` (CIMA) queda indexado bajo `losartan`, que es lo que
 * `_substanceIdentity` genera para un producto de losartán.
 *
 * ── Lo que NO se publica ──────────────────────────────────────────────────────────────
 * Ni una sola asociación fármaco→efecto suya, que es donde está su trabajo. El índice
 * lleva rutas de sustancias que la AEMPS reconoce, y nada más.
 *
 * Uso:
 *   node scripts/etl-medynut.mjs [--out <ruta>] [--dry]
 * Salida:
 *   exit 0 con el índice escrito y el informe de revisión por stdout;
 *   exit 1 si el catálogo remoto se desploma (centinela de cobertura).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'assets', 'data', 'medynut-index.json');

const MEDYNUT = 'https://www.medynut.com';
const RUTA = '/medicamentos/';
const CIMA = 'https://cima.aemps.es/cima/rest';
// Si el catálogo remoto cae por debajo de esto, algo ha cambiado en su web y NO se
// publica un índice mutilado: se falla. Medido el 2026-08-26: 895 fármacos.
const MINIMO_CATALOGO = 700;
const PAUSA_MS = 120;

const dormir = ms => new Promise(r => setTimeout(r, ms));

// ── Resolutor real del repo: NO se reimplementa ───────────────────────────────────────
// La clave del índice tiene que ser exactamente lo que la app buscará en tiempo de
// ejecución (`innDict.norm(componente.baseEs)`). Reimplementar esa normalización aquí
// sería crear dos verdades que divergen en silencio, así que se carga el fichero real.
const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sin red durante la carga')),
    JSON, Math, Date, String, Object, Array, Set, Map, RegExp, Promise,
    encodeURIComponent, setTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const dict = sandbox.window.innDict;
dict.map = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8')).map;
dict.loaded = true;

const norm = s => dict.norm(s);
/** Quita la anotación de uso que MedyNut añade entre paréntesis: "(Antiácido)", "(oral)". */
const sinParentesis = s => String(s || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

async function pedirJson(url, intentos = 3) {
    for (let i = 1; i <= intentos; i += 1) {
        try {
            const r = await fetch(url, { headers: { accept: 'application/json' } });
            if (r.ok) return await r.json();
            if (r.status === 204) return null;
            if (r.status < 500 && r.status !== 429) return null;
        } catch { /* red */ }
        if (i < intentos) await dormir(600 * i);
    }
    return undefined;   // undefined = no se pudo medir (distinto de "no hay")
}

/** Árbol ATC de MedyNut, embebido como props de su componente React en la portada. */
async function arbolAtc() {
    const r = await fetch(MEDYNUT + '/', { headers: { accept: 'text/html' } });
    if (!r.ok) throw new Error(`portada de MedyNut HTTP ${r.status}`);
    const html = await r.text();
    const m = html.match(/data-react-props="([^"]*)"/);
    if (!m) throw new Error('la portada ya no expone data-react-props: su web ha cambiado');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
    const props = JSON.parse(dec(m[1]));
    const nodos = [];
    (function baja(ns) {
        for (const n of ns || []) { nodos.push({ id: n.id, nombre: n.name }); baja(n.children); }
    })(props.classifications);
    if (!nodos.length) throw new Error('árbol ATC vacío');
    return nodos;
}

/** Catálogo completo recorriendo el árbol: es la única vía de enumeración que ofrecen. */
async function catalogoMedynut(nodos) {
    const porRuta = new Map();
    for (const n of nodos) {
        const j = await pedirJson(`${MEDYNUT}/medicamentos/classifications.json?id=${n.id}`);
        for (const d of (j?.drugs || [])) {
            if (typeof d.path !== 'string' || !d.path.startsWith(RUTA)) continue;
            const slug = d.path.slice(RUTA.length);
            if (!slug || slug.includes('/')) continue;
            if (!porRuta.has(slug)) porRuta.set(slug, { nombre: (d.name || '').trim(), slug });
        }
        await dormir(PAUSA_MS);
    }
    return [...porRuta.values()];
}

/** Maestra 1 de CIMA = principios activos. Se cachea por token: muchos nombres lo comparten. */
const cacheMaestra = new Map();
async function maestraPorToken(token) {
    if (cacheMaestra.has(token)) return cacheMaestra.get(token);
    const j = await pedirJson(`${CIMA}/maestras?maestra=1&nombre=${encodeURIComponent(token)}`);
    const res = j === undefined ? undefined : (j?.resultados || []);
    cacheMaestra.set(token, res);
    await dormir(PAUSA_MS);
    return res;
}

// ── Ejecución ─────────────────────────────────────────────────────────────────────────
const nodos = await arbolAtc();
console.error(`[medynut] árbol ATC: ${nodos.length} nodos`);
const cat = await catalogoMedynut(nodos);
console.error(`[medynut] catálogo MedyNut: ${cat.length} principios activos`);
if (cat.length < MINIMO_CATALOGO) {
    console.error(`[medynut] ABORTA: solo ${cat.length} fármacos (mínimo ${MINIMO_CATALOGO}). No se publica un índice mutilado.`);
    process.exit(1);
}

const indice = {};          // clave (baseEs normalizado) -> slug
const procedencia = {};     // clave -> nombre CIMA que la avaló (para el informe)
const revision = [];        // no coinciden exacto con la maestra: decisión humana
const colisiones = [];      // dos rutas para la misma clave: no se publica ninguna
let inconclusos = 0;

for (const d of cat) {
    const limpio = sinParentesis(d.nombre) || d.slug.replace(/-/g, ' ');
    const desdeSlug = sinParentesis(d.slug.replace(/-/g, ' '));
    // Token de consulta = el MÁS LARGO, no el primero. Con el primero, "Ácido fólico"
    // consultaba "acido" y CIMA devolvía los cien ácidos del vademécum sin el bueno.
    // La búsqueda de la maestra es por subcadena, así que cualquier token sirve y el
    // más largo es el más discriminante.
    const token = norm(limpio).split(' ').filter(t => t.length >= 4).sort((a, b) => b.length - a.length)[0];
    if (!token) { revision.push({ ...d, motivo: 'sin token utilizable' }); continue; }

    const maestra = await maestraPorToken(token);
    if (maestra === undefined) {
        // No se pudo medir. INCONCLUSO no es "no existe": no se acepta y no se descarta.
        inconclusos += 1;
        revision.push({ ...d, motivo: 'CIMA no respondió; inconcluso' });
        continue;
    }

    // Igualdad EXACTA contra la maestra oficial. La autoridad decide, no el parecido.
    // Única transformación admitida: invertir un nombre de DOS palabras. CIMA nombra
    // "FOLICO ACIDO" y MedyNut "Ácido fólico"; es una convención de orden, no una
    // conjetura semántica, y con dos tokens no puede llevar a otra sustancia.
    const invertir = s => { const p = norm(s).split(' '); return p.length === 2 ? `${p[1]} ${p[0]}` : null; };
    const objetivo = new Set([norm(limpio), norm(desdeSlug), invertir(limpio), invertir(desdeSlug)].filter(Boolean));
    const oficial = maestra.find(pa => objetivo.has(norm(pa.nombre)));
    if (!oficial) {
        revision.push({ ...d, motivo: 'sin igualdad exacta en la maestra de CIMA', vistos: maestra.slice(0, 3).map(p => p.nombre) });
        continue;
    }

    // La clave es lo que `_substanceIdentity` producirá en el navegador para ese PA.
    const clave = norm(dict.toSearchTerm(oficial.nombre, { allowCounterionTrim: true }).baseEs);
    if (!clave) { revision.push({ ...d, motivo: 'clave vacía tras resolver' }); continue; }

    if (indice[clave] && indice[clave] !== d.slug) {
        colisiones.push({ clave, a: indice[clave], b: d.slug });
        continue;
    }
    indice[clave] = d.slug;
    procedencia[clave] = oficial.nombre;
}

// Una colisión invalida la clave entera: publicar una de las dos rutas sería elegir al azar.
for (const c of colisiones) delete indice[c.clave];

const payload = {
    _meta: {
        source: 'medynut.com — Grupo de Farmacia en Nutricion Artificial (SENPE)',
        generated_at: new Date().toISOString().slice(0, 10),
        base_url: MEDYNUT + RUTA,
        avalado_por: 'AEMPS CIMA /maestras?maestra=1 (principios activos), igualdad exacta',
        catalogo_remoto: cat.length,
        aceptadas: Object.keys(indice).length,
        en_revision: revision.length,
        colisiones: colisiones.length,
        inconclusos,
        criterio: 'fail-closed: sin igualdad exacta contra la maestra de CIMA no se publica',
    },
    indice,
};

console.error('');
console.error(`[medynut] ACEPTADAS   ${Object.keys(indice).length}`);
console.error(`[medynut] REVISION    ${revision.length}   (no se publican)`);
console.error(`[medynut] COLISIONES  ${colisiones.length}   (clave retirada: dos rutas, elegir sería azar)`);
console.error(`[medynut] INCONCLUSOS ${inconclusos}   (CIMA no respondió; no se aprueban ni se descartan)`);
for (const c of colisiones) console.error(`    colisión "${c.clave}": /${c.a}  vs  /${c.b}`);

console.error('');
console.error('Muestra de candidatos a revisión humana:');
for (const r of revision.slice(0, 20)) {
    console.error(`  ${(r.nombre || r.slug).slice(0, 58).padEnd(58)} ${r.motivo}${r.vistos ? ` — CIMA vio: ${r.vistos.join(', ')}` : ''}`);
}
if (revision.length > 20) console.error(`  ... y ${revision.length - 20} más`);

if (DRY) {
    console.error('\n[medynut] --dry: no se escribe nada');
} else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(payload));
    console.error(`\n[medynut] escrito ${OUT}`);
}
