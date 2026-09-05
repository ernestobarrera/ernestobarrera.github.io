#!/usr/bin/env node
/**
 * MedCheck — ETL de «utilización observada» (España, Ministerio de Sanidad).
 *
 * Construye el JSON que sirve el Worker desde KV a partir de las tablas oficiales de consumo en
 * recetas médicas del SNS por código ATC. Mismo patrón que `etl-biomarkers`: descarga condicional,
 * validación, y publicación solo si el resultado pasa los controles.
 *
 * PERÍMETRO, y no es un detalle de forma: estas tablas son SOLO receta del SNS dispensada en
 * oficina de farmacia. El consumo hospitalario se publica aparte: la serie mensual, agregada por
 * comunidad autónoma y sin ATC; el informe anual sí baja a principio activo, pero en euros y como
 * ranking parcial. No hay serie hospitalaria en DHD con la que completar esta.
 * Por eso `perimetro_corto` viaja dentro del propio dato y la UI lo pinta siempre: decir
 * «España · 2025» a secas sería afirmar más de lo que la fuente sostiene.
 *
 * Tres cosas que la fuente hace y que rompen un ETL ingenuo, todas medidas el 30/08/2026:
 *
 *  1. Los nombres de fichero NO son deducibles: julio de 2025 se publicó como
 *     `JULIO_2025_ATC54.xlsx`, con un 4 de más. Se rascan los `href` del índice del año.
 *  2. El diseño de columnas cambió entre 2022 y 2023 y la fila de cabecera se mueve cada año
 *     (8, 11, 9, 10, 9 en 2021–2025). Se localiza por contenido y se falla ruidosamente si no
 *     aparece; un parser que adivine publica cifras equivocadas sin avisar.
 *  3. Una DHD de 0,0027 se publica como «0,00» (lo dice la nota metodológica, ejemplo P02CC).
 *     Se marca con `z:1` para que la UI escriba «<0,01» y no «0».
 *
 * Uso:
 *   node scripts/etl-utilizacion/build-utilizacion.mjs --out utilizacion.json
 *   node scripts/etl-utilizacion/build-utilizacion.mjs --head-only
 *   node scripts/etl-utilizacion/build-utilizacion.mjs --anio 2025 --from-dir ./fixtures
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { leerZip, leerHoja } from './lib/xlsx-min.mjs';
import { validar } from './validaciones.mjs';

const BASE = 'https://www.sanidad.gob.es/areas/farmacia/consumoMedicamentos/ATC/';
const DOCS = `${BASE}docs/`;
const UA = 'Mozilla/5.0 (compatible; MedCheck-ETL/1.0; +https://ernestobarrera.github.io)';

export const PERIMETRO = Object.freeze({
  pais: 'ES',
  corto: 'España · recetas SNS · oficina de farmacia',
  ambito: { canal: 'facturacion', entorno: 'comunidad', pagador: 'publico' },
  clave_comparabilidad: 'dhd|DDD/1.000 hab/día|facturacion|comunidad|publico',
  cobertura:
    'Recetas del SNS prescritas en atención primaria y especializada, dispensadas y facturadas '
    + 'en oficinas de farmacia, con cargo a las CCAA, INGESA y el Mutualismo Administrativo. '
    + 'No incluye dispensación hospitalaria, receta privada ni medicamentos no financiados.',
  // Precisión que costó una revisión: decir «el consumo hospitalario se publica sin desglose ATC»
  // era demasiado absoluto. La SERIE mensual sí es solo envases y coste por comunidad; el informe
  // anual sí baja a principio activo, aunque en euros y como ranking parcial.
  nota_hospital:
    'La serie mensual de consumo hospitalario del SNS se publica agregada por comunidad autónoma, '
    + 'con envases y coste, sin desglose por código ATC. No existe una serie hospitalaria en DHD '
    + 'equivalente a esta.',
  // Para los medicamentos de uso hospitalario esta fuente no es «incompleta»: es ciega. No los ve
  // porque no se facturan por receta en oficina de farmacia. Comprobado: pembrolizumab, nivolumab,
  // adalimumab, infliximab, etanercept, evolocumab y alirocumab NO aparecen en el fichero de 2025.
  // Decir «sin dato» ahí se lee como «no se usa», que es lo contrario de la verdad.
  nota_hospitalarios:
    'Los medicamentos de uso o diagnóstico hospitalario no se facturan por receta en oficina de '
    + 'farmacia, así que esta fuente no los recoge. Su volumen real está en la dispensación '
    + 'hospitalaria, que en España no se publica por principio activo con dosis.',
  donde_esta_el_hospitalario:
    'El informe anual «Prestación Farmacéutica en el SNS» sí desglosa el consumo hospitalario por '
    + 'principio activo (ATC5), pero en euros a precio de venta de laboratorio y envases, no en '
    + 'DDD ni DHD, y como ranking de los mayores, no como lista completa.',
  donde_esta_el_hospitalario_url:
    'https://www.sanidad.gob.es/estadEstudios/estadisticas/sisInfSanSNS/tablasEstadisticas/'
    + 'InfAnual2024/Monografico_PrestacionFarmaceutica_2024.pdf',
  // Atribución exigida por el aviso legal del Ministerio: citar la fuente y mencionar la fecha de
  // última actualización, y no desnaturalizar el contenido.
  atribucion:
    'Información reutilizada del Ministerio de Sanidad conforme a su aviso legal '
    + '(https://www.sanidad.gob.es/avisoLegal/home.htm): se cita la fuente y la fecha de última '
    + 'actualización, y no se altera el contenido.',
  nota_dhd:
    'La DHD cuenta dosis diarias definidas, no personas. La DDD es una unidad técnica de la OMS y '
    + 'no equivale a la dosis prescrita ni a la recomendada.',
  nota_denominador:
    'La DHD de un grupo suma solo los medicamentos que tienen DDD asignada por la OMS.',
  fuente: 'Ministerio de Sanidad — Consumo en recetas médicas del SNS por ATC',
  fuente_url: `${BASE}home.htm`,
  metodologia_url: `${DOCS}Nota_CM_ATC.pdf`,
  atc5_desde: '2025',
});

// Un patrón por nivel. La jerarquía ATC es A > A02 > A02B > A02BC > A02BC01, y el nivel de un
// código se deduce de su longitud, que es lo que permite recorrer el árbol sin tabla aparte.
export const RE_NIVEL = Object.freeze({
  1: /^[A-V]$/,
  2: /^[A-V]\d{2}$/,
  3: /^[A-V]\d{2}[A-Z]$/,
  4: /^[A-V]\d{2}[A-Z]{2}$/,
  5: /^[A-V]\d{2}[A-Z]{2}\d{2}$/,
});

/** Nivel ATC de un código, por longitud: 1, 3, 4, 5 y 7 caracteres. */
export function nivelDe(codigo) {
  const L = { 1: 1, 3: 2, 4: 3, 5: 4, 7: 5 };
  return L[String(codigo || "").length] ?? null;
}

