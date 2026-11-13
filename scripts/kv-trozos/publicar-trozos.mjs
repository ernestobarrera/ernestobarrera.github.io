#!/usr/bin/env node
/**
 * Publica en Cloudflare KV un catálogo partido en trozos versionados (formato en `trozos.mjs`).
 *
 * Lo llaman los ETL de BIFIMED y del Nomenclátor DOS veces:
 *   - sin --publicar, ANTES de publicar `:full` y `:meta`: si el release no se puede construir o
 *     no casa con el origen, el ETL para sin mover nada. Si no, `:full` sería del mes nuevo y los
 *     trozos del anterior hasta la pasada siguiente: con los trozos activos, Financiación diría
 *     «financiado» de un CN retirado y las marcas del índice se apagarían en todas las sesiones
 *     (revisión del 11/11, C1);
 *   - con --publicar, DESPUÉS de `:full` y `:meta`, que se siguen escribiendo igual: un Worker
 *     viejo (o uno nuevo con los trozos desactivados) tiene que seguir encontrando el blob entero.
 *     Eso es la vuelta atrás.
 *
 * ORDEN, y por qué:
 *   1. construir el release y verificarlo contra el origen (todos los CN, todos los campos);
 *   2. si el puntero ya apunta a este release, no escribir nada (ahorra cuota: 1.000/día);
 *   3. escribir trozos + manifiesto en una sola petición por lotes;
 *   4. RELEERLOS uno a uno y comparar la huella: si alguno no casa, el puntero no se toca y el
 *      Worker sigue sirviendo el release anterior, entero y coherente;
 *   5. mover el puntero, lo último;
 *   6. limpiar releases viejos conservando el activo y el anterior (ventana de vuelta atrás). Un
 *      fallo aquí avisa pero no tumba la publicación: el puntero ya está bien.
 * El orden reduce ventanas; no es una barrera: KV es eventual entre claves (60 s o más). La
 * corrección ante una propagación incompleta la da el lector, que ante un trozo ausente o de otra
 * huella responde «no se pudo consultar».
 *
 * Uso:
 *   node scripts/kv-trozos/publicar-trozos.mjs --catalogo bifimed --entrada bifimed_catalog.json
 *        [--salida <dir>] [--publicar]
 * Sin --publicar solo construye, verifica y (con --salida) deja los ficheros. Con --publicar
 * necesita CF_API_TOKEN, CF_ACCOUNT_ID y CF_KV_NAMESPACE_ID.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { construirRelease, verificarRelease, filasRepetidas, claves, sha256hex, RID_RE } from './trozos.mjs';

/**
 * `api` abstrae KV para poder probarlo sin red: get(clave) → Buffer|null, putBulk([{key,value}]),
 * put(clave, texto), list(prefijo) → [nombres], deleteBulk([claves]).
 */
