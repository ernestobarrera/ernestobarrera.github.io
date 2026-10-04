#!/usr/bin/env node
/**
 * MedCheck — auditoría de los resaltados del apartado 5.1 (Evidencia) contra fichas REALES de CIMA.
 *
 * Complementa a `medcheck-test-resultados-51.mjs`: aquel fija frases sintéticas; este mira qué
 * pasa con la 5.1 de verdad, en una muestra elegida por DISEÑO de estudio y no por forma
 * galénica, porque lo que cambia la manera de expresar un resultado es el diseño: tiempo hasta el
 * evento (HR, medianas, Kaplan-Meier), variables continuas (diferencias de medias, cambio
 * respecto al basal), tasas de eventos (por paciente y año, razón de tasas), resultados binarios
 * y vacunas (proporciones, OR, eficacia vacunal) y fármacos antiguos con una 5.1 casi solo
 * farmacodinámica. No reutiliza el auditor de Posología: aquel muestrea por familia galénica y
 * busca vocabulario de manipulación, que aquí no sirve.
 *
 * Informa, para revisión HUMANA:
 *   - PRECISIÓN: todo lo resaltado, por familia, con su recuento y la primera frase donde
 *     aparece, para ver de un vistazo lo que se marca mal.
 *   - COBERTURA: frases con vocabulario estadístico amplio que no llevan ningún resaltado. Son
 *     candidatas, no fallos: muchas serán texto que no expresa ninguna medida.
 *   - LÍMITE DEL MOTOR: expresiones que se reconocen en el texto plano de la ficha pero no en el
 *     navegador, porque allí se resalta por nodo de texto y la ficha las parte entre etiquetas.
 *
 * Una sola invariante, porque es la única que no es criterio clínico: los segmentos concatenados
 * tienen que reproducir el texto (si no, exit 1). Sale con 2 (INCONCLUSO) si CIMA no responde: unas
 * cifras sobre media muestra describirían otra cosa.
 *
 * Uso (necesita red; desde el entorno de Claude en la nube no hay acceso a CIMA):
 *   node scripts/medcheck-audit-resaltado-51.mjs
 *   node scripts/medcheck-audit-resaltado-51.mjs --salida=informe-51.md
 *   node scripts/medcheck-audit-resaltado-51.mjs --principios=apixaban,semaglutida
 *   node scripts/medcheck-audit-resaltado-51.mjs --nregistros=65981,77073
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CIMA = 'https://cima.aemps.es/cima/rest';
const PAUSA_MS = 150;

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));

// Muestra por diseño de estudio. Son principios activos, no fichas: se toma el primer
// comercializado con ficha segmentada. Ampliable con --principios.
const MUESTRA = {
    'Tiempo hasta el evento (HR, medianas, Kaplan-Meier)': ['apixaban', 'rivaroxaban', 'dabigatran', 'ticagrelor', 'empagliflozina', 'dapagliflozina', 'sacubitrilo', 'pembrolizumab', 'osimertinib', 'palbociclib', 'enzalutamida'],
    'Variables continuas (diferencias de medias, cambio respecto al basal)': ['semaglutida', 'sitagliptina', 'dulaglutida', 'evolocumab', 'ezetimiba', 'olmesartan', 'vortioxetina', 'mirabegron', 'denosumab'],
    'Tasas de eventos (por paciente y año, razón de tasas)': ['mepolizumab', 'benralizumab', 'dupilumab', 'tiotropio', 'roflumilast', 'omalizumab'],
    'Resultados binarios, antiinfecciosos y vacunas': ['vareniclina', 'oseltamivir', 'dolutegravir', 'sofosbuvir', 'nirmatrelvir'],
    '5.1 con pocos datos clínicos': ['paracetamol', 'ibuprofeno', 'amoxicilina', 'omeprazol', 'enalapril', 'metamizol'],
};

class AuditoriaInconclusa extends Error {}
const pausa = ms => new Promise(r => setTimeout(r, ms));

// --- El módulo real, en un sandbox: los mismos patrones y el mismo glosario que la app ----------
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
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8')}\n;window.__CimaAPI = CimaAPI;`, sandbox);
vm.runInContext(`${readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8')}\n;window.__App = MedCheckApp;`, sandbox);
const App = sandbox.window.__App;
const CimaAPI = sandbox.window.__CimaAPI;
const app = Object.create(App.prototype);
const categorias = App.RESALTADOS_51;

// Vocabulario AMPLIO para buscar huecos, a propósito más ancho que el de la app.
const RAICES = /(?<![\wáéíóúñ])(hazard|ratio|odds|raz[óo]n|cociente|riesgos?|IC|intervalo|confianza|diferencias?|medias?|medianas?|tasas?|porcentaje|proporci[óo]n|NN[THD]|reducci[óo]n|aumento|respuesta|remisi[óo]n|supervivencia|significativ\w*|desviaci[óo]n|error|puntos|eficacia|probabilidad|incidencia|[pP]\s*[<=>≤≥])(?![\wáéíóúñ])/g;

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

/** Primer comercializado del principio activo con ficha técnica segmentada. */
async function fichaDe(principio) {
    const d = await pedir(`${CIMA}/medicamentos?practiv1=${encodeURIComponent(principio)}&comerc=1`);
    await pausa(PAUSA_MS);
    const m = (d?.resultados || []).find(x => (x.docs || []).some(doc => doc.tipo === 1 && doc.secc));
    return m ? { nregistro: m.nregistro, nombre: m.nombre } : null;
}

