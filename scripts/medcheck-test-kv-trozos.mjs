#!/usr/bin/env node
/**
 * MedCheck — catálogos en trozos versionados para el Worker (punto 8 de la cola: el 1102).
 *
 * POR QUÉ EXISTE. El Worker parseaba el catálogo entero (BIFIMED, 19,9 MB) en cada isolate frío
 * para contestar una consulta por CN, y en el plan gratuito eso acaba en `503 · error code: 1102`.
 * El 02/11, RIVAROXABAN AUROVITAS 10 MG dijo «no figura» estando financiado. Los ETL publican
 * ahora, además de `:full`, el catálogo partido en trozos (`scripts/kv-trozos/`). Un error en el
 * publicador no da un aviso: da una financiación equivocada en la ficha.
 *
 * LO QUE ESTE BANCO FIJA (sin red: KV falso):
 *   1. el `release_id` identifica los bytes servidos: cambia si cambia el visado aunque el
 *      `catalog_id` (sello de procedencia) sea el mismo, y no depende del orden de las claves;
 *   2. los trozos traen todos los CN y solo esos, cada uno en el suyo y con sus campos exactos;
 *      el verificador detecta un CN perdido, uno cambiado y un meta que no cuadra;
 *   3. el publicador escribe trozos y manifiesto, los relee, y SOLO ENTONCES mueve el puntero;
 *      si una relectura no casa, el puntero no se toca;
 *   4. no reescribe lo que ya está activo, y limpia releases viejos conservando el activo y el
 *      anterior (la vuelta atrás), sin tumbar la publicación si la limpieza falla.
 * El lector vive en el Worker (repo privado) y su test importa `trozos.mjs` de aquí.
 *
 * Uso: node scripts/medcheck-test-kv-trozos.mjs
 */
import { construirRelease, verificarRelease, claves, trozoDe, canonico, N_TROZOS } from './kv-trozos/trozos.mjs';
import { publicar } from './kv-trozos/publicar-trozos.mjs';

let fallos = 0;
const ok = (n, c, d = '') => {
    if (c) { console.log(`  ok    ${n}`); return; }
    fallos++;
    console.log(`  FALLO ${n}${d ? ` — ${d}` : ''}`);
};

function doc({ visado = true, quitar = null, orden = 1 } = {}) {
    const by_cn = {};
    const idx = Array.from({ length: 500 }, (_, i) => i);
    if (orden < 0) idx.reverse();
    for (const i of idx) {
        const cn = String(600000 + i * 41).padStart(7, '0');
        if (cn === quitar) continue;
        by_cn[cn] = { cn, principio_activo: `PA ${i} ≥ 5 mg`, situacion_financiacion: 'Si', visado: i % 4 === 0 ? visado : false };
    }
    return { meta: { schema_version: 2, download_date: '2026-11-02', total_cn: Object.keys(by_cn).length, catalog_id: 'a'.repeat(64) }, by_cn };
}

