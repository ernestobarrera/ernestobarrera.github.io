#!/usr/bin/env node
/**
 * MedCheck — auditoría de la PREMISA de los excipientes: ¿declara CIMA todos los obligatorios?
 *
 * TODO lo que MedCheck enseña de excipientes descansa en una sola afirmación: que el campo
 * `excipientes` de CIMA contiene los de declaración obligatoria de esa ficha, y no una selección
 * caprichosa. Esa afirmación se comprobó a mano el 17/09/2026 —PENILEVEL 250 mg declara 3 de los 4
 * de su ficha y deja fuera justo la esencia de plátano, que no es declarable— y con 116 nombres
 * recogidos en 287 medicamentos sin un solo relleno corriente. Pero **comprobar casos no es
 * vigilar**: si CIMA cambiara su criterio, o dejara de rellenar el campo para una familia de
 * productos, el cliente seguiría enseñando ceros y cifras con la misma confianza de siempre.
 *
 * Esto lo vigila por muestreo, FUERA del cliente: no añade ni una petición al uso normal.
 *
 *   node scripts/medcheck-audit-excipientes.mjs [--n 200] [--json <ruta>]
 *
 * CÓMO FUNCIONA, y por qué así:
 *   1. Toma una muestra aleatoria de comercializados del índice de financiación (que es el censo
 *      que ya vive en el repo, así que no hace falta pedirle a CIMA la lista entera).
 *   2. Con lo que CADA UNO declara, construye el vocabulario de excipientes declarables. Se
 *      construye de los datos y no de una lista escrita a mano a propósito: una lista nuestra
 *      envejecería y acabaría auditando nuestro recuerdo en vez del comportamiento de la fuente.
 *   3. Para cada medicamento con ficha técnica publicada, lee su sección 6.1 y busca términos del
 *      vocabulario que ESTÉN EN EL TEXTO y NO en lo declarado.
 *
 * `CONTRATO:` UN HALLAZGO ES UN CANDIDATO A REVISAR, NUNCA UN ERROR PROBADO. Varios excipientes
 * solo son declarables por encima de un umbral —el sodio, a partir de 1 mmol por dosis— así que
 * su presencia en la 6.1 sin estar declarado puede ser correcta. El script señala dónde mirar; no
 * dictamina. Prometer más sería el guardián que aprueba (o condena) sin haber podido juzgar.
 *
 * Tres estados, como `check-publicado.mjs`:
 *   0 OK · 1 discrepancias a revisar · 2 INCONCLUSO (no se pudo auditar lo suficiente)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASE = 'https://cima.aemps.es/cima/rest';

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const N = Math.max(20, parseInt(argOf('--n', '200'), 10) || 200);
const OUT = argOf('--json', null);

/** Cobertura mínima para que la auditoría signifique algo. Por debajo es INCONCLUSO, no OK: una
 *  muestra que no se pudo leer no demuestra que no haya nada que encontrar. */
const MIN_AUDITABLES = 8;

const sinAcentos = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * La palabra con la que se reconoce un excipiente en un texto corrido.
 *
 * Se usa el token significativo más LARGO del nombre y no el nombre entero, porque la ficha lo
 * escribe de otra forma que el campo: «SORBITOL LIQUIDO NO CRISTALIZABLE (E420)» en uno y
 * «solución de sorbitol al 70 %» en el otro. Comparar cadenas completas no encontraría ni uno.
 * Se exigen 6 caracteres para no casar por «sodio» o «acido», que están en medio catálogo.
 */
function claveDeTexto(nombre) {
    const tokens = sinAcentos(nombre).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(t => t.length >= 6 && !['liquido', 'solucion', 'monohidrato', 'anhidro', 'anhidra', 'sodico', 'sodica', 'potasico'].includes(t));
    if (!tokens.length) return null;
    return tokens.sort((a, b) => b.length - a.length)[0];
}

async function pedir(url) {
    try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const t = await r.text();
        if (!t) return null;
        try { return JSON.parse(t); } catch { return t; }
    } catch { return null; }
}

