#!/usr/bin/env node
/**
 * MedCheck — auditoría de COBERTURA, PRECISIÓN y DENSIDAD de los resaltados de 4.5 y 4.8 contra
 * fichas reales de CIMA (piloto del 26/11/2026; informe `2026-11-26_resaltados-secciones.md`).
 *
 * Hermana de `medcheck-audit-resaltado-posologia.mjs`, con dos cambios de método:
 *   - la muestra se estratifica por grupo ATC1 (14) y, dentro, por familia galénica en turno, con
 *     UN producto por ATC5: los genéricos repiten el mismo texto e inflarían cualquier frecuencia;
 *   - el HTML se parte en nodos de texto como lo hace el navegador, y se pasa por el MISMO plan
 *     que la app (`_planResaltado`, con sus umbrales): lo que se mide es lo que vería el médico.
 *
 * Informa, para revisión HUMANA:
 *   - ESTADO por sección: cuántas quedan resaltadas, cuántas cortas (< mínimo, sin colores) y
 *     cuántas densas (> umbral, sin colores), y la densidad de las resaltadas (mediana · p90 · máx).
 *   - PRECISIÓN: todo lo resaltado, por texto, con su recuento y la primera frase en que salió.
 *   - COBERTURA: frases con vocabulario amplio (recomienda, precaución, evitar, frecuente, rara…)
 *     que se quedan sin resaltar. Son candidatas, no fallos.
 *
 * No tiene invariantes: decidir qué es una recomendación es criterio humano. Sale con 0 si completa
 * la muestra y 2 (INCONCLUSO) si CIMA no responde o el catálogo llega incompleto.
 *
 * Uso (necesita red):
 *   node scripts/medcheck-audit-resaltado-secciones.mjs
 *   node scripts/medcheck-audit-resaltado-secciones.mjs --por-atc=16 --salida=informe.md
 */
import { fuenteApp } from './lib/cargar-app.mjs';
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
const POR_ATC = Number(args['por-atc'] || 16);

class AuditoriaInconclusa extends Error {}
const pausa = ms => new Promise(r => setTimeout(r, ms));

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
vm.runInContext(`${fuenteApp(ROOT)}\n;window.__App = MedCheckApp;`, sandbox);
const App = sandbox.window.__App;
const app = Object.create(App.prototype);

const SECCIONES = {
    '4.5': { categorias: () => App.RESALTADOS_45, amplio: /\b(recomiend\w*|recomienda\w*|precauci\w+|evit\w+|contraindic\w+|ajust\w+|vigil\w+|monitoriz\w+|control\w*|estudiad\w*|realizado\w*)\b/gi },
    '4.8': { categorias: () => App.RESALTADOS_48, amplio: /(?<![a-záéíóúñ])(frecuentes?|frecuencia|raras?|raros?|no\s+conocida|desconocida)(?![a-záéíóúñ])/gi },
};

const entidades = t => t
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** Nodos de texto del HTML, como los recorrería el TreeWalker de la app (los vacíos fuera). */
const nodosDeTexto = html => String(html || '').split(/<[^>]+>/).map(t => entidades(t).normalize('NFC')).filter(t => t.trim());

