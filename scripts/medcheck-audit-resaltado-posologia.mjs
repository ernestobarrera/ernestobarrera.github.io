#!/usr/bin/env node
/**
 * MedCheck — auditoría de COBERTURA de los resaltados de Posología contra fichas reales de CIMA.
 *
 * Complementa a `medcheck-test-resaltado-posologia.mjs`: ese fija casos concretos; este mira
 * qué se queda SIN resaltar en una muestra de fichas de todas las formas farmacéuticas. Existe
 * porque el vocabulario de Manipulación se escribió mirando 12 fichas orales del fixture, y la
 * primera ficha inyectable que abrió Ernesto (DYNASTAT, 2026-10-04) no tenía un solo resaltado
 * en un apartado entero sobre reconstituir, mezclar y precipitar. Un banco con casos elegidos
 * no puede ver lo que nadie eligió.
 *
 * Qué hace:
 *   1. Descarga el catálogo de comercializados (o lo lee de .cache/, caduca en un día).
 *   2. Agrupa por familia galénica con el mismo mapa que la app (`GALENIC_FAMILIES`) y toma,
 *      de cada familia, `--por-familia` productos repartidos a lo largo del catálogo.
 *   3. Pide la 4.2 de cada uno y aplica `RESALTADOS_POSOLOGIA` tal cual los ve el médico.
 *   4. Informa de dos cosas, para revisión HUMANA:
 *      - COBERTURA: frases con vocabulario amplio de manipulación (preparar, mezclar, cargar,
 *        purgar, aplicar…) que no llevan ningún resaltado de Manipulación. Son candidatas, no
 *        fallos: muchas serán posología legítima. Las raíces más repetidas dicen qué falta.
 *      - PRECISIÓN: todo lo que SÍ se resaltó como Manipulación, con su recuento, para ver
 *        falsos positivos de un vistazo.
 *
 * No tiene invariantes: no falla por lo que encuentra, porque decidir qué es manipulación es
 * criterio clínico. Sale con 0 si completa la muestra y 2 (INCONCLUSO) si CIMA no responde o el
 * catálogo llega incompleto: unas cifras sobre media muestra describirían otra cosa.
 *
 * Uso (necesita red; desde el entorno de Claude en la nube no hay acceso a CIMA):
 *   node scripts/medcheck-audit-resaltado-posologia.mjs
 *   node scripts/medcheck-audit-resaltado-posologia.mjs --por-familia=12 --salida=informe.md
 *   node scripts/medcheck-audit-resaltado-posologia.mjs --familia=inyectable --por-familia=30
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CIMA = 'https://cima.aemps.es/cima/rest';
const CACHE = join(ROOT, '.cache', 'cima-comercializados-formas.json');
const CACHE_MAX_MS = 24 * 3600 * 1000;
const MAX_PAGINAS = 200;
const PAUSA_MS = 150;

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const POR_FAMILIA = Number(args['por-familia'] || 8);
const SOLO_FAMILIA = args.familia || null;

class AuditoriaInconclusa extends Error {}
const pausa = ms => new Promise(r => setTimeout(r, ms));

// --- El módulo real, en un sandbox: los mismos patrones y el mismo mapa galénico que la app ----
const sandbox = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en el sandbox')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__App = MedCheckApp;`, sandbox);
const App = sandbox.window.__App;
const app = Object.create(App.prototype);

// Vocabulario AMPLIO para buscar huecos: a propósito mucho más ancho que el de la app. Lo que
// aparezca aquí sin resaltar es una pregunta para una persona, no un error.
const RAICES = /\b(reconstitu\w*|dilu\w*|mezcl\w*|compatib\w*|incompatib\w*|precipit\w*|agit\w*|cort\w*|tritur\w*|mastic\w*|parti[rd]\w*|divid\w*|abr[ie]\w*|disol\w*|disuel\w*|dispers\w*|sondas?|trag\w*|deglu\w*|espolvore\w*|ranur\w*|fraccion\w*|romp\w*|machac\w*|aplast\w*|enter[oa]s|vaci\w*|carg\w*|purg\w*|ceb\w*|jeringa\w*|aguja\w*|pluma\w*|cartucho\w*|vial\w*|ampolla\w*|perfus\w*|infus\w*|filtr\w*|calent\w*|templ\w*|lav\w*|aplic\w*|frot\w*|extend\w*|masaj\w*|inhal\w*|nebuliz\w*|c[áa]mara\w*|pulveriz\w*|gotas?|gotero\w*|cuchar\w*|vaso\w*|zumo\w*|yogur\w*|compota\w*|alimentos?\s+blandos?)\b/gi;

function decodificar(html) {
    return String(html || '')
        .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/[ \t ]+/g, ' ');
}

async function pedir(url) {
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            if (r.ok) return r.json();
            if (r.status !== 429 && r.status < 500) throw new AuditoriaInconclusa(`HTTP ${r.status} en ${url}`);
        } catch (e) {
            if (e instanceof AuditoriaInconclusa) throw e;
            if (intento === 3) throw new AuditoriaInconclusa(`sin respuesta de CIMA (${e.message}) en ${url}`);
        }
        await pausa(1000 * intento);
    }
    throw new AuditoriaInconclusa(`CIMA no respondió tras 3 intentos: ${url}`);
}

async function catalogo() {
    if (existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < CACHE_MAX_MS) {
        return JSON.parse(readFileSync(CACHE, 'utf8'));
    }
    const out = [];
    let total = null;
    for (let pagina = 1; ; pagina++) {
        if (pagina > MAX_PAGINAS) throw new AuditoriaInconclusa(`tope de ${MAX_PAGINAS} páginas alcanzado`);
        const d = await pedir(`${CIMA}/medicamentos?comerc=1&pagina=${pagina}`);
        total = d.totalFilas ?? total;
        for (const m of d.resultados || []) {
            out.push({ nregistro: m.nregistro, nombre: m.nombre, formaFarmaceuticaSimplificada: m.formaFarmaceuticaSimplificada || null });
        }
        process.stderr.write(`\rcatálogo: ${out.length}/${total ?? '?'}`);
        if (!d.resultados?.length || (total && out.length >= total)) break;
        await pausa(PAUSA_MS);
    }
    process.stderr.write('\n');
    if (total === null || out.length !== total) throw new AuditoriaInconclusa(`catálogo incompleto: ${out.length} de ${total ?? '?'}`);
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(out));
    return out;
}

/** `n` elementos repartidos a lo largo de la lista ordenada: determinista y sin agruparse al principio. */
function repartidos(lista, n) {
    if (lista.length <= n) return lista;
    const paso = lista.length / n;
    return Array.from({ length: n }, (_, i) => lista[Math.floor(i * paso)]);
}