async function ft61(nregistro) {
    const d = await pedir(`${BASE}/docSegmentado/contenido/1?nregistro=${encodeURIComponent(nregistro)}&seccion=6.1`);
    const bruto = Array.isArray(d) ? d.map(x => x?.contenido || '').join(' ') : '';
    const texto = bruto.replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    return texto.length >= 10 ? texto : null;
}

async function main() {
    const idx = JSON.parse(readFileSync(join(ROOT, 'assets/data/financiacion-index.json'), 'utf8')).fin;
    const censo = Object.keys(idx).filter(k => Array.isArray(idx[k]) && idx[k][0] > 0);
    if (censo.length < 1000) {
        console.error('INCONCLUSO: el índice de financiación no trae censo utilizable.');
        process.exit(2);
    }

    const usados = new Set();
    const muestra = [];
    while (muestra.length < Math.min(N, censo.length)) {
        const i = Math.floor(Math.random() * censo.length);
        if (!usados.has(i)) { usados.add(i); muestra.push(censo[i]); }
    }

    const registros = [];
    let sinDetalle = 0;
    const LOTE = 6;
    for (let i = 0; i < muestra.length; i += LOTE) {
        await Promise.all(muestra.slice(i, i + LOTE).map(async (n) => {
            const m = await pedir(`${BASE}/medicamento?nregistro=${encodeURIComponent(n)}`);
            if (!m || !m.nregistro) { sinDetalle += 1; return; }
            registros.push({
                nregistro: n,
                nombre: m.nombre || '',
                declarados: (m.excipientes || []).map(e => e.nombre).filter(Boolean),
                seis1: await ft61(n),
            });
        }));
        process.stderr.write(`\r  leídos ${registros.length}/${muestra.length}`);
    }
    process.stderr.write('\n');

    // El vocabulario sale de los propios datos (paso 2 de la cabecera).
    const vocab = new Map();   // clave de texto -> nombre representativo
    for (const r of registros) {
        for (const nombre of r.declarados) {
            const k = claveDeTexto(nombre);
            if (k && !vocab.has(k)) vocab.set(k, nombre);
        }
    }

    // SE DESCARTAN LOS TÉRMINOS GENÉRICOS, Y EL UMBRAL SE CALIBRA CON LOS DATOS, no con una lista
    // escrita a mano. Motivo: la clave se extrae del token más largo de un nombre declarado, y a
    // veces ese token es química corriente —«microcristalina» viene de «CELULOSA MICROCRISTALINA-
    // CARMELOSA SODICA», «almidon» de «ALMIDON DE TRIGO»— que aparece en media farmacopea. En la
    // primera pasada, 12 de los 12 términos más frecuentes eran de esa clase y tapaban los dos que
    // sí valían (el E-110 y el aceite de soja).
    //
    // Un término presente en más del 15 % de las fichas leídas no distingue nada, así que no puede
    // sostener un hallazgo. El umbral sale de la muestra: una lista de palabras prohibidas
    // envejecería igual que la que este script evita a propósito.
    const UMBRAL_GENERICO = 0.15;
    const textosNorm = registros.filter(r => r.seis1).map(r => sinAcentos(r.seis1));
    const genericos = new Set();
    for (const k of vocab.keys()) {
        const df = textosNorm.filter(t => t.includes(k)).length / Math.max(1, textosNorm.length);
        if (df > UMBRAL_GENERICO) genericos.add(k);
    }
    for (const k of genericos) vocab.delete(k);

    // SE AUDITA EL CERO, Y SOLO EL CERO. Es la única afirmación que MedCheck hace por su cuenta:
    // «este medicamento no tiene ningún excipiente de declaración obligatoria». Las demás no
    // afirman completitud —«declara 3» es cierto por construcción, sea cual sea el criterio de
    // CIMA— así que auditarlas era producir ruido sobre algo que nadie promete.
    //
    // La primera versión de este script sí las auditaba todas, y el resultado lo desaconsejó solo:
    // 61 de 105 medicamentos con «candidatos», encabezados por «aluminio» (extraído de una laca de
    // Ponceau 4R y casando con cualquier hidróxido de aluminio) y por «carmelosa», que es
    // declarable solo por encima del umbral de sodio. Un aviso que casi siempre es ruido se aprende
    // a ignorar entero, y entonces el que traiga algo tampoco se mira.
    const auditables = registros.filter(r => r.seis1 && r.declarados.length === 0);
    const hallazgos = [];
    for (const r of auditables) {
        const texto = sinAcentos(r.seis1);
        for (const [k, ejemplo] of vocab) {
            if (!texto.includes(k)) continue;
            hallazgos.push({ nregistro: r.nregistro, nombre: r.nombre, termino: k, ejemplo, declarados: 0 });
        }
    }

    const porTermino = new Map();
    for (const h of hallazgos) porTermino.set(h.termino, (porTermino.get(h.termino) || 0) + 1);

    console.log('');
    console.log(`Muestra pedida ........ ${muestra.length}`);
    console.log(`Con detalle en CIMA ... ${registros.length}  (sin detalle: ${sinDetalle})`);
    const conCero = registros.filter(r => r.declarados.length === 0).length;
    console.log(`Declaran CERO ......... ${conCero}   <- la única afirmación que auditamos`);
    console.log(`   de ellos, con 6.1 .. ${auditables.length}   <- los que se pueden contrastar`);
    console.log(`Vocabulario derivado .. ${vocab.size} términos distintivos (${genericos.size} genéricos descartados)`);
    console.log(`Ceros con algo en su 6.1 que el vocabulario reconoce: ${new Set(hallazgos.map(h => h.nregistro)).size}`);

    if (porTermino.size) {
        console.log('\nTérminos que aparecen en la 6.1 sin estar declarados (candidatos a revisar):');
        for (const [t, n] of [...porTermino.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
            console.log(`  ${String(n).padStart(4)}  ${t}   (p. ej. «${vocab.get(t)}»)`);
        }
        console.log('\n  RECORDATORIO: un candidato NO es un error. Varios excipientes solo son');
        console.log('  declarables por encima de un umbral (el sodio, a partir de 1 mmol por dosis),');
        console.log('  así que aparecer en la ficha sin estar declarado puede ser correcto.');
    }

    if (OUT) {
        writeFileSync(resolve(OUT), JSON.stringify({
            generado: new Date().toISOString().slice(0, 10),
            muestra: muestra.length, conDetalle: registros.length, auditables: auditables.length,
            vocabulario: [...vocab.keys()], hallazgos,
        }, null, 1));
        console.log(`\nDetalle en ${resolve(OUT)}`);
    }

    if (auditables.length < MIN_AUDITABLES) {
        console.log(`\nINCONCLUSO: solo ${auditables.length} medicamentos auditables (mínimo ${MIN_AUDITABLES}).`);
        console.log('No se ha podido mirar lo suficiente; esto NO significa que esté todo bien.');
        process.exit(2);
    }
    if (hallazgos.length) {
        console.log('\nDISCREPANCIAS: hay candidatos que revisar (ver arriba).');
        process.exit(1);
    }
    console.log('\nOK: en esta muestra, todo lo que aparece en la 6.1 y pertenece al vocabulario');
    console.log('    declarable estaba declarado. La premisa se sostiene donde se ha podido mirar.');
    process.exit(0);
}

// Resuelve enlaces por los DOS lados: la carpeta puede consumirse por symlink y entonces
// `import.meta.url` (ruta real) nunca casaría con `process.argv[1]` (ruta tecleada). Un script que
// no arranca aprueba en silencio, que es peor que no tenerlo.
const esteFichero = realpathSync(fileURLToPath(import.meta.url));
const invocado = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (esteFichero === invocado) {
    main().catch((e) => { console.error('INCONCLUSO:', e.message); process.exit(2); });
}

export { claveDeTexto };