async function pedir(url) {
    for (let intento = 1; intento <= 3; intento++) {
        try {
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            if (r.status === 204) return null;
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
    if (existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < CACHE_MAX_MS) return JSON.parse(readFileSync(CACHE, 'utf8'));
    const out = [];
    let total = null;
    for (let pagina = 1; ; pagina++) {
        if (pagina > MAX_PAGINAS) throw new AuditoriaInconclusa(`tope de ${MAX_PAGINAS} páginas alcanzado`);
        const d = await pedir(`${CIMA}/medicamentos?comerc=1&pagina=${pagina}`);
        total = d.totalFilas ?? total;
        for (const m of d.resultados || []) out.push({ nregistro: m.nregistro, nombre: m.nombre, formaFarmaceuticaSimplificada: m.formaFarmaceuticaSimplificada || null });
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

/** Muestra estratificada: por ATC1, familias galénicas en turno, un producto por ATC5. Determinista. */
function muestra(meds, atcDe) {
    const porAtc1 = new Map();
    for (const m of meds) {
        const atc = atcDe[m.nregistro];
        if (!atc || atc.length < 7) continue;
        const fam = app._galenicFamily(m).id;
        if (!porAtc1.has(atc[0])) porAtc1.set(atc[0], new Map());
        const fams = porAtc1.get(atc[0]);
        if (!fams.has(fam)) fams.set(fam, []);
        fams.get(fam).push({ ...m, atc });
    }
    const out = [];
    for (const [, fams] of [...porAtc1].sort()) {
        const colas = [...fams].sort((a, b) => b[1].length - a[1].length).map(([, l]) => {
            const s = [...l].sort((a, b) => String(a.nregistro).localeCompare(String(b.nregistro)));
            const paso = Math.max(1, Math.floor(s.length / POR_ATC));
            return s.filter((_, i) => i % paso === 0);
        });
        const vistos = new Set();
        const elegidos = [];
        for (let vuelta = 0; elegidos.length < POR_ATC && colas.some(c => c.length > vuelta); vuelta++) {
            for (const c of colas) {
                const m = c[vuelta];
                if (m && !vistos.has(m.atc) && elegidos.length < POR_ATC) { vistos.add(m.atc); elegidos.push(m); }
            }
        }
        out.push(...elegidos);
    }
    return out;
}

const cuantil = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const celda = t => String(t).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const corta = (t, n = 200) => (t.length > n ? `${t.slice(0, n)}…` : t);

async function main() {
    const meds = await catalogo();
    const atcDe = JSON.parse(readFileSync(join(ROOT, 'assets', 'data', 'atc-index.json'), 'utf8')).atc;
    const lista = muestra(meds, atcDe);
    const umbral = App.UMBRAL_RESALTADO;
    const informe = [
        '# Resaltados de 4.5 y 4.8: cobertura, precisión y densidad', '',
        `Muestra: ${lista.length} productos (${POR_ATC} por grupo ATC1, uno por ATC5) del catálogo de comercializados (${meds.length}).`,
        `Umbrales de la app: mínimo ${umbral.minCaracteres} caracteres, máximo ${Math.round(umbral.maxFraccion * 100)} % coloreado.`,
        `Generado: ${new Date().toISOString()}`, '',
    ];
    for (const [seccion, def] of Object.entries(SECCIONES)) {
        const categorias = def.categorias();
        const estados = { aplicar: 0, corta: 0, densa: 0, sin: 0 };
        const densidades = [];
        const resaltados = new Map();
        const sueltas = new Map();
        let n = 0;
        for (const m of lista) {
            n++;
            process.stderr.write(`\r${seccion}: ${n}/${lista.length}`);
            const d = await pedir(`${CIMA}/docSegmentado/contenido/1?nregistro=${m.nregistro}&seccion=${seccion}`);
            await pausa(PAUSA_MS);
            const html = (Array.isArray(d) ? d : [d]).map(x => x?.contenido || '').join('\n');
            const textos = nodosDeTexto(html);
            if (textos.join('').replace(/\s+/g, '').length < 40) { estados.sin++; continue; }
            const plan = app._planResaltado(textos, categorias);
            estados[plan.estado]++;
            if (plan.estado !== 'aplicar') continue;
            densidades.push(100 * plan.marcado / plan.total);
            textos.forEach((t, i) => {
                const segs = plan.segmentos[i] || [{ texto: t, clase: null }];
                for (const s of segs.filter(x => x.clase)) {
                    const k = `${s.clase} · ${s.texto.toLowerCase().replace(/\s+/g, ' ').trim()}`;
                    const previo = resaltados.get(k);
                    resaltados.set(k, previo ? { ...previo, n: previo.n + 1 } : { n: 1, ejemplo: corta(t), ficha: m.nregistro });
                }
                for (const s of segs.filter(x => !x.clase)) {
                    for (const x of s.texto.matchAll(def.amplio)) {
                        const k = x[0].toLowerCase().replace(/\s+/g, ' ');
                        const previo = sueltas.get(k);
                        sueltas.set(k, previo ? { ...previo, n: previo.n + 1 } : { n: 1, ejemplo: corta(t), ficha: m.nregistro });
                    }
                }
            });
        }
        process.stderr.write('\n');
        const top = (mapa, k) => [...mapa].sort((a, b) => b[1].n - a[1].n).slice(0, k).map(([t, v]) => `| ${celda(t)} | ${v.n} | ${celda(v.ejemplo)} (${v.ficha}) |`);
        informe.push(`## ${seccion}`, '',
            `Resaltadas: ${estados.aplicar} · cortas (sin colores): ${estados.corta} · densas (sin colores): ${estados.densa} · sin sección en CIMA: ${estados.sin}.`,
            `Densidad de las resaltadas: mediana ${cuantil(densidades, 0.5).toFixed(1)} % · p90 ${cuantil(densidades, 0.9).toFixed(1)} % · máx ${(densidades.length ? Math.max(...densidades) : 0).toFixed(1)} %.`, '',
            '### Lo resaltado (precisión)', '', '| Categoría · texto | Veces | Primer nodo (ficha) |', '|---|---|---|', ...top(resaltados, 80), '',
            '### Vocabulario amplio sin resaltar (cobertura)', '',
            'Candidatas, no fallos: muchas son prosa legítima («las reacciones más frecuentes», «control glucémico»).', '',
            '| Palabra | Veces | Primer nodo (ficha) |', '|---|---|---|', ...top(sueltas, 40), '');
    }
    const salida = informe.join('\n');
    if (args.salida) { writeFileSync(args.salida, salida); console.log(`Informe escrito en ${args.salida}.`); } else console.log(salida);
}

main().then(() => process.exit(0)).catch(e => {
    if (e instanceof AuditoriaInconclusa) { console.error(`INCONCLUSO: ${e.message}`); process.exit(2); }
    console.error(e);
    process.exit(1);
});