/** Código del padre. `A02BC01` → `A02BC` → `A02B` → `A02` → `A` → null. */
export function padreDe(codigo) {
  const corte = { 7: 5, 5: 4, 4: 3, 3: 1 };
  const n = corte[String(codigo || "").length];
  return n ? codigo.slice(0, n) : null;
}
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

/** Celda sin contenido: el estado normal de un c\u00f3digo al que la fuente no publica cifra. */
const esVacia = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// ── descubrimiento ──────────────────────────────────────────────────────────
export async function descubrirFicheros(anio, fetchImpl = fetch) {
  const r = await fetchImpl(`${BASE}${anio}.htm`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`Índice ${anio}: HTTP ${r.status}`);
  const html = await r.text();
  const out = [];
  for (const m of html.matchAll(/href="docs\/([^"]+\.xlsx)"/gi)) {
    const nombre = m[1];
    const nivel = nombre.match(/ATC(\d)/i);
    out.push({
      nombre,
      url: DOCS + nombre,
      nivel: nivel ? Number(nivel[1]) : null,
      esAnual: new RegExp(`^${anio}_ATC`, 'i').test(nombre),
      nombreNoCanonico: /ATC\d\d/i.test(nombre),
    });
  }
  return out;
}

export async function cabecerasDe(url, fetchImpl = fetch) {
  const r = await fetchImpl(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
  return {
    status: r.status,
    etag: r.headers.get('etag'),
    lastModified: r.headers.get('last-modified'),
    contentLength: r.headers.get('content-length'),
  };
}

export async function descargar(url, { etag, lastModified } = {}, fetchImpl = fetch) {
  const headers = { 'User-Agent': UA };
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  const r = await fetchImpl(url, { headers });
  if (r.status === 304) return { cambiado: false };
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  return {
    cambiado: true,
    buffer,
    etag: r.headers.get('etag'),
    lastModified: r.headers.get('last-modified'),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

// ── parseo ──────────────────────────────────────────────────────────────────
/**
 * Localiza la fila de cabecera por CONTENIDO y mapea columnas por su texto.
 * El año aparece dos veces en la cabecera: primero envases, después DHD. Ese orden es lo único
 * estable entre los cinco diseños observados.
 */
export function mapearColumnas(filas, anio) {
  for (const fila of filas) {
    const cols = Object.entries(fila.celdas);
    if (!cols.some(([, v]) => norm(v) === 'CODIGO')) continue;
    const mapa = {};
    let vistoAnio = 0;
    for (const [col, v] of cols) {
      const t = norm(v);
      if (t === 'CODIGO') mapa.codigo = col;
      else if (t === 'DESCRIPCION') mapa.descripcion = col;
      else if (t === String(anio)) { vistoAnio += 1; if (vistoAnio === 1) mapa.envases = col; else mapa.dhd = col; }
    }
    if (mapa.codigo && mapa.envases && mapa.dhd) return { fila: fila.n, mapa };
  }
  return null;
}

export function parsear(buffer, anio, nivel) {
  const filas = leerHoja(leerZip(buffer)); // hoja 1 = «Nº DE ENVASES – DHD»
  const cab = mapearColumnas(filas, anio);
  if (!cab) {
    throw new Error(
      `España ${anio} ATC${nivel}: no se reconoce la cabecera. El diseño de la tabla ha cambiado; `
      + 'revisar antes de publicar nada.',
    );
  }
  const re = RE_NIVEL[nivel];
  if (!re) throw new Error(`Nivel ATC no soportado: ${nivel}`);
  const out = new Map();
  const ilegibles = [];
  for (const f of filas) {
    if (f.n <= cab.fila) continue;
    const cod = f.celdas[cab.mapa.codigo];
    if (typeof cod !== 'string' || !re.test(cod.trim())) continue;
    const clave = cod.trim();

    // Un duplicado hay que cazarlo AQUÍ. Si se deja pasar, el `Map` pisa la primera fila con la
    // segunda y a partir de ese momento no queda rastro: cualquier comprobación posterior compara
    // el índice consigo mismo y sale verde. La versión anterior tenía justo ese hueco.
    if (out.has(clave)) {
      throw new Error(
        `España ${anio} ATC${nivel}: el código ${clave} aparece más de una vez en el fichero. `
        + 'Sin resolverlo a mano, una de las dos filas se perdería en silencio.',
      );
    }

    const dhd = f.celdas[cab.mapa.dhd];
    const env = f.celdas[cab.mapa.envases];
    const reg = { n: cab.mapa.descripcion ? (f.celdas[cab.mapa.descripcion] ?? null) : null };
    if (typeof env === 'number') reg.env = env;
    if (typeof dhd === 'number') { reg.dhd = dhd; if (dhd === 0) reg.z = 1; }
    out.set(clave, reg);

    // Celda VACÍA y celda ILEGIBLE no son lo mismo, y hasta aquí acababan igual: sin `dhd`.
    // La vacía es el estado normal de la fuente —medido el 05/09/2026 sobre los cinco niveles:
    // 353 de 1.575 códigos sin DHD, TODAS vacías, ninguna con texto—. La ilegible significa que
    // el formato ha cambiado y que se están perdiendo cifras que nadie echará en falta: el
    // código acabaría publicado como «sin DHD», indistinguible de una ausencia legítima.
    if (!esVacia(dhd) && typeof dhd !== 'number') ilegibles.push(`${clave} DHD=${JSON.stringify(dhd).slice(0, 40)}`);
    if (!esVacia(env) && typeof env !== 'number') ilegibles.push(`${clave} envases=${JSON.stringify(env).slice(0, 40)}`);
  }

  // Se lanza aquí, igual que con un duplicado o una cabecera irreconocible: son los tres la
  // misma clase de suceso —el fichero ya no es el que sabemos leer— y ninguno debe publicarse.
  if (ilegibles.length) {
    throw new Error(
      `España ${anio} ATC${nivel}: ${ilegibles.length} celda(s) con contenido que no es numérico. `
      + 'El formato de la fuente ha cambiado y esas cifras se perderían en silencio, publicadas '
      + `como si la tabla no las trajera. Primeras: ${ilegibles.slice(0, 5).join(' · ')}`,
    );
  }
  return out;
}

/** `Last-Modified` HTTP → ISO. El watchdog necesita la fecha de la FUENTE, no la de la ejecución. */
export function fechaFuenteISO(lastModified) {
  if (!lastModified) return null;
  const d = new Date(lastModified);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── árbol y denominador ─────────────────────────────────────────────────────
/**
 * Construye el árbol ATC1–ATC5 completo y clasifica el denominador de cada nodo con hijos.
 *
 * El árbol entero, no solo las hojas, porque la pregunta clínica interesante no es «cuánto se usa
 * este medicamento» sino «cómo se reparte el uso dentro de su grupo», y esa se hace navegando.
 * Son 1.575 nodos y ~28 KB comprimidos: cabe entero en una sola petición, y a partir de ahí toda
 * la navegación se resuelve en local sin volver a la red.
 *
 * Estados del denominador, iguales en los cinco niveles:
 *   completo → todos los hijos con consumo tienen DHD
 *   parcial  → hay hijos con envases y sin DDD asignada; se listan en `sin_ddd`
 *   nulo     → la DHD del nodo es 0,00 (redondeo), no existe, o la suma de hijos no cuadra
 *
 * Medido sobre 2025: de 951 códigos ATC5, 224 no tienen DHD y **207 sí tienen envases**. Eso deja
 * 37 grupos ATC4 cuyo denominador no ve parte de su propio consumo, alguno extremo — `S01ED51`
 * mueve 5,06 millones de envases dentro de un grupo cuya DHD total es 1,24.
 *
 * Y aun con `completo`, la cobertura no está garantizada: dentro de un mismo ATC5 la DHD puede
 * excluir vías de administración sin DDD (el Ministerio pone el ejemplo de G04BE). Por eso la UI
 * dice siempre «% de la DHD publicada» y nunca «% del grupo».
 */
export function construirArbol(niveles) {
  // Índice plano de los cinco niveles. La jerarquía se reconstruye por longitud de código, no por
  // una tabla aparte: A02BC01 → A02BC → A02B → A02 → A.
  const nodos = new Map();
  for (const n of [1, 2, 3, 4, 5]) {
    for (const [cod, v] of (niveles[n] ?? new Map())) {
      nodos.set(cod, {
        n: v.n ?? null,
        niv: n,
        dhd: typeof v.dhd === 'number' ? v.dhd : null,
        env: v.env ?? null,
        ...(v.z ? { z: 1 } : {}),
      });
    }
  }

  // Hijos directos de cada nodo.
  const hijosDe = new Map();
  for (const cod of nodos.keys()) {
    const padre = padreDe(cod);
    if (!padre || !nodos.has(padre)) continue;
    if (!hijosDe.has(padre)) hijosDe.set(padre, []);
    hijosDe.get(padre).push(cod);
    nodos.get(cod).p = padre;
  }

  // Clasificación del denominador, aplicada igual en los cinco niveles.
  for (const [cod, nodo] of nodos) {
    const hijos = hijosDe.get(cod);
    if (!hijos?.length) continue;

    const sinDdd = hijos.filter((k) => nodos.get(k).dhd === null && (nodos.get(k).env ?? 0) > 0);
    const conDhd = hijos.filter((k) => typeof nodos.get(k).dhd === 'number');
    const suma = conDhd.reduce((s, k) => s + nodos.get(k).dhd, 0);

    if (typeof nodo.dhd !== 'number' || nodo.dhd === 0) nodo.den = 'nulo';
    else if (sinDdd.length) nodo.den = 'parcial';
    else if (Math.abs(suma - nodo.dhd) / nodo.dhd > 0.02) nodo.den = 'nulo'; // descuadre inexplicado
    else nodo.den = 'completo';

    if (sinDdd.length) nodo.sin_ddd = sinDdd;
    // Solo los hijos con DHD llevan cuota; los demás se listan aparte en `sin_ddd`.
    nodo.h = conDhd.sort((a, b) => nodos.get(b).dhd - nodos.get(a).dhd);
  }


  // ── Reparto por ENVASES, solo donde no existe DDD en absoluto ──────────────
  //
  // Hay 156 nodos con volumen dispensado y sin DHD: los tópicos, sobre todo — dermatológicos,
  // óticos, oftálmicos —, cuyas presentaciones no tienen DDD asignada por la OMS. Hasta ahora
  // la capa decía de ellos «este grupo no tiene reparto publicado con DHD» sentada sobre el
  // 7,7 % del volumen dispensado del país, cuyo reparto SÍ está publicado.
  //
  // Esto no es una derivación como lo sería «DDD por envase», que exigiría población y días y
  // produciría una cifra que no se puede verificar contra nada. Es la MISMA división que ya se
  // hace para la DHD, sobre dos números de la misma fila del mismo fichero, y su resultado se
  // puede comprobar: la suma de los hijos tiene que dar el padre.
  //
  // Lo que un porcentaje de envases NO es: un reparto de tratamiento. Un envase no equivale a
  // otro en cantidad de fármaco —un frasco de 5 ml y uno de 10 ml cuentan igual—, y normalizar
  // eso es justamente para lo que existe la DDD. Por eso las cinco puertas de abajo, y por eso
  // la magnitud viaja en el dato (`mag`) y no solo en el texto: un consumidor que no la mire
  // no puede confundir un reparto con el otro, porque los miembros viven en claves distintas
  // (`h` para DHD, `he` para envases) y ningún nodo tiene las dos.
  for (const [cod, nodo] of nodos) {
    const hijos = hijosDe.get(cod);
    if (!hijos?.length) continue;

    // 1. El nodo NO tiene DHD publicada. `typeof` y no `> 0`: un nodo con DHD 0,00 sí tiene DDD
    //    asignada, solo que redondea a cero, y su reparto es el de dosis aunque salga diminuto.
    if (typeof nodo.dhd === 'number') continue;
    // 2. Tiene volumen propio sobre el que repartir.
    if (!(nodo.env > 0)) continue;
    // 3. NINGÚN hijo tiene DHD. Si alguno la tuviera, el reparto mezclaría dos magnitudes en la
    //    misma escala y eso es exactamente lo que no se puede hacer.
    if (hijos.some((k) => typeof nodos.get(k).dhd === 'number')) continue;
    // 4. Hay reparto real. Un único miembro al 100 % no reparte nada y ocupa una pantalla.
    const conEnv = hijos.filter((k) => (nodos.get(k).env ?? 0) > 0);
    if (conEnv.length < 2) continue;
    // 5. La suma de los hijos cuadra con el padre, con la misma tolerancia que ya se aplica al
    //    descuadre de la DHD. Es la única comprobación que puede desmentir el dato, así que es
    //    la que decide si se publica.
    const suma = conEnv.reduce((s, k) => s + nodos.get(k).env, 0);
    if (Math.abs(suma - nodo.env) / nodo.env > 0.02) continue;

    nodo.he = conEnv.sort((a, b) => nodos.get(b).env - nodos.get(a).env);
    nodo.mag = 'env';
  }
  return Object.fromEntries(nodos);
}

// ── construcción ────────────────────────────────────────────────────────────
export function construir({ niveles, anio, procedencia }) {
  const nodos = construirArbol(niveles);
  const porNivel = (n) => Object.values(nodos).filter((x) => x.niv === n).length;
  const conHijos = Object.values(nodos).filter((x) => x.h?.length);
  return {
    meta: {
      // Sube a 3 el 03/09/2026: los nodos ganan `he` y `mag` (reparto por envases). Los campos
      // anteriores no cambian, pero el esquema no es el mismo y decir que sí lo es impediría a
      // cualquier consumidor saber que hay algo nuevo que leer.
      schema_version: 3,
      generated_at: new Date().toISOString(),
      // Fecha de la FUENTE, no de la ejecución. Es la que debe vigilar el watchdog: si el
      // Ministerio deja de publicar años nuevos, `generated_at` se refresca cada mes igual y el
      // vigilante se quedaría verde para siempre mirando su propio reloj.
      fuente_fecha: fechaFuenteISO(procedencia?.atc5?.last_modified),
      periodo: String(anio),
      ...PERIMETRO,
      procedencia,
      n_nodos: Object.keys(nodos).length,
      n_por_nivel: { 1: porNivel(1), 2: porNivel(2), 3: porNivel(3), 4: porNivel(4), 5: porNivel(5) },
      n_atc5: porNivel(5),
      n_atc4: porNivel(4),
      n_grupos_completo: conHijos.filter((x) => x.den === 'completo').length,
      n_grupos_parcial: conHijos.filter((x) => x.den === 'parcial').length,
      // Grupos cuyo reparto es de ENVASES porque no existe DDD. Si esta cifra se desploma de
      // un mes a otro, la fuente ha cambiado algo en las filas sin DDD y hay que mirarlo.
      n_grupos_envases: Object.values(nodos).filter((x) => x.mag === 'env').length,
      avisos: [],
    },
    nodos,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function args(argv) {
  const o = { out: 'utilizacion.json', anio: null, headOnly: false, fromDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') o.out = argv[++i];
    else if (argv[i] === '--anio') o.anio = Number(argv[++i]);
    else if (argv[i] === '--head-only') o.headOnly = true;
    else if (argv[i] === '--from-dir') o.fromDir = argv[++i];
  }
  return o;
}

/** Último año con tabla anual ATC5 publicada. Nunca se asume: se comprueba. */
async function ultimoAnioConAtc5(desde) {
  for (let a = desde; a >= 2025; a--) {
    const fs = await descubrirFicheros(a).catch(() => []);
    if (fs.some((f) => f.esAnual && f.nivel === 5)) return { anio: a, ficheros: fs };
  }
  throw new Error('No hay ninguna tabla anual ATC5 publicada (el ATC5 español empieza en 2025)');
}

async function main() {
  const o = args(process.argv.slice(2));
  const anioBase = o.anio ?? new Date().getFullYear();

  const NIVELES = [1, 2, 3, 4, 5];

  if (o.fromDir) {
    const anio = o.anio ?? 2025;
    const niveles = {};
    for (const n of NIVELES) {
      const f = join(o.fromDir, `es_${anio}_ATC${n}.xlsx`);
      if (existsSync(f)) niveles[n] = parsear(readFileSync(f), anio, n);
    }
    const doc = construir({ niveles, anio, procedencia: { modo: 'from-dir', dir: o.fromDir } });
    const informe = validar(doc, null);
    doc.meta.avisos = informe.avisos;
    writeFileSync(o.out, JSON.stringify(doc), 'utf8');
    console.log(informe.texto);
    process.exit(informe.bloquea ? 1 : 0);
  }

  const { anio, ficheros } = await ultimoAnioConAtc5(anioBase);
  const anual = (n) => ficheros.find((f) => f.esAnual && f.nivel === n);
  const f5 = anual(5);
  for (const n of NIVELES) {
    if (!anual(n)) throw new Error(`${anio}: falta la tabla anual ATC${n}; el árbol necesita los cinco niveles`);
  }

  if (o.headOnly) {
    const h = await cabecerasDe(f5.url);
    console.log(JSON.stringify({ anio, fichero: f5.nombre, ...h }));
    return;
  }

  const noCanonicos = ficheros.filter((f) => f.nombreNoCanonico).map((f) => f.nombre);

  // Descarga realmente condicional: se reutilizan el ETag y el Last-Modified que guardó el run
  // anterior en el propio JSON. Antes la función los aceptaba y nadie se los pasaba, así que el
  // «condicional» estaba solo en el comentario.
  const anterior = existsSync(o.out) ? JSON.parse(readFileSync(o.out, 'utf8')) : null;
  const cond = (nivel) => {
    const p = anterior?.meta?.procedencia?.[`atc${nivel}`];
    return p && anterior?.meta?.periodo === String(anio)
      ? { etag: p.etag, lastModified: p.last_modified }
      : {};
  };

  const primera = {};
  for (const n of NIVELES) primera[n] = await descargar(anual(n).url, cond(n));
  if (NIVELES.every((n) => !primera[n].cambiado)) {
    console.log(`Sin cambios en origen (304 en los cinco niveles). Se conserva ${o.out}; no se republica.`);
    return;
  }
  // Si alguno no cambió hay que traérselo entero igualmente: el árbol se construye con los cinco a
  // la vez, y mezclar niveles de años distintos daría una jerarquía incoherente.
  const bruto = {};
  for (const n of NIVELES) bruto[n] = primera[n].cambiado ? primera[n] : await descargar(anual(n).url);

  const niveles = {};
  for (const n of NIVELES) niveles[n] = parsear(bruto[n].buffer, anio, n);

  const procedencia = { ficheros_no_canonicos: noCanonicos };
  for (const n of NIVELES) {
    procedencia[`atc${n}`] = {
      url: anual(n).url,
      etag: bruto[n].etag,
      last_modified: bruto[n].lastModified,
      sha256: bruto[n].sha256,
      bytes: bruto[n].buffer.length,
    };
  }

  const doc = construir({ niveles, anio, procedencia });

  const informe = validar(doc, anterior);
  doc.meta.avisos = informe.avisos;

  console.log(informe.texto);
  if (informe.bloquea) {
    console.error('\n::error::El dataset NO supera las validaciones. No se publica; KV conserva la versión anterior.');
    process.exit(1);
  }
  writeFileSync(o.out, JSON.stringify(doc), 'utf8');
  console.log(`\nEscrito ${o.out} — ${(Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(1)} KB`);
}

// `pathToFileURL` y no concatenar «file:///» + la ruta. La versión concatenada solo funcionaba en
// Windows: en Linux `process.argv[1]` ya empieza por «/», así que salía `file:////home/...` con
// cuatro barras, nunca casaba con `import.meta.url`, y el ETL terminaba con éxito **sin hacer
// nada**. Pasó en el primer run real del workflow: node salió en 48 ms, sin salida y sin fichero.
const ejecutadoDirectamente = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (ejecutadoDirectamente) {
  main().catch((e) => { console.error('fallo:', e.message); process.exit(1); });
}
