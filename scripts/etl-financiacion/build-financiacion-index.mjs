#!/usr/bin/env node
/**
 * MedCheck — ETL del índice de financiación por medicamento
 *
 * Construye `nregistro -> conteo de presentaciones comercializadas por lista oficial de
 * BIFIMED`, para que la LISTA de resultados pueda mostrar y filtrar la financiación sin una
 * petición por tarjeta. Hoy la financiación solo se ve abriendo la ficha de una en una.
 *
 * QUÉ GUARDA, Y QUÉ NO. Guarda conteos por PROCEDENCIA —de cuál de las seis listas oficiales
 * viene cada CN—, nunca un veredicto. La pregunta «¿esto cuenta como financiado?» se responde
 * en un solo sitio, el cliente (`_classifyFinSit` / `_computeFinancingSummary`), para que no
 * existan dos verdades sobre lo mismo. La procedencia llega del sidecar del ETL de BIFIMED
 * (`bifimed_catalog_procedencia.json`), que es dato de la fuente y no interpretación nuestra.
 *
 * EL UNIVERSO SON LAS COMERCIALIZADAS, Y ESO SE DICE. Se crawlea el censo COMPLETO de CIMA
 * (sin `comerc=1`), pero los conteos se hacen sobre las presentaciones comercializadas, que es
 * la partición sobre la que el resumen de la ficha ya cuenta («2 comercializadas de 3»). Medido
 * el 2026-09-08: contar todas o solo las comercializadas cambia el veredicto de 1.723
 * medicamentos, y en 1.587 de ellos la diferencia es `parcial → financiado` — medicamentos cuyas
 * presentaciones vivas están todas financiadas y que hoy se anuncian como parciales porque
 * arrastran un envase retirado. Contar el censo entero haría a la lista decir de un medicamento
 * algo distinto de lo que dice su propia ficha.
 *
 * UN MEDICAMENTO SIN ENTRADA NO ES UN MEDICAMENTO SIN FINANCIACIÓN. La ausencia de marca nunca
 * puede leerse como «no financiado»: hay 1.331 medicamentos visibles sin ningún CN en BIFIMED
 * (993 de ellos importaciones paralelas). Por eso se emiten también los que tienen cero
 * presentaciones comercializadas, con total 0: permite decir «sin presentaciones
 * comercializadas» en vez de callar.
 *
 * SEGUNDA FUENTE: EL NOMENCLÁTOR (2026-09-10, esquema 2). La frase de arriba decía antes «que el
 * Ministerio no publica», y era falsa —cierta para BIFIMED, falsa para el Ministerio—. Medido:
 * **el Nomenclátor de facturación cubre 1.017 de esos 1.331**, todos con estado de alta. El dato
 * estaba en una fuente que la FICHA ya consultaba (`/sns-catalog/by-cn/`) y que la LISTA no
 * miraba, así que el mismo medicamento decía dos cosas distintas según por dónde se mirara: es
 * el caso de JENTADUETO que trajo Ernesto el 2026-09-10 (CN 763083, «Sin datos» en la lista y
 * financiación al abrir la ficha).
 *
 * Se añade como OCTAVA posición, no fundida con las otras: las seis primeras son listas de
 * BIFIMED y esta es otra fuente con otro significado —«consta de alta en el Nomenclátor de
 * facturación»—, así que el cliente puede decirlo con sus palabras en vez de dar a entender que
 * lo dice BIFIMED. Solo cuenta presentaciones SIN dato en BIFIMED: nunca hay doble conteo.
 *
 * El sidecar del Nomenclátor es OPCIONAL. Sin él se emite el esquema 1 de siempre (7 columnas):
 * una cadena de CI que aún no lo pase no puede romper la generación diaria, y el cliente lee los
 * dos esquemas.
 *
 * Uso:
 *   node scripts/etl-financiacion/build-financiacion-index.mjs --procedencia <ruta>
 *        [--nomenclator <ruta>] [--out <ruta>] [--dry]
 * Salida:
 *   exit 0 con el índice escrito; exit 1 si un centinela falla o la cobertura se desploma.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BASE = 'https://cima.aemps.es/cima/rest';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const NO_CACHE = args.includes('--no-cache');
const argOf = (name, def = null) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : def;
};
const OUT = argOf('--out', join(ROOT, 'assets', 'data', 'financiacion-index.json'));
const PROCEDENCIA = argOf('--procedencia', null);
const NOMENCLATOR = argOf('--nomenclator', null);

/**
 * Orden de los conteos en cada entrada. Es el mismo de `DESCARGAS` en el ETL de BIFIMED y NO se
 * reordena: el cliente lee por posición. Cada entrada del índice es
 *   [ totalComercializadas, si, si_determinadas, no_incluido, excluido, no_fin_resolucion, estudio ]
 * y, con `--nomenclator`, una OCTAVA posición
 *   [ …, alta_en_nomenclator_sin_dato_bifimed ]
 * Las presentaciones sin dato son `total - suma(resto)`, que nunca se emite porque es derivable.
 */
