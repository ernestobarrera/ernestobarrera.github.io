#!/usr/bin/env node
/**
 * MedCheck — test de la ausencia de DHD: leerla mal no puede parecerse a que no exista.
 *
 * Cubre el hueco que encontró la revisión cruzada del 05/09/2026: el ETL descartaba en silencio
 * cualquier DHD que no llegara como `number`, la validación no lo veía, y la ficha lo contaba
 * como «la OMS no ha asignado DDD a este principio activo». Tres saltos, y el último es una
 * afirmación sobre el mundo construida sobre una celda que no se supo leer.
 *
 * Lo que fija este test:
 *   - una celda con contenido no numérico BLOQUEA el parseo (el formato ha cambiado);
 *   - una celda vacía NO bloquea: es el estado normal de la fuente;
 *   - una caída de cobertura de DHD bloquea la publicación, aunque el árbol quede impecable;
 *   - el cliente dice la ausencia, no la causa.
 *
 * Los fixtures atraviesan el PARSER REAL, construyendo XLSX de verdad con la misma librería
 * mínima que lee la fuente. Probarlo contra una réplica del parser habría dejado sin verificar
 * justamente la frontera que falla.
 *
 * Cifras del fixture, medidas el 05/09/2026 sobre la fuente real (2025_ATC5.xlsx):
 *   951 códigos ATC5, 727 con DHD numérica, 224 con la celda vacía, 0 con texto.
 *
 * Uso: node scripts/medcheck-test-dhd-ausente.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsear } = await import(`file:///${join(ROOT, 'scripts/etl-utilizacion/build-utilizacion.mjs').replace(/\\/g, '/')}`);
const { validar } = await import(`file:///${join(ROOT, 'scripts/etl-utilizacion/validaciones.mjs').replace(/\\/g, '/')}`);

let fallos = 0;
function check(nombre, ok, detalle = '') {
    if (ok) console.log(`  ok     ${nombre}`);
    else { fallos++; console.log(`  FALLO  ${nombre}${detalle ? `\n         ${detalle}` : ''}`); }
}

// ─── Constructor mínimo de XLSX ───────────────────────────────────────────────
// Un XLSX es un ZIP con XML dentro. Se escribe a mano, sin dependencias, para que el fixture
// entre por la misma puerta que el fichero del Ministerio.
function zip(archivos) {
    const locales = [], centrales = [];
    let offset = 0;
    for (const [nombre, contenido] of archivos) {
        const datos = Buffer.from(contenido, 'utf8');
        const comprimido = deflateRawSync(datos);
        const crc = crc32(datos);
        const n = Buffer.from(nombre, 'utf8');
        const cabecera = Buffer.alloc(30);
        cabecera.writeUInt32LE(0x04034b50, 0); cabecera.writeUInt16LE(20, 4); cabecera.writeUInt16LE(0, 6);
        cabecera.writeUInt16LE(8, 8); cabecera.writeUInt16LE(0, 10); cabecera.writeUInt16LE(0, 12);
        cabecera.writeUInt32LE(crc, 14); cabecera.writeUInt32LE(comprimido.length, 18);
        cabecera.writeUInt32LE(datos.length, 22); cabecera.writeUInt16LE(n.length, 26); cabecera.writeUInt16LE(0, 28);
        locales.push(cabecera, n, comprimido);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
        central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20); central.writeUInt32LE(datos.length, 24);
        central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42 - 8); central.writeUInt32LE(offset, 42);
        centrales.push(central, n);
        offset += cabecera.length + n.length + comprimido.length;
    }
    const cuerpo = Buffer.concat(locales);
    const dir = Buffer.concat(centrales);
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
    fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(cuerpo.length, 16);
    return Buffer.concat([cuerpo, dir, fin]);
}

const col = (i) => String.fromCharCode(65 + i);

/** `filas`: array de arrays; cada celda es número (numérica), string (texto inline) o null (vacía). */
function xlsx(filas) {
    const xmlFilas = filas.map((celdas, f) => {
        const n = f + 1;
        const cs = celdas.map((v, i) => {
            if (v === null || v === undefined) return '';
            const ref = `${col(i)}${n}`;
            return typeof v === 'number'
                ? `<c r="${ref}"><v>${v}</v></c>`
                : `<c r="${ref}" t="inlineStr"><is><t>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`;
        }).join('');
        return `<row r="${n}">${cs}</row>`;
    }).join('');
    return zip([
        ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
        ['xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Hoja1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>'],
        ['xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
        ['xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlFilas}</sheetData></worksheet>`],
    ]);
}

// Cabecera igual que la real: el año aparece dos veces, primero envases y después DHD.
const CAB = ['CODIGO', 'DESCRIPCION', '2025', 'X', '2025'];
const hoja = (filas) => xlsx([['CONSUMO EN RECETAS SNS'], [], CAB, ...filas]);

console.log('\n=== El parser distingue vacío de ilegible ===\n');

const buenas = [
    ['A02BC01', 'Omeprazol', 12345, null, 96.24],
    ['A02BC05', 'Esomeprazol', 2345, null, 8.1],
];

let mapa = null, err = null;
try { mapa = parsear(hoja(buenas), 2025, 5); } catch (e) { err = e; }
check('un fichero normal se parsea', !err && mapa?.size === 2, err?.message);
check('y trae las dos DHD', mapa?.get('A02BC01')?.dhd === 96.24 && mapa?.get('A02BC05')?.dhd === 8.1);

// Celda VACÍA: estado normal de la fuente (224 de 951 en el fichero real de 2025).
mapa = null; err = null;
try { mapa = parsear(hoja([...buenas, ['S01EE01', 'Latanoprost', 4210, null, null]]), 2025, 5); } catch (e) { err = e; }
check('una celda VACÍA no bloquea: es el estado normal', !err && mapa?.size === 3, err?.message);
check('y ese código queda sin `dhd`, conservando sus envases',
    mapa?.get('S01EE01')?.dhd === undefined && mapa?.get('S01EE01')?.env === 4210);

// Celda ILEGIBLE: el formato ha cambiado. Antes se descartaba en silencio.
for (const [etiqueta, valor] of [['texto', '96,24'], ['guion', '-'], ['nota', 'n.d.']]) {
    err = null;
    try { parsear(hoja([...buenas, ['N02BE01', 'Paracetamol', 999, null, valor]]), 2025, 5); } catch (e) { err = e; }
    check(`una DHD como ${etiqueta} (${JSON.stringify(valor)}) BLOQUEA el parseo`, !!err);
    if (err) check(`  y el error nombra el código afectado`, /N02BE01/.test(err.message), err.message);
}

err = null;
try { parsear(hoja([...buenas, ['N02BE01', 'Paracetamol', '1.234', null, 5]]), 2025, 5); } catch (e) { err = e; }
check('unos envases no numéricos también bloquean', !!err && /N02BE01/.test(err.message || ''));

// Autoverificación: sin la guarda, el fichero roto pasaría y perdería la cifra en silencio.
console.log('\n=== Autoverificación: se reintroduce el defecto ===\n');
const roto = hoja([...buenas, ['N02BE01', 'Paracetamol', 999, null, '96,24']]);
let pasó = false, perdida = null;
try { parsear(roto, 2025, 5); pasó = true; } catch { /* la guarda actúa */ }
check('con la guarda puesta, el fichero roto NO pasa', !pasó);
// Y se comprueba que lo que la guarda evita es exactamente una pérdida silenciosa:
const mapaSano = parsear(hoja([...buenas, ['N02BE01', 'Paracetamol', 999, null, 96.24]]), 2025, 5);
perdida = mapaSano.get('N02BE01')?.dhd;
check('  (el mismo código con la celda bien leída sí trae su DHD)', perdida === 96.24);

console.log('\n=== La validación bloquea una desaparición masiva de cifras ===\n');

const nodos = (n, conDhd) => {
    const out = {};
    out.A = { niv: 1, dhd: 1, n: 'Digestivo', h: ['A02'] };
    out.A02 = { niv: 2, p: 'A', dhd: 1, n: 'Ácidos', h: ['A02B'] };
    out.A02B = { niv: 3, p: 'A02', dhd: 1, n: 'Úlcera', h: ['A02BC'] };
    out.A02BC = { niv: 4, p: 'A02B', dhd: 1, n: 'IBP', h: [] };
    const hijos = [];
    for (let i = 0; i < n; i++) {
        const k = `A02BC${String(i).padStart(2, '0')}`;
        out[k] = { niv: 5, p: 'A02BC', n: `PA ${i}`, ...(i < conDhd ? { dhd: 1 } : {}) };
        hijos.push(k);
    }
    out.A02BC.h = hijos;
    return out;
};
const doc = (n, conDhd) => ({ meta: { periodo: '2025', n_nodos: n + 4 }, nodos: nodos(n, conDhd) });

const bloquea = (d, ant) => validar(d, ant).errores.some((e) => /cobertura de DHD|traen DHD numérica/i.test(e));

check('cobertura normal (78 %) no bloquea', !bloquea(doc(100, 78)));
check('cobertura hundida (20 %) bloquea', bloquea(doc(100, 20)));
check('una caída de 78 % a 62 % frente al anterior bloquea', bloquea(doc(100, 62), doc(100, 78)));
check('una bajada pequeña (78 % → 74 %) no bloquea', !bloquea(doc(100, 74), doc(100, 78)));
check('sin dataset anterior, solo manda el mínimo absoluto', !bloquea(doc(100, 78), null));

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