export async function publicar(rel, api, { log = console.log, avisar = console.warn,
    reintentos = 3, esperaMs = 5000 } = {}) {
    const informe = { release_id: rel.release_id, escrito: false, puntero: false, borrados: 0, avisos: [] };

    const actualTxt = await api.get(rel.punteroClave);
    let anterior = null;
    if (actualTxt) {
        try { anterior = JSON.parse(actualTxt.toString('utf8')).release_id || null; } catch { anterior = null; }
    }
    if (anterior === rel.release_id) {
        // Mismo contenido que lo activo: comprobar que el manifiesto sigue ahí y no escribir.
        const m = await api.get(rel.manifiestoClave);
        if (m && sha256hex(m) === rel.manifiestoSha256) {
            log(`[trozos] ${rel.catalogo}: el puntero ya apunta a ${rel.release_id}; nada que escribir`);
            informe.puntero = true;
            return informe;
        }
        log(`[trozos] ${rel.catalogo}: el puntero apunta a ${rel.release_id} pero su manifiesto no casa; se reescribe`);
    }

    const pares = [
        ...rel.trozos.map((t) => ({ key: t.clave, value: t.texto })),
        { key: rel.manifiestoClave, value: rel.manifiestoTexto },
    ];
    await api.putBulk(pares);
    informe.escrito = true;
    log(`[trozos] ${rel.catalogo}: ${pares.length} claves escritas (release ${rel.release_id})`);

    const esperadas = [
        ...rel.trozos.map((t) => [t.clave, t.sha256]),
        [rel.manifiestoClave, rel.manifiestoSha256],
    ];
    let pendientes = esperadas;
    for (let intento = 1; pendientes.length && intento <= reintentos; intento++) {
        if (intento > 1) await new Promise((r) => setTimeout(r, esperaMs));
        const siguen = [];
        for (const [clave, huella] of pendientes) {
            const b = await api.get(clave);
            if (!b || sha256hex(b) !== huella) siguen.push([clave, huella]);
        }
        pendientes = siguen;
    }
    if (pendientes.length) {
        throw new Error(`${pendientes.length} claves no se releen con su huella (p. ej. ${pendientes[0][0]}); `
            + 'el puntero NO se mueve y el Worker sigue con el release anterior');
    }
    log(`[trozos] ${rel.catalogo}: ${esperadas.length} claves releídas con su huella`);

    await api.put(rel.punteroClave, rel.punteroTexto());
    informe.puntero = true;
    log(`[trozos] ${rel.catalogo}: puntero → ${rel.release_id}${anterior ? ` (antes ${anterior})` : ''}`);

    try {
        const conservar = new Set([rel.release_id, anterior].filter(Boolean));
        const nombres = await api.list(claves.prefijoManifiestos(rel.catalogo));
        const viejos = nombres
            .map((k) => k.slice(claves.prefijoManifiestos(rel.catalogo).length))
            .filter((rid) => RID_RE.test(rid) && !conservar.has(rid));
        for (const rid of viejos) {
            const mb = await api.get(claves.manifiesto(rel.catalogo, rid));
            let n = null;
            try { n = JSON.parse(mb.toString('utf8')).n_trozos; } catch { n = null; }
            if (!Number.isInteger(n) || n < 1) {
                avisar(`[trozos] ${rel.catalogo}: manifiesto ${rid} ilegible; no se borra a ciegas`);
                informe.avisos.push(`manifiesto ilegible ${rid}`);
                continue;
            }
            // Primero los trozos y después el manifiesto: si se corta a mitad, el manifiesto
            // sigue siendo el inventario de lo que queda por borrar.
            const ks = Array.from({ length: n }, (_, k) => claves.trozo(rel.catalogo, rid, k, n));
            await api.deleteBulk(ks);
            await api.deleteBulk([claves.manifiesto(rel.catalogo, rid)]);
            informe.borrados += ks.length + 1;
            log(`[trozos] ${rel.catalogo}: release viejo ${rid} retirado (${ks.length + 1} claves)`);
        }
    } catch (e) {
        avisar(`[trozos] ${rel.catalogo}: la limpieza falló (${e.message}); la publicación es válida`);
        informe.avisos.push(`limpieza: ${e.message}`);
    }
    return informe;
}

