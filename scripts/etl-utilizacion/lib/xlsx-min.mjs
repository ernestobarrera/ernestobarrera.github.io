/**
 * Lector mínimo de XLSX, sin dependencias (el repo no tiene package.json y no se le añade uno
 * por un spike). Solo hace falta leer celdas de texto y número de una hoja: no formato, no
 * fórmulas, no fechas.
 *
 * Un .xlsx es un ZIP con XML dentro. Node trae `zlib`, así que se descomprime a mano: se recorre
 * el directorio central del ZIP y se inflan las entradas necesarias.
 */
import { inflateRawSync } from 'node:zlib';

/** Devuelve un Map nombreEntrada -> Buffer con el contenido de un ZIP en memoria. */
export function leerZip(buf) {
  // Localizar el End Of Central Directory (firma 0x06054b50) desde el final.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('No es un ZIP válido (falta EOCD)');

  const nEntradas = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const salida = new Map();

  for (let n = 0; n < nEntradas; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Cabecera de directorio central inesperada');
    const metodo = buf.readUInt16LE(off + 10);
    const tamComp = buf.readUInt32LE(off + 20);
    const lenNombre = buf.readUInt16LE(off + 28);
    const lenExtra = buf.readUInt16LE(off + 30);
    const lenComent = buf.readUInt16LE(off + 32);
    const offLocal = buf.readUInt32LE(off + 42);
    const nombre = buf.toString('utf8', off + 46, off + 46 + lenNombre);

    // Cabecera local: los campos de longitud pueden diferir de los del directorio central.
    const lnNombre = buf.readUInt16LE(offLocal + 26);
    const lnExtra = buf.readUInt16LE(offLocal + 28);
    const inicio = offLocal + 30 + lnNombre + lnExtra;
    const crudo = buf.subarray(inicio, inicio + tamComp);
    salida.set(nombre, metodo === 0 ? crudo : inflateRawSync(crudo));

    off += 46 + lenNombre + lenExtra + lenComent;
  }
  return salida;
}

function desescapar(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Lee una hoja como array de filas; cada fila es `{ n: numeroDeFila, celdas: {A: valor, ...} }`.
 * Las celdas vacías simplemente no aparecen.
 */
export function leerHoja(zip, rutaHoja = 'xl/worksheets/sheet1.xml') {
  const ssBuf = zip.get('xl/sharedStrings.xml');
  const compartidas = [];
  if (ssBuf) {
    const ss = ssBuf.toString('utf8');
    for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const trozos = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
      compartidas.push(desescapar(trozos.join('')));
    }
  }

  const hojaBuf = zip.get(rutaHoja);
  if (!hojaBuf) throw new Error(`No existe la hoja ${rutaHoja}`);
  const xml = hojaBuf.toString('utf8');

  const filas = [];
  for (const mf of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = {};
    for (const mc of mf[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const [, col, attrs, dentro] = mc;
      if (/t="inlineStr"/.test(attrs)) {
        const t = dentro.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        if (t) celdas[col] = desescapar(t[1]);
        continue;
      }
      const v = dentro.match(/<v>([\s\S]*?)<\/v>/);
      if (!v) continue;
      celdas[col] = /t="s"/.test(attrs) ? compartidas[Number(v[1])]
        : /t="str"/.test(attrs) ? desescapar(v[1])
          : Number(v[1]);
    }
    filas.push({ n: Number(mf[1]), celdas });
  }
  return filas;
}
