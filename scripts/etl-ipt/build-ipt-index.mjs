#!/usr/bin/env node
/**
 * MedCheck — ETL del índice de Informes de Posicionamiento Terapéutico (IPT) de la AEMPS
 *
 * Construye `assets/data/ipt-index.json`, que la pestaña «Documentación» del modal lee para decir
 * qué IPT hay de ese medicamento. CIMA no publica los IPT —ni en su API ni en su web; comprobado
 * el 30/09/2026—, así que sin este índice MedCheck no puede enseñarlos.
 *
 * QUÉ HACE:
 *   1. Descarga la lista de la AEMPS (`ddbb.json`, ~820 IPT) y valida su esquema.
 *   2. Saca del título el principio activo y la(s) marca(s). Los documentos de clase («Criterios
 *      y recomendaciones generales… ACOD») van por la tabla curada `clases.json`.
 *   3. Resuelve cada marca contra CIMA (`/medicamentos?nombre=`) y la VERIFICA por una segunda vía
 *      independiente: principio activo contra el VTM, o ATC5 del Nomenclátor dentro del ATC2 que
 *      la AEMPS asigna al IPT. Una marca que solo casa por nombre no entra.
 *   4. Compara con el índice anterior para marcar IPT nuevos y ACTUALIZADOS: la fuente guarda una
 *      sola entrada por IPT con su versión vigente, así que la actualización solo se ve por
 *      diferencia.
 *
 * QUÉ NO HACE: no aloja los PDF (se enlazan los originales), no resume ni interpreta el contenido
 * del IPT y no infiere que un medicamento sin IPT «no esté evaluado».
 *
 * ABORTA SIN ESCRIBIR si la fuente cambia de esquema, si cae más de un 10 % el número de IPT, si
 * se analizan menos del 95 % de los títulos, si CIMA falla en más del 2 % de las consultas o si se
 * resuelven menos del 85 % de los IPT de marca. Un índice de la semana pasada es mejor que uno
 * roto, y el watchdog avisa si envejece.
 *
 * Uso:
 *   node scripts/etl-ipt/build-ipt-index.mjs [--out <ruta>] [--anterior <ruta>] [--fuente <ddbb.json local>]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import {
    FUENTE_URL, FUENTE_PAGINA, normalizar, analizarTitulo, fechaIso, urlAbsoluta,
    verificarRegistro, emparejarTodas, colapsarVersiones, validarFuente, quitarEtiquetas,
} from './ipt-lib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (nombre, defecto) => {
    const i = argv.indexOf(nombre);
    return i >= 0 ? argv[i + 1] : defecto;
};
const OUT = arg('--out', join(RAIZ, 'assets', 'data', 'ipt-index.json'));
const ANTERIOR = arg('--anterior', join(RAIZ, 'assets', 'data', 'ipt-index.json'));
const FUENTE_LOCAL = arg('--fuente', null);

const CIMA = 'https://cima.aemps.es/cima/rest';
// Identificable a propósito: una consulta semanal que se presenta, no un rastreador anónimo.
const UA = 'MedCheck-ETL-IPT/1.0 (+https://ernestobarrera.github.io/medcheck.html)';
const LOTE = 4;
const PAUSA_MS = 250;

const dormir = ms => new Promise(r => setTimeout(r, ms));
const hoy = new Date().toISOString().slice(0, 10);

function abortar(motivo) {
    console.error(`\nABORTA: ${motivo}\nNo se escribe nada; el índice anterior sigue siendo el bueno.`);
    process.exit(1);
}

async function pedir(url, intentos = 3) {
    let ultimo;
    for (let i = 0; i < intentos; i++) {
        try {
            const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA } });
            if (r.status === 204) return { cuerpo: null, cabeceras: r.headers };
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return { cuerpo: JSON.parse(await r.text()), cabeceras: r.headers };
        } catch (e) {
            ultimo = e;
            await dormir(800 * (i + 1));
        }
    }
    throw ultimo;
}

// ── 1. Fuente ────────────────────────────────────────────────────────────────
console.log('Fase 1: lista de IPT de la AEMPS...');
let fuente;
let fechaFuente = null;
let etag = null;
if (FUENTE_LOCAL) {
    fuente = JSON.parse(readFileSync(FUENTE_LOCAL, 'utf8'));
} else {
    const { cuerpo, cabeceras } = await pedir(FUENTE_URL);
    fuente = cuerpo;
    const lm = cabeceras.get('last-modified');
    fechaFuente = lm && !Number.isNaN(Date.parse(lm)) ? new Date(lm).toISOString().slice(0, 10) : null;
    etag = cabeceras.get('etag');
}

const anteriorIdx = existsSync(ANTERIOR) ? JSON.parse(readFileSync(ANTERIOR, 'utf8')) : null;
const problemas = validarFuente(fuente, { minimoAnterior: anteriorIdx?._meta?.entradas || 0 });
if (problemas.length) abortar(`la fuente no tiene la forma esperada:\n  - ${problemas.join('\n  - ')}`);
console.log(`  ${fuente.length} IPT · fecha de la fuente ${fechaFuente ?? '(sin Last-Modified)'}`);

let enfermedades = {};
if (!FUENTE_LOCAL) {
    try {
        const { cuerpo } = await pedir(FUENTE_URL.replace('ddbb.json', 'illnesses.json'));
        for (const e of cuerpo || []) enfermedades[e.id] = e.illness;
    } catch {
        // El nombre de la enfermedad es un adorno: su ausencia no invalida el índice.
        console.warn('  illnesses.json no disponible; se sigue sin nombre de enfermedad');
    }
}

// ── 2. Nomenclátor: ATC5 por registro ────────────────────────────────────────
const atcIndex = JSON.parse(readFileSync(join(RAIZ, 'assets', 'data', 'atc-index.json'), 'utf8')).atc || {};
const atcDe = nr => atcIndex[nr] || null;
const registrosPorAtc = {};
for (const [nr, atc] of Object.entries(atcIndex)) (registrosPorAtc[atc] = registrosPorAtc[atc] || []).push(nr);

const { clases } = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'etl-ipt', 'clases.json'), 'utf8'));

// ── 3. Análisis de títulos ───────────────────────────────────────────────────
console.log('Fase 2: análisis de títulos...');
const entradas = [];
const sinParsear = [];
for (const r of fuente) {
    const base = {
        // Texto literal de la AEMPS, sin su marcado (`<sup>177</sup>Lu`): el cliente lo escapa y lo
        // pinta como texto, así que una etiqueta aquí saldría como `<sup>` visible.
        t: quitarEtiquetas(r.title).replace(/\s+/g, ' ').trim(),
        f: fechaIso(r.date),
        v: Number.parseInt(r.version, 10) || 1,
        u: urlAbsoluta(r.link),
        atc2: r.subgroup || null,
        enf: enfermedades[r.illness] || null,
    };
    if (!base.u) { sinParsear.push({ t: base.t, motivo: 'enlace no válido' }); continue; }
    const tn = normalizar(base.t);
    const clase = clases.find(c => tn.includes(normalizar(c.coincide)));
    if (clase) { entradas.push({ ...base, tipo: 'clase', grupo: clase.grupo, atc5: clase.atc5 }); continue; }
    const a = analizarTitulo(base.t);
    if (!a) { sinParsear.push({ t: base.t, u: base.u, motivo: 'título sin patrón conocido' }); continue; }
    entradas.push({ ...base, tipo: 'marca', dci: a.dci, marcas: a.marcas, ind: a.indicacion });
}
const tasaParseo = entradas.length / fuente.length;
const colapso = colapsarVersiones(entradas);
entradas.length = 0;
entradas.push(...colapso.entradas);
console.log(`  ${(tasaParseo * 100).toFixed(1)} % analizados · ${sinParsear.length} sin patrón · ${colapso.retiradas} versión(es) antigua(s) duplicada(s) retirada(s)`);
if (tasaParseo < 0.95) abortar(`solo se analiza el ${(tasaParseo * 100).toFixed(1)} % de los títulos`);

// ── 4. Resolución de marcas contra CIMA ──────────────────────────────────────
const marcas = [...new Set(entradas.filter(e => e.tipo === 'marca').flatMap(e => e.marcas))];
console.log(`Fase 3: ${marcas.length} marcas contra CIMA...`);
const porMarca = {};
let errores = 0;
async function buscarMarca(marca) {
    const todos = [];
    for (let pagina = 1; pagina <= 5; pagina++) {
        const q = `${CIMA}/medicamentos?nombre=${encodeURIComponent(marca)}&tamanioPagina=200&pagina=${pagina}`;
        const { cuerpo } = await pedir(q);
        const res = cuerpo?.resultados || [];
        todos.push(...res);
        if (!cuerpo?.totalFilas || todos.length >= cuerpo.totalFilas || res.length === 0) break;
    }
    return todos;
}
for (let i = 0; i < marcas.length; i += LOTE) {
    await Promise.all(marcas.slice(i, i + LOTE).map(async m => {
        try { porMarca[m] = await buscarMarca(m); } catch { errores++; porMarca[m] = null; }
    }));
    if ((i / LOTE) % 25 === 0) console.log(`  ${Math.min(i + LOTE, marcas.length)}/${marcas.length}`);
    await dormir(PAUSA_MS);
}
if (errores > marcas.length * 0.02) abortar(`CIMA falló en ${errores} de ${marcas.length} consultas`);

// ── 5. Ensamblado, verificación y comparación con la pasada anterior ─────────
console.log('Fase 4: verificación y novedades...');
const previas = anteriorIdx?.ipts || {};
const ipts = {};
const porNregistro = {};
const porVtm = {};
const sinResolver = [];
const via = { dci: 0, atc: 0 };
const novedades = { nuevos: [], actualizados: [] };
const anadir = (mapa, clave, id) => { (mapa[clave] = mapa[clave] || new Set()).add(id); };

const emparejadas = emparejarTodas(entradas, previas, crypto);
entradas.forEach((e, i) => {
    const { id, estado, previa } = emparejadas[i];
    const registros = new Set();
    const vtms = new Set();
    if (e.tipo === 'clase') {
        for (const atc of e.atc5) for (const nr of registrosPorAtc[atc] || []) registros.add(nr);
    } else {
        for (const marca of e.marcas) {
            for (const med of porMarca[marca] || []) {
                const v = verificarRegistro({ med, marca, dci: e.dci, subgrupo: e.atc2, atcDe });
                if (!v) continue;
                via[v]++;
                registros.add(med.nregistro);
                if (med.vtm?.id != null) vtms.add(String(med.vtm.id));
            }
        }
        if (registros.size === 0) sinResolver.push({ id, t: e.t, marcas: e.marcas });
    }

    // Primera pasada (sin índice anterior): nada es «nuevo», es la línea base.
    const esBase = !anteriorIdx;
    // Una entrada ya conocida hereda su `visto` TAL CUAL, también si es nulo (línea base): si no,
    // la segunda pasada estamparía hoy en todas y el índice cambiaría cada semana sin cambiar nada.
    const visto = previa ? (previa.visto ?? null) : (esBase ? null : hoy);
    let act = previa?.act ?? null;
    let vprev = previa?.vprev ?? null;
    if (!esBase && estado === 'nuevo') novedades.nuevos.push(id);
    if (estado === 'actualizado' && (previa.v !== e.v || previa.f !== e.f)) {
        act = hoy;
        vprev = previa.v;
        novedades.actualizados.push(id);
    }

    // La indicación NO se guarda aparte: es un trozo del título literal, y duplicarla doblaba el
    // peso del índice. Se guarda dónde empieza (`i`) y el cliente la corta del título. Los campos
    // vacíos se omiten por la misma razón: el cliente lee su ausencia como `null`.
    const { atc5, ind, ...resto } = e;
    const inicio = ind ? e.t.lastIndexOf(ind) : -1;
    const entrada = { ...resto, ...(e.tipo === 'clase' ? { atc5 } : {}), i: inicio >= 0 ? inicio : null, visto, act, vprev };
    ipts[id] = Object.fromEntries(Object.entries(entrada).filter(([, v]) => v != null));
    for (const nr of registros) anadir(porNregistro, nr, id);
    for (const vt of vtms) anadir(porVtm, vt, id);
});

const deMarca = entradas.filter(e => e.tipo === 'marca').length;
const resueltas = deMarca - sinResolver.length;
console.log(`  ${resueltas}/${deMarca} IPT de marca resueltos · verificación: ${via.dci} por principio activo, ${via.atc} por ATC`);
if (resueltas < deMarca * 0.85) abortar(`solo se resuelven ${resueltas} de ${deMarca} IPT de marca`);

// Cada lista, del más reciente al más antiguo: es el orden en que se pintan.
const ordenar = mapa => Object.fromEntries(Object.keys(mapa).sort().map(k => [k,
    [...mapa[k]].sort((a, b) => (ipts[b].f || '').localeCompare(ipts[a].f || '') || a.localeCompare(b))]));

const indice = {
    _meta: {
        schema_version: 1,
        source: 'AEMPS — Informes de Posicionamiento Terapéutico (lista pública de la web de la AEMPS)',
        source_url: FUENTE_URL,
        source_page: FUENTE_PAGINA,
        fecha_fuente: fechaFuente,
        etag,
        generated_at: hoy,
        entradas: fuente.length,
        versiones_duplicadas_retiradas: colapso.retiradas,
        de_marca: deMarca,
        resueltas,
        de_clase: entradas.length - deMarca,
        verificacion: via,
        consultas_cima: marcas.length,
        errores_cima: errores,
        registros_con_ipt: Object.keys(porNregistro).length,
        novedades,
        sin_resolver: sinResolver,
        sin_parsear: sinParsear,
    },
    ipts: Object.fromEntries(Object.keys(ipts).sort().map(k => [k, ipts[k]])),
    por_nregistro: ordenar(porNregistro),
    por_vtm: ordenar(porVtm),
};

// Una entrada por línea: el historial de git ES la auditoría de qué cambió cada semana, y un
// JSON en una sola línea haría ese diff ilegible.
const bloque = obj => '{\n' + Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n') + '\n}';
const texto = '{\n"_meta":' + JSON.stringify(indice._meta, null, 1) +
    ',\n"ipts":' + bloque(indice.ipts) +
    ',\n"por_nregistro":' + bloque(indice.por_nregistro) +
    ',\n"por_vtm":' + bloque(indice.por_vtm) + '\n}\n';
JSON.parse(texto); // si el serializador a mano se equivoca, que reviente aquí y no en el cliente
writeFileSync(OUT, texto);
console.log(`\nEscrito ${OUT}`);
console.log(`  ${Object.keys(ipts).length} IPT · ${indice._meta.registros_con_ipt} registros con IPT · ${Object.keys(porVtm).length} principios activos (VTM)`);
console.log(`  novedades: ${novedades.nuevos.length} nuevos, ${novedades.actualizados.length} actualizados`);
if (sinResolver.length) console.log(`  sin resolver (${sinResolver.length}): ${sinResolver.slice(0, 8).map(s => s.marcas.join('/')).join(', ')}${sinResolver.length > 8 ? '…' : ''}`);