/** Texto de cada nodo de texto, como lo ve `_resaltar51` en el navegador. */
const nodosDeTexto = html => String(html || '').split(/<[^>]*>/).map(t => CimaAPI.textoFT(t)).filter(t => t.trim());

const corta = (t, n = 220) => (t.length > n ? `${t.slice(0, n)}…` : t);
const celda = t => String(t).replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function main() {
    let objetivos = [];
    if (args.nregistros) {
        objetivos = String(args.nregistros).split(',').map(n => ({ grupo: 'Indicados a mano', nregistro: n.trim(), nombre: n.trim() }));
    } else {
        const muestra = args.principios ? { 'Indicados a mano': String(args.principios).split(',').map(s => s.trim()) } : MUESTRA;
        for (const [grupo, principios] of Object.entries(muestra)) {
            for (const p of principios) {
                const f = await fichaDe(p);
                objetivos.push(f ? { grupo, principio: p, ...f } : { grupo, principio: p, nregistro: null });
            }
        }
    }

    const informe = [`# Resaltados de la 5.1 sobre fichas reales de CIMA`, '', `Generado: ${new Date().toISOString()}`, ''];
    const porFamilia = new Map(categorias.map(c => [c.clase, new Map()]));
    const huecos = new Map();
    const partidas = [];
    const perdidas = [];
    let fichas = 0, sin51 = 0, sinFicha = 0;
    let grupoActual = null;

    for (const o of objetivos) {
        if (o.grupo !== grupoActual) { informe.push(`## ${o.grupo}`, ''); grupoActual = o.grupo; }
        if (!o.nregistro) { sinFicha++; informe.push(`- ${o.principio}: sin comercializado con ficha segmentada`); continue; }
        const datos = await pedir(`${CIMA}/docSegmentado/contenido/1?nregistro=${o.nregistro}&seccion=5.1`);
        await pausa(PAUSA_MS);
        const html = (Array.isArray(datos) ? datos : [datos]).map(x => x?.contenido || '').join(' ');
        const texto = CimaAPI.textoFT(html);
        if (texto.replace(/\s+/g, '').length < 40) { sin51++; informe.push(`- **${o.nombre}** (${o.nregistro}): CIMA no devuelve texto para la 5.1`); continue; }
        fichas++;

        const segs = app._segmentarResaltados(texto, categorias);
        if (segs.map(s => s.texto).join('') !== texto) perdidas.push(o.nregistro);
        const cuenta = Object.fromEntries(categorias.map(c => [c.clase, 0]));
        for (const s of segs.filter(s => s.clase)) {
            cuenta[s.clase]++;
            const k = s.texto.replace(/\s+/g, ' ').trim();
            const mapa = porFamilia.get(s.clase);
            const previo = mapa.get(k.toLowerCase());
            const i = texto.indexOf(s.texto);
            mapa.set(k.toLowerCase(), previo ? { ...previo, n: previo.n + 1 }
                : { n: 1, texto: k, termino: app._glosa51(s.texto, s.clase, categorias)?.nombre, ejemplo: corta(texto.slice(Math.max(0, i - 80), i + s.texto.length + 80)), ficha: o.nregistro });
        }

        // Cobertura: frases con vocabulario amplio y ningún resaltado.
        for (const frase of texto.split(/\n+|(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ(])/).map(f => f.trim()).filter(Boolean)) {
            const fs = app._segmentarResaltados(frase, categorias);
            if (fs.some(s => s.clase)) continue;
            const raices = [...frase.matchAll(RAICES)].map(x => x[0].toLowerCase().replace(/\s+/g, ''));
            if (!raices.length || !/\d/.test(frase)) continue;
            raices.forEach(r => huecos.set(r, [...(huecos.get(r) || []), { frase: corta(frase), ficha: o.nregistro }]));
        }

        // Límite del motor: lo que se reconoce en el texto plano y no por nodo de texto.
        const enNodos = nodosDeTexto(html).flatMap(t => app._segmentarResaltados(t, categorias).filter(s => s.clase).map(s => s.texto.replace(/\s+/g, ' ').trim()));
        const enPlano = segs.filter(s => s.clase).map(s => s.texto.replace(/\s+/g, ' ').trim());
        const restantes = [...enNodos];
        for (const t of enPlano) {
            const j = restantes.indexOf(t);
            if (j >= 0) restantes.splice(j, 1);
            else partidas.push({ texto: t, ficha: o.nregistro });
        }

        const resumen = categorias.map(c => `${c.etiqueta}: ${cuenta[c.clase]}`).join(' · ');
        informe.push(`- **${o.nombre}** (${o.nregistro}${o.principio ? `, ${o.principio}` : ''}) · ${texto.length} caracteres · ${resumen}`);
    }
    informe.push('');

    for (const c of [...categorias].sort((a, b) => a.leyenda - b.leyenda)) {
        const filas = [...porFamilia.get(c.clase).values()].sort((a, b) => b.n - a.n).slice(0, 80)
            .map(v => `| ${celda(v.texto)} | ${v.n} | ${celda(v.termino || '—')} | ${celda(v.ejemplo)} (${v.ficha}) |`);
        informe.push(`## Resaltado como «${c.etiqueta}»`, '', 'Para buscar falsos positivos: cada fila debería ser una medida de esta familia.', '',
            '| Texto | Veces | Término del glosario | Contexto (ficha) |', '|---|---|---|---|', ...(filas.length ? filas : ['| — | 0 | | |']), '');
    }

    const topHuecos = [...huecos].sort((a, b) => b[1].length - a[1].length).slice(0, 40)
        .map(([r, v]) => `| ${celda(r)} | ${v.length} | ${celda(v[0].frase)} (${v[0].ficha}) |`);
    informe.push('## Frases con cifras y vocabulario estadístico sin ningún resaltado', '',
        'Candidatas a ampliar el vocabulario. Muchas no expresan ninguna medida; las que sí, dicen qué falta.', '',
        '| Raíz | Frases | Primera frase (ficha) |', '|---|---|---|', ...(topHuecos.length ? topHuecos : ['| — | 0 | |']), '');
    informe.push('## Límite del motor: reconocido en texto plano, no en el navegador', '',
        'La ficha parte estas expresiones entre etiquetas y `_resaltar51` trabaja por nodo de texto, sin reescribir el HTML.', '',
        ...(partidas.length ? partidas.slice(0, 60).map(p => `- ${p.texto} (${p.ficha})`) : ['- Ninguna en esta muestra.']), '');
    informe.push(`Fichas con 5.1 analizadas: ${fichas}. Sin texto en la 5.1: ${sin51}. Principios sin ficha segmentada comercializada: ${sinFicha}.`);
    if (perdidas.length) informe.push('', `**FALLO: los segmentos no reproducen el texto en ${perdidas.join(', ')}.**`);

    const salida = informe.join('\n');
    if (args.salida) {
        writeFileSync(args.salida, salida);
        console.log(`Informe escrito en ${args.salida} (${fichas} fichas).`);
    } else {
        console.log(salida);
    }
    return perdidas.length ? 1 : 0;
}

main().then(code => process.exit(code)).catch(e => {
    if (e instanceof AuditoriaInconclusa) {
        console.error(`INCONCLUSO: ${e.message}`);
        process.exit(2);
    }
    console.error(e);
    process.exit(1);
});
