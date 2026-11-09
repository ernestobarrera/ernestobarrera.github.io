/**
 * Catálogos en trozos versionados para el Worker de MedCheck (punto 8 de la cola: el 1102).
 *
 * POR QUÉ EXISTE. El Worker parseaba `bifimed:full` (19,9 MB) o `sns-catalog:full` (20,3 MB)
 * enteros en cada isolate frío para contestar UNA consulta por CN. En el plan gratuito eso son
 * 40-90 ms de CPU frente a 10 y decenas de MB frente a 128 por isolate: el 1102 del 02/11
 * (RIVAROXABAN AUROVITAS 10 MG dijo «no figura» estando financiado). Aquí `by_cn` se parte en
 * trozos de ~150-350 KB, y el Worker solo lee el trozo del CN que le piden.
 *
 * EL CONTRATO (contraste con Codex del 02/11, R1 y R2):
 *   - `release_id` identifica los BYTES que se sirven (meta + by_cn completos, visado incluido).
 *     No es `catalog_id`: ese sello es de la procedencia, excluye el visado y el Nomenclátor ni
 *     lo lleva. Dos reconstrucciones con el mismo `catalog_id` y otro visado dan otro release.
 *   - Las claves de un release son inmutables; el puntero `C:active:v1` se escribe EL ÚLTIMO.
 *   - El lector fija un manifiesto y usa solo sus trozos: trozo ausente, de otra versión o con
 *     otra huella = «no se pudo consultar» (503), nunca `found:false`. Nunca busca en otra
 *     versión.
 *   - `/meta` sale del mismo manifiesto que `by-cn`.
 *
 * Este módulo es la ÚNICA definición del formato: lo usan el publicador del ETL
 * (`publicar-trozos.mjs`) y el test del Worker, que lo importa de aquí. El lector vive en el
 * Worker (`medcheck-worker/index.js`) y el test comprueba que lee lo que esto escribe.
 */
import { createHash } from 'node:crypto';

export const FORMATO = 1;
export const N_TROZOS = 64;

/** Qué campo del meta declara el total de CN de cada catálogo. */
export const CATALOGOS = {
    'bifimed':     { total: (meta) => meta?.total_cn },
    'sns-catalog': { total: (meta) => meta?.total_products },
};

export function anchoTrozo(n) {
    return Math.max(2, String(n - 1).length);
}

export const claves = {
    puntero:    (c) => `${c}:active:v1`,
    manifiesto: (c, rid) => `${c}:v1:manifest:${rid}`,
    prefijoManifiestos: (c) => `${c}:v1:manifest:`,
    trozo:      (c, rid, k, n) => `${c}:v1:release:${rid}:shard:${String(k).padStart(anchoTrozo(n), '0')}`,
};

export const CN_RE = /^\d{7}$/;
export const RID_RE = /^[0-9a-f]{32}$/;

export function trozoDe(cn, n) {
    if (!CN_RE.test(cn)) throw new Error(`CN no normalizado: ${cn}`);
    return Number(cn) % n;
}

export function sha256hex(datos) {
    return createHash('sha256').update(datos).digest('hex');
}