/** KV por la API REST de Cloudflare. */
export function apiRest({ token, cuenta, namespace }) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${cuenta}/storage/kv/namespaces/${namespace}`;
    const h = { Authorization: `Bearer ${token}` };
    const json = async (r, que) => {
        const b = await r.json().catch(() => null);
        if (!r.ok || !b?.success) throw new Error(`${que}: HTTP ${r.status} ${JSON.stringify(b?.errors || b)}`);
        return b;
    };
    return {
        async get(clave) {
            const r = await fetch(`${base}/values/${encodeURIComponent(clave)}`, { headers: h });
            if (r.status === 404) return null;
            if (!r.ok) throw new Error(`leer ${clave}: HTTP ${r.status}`);
            return Buffer.from(await r.arrayBuffer());
        },
        async putBulk(pares) {
            const b = await json(await fetch(`${base}/bulk`, {
                method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(pares),
            }), 'escritura por lotes');
            const fallidas = b.result?.unsuccessful_keys || [];
            if (fallidas.length) throw new Error(`escritura por lotes: ${fallidas.length} claves sin escribir`);
        },
        async put(clave, texto) {
            const r = await fetch(`${base}/values/${encodeURIComponent(clave)}`, {
                method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: texto,
            });
            await json(r, `escribir ${clave}`);
        },
        async list(prefijo) {
            const nombres = [];
            let cursor = '';
            do {
                const q = new URLSearchParams({ prefix: prefijo, limit: '1000', ...(cursor ? { cursor } : {}) });
                const b = await json(await fetch(`${base}/keys?${q}`, { headers: h }), 'listar');
                for (const k of b.result || []) nombres.push(k.name);
                cursor = b.result_info?.cursor || '';
            } while (cursor);
            return nombres;
        },
        async deleteBulk(ks) {
            const b = await json(await fetch(`${base}/bulk/delete`, {
                method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(ks),
            }), 'borrado por lotes');
            const fallidas = b.result?.unsuccessful_keys || [];
            if (fallidas.length) throw new Error(`borrado por lotes: ${fallidas.length} claves sin borrar`);
        },
    };
}

async function main(argv) {
    const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
    const catalogo = arg('--catalogo');
    const entrada = arg('--entrada');
    const salida = arg('--salida');
    if (!catalogo || !entrada) {
        console.error('uso: publicar-trozos.mjs --catalogo bifimed|sns-catalog --entrada <json> [--salida dir] [--publicar]');
        return 2;
    }
    const doc = JSON.parse(readFileSync(entrada, 'utf8'));
    const rel = construirRelease(catalogo, doc);
    const errores = verificarRelease(doc, rel);
    if (errores.length) {
        console.error(`[trozos] ${catalogo}: el release NO coincide con el origen:\n  - ${errores.join('\n  - ')}`);
        return 1;
    }
    const repetidas = filasRepetidas(catalogo, doc);
    if (repetidas) {
        const m = `[trozos] ${catalogo}: ${repetidas} filas del origen repiten un CN ya visto; by_cn se queda con la última, igual que :full`;
        console.log(process.env.GITHUB_ACTIONS ? `::warning::${m}` : m);
    }
    const tam = rel.trozos.map((t) => t.bytes);
    console.log(`[trozos] ${catalogo}: release ${rel.release_id}, ${rel.manifiesto.total_cn} CN en ${rel.n_trozos} trozos `
        + `(${Math.round(Math.min(...tam) / 1024)}-${Math.round(Math.max(...tam) / 1024)} KB), verificado contra el origen`);

    if (salida) {
        mkdirSync(salida, { recursive: true });
        for (const t of rel.trozos) writeFileSync(join(salida, `${t.clave.replace(/:/g, '_')}.json`), t.texto);
        writeFileSync(join(salida, `${rel.manifiestoClave.replace(/:/g, '_')}.json`), rel.manifiestoTexto);
    }
    if (!argv.includes('--publicar')) return 0;

    const { CF_API_TOKEN: token, CF_ACCOUNT_ID: cuenta, CF_KV_NAMESPACE_ID: namespace } = process.env;
    if (!token || !cuenta || !namespace) {
        console.error('[trozos] faltan CF_API_TOKEN, CF_ACCOUNT_ID o CF_KV_NAMESPACE_ID');
        return 1;
    }
    const avisar = (m) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${m}` : m);
    const inf = await publicar(rel, apiRest({ token, cuenta, namespace }), { avisar });
    console.log(JSON.stringify(inf));
    return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    main(process.argv.slice(2)).then((c) => process.exit(c), (e) => {
        console.error(`[trozos] ${e.message}`);
        process.exit(1);
    });
}