console.log('\n1) Identidad del release');
{
    const a = construirRelease('bifimed', doc());
    const b = construirRelease('bifimed', doc({ orden: -1 }));
    const c = construirRelease('bifimed', doc({ visado: false }));
    ok('release_id de 32 hex', /^[0-9a-f]{32}$/.test(a.release_id), a.release_id);
    ok('determinista: el mismo contenido en otro orden da el mismo release y los mismos trozos',
        a.release_id === b.release_id && a.trozos.every((t, k) => t.texto === b.trozos[k].texto));
    ok('mismo catalog_id y otro visado → otro release (R2 de Codex)', a.release_id !== c.release_id);
    ok('las claves llevan el release, no el catalog_id',
        a.trozos[0].clave === `bifimed:v1:release:${a.release_id}:shard:00` && !a.trozos[0].clave.includes('aaaa'));
    ok('puntero y manifiesto con su nombre fijo', a.punteroClave === 'bifimed:active:v1' && a.manifiestoClave === `bifimed:v1:manifest:${a.release_id}`);
    ok('canónico ordena claves a todos los niveles', canonico({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }) === '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
    ok('el meta del manifiesto es el de origen (de ahí sale /meta)', JSON.stringify(a.manifiesto.meta) === JSON.stringify(doc().meta));
    ok(`${N_TROZOS} trozos`, a.trozos.length === N_TROZOS && a.manifiesto.trozos.length === N_TROZOS);
    let lanza = false;
    try { construirRelease('bifimed', { meta: {}, by_cn: { 725293: {} } }); } catch { lanza = true; }
    ok('un CN sin normalizar a 7 cifras no se publica', lanza);
}

console.log('\n2) Los trozos traen exactamente el origen');
{
    const d = doc();
    const rel = construirRelease('bifimed', d);
    ok('el verificador acepta el release bueno', verificarRelease(d, rel).length === 0, verificarRelease(d, rel).join('; '));
    const todos = rel.trozos.flatMap((t) => Object.keys(JSON.parse(t.texto).by_cn));
    ok('cada CN una vez', todos.length === Object.keys(d.by_cn).length && new Set(todos).size === todos.length);
    ok('cada CN en su trozo (Number(cn) % 64)', rel.trozos.every((t) => Object.keys(JSON.parse(t.texto).by_cn).every((cn) => trozoDe(cn, 64) === t.k)));

    const perdido = { ...rel, trozos: rel.trozos.map((t) => ({ ...t })) };
    const t5 = JSON.parse(perdido.trozos[5].texto); const cnP = Object.keys(t5.by_cn)[0]; delete t5.by_cn[cnP];
    perdido.trozos[5].texto = JSON.stringify(t5);
    ok('detecta un CN perdido', verificarRelease(d, perdido).length > 0);

    const cambiado = { ...rel, trozos: rel.trozos.map((t) => ({ ...t })) };
    cambiado.trozos[7].texto = cambiado.trozos[7].texto.replace('"Si"', '"No"');
    ok('detecta un campo cambiado', verificarRelease(d, cambiado).length > 0);

    const d2 = doc(); d2.meta.total_cn = 499;
    ok('detecta un meta que no cuadra con by_cn', verificarRelease(d2, construirRelease('bifimed', d2)).some((e) => /declara 499/.test(e)));
    const sns = { meta: { total_products: 1 }, items: [], by_cn: { '0140001': { cn: '0140001' } } };
    ok('Nomenclátor: el total sale de total_products', verificarRelease(sns, construirRelease('sns-catalog', sns)).length === 0);
}

function kvFalso() {
    const mapa = new Map();
    const ops = [];
    return {
        mapa, ops, corromper: null, fallarLimpieza: false,
        async get(k) { ops.push(['get', k]); const v = mapa.get(k); if (v == null) return null; return Buffer.from(this.corromper === k ? v + ' ' : v, 'utf8'); },
        async putBulk(pares) { ops.push(['putBulk', pares.length]); for (const p of pares) mapa.set(p.key, p.value); },
        async put(k, v) { ops.push(['put', k]); mapa.set(k, v); },
        async list(pre) { ops.push(['list', pre]); if (this.fallarLimpieza) throw new Error('sin permiso de listar'); return [...mapa.keys()].filter((k) => k.startsWith(pre)); },
        async deleteBulk(ks) { ops.push(['deleteBulk', ks.length]); for (const k of ks) mapa.delete(k); },
    };
}
const silencio = { log: () => {}, avisar: () => {}, esperaMs: 0 };

console.log('\n3) Orden de publicación: el puntero, lo último y solo si todo se relee');
{
    const rel = construirRelease('bifimed', doc());
    const kv = kvFalso();
    const inf = await publicar(rel, kv, silencio);
    ok('publica y mueve el puntero', inf.escrito && inf.puntero && JSON.parse(kv.mapa.get('bifimed:active:v1')).release_id === rel.release_id);
    const iPut = kv.ops.findIndex((o) => o[0] === 'putBulk');
    const iPuntero = kv.ops.findIndex((o) => o[0] === 'put' && o[1] === 'bifimed:active:v1');
    const relecturas = kv.ops.slice(iPut, iPuntero).filter((o) => o[0] === 'get').length;
    ok('una sola escritura por lotes con 64 trozos + manifiesto', kv.ops[iPut][1] === 65);
    ok('relee las 65 claves ANTES de mover el puntero', relecturas === 65, String(relecturas));

    const kv2 = kvFalso();
    kv2.corromper = rel.trozos[9].clave;
    let error = null;
    try { await publicar(rel, kv2, silencio); } catch (e) { error = e; }
    ok('una relectura que no casa aborta', error && /NO se mueve/.test(error.message));
    ok('…y el puntero no se escribe', !kv2.mapa.has('bifimed:active:v1'));
    ok('…tras reintentar (3 relecturas de la clave mala)', kv2.ops.filter((o) => o[0] === 'get' && o[1] === rel.trozos[9].clave).length === 3);
}

console.log('\n4) Idempotencia y limpieza');
{
    const kv = kvFalso();
    const r1 = construirRelease('bifimed', doc());
    const r2 = construirRelease('bifimed', doc({ visado: false }));
    const r3 = construirRelease('bifimed', doc({ quitar: '0600041' }));
    await publicar(r1, kv, silencio);
    kv.ops.length = 0;
    const otra = await publicar(r1, kv, silencio);
    ok('mismo release ya activo: no escribe nada', !kv.ops.some((o) => o[0] === 'putBulk' || o[0] === 'put') && otra.puntero);
    await publicar(r2, kv, silencio);
    ok('con dos releases no borra ninguno (activo + anterior)', kv.mapa.has(r1.manifiestoClave) && kv.mapa.has(r1.trozos[0].clave));
    const inf3 = await publicar(r3, kv, silencio);
    ok('al tercero, retira el más viejo entero (64 trozos + manifiesto)', inf3.borrados === 65 && !kv.mapa.has(r1.manifiestoClave)
        && ![...kv.mapa.keys()].some((k) => k.includes(r1.release_id)), String(inf3.borrados));
    ok('conserva el activo y el anterior', kv.mapa.has(r2.manifiestoClave) && kv.mapa.has(r3.manifiestoClave)
        && kv.mapa.has(r2.trozos[63].clave) && kv.mapa.has(r3.trozos[63].clave));
    ok('no toca :full ni :meta (vuelta atrás al Worker viejo)', ![...kv.ops].some((o) => /:full$|:meta$/.test(String(o[1]))));

    const kvL = kvFalso();
    kvL.fallarLimpieza = true;
    const infL = await publicar(r1, kvL, silencio);
    ok('si la limpieza falla, la publicación sigue siendo válida y lo avisa', infL.puntero && infL.avisos.length === 1);
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO OK');
process.exit(fallos ? 1 : 0);