const CODIGOS = ['1', '2', '5', '6', '7', '666'];

/** Posición de la columna del Nomenclátor (esquema 2). Al final, para no mover ninguna anterior. */
const COL_NOMENCLATOR = CODIGOS.length + 1;

// Umbrales de cordura: una caída brusca es un cambio de contrato en CIMA o un sidecar truncado,
// no que España se haya quedado sin medicamentos. Mismo criterio fail-closed que el ETL de envases.
const MIN_NREGISTROS = 20000;
const MIN_PRESENTACIONES = 55000;
const MIN_CON_DATO = 12000;

// ── Crawl con caché del día ───────────────────────────────────────────────────
const CACHE_DIR = join(HERE, '.cache');
const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const cachePath = (endpoint, pagina) => join(CACHE_DIR, `${endpoint}-${hoy()}-p${pagina}.json`);

function readCache(endpoint, pagina) {
    if (NO_CACHE) return null;
    const file = cachePath(endpoint, pagina);
    try {
        if (!existsSync(file) || statSync(file).size === 0) return null;
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}
function writeCache(endpoint, pagina, data) {
    try {
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(cachePath(endpoint, pagina), JSON.stringify(data));
    } catch { /* la caché es una optimización: si no se puede escribir, seguimos */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_INTENTOS = 6;

async function fetchPagina(endpoint, pagina) {
    const cached = readCache(endpoint, pagina);
    if (cached) return { data: cached, deCache: true };

    let ultimoError = null;
    for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
        try {
            const res = await fetch(`${BASE}/${endpoint}?pagina=${pagina}`);
            if (!res.ok) {
                const retryAfter = Number(res.headers.get('Retry-After'));
                if ((res.status === 429 || res.status >= 500) && intento < MAX_INTENTOS) {
                    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * intento);
                    continue;
                }
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();
            writeCache(endpoint, pagina, data);
            return { data, deCache: false };
        } catch (err) {
            ultimoError = err;
            if (intento < MAX_INTENTOS) await sleep(2000 * intento);
        }
    }
    // Un fallo de red no puede degradar en "índice más corto": aborta.
    throw new Error(`[${endpoint}] página ${pagina}: ${ultimoError?.message || 'desconocido'} (reejecuta para reanudar)`);
}

async function crawl(endpoint) {
    const filas = [];
    const vistos = new Set();
    let pagina = 1;
    let total = null;
    for (;;) {
        const { data, deCache } = await fetchPagina(endpoint, pagina);
        const lote = data?.resultados || [];
        for (const r of lote) {
            // Deriva durante la paginación: en 336 páginas, un alta o una baja desplaza filas y
            // la misma puede llegar dos veces. Medir el avance en filas brutas dejaría "completar"
            // el total con duplicados mientras faltan registros reales.
            const clave = `${r?.nregistro}|${r?.cn}`;
            if (vistos.has(clave)) continue;
            vistos.add(clave);
            filas.push(r);
        }
        if (total === null) total = data?.totalFilas ?? lote.length;
        if (filas.length >= total || lote.length === 0) break;
        pagina += 1;
        if (!deCache) await sleep(200);
    }
    if (filas.length < total) {
        throw new Error(`[${endpoint}] recogidas ${filas.length} únicas de ${total} declaradas`);
    }
    console.error(`[etl-fin] ${endpoint}: ${filas.length} filas únicas en ${pagina} páginas`);
    return filas;
}

// ── Centinelas ────────────────────────────────────────────────────────────────
/**
 * Comprueban VALORES, no existencia. Un centinela que solo mira si una clave está presente
 * aprueba un índice lleno de ceros, que es exactamente el fallo que no puede pasar desapercibido:
 * un índice de ceros no rompe nada visible y convierte toda la lista en "sin datos".
 */
function validarCentinelas(fin, ruta, { conNomenclator = false } = {}) {
    let sentinels;
    try {
        sentinels = JSON.parse(readFileSync(ruta, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('[etl-fin] aviso: sin sentinels.json, no se verifican valores');
            return 0;
        }
        throw err;
    }
    let fallos = 0;
    let omitidos = 0;
    for (const s of sentinels.checks || []) {
        // Un centinela puede pertenecer solo a un esquema: el de la columna del Nomenclátor no
        // tiene nada que vigilar cuando el índice se construye sin ese sidecar. Sin esta
        // distinción, el modo de reserva —el que existe para que un fallo del ETL del Nomenclátor
        // no deje la lista SIN NINGUNA marca de financiación— abortaba siempre, y el plan B se
        // convertía en ningún plan. Se omite en voz alta, nunca en silencio: un centinela saltado
        // sin decirlo es un centinela que no existe.
        if (s.solo_esquema === 2 && !conNomenclator) {
            omitidos += 1;
            console.error(`[centinela] omitido (esquema 1, sin Nomenclátor): ${s.note}`);
            continue;
        }
        if (s.kind === 'columna_min') {
            // No fija un medicamento concreto a propósito: el estado de financiación de uno
            // cualquiera puede cambiar el mes que viene y el centinela fallaría sin que hubiera
            // nada roto. Lo que vigila es que la COLUMNA siga poblada, que es el fallo real —
            // reordenar `CODIGOS` o perder una de las seis descargas vacía una posición entera y
            // el índice sigue pareciendo válido.
            const n = Object.values(fin).filter((v) => v[s.pos] > 0).length;
            if (n < s.min) {
                fallos += 1;
                console.error(`[centinela] columna ${s.pos} (${s.note}): ${n} medicamentos, mínimo ${s.min}`);
            }
            continue;
        }
        const got = fin[s.nregistro];
        const esperado = s.expect;
        // `expect` sigue describiendo las SEIS columnas de BIFIMED más el total, que es lo que
        // estos centinelas fueron escritos para vigilar y no cambia. La columna del Nomenclátor
        // se declara aparte, en `expect_nom`.
        //
        // NO SE APRUEBA POR OMISIÓN, que es la parte que importa: en esquema 2, un centinela que
        // no declare `expect_nom` FALLA. Si se dejara pasar, añadir la columna habría convertido
        // en silencio a estos cinco guardianes en guardianes de siete octavos del dato — y la
        // columna nueva, que es justamente la que nadie ha visto funcionar todavía, sería la
        // única sin vigilancia. Es la regla de la casa: a un guardián se le declara la excepción,
        // no se le apaga.
        const okBase = Array.isArray(got) && Array.isArray(esperado)
            && got.length >= esperado.length
            && esperado.every((v, i) => got[i] === v);
        let ok = okBase;
        let detalle = '';
        if (okBase && got.length === esperado.length + 1) {
            if (typeof s.expect_nom !== 'number') {
                ok = false;
                detalle = ' — el índice trae la columna del Nomenclátor y este centinela no declara `expect_nom`';
            } else if (got[esperado.length] !== s.expect_nom) {
                ok = false;
                detalle = ` — Nomenclátor: esperado ${s.expect_nom}, obtenido ${got[esperado.length]}`;
            }
        }
        if (!ok) {
            fallos += 1;
            console.error(`[centinela] ${s.nregistro} (${s.note}): esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(got)}${detalle}`);
        }
    }
    const total = (sentinels.checks || []).length;
    console.error(`[etl-fin] centinelas: ${total - fallos - omitidos} OK, ${fallos} fallidos`
        + (omitidos ? `, ${omitidos} omitidos por esquema` : ''));
    return fallos;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    if (!PROCEDENCIA) {
        throw new Error('falta --procedencia <ruta a bifimed_catalog_procedencia.json>');
    }
    const proc = JSON.parse(readFileSync(PROCEDENCIA, 'utf8'));
    const porCn = proc.por_cn || {};
    const catalogId = proc.meta?.catalog_id;
    if (!catalogId) {
        // Sin identidad no hay forma de que el cliente compruebe que índice y catálogo son la
        // misma generación, y filtrar con generaciones distintas es peor que no filtrar.
        throw new Error('el sidecar no trae meta.catalog_id: no se puede sellar el índice');
    }
    const cnsConDato = Object.keys(porCn).length;
    console.error(`[etl-fin] procedencia: ${cnsConDato} CN · catalog_id ${catalogId.slice(0, 16)}…`);
    if (proc.meta?.suma_listas !== proc.meta?.total_cn_con_procedencia) {
        throw new Error('el sidecar declara solapamiento entre listas; el índice contaría CN dos veces');
    }

    const pres = await crawl('presentaciones');
    if (pres.length < MIN_PRESENTACIONES) {
        throw new Error(`cobertura anómala: ${pres.length} presentaciones (mínimo ${MIN_PRESENTACIONES})`);
    }

    // ── Segunda fuente, opcional: el Nomenclátor de facturación ──────────────
    let nomPorCn = null;
    let nomMeta = null;
    if (NOMENCLATOR) {
        const nom = JSON.parse(readFileSync(NOMENCLATOR, 'utf8'));
        nomPorCn = nom.por_cn || null;
        nomMeta = nom.meta || null;
        // Un sidecar sin sello o vacío se RECHAZA en vez de ignorarse. Ignorarlo en silencio
        // dejaría un índice de esquema 1 con pinta de esquema 2 pedido: el operador creería que
        // los 1.017 están cubiertos y no lo estarían. Pedirlo y no poder usarlo es un fallo.
        if (!nomPorCn || !Object.keys(nomPorCn).length) {
            throw new Error('el sidecar del Nomenclátor no trae por_cn: se pidió --nomenclator y no se puede aplicar');
        }
        if (!nomMeta?.catalog_id) {
            throw new Error('el sidecar del Nomenclátor no trae meta.catalog_id: no se puede sellar su procedencia');
        }
        const altas = Object.values(nomPorCn).filter((v) => v === 'A').length;
        console.error(`[etl-fin] nomenclátor: ${Object.keys(nomPorCn).length} CN (${altas} de alta) `
            + `· catalog_id ${nomMeta.catalog_id.slice(0, 16)}…`);
    }

    const idx = CODIGOS.reduce((m, c, i) => (m[c] = i + 1, m), {});
    const ancho = nomPorCn ? COL_NOMENCLATOR + 1 : CODIGOS.length + 1;
    const fin = {};
    let conAlgunDato = 0;
    let sinComercializadas = 0;
    let rescatadasPorNomenclator = 0;

    for (const p of pres) {
        if (!p?.nregistro || !p?.cn) continue;
        const nreg = String(p.nregistro);
        if (!fin[nreg]) fin[nreg] = new Array(ancho).fill(0);
        // `comerc !== false` y no `=== true`: es el criterio que ya usa el bloque de
        // presentaciones de la ficha, y dos criterios distintos darían dos recuentos distintos
        // de lo mismo en la misma pantalla.
        if (p.comerc === false) continue;
        const fila = fin[nreg];
        fila[0] += 1;
        const cn7 = String(p.cn).padStart(7, '0');
        const codigo = porCn[cn7];
        if (codigo !== undefined) {
            fila[idx[String(codigo)]] += 1;
        } else if (nomPorCn && nomPorCn[cn7] === 'A') {
            // SOLO cuando BIFIMED no dice nada de este CN. El orden de este `else if` ES la
            // garantía de que no hay doble conteo: una presentación cae en una columna o en la
            // otra, nunca en las dos, y `total` sigue siendo el denominador de todo.
            fila[COL_NOMENCLATOR] += 1;
            rescatadasPorNomenclator += 1;
        }
    }

    for (const fila of Object.values(fin)) {
        if (fila[0] === 0) sinComercializadas += 1;
        else if (fila.slice(1).some((n) => n > 0)) conAlgunDato += 1;
    }

    const nregistros = Object.keys(fin).length;
    if (nregistros < MIN_NREGISTROS || conAlgunDato < MIN_CON_DATO) {
        throw new Error(`cobertura anómala: ${nregistros} nregistros, ${conAlgunDato} con dato `
            + `(mínimos ${MIN_NREGISTROS} / ${MIN_CON_DATO})`);
    }

    const fallos = validarCentinelas(fin, join(HERE, 'sentinels.json'), { conNomenclator: !!nomPorCn });
    if (fallos > 0) throw new Error(`${fallos} centinela(s) fallidos`);


    const payload = {
        _meta: {
            // El esquema lo dicta el ANCHO REAL de las filas emitidas, no la intención: declarar 2
            // con filas de 7 haría que el cliente buscara una columna que no está.
            schema_version: nomPorCn ? 2 : 1,
            source: nomPorCn
                ? 'CIMA REST /presentaciones (censo completo) × BIFIMED (sidecar de procedencia) '
                  + '× Nomenclátor de facturación del Ministerio de Sanidad (sidecar de estado)'
                : 'CIMA REST /presentaciones (censo completo) × BIFIMED (sidecar de procedencia)',
            ...(nomPorCn ? {
                nomenclator_catalog_id: nomMeta.catalog_id,
                nomenclator_download_date: nomMeta.download_date ?? null,
                presentaciones_solo_en_nomenclator: rescatadasPorNomenclator,
            } : {}),
            generated_at: new Date().toISOString().slice(0, 10),
            // Sello de generación. El cliente NO habilita la faceta si esto no coincide con el
            // `catalog_id` que devuelve `/bifimed/meta`: filtrar una lista con un índice de otra
            // generación que la ficha es la forma silenciosa de mentir.
            catalog_id: catalogId,
            bifimed_download_date: proc.meta?.download_date ?? null,
            orden_codigos: CODIGOS,
            presentaciones: pres.length,
            nregistros,
            con_algun_dato: conAlgunDato,
            sin_comercializadas: sinComercializadas,
        },
        fin,
    };

    // El esquema DECLARADO tiene que ser el esquema EMITIDO, y se comprueba leyendo el payload YA
    // CONSTRUIDO, no recalculando la condición que lo decidió: una guarda que vuelve a derivar el
    // valor esperado de la misma variable no comprueba nada, se da la razón a sí misma. (Primera
    // versión de esta guarda: exactamente eso, y el mutante que ponía `schema_version: 1` con
    // filas de 8 la sobrevivía sin despeinarse.)
    //
    // El cliente deduce el ancho leyendo la fila, así que una declaración falsa no rompería la
    // pantalla — y por eso mismo nadie la vería. Pero `_meta` es lo que lee un humano para saber
    // qué tiene delante, y un metadato que miente sobre su propio contenido es el principio de una
    // investigación perdida dentro de seis meses.
    {
        const anchos = new Set(Object.values(payload.fin).map((f) => f.length));
        const declarado = payload._meta.schema_version;
        const esperado = { 1: CODIGOS.length + 1, 2: COL_NOMENCLATOR + 1 }[declarado];
        if (!esperado || anchos.size !== 1 || !anchos.has(esperado)) {
            throw new Error(`el índice se declara esquema ${declarado} pero sus filas miden `
                + `${[...anchos].join('/')} (ese esquema exige ${esperado ?? 'un ancho que no existe'}): `
                + 'describiría mal su propio contenido');
        }
        // Y la columna nueva solo puede existir si de verdad se aplicó el sidecar.
        if ((declarado === 2) !== !!nomPorCn) {
            throw new Error(`esquema ${declarado} declarado con sidecar del Nomenclátor ${nomPorCn ? 'presente' : 'ausente'}`);
        }
    }

    const json = JSON.stringify(payload);
    console.error(`[etl-fin] crudo ${(json.length / 1048576).toFixed(2)} MiB · `
        + `gzip ${(gzipSync(Buffer.from(json), { level: 9 }).length / 1024).toFixed(0)} KiB`);
    console.error(`[etl-fin] ${nregistros} nregistros · ${conAlgunDato} con dato · `
        + `${sinComercializadas} sin comercializadas`);

    if (DRY) {
        console.error('[etl-fin] --dry: no se escribe nada');
        return;
    }
    writeFileSync(OUT, json);
    console.error(`[etl-fin] escrito ${OUT}`);
}

main().catch((err) => {
    console.error(`[etl-fin] ABORTA: ${err.message}`);
    process.exit(1);
});