async function main() {
    const meds = await catalogo();
    const porFamilia = new Map();
    for (const m of meds) {
        const f = app._galenicFamily(m).id;
        if (SOLO_FAMILIA && f !== SOLO_FAMILIA) continue;
        if (!porFamilia.has(f)) porFamilia.set(f, []);
        porFamilia.get(f).push(m);
    }
    const categorias = App.RESALTADOS_POSOLOGIA;
    const informe = [];
    const raicesSinResaltar = new Map();
    const resaltadosManip = new Map();
    let fichas = 0, sin42 = 0;

    informe.push(`# Cobertura de los resaltados de Posología`, '',
        `Muestra: ${POR_FAMILIA} productos por familia galénica, repartidos por el catálogo de comercializados (${meds.length}).`,
        `Generado: ${new Date().toISOString()}`, '');

    for (const [familia, lista] of [...porFamilia].sort()) {
        const muestra = repartidos([...lista].sort((a, b) => String(a.nregistro).localeCompare(String(b.nregistro))), POR_FAMILIA);
        informe.push(`## ${App.GALENIC_FAMILIES.families[familia]?.label || familia} (${lista.length} en catálogo)`, '');
        for (const m of muestra) {
            const datos = await pedir(`${CIMA}/docSegmentado/contenido/1?nregistro=${m.nregistro}&seccion=4.2`);
            await pausa(PAUSA_MS);
            const texto = decodificar((Array.isArray(datos) ? datos : [datos]).map(x => x?.contenido || '').join('\n'));
            if (texto.replace(/\s+/g, '').length < 40) { sin42 += 1; continue; }
            fichas += 1;
            const lineas = [];
            for (const frase of texto.split(/\n+|(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/).map(f => f.trim()).filter(Boolean)) {
                const segs = app._segmentarResaltados(frase, categorias);
                segs.filter(s => s.clase === 'posology-manip').forEach(s => {
                    const k = s.texto.toLowerCase();
                    resaltadosManip.set(k, (resaltadosManip.get(k) || 0) + 1);
                });
                // Raíces amplias que caen fuera de cualquier resaltado de Manipulación o Unidades.
                const sueltas = segs.filter(s => s.clase !== 'posology-manip' && s.clase !== 'posology-unit')
                    .flatMap(s => [...s.texto.matchAll(RAICES)].map(x => x[0].toLowerCase()));
                if (!sueltas.length) continue;
                sueltas.forEach(r => raicesSinResaltar.set(r, (raicesSinResaltar.get(r) || 0) + 1));
                lineas.push(`  - _${[...new Set(sueltas)].join(', ')}_ — ${frase.length > 240 ? `${frase.slice(0, 240)}…` : frase}`);
            }
            const marcas = texto ? app._segmentarResaltados(texto, categorias).filter(s => s.clase === 'posology-manip').length : 0;
            informe.push(`- **${m.nombre}** (${m.nregistro}) · ${m.formaFarmaceuticaSimplificada?.nombre || '?'} · ${marcas} resaltado(s) de Manipulación${lineas.length ? '' : ' · sin candidatas'}`);
            informe.push(...lineas);
        }
        informe.push('');
    }

    const top = (mapa, n) => [...mapa].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `| ${k} | ${v} |`);
    informe.push('## Raíces amplias sin resaltar (las más repetidas)', '',
        'Qué vocabulario aparece en la 4.2 sin ningún resaltado de Manipulación. Muchas son posología legítima (aplicar, inyectar, vial); las que describan preparar o alterar la forma farmacéutica son candidatas a entrar en `RESALTADOS_POSOLOGIA`.', '',
        '| Raíz | Veces |', '|---|---|', ...top(raicesSinResaltar, 60), '');
    informe.push('## Lo que sí se resaltó como Manipulación', '',
        'Para buscar falsos positivos: todo debería describir manipular la forma farmacéutica.', '',
        '| Texto resaltado | Veces |', '|---|---|', ...top(resaltadosManip, 80), '');
    informe.push(`Fichas con 4.2 analizadas: ${fichas}. Sin 4.2 segmentada en CIMA: ${sin42}.`);

    const salida = informe.join('\n');
    if (args.salida) {
        writeFileSync(args.salida, salida);
        console.log(`Informe escrito en ${args.salida} (${fichas} fichas).`);
    } else {
        console.log(salida);
    }
}

main().then(() => process.exit(0)).catch(e => {
    if (e instanceof AuditoriaInconclusa) {
        console.error(`INCONCLUSO: ${e.message}`);
        process.exit(2);
    }
    console.error(e);
    process.exit(1);
});