/** JSON con las claves ordenadas a todos los niveles: la identidad no depende del orden. */
export function canonico(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
    const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${ks.map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
}

/**
 * Construye un release a partir del JSON completo que publica el ETL (`{meta, by_cn, ...}`).
 * Devuelve las claves y los TEXTOS exactos que se escriben en KV, con sus huellas.
 */
export function construirRelease(catalogo, doc, { n = N_TROZOS } = {}) {
    if (!CATALOGOS[catalogo]) throw new Error(`catálogo desconocido: ${catalogo}`);
    if (!doc || typeof doc.meta !== 'object' || !doc.meta || typeof doc.by_cn !== 'object' || !doc.by_cn) {
        throw new Error('el documento no trae meta y by_cn');
    }
    const cns = Object.keys(doc.by_cn).sort();
    for (const cn of cns) trozoDe(cn, n); // lanza si alguno no está normalizado

    const release_id = sha256hex(canonico({
        formato: FORMATO, catalogo, n_trozos: n, meta: doc.meta, by_cn: doc.by_cn,
    })).slice(0, 32);

    const reparto = Array.from({ length: n }, () => ({}));
    for (const cn of cns) reparto[trozoDe(cn, n)][cn] = doc.by_cn[cn];

    const trozos = reparto.map((by_cn, k) => {
        const total = Object.keys(by_cn).length;
        const texto = JSON.stringify({ formato: FORMATO, catalogo, release_id, trozo: k, n_trozos: n, total, by_cn });
        const bytes = Buffer.from(texto, 'utf8');
        return { k, clave: claves.trozo(catalogo, release_id, k, n), texto, n: total, bytes: bytes.length, sha256: sha256hex(bytes) };
    });

    const manifiesto = {
        formato: FORMATO,
        catalogo,
        release_id,
        n_trozos: n,
        total_cn: cns.length,
        meta: doc.meta,
        trozos: trozos.map(({ n: cuenta, bytes, sha256 }) => ({ n: cuenta, bytes, sha256 })),
    };
    const manifiestoTexto = JSON.stringify(manifiesto);

    return {
        catalogo,
        release_id,
        n_trozos: n,
        manifiesto,
        manifiestoClave: claves.manifiesto(catalogo, release_id),
        manifiestoTexto,
        manifiestoSha256: sha256hex(Buffer.from(manifiestoTexto, 'utf8')),
        trozos,
        punteroClave: claves.puntero(catalogo),
        punteroTexto: (publicado = new Date().toISOString()) =>
            JSON.stringify({ formato: FORMATO, catalogo, release_id, publicado }),
    };
}

/**
 * Comprueba el release contra el documento de origen RELEYENDO los textos que se van a escribir:
 * todos los CN y todos sus campos, el reparto, los totales del meta y las huellas. Devuelve la
 * lista de errores (vacía = se puede publicar). Comprobar solo tamaños no basta (Codex, J3.2).
 */
export function verificarRelease(doc, rel) {
    const errores = [];
    const err = (m) => { if (errores.length < 50) errores.push(m); };
    const n = rel.n_trozos;
    const totalMeta = CATALOGOS[rel.catalogo].total(doc.meta);
    const cnsOrigen = Object.keys(doc.by_cn);

    if (typeof totalMeta !== 'number') err(`el meta no declara el total de CN de ${rel.catalogo}`);
    else if (totalMeta !== cnsOrigen.length) err(`el meta declara ${totalMeta} CN y by_cn trae ${cnsOrigen.length}`);
    if (rel.manifiesto.total_cn !== cnsOrigen.length) err('el manifiesto no cuenta los CN de origen');
    if (rel.trozos.length !== n || rel.manifiesto.trozos.length !== n) err('número de trozos incoherente');
    if (!RID_RE.test(rel.release_id)) err('release_id mal formado');

    const vistos = new Set();
    for (const t of rel.trozos) {
        const b = Buffer.from(t.texto, 'utf8');
        if (sha256hex(b) !== rel.manifiesto.trozos[t.k]?.sha256) err(`trozo ${t.k}: huella distinta de la del manifiesto`);
        const p = JSON.parse(t.texto);
        if (p.formato !== FORMATO || p.catalogo !== rel.catalogo || p.release_id !== rel.release_id
            || p.trozo !== t.k || p.n_trozos !== n) err(`trozo ${t.k}: cabecera incoherente`);
        const cns = Object.keys(p.by_cn || {});
        if (cns.length !== p.total || cns.length !== rel.manifiesto.trozos[t.k]?.n) err(`trozo ${t.k}: recuento incoherente`);
        for (const cn of cns) {
            if (trozoDe(cn, n) !== t.k) err(`CN ${cn} en el trozo ${t.k}, no en el suyo`);
            if (vistos.has(cn)) err(`CN ${cn} repetido`);
            vistos.add(cn);
            if (!(cn in doc.by_cn)) { err(`CN ${cn} no está en el origen`); continue; }
            if (JSON.stringify(p.by_cn[cn]) !== JSON.stringify(doc.by_cn[cn])) err(`CN ${cn}: campos distintos del origen`);
        }
    }
    if (vistos.size !== cnsOrigen.length) err(`los trozos traen ${vistos.size} CN y el origen ${cnsOrigen.length}`);
    if (canonico(JSON.parse(rel.manifiestoTexto).meta) !== canonico(doc.meta)) err('el meta del manifiesto no es el de origen');
    return errores;
}
