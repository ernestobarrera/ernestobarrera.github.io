#!/usr/bin/env node
/**
 * MedCheck — compilador de identidad de sustancia (pasos 1 y 2 de la hoja de ruta del acta
 * ia-config/actas/2026-08-18_acta-medcheck-identidad-sustancia.md)
 *
 * QUÉ HACE: barre los nombres de sustancia de CIMA que hoy quedan sin verificar, busca su
 * término inglés en DOS AUTORIDADES independientes y escribe un BASELINE de candidatos.
 *
 * QUÉ NO HACE, y es lo que lo mantiene dentro de la doctrina «espejo, no juez»:
 *   - NO escribe `inn-es-en.json`. Propone; la incorporación es una decisión humana.
 *   - NO inventa traducciones. Una regla de sufijo puede sugerir un candidato, jamás sellarlo.
 *   - NO desempata. Si las dos autoridades dan términos distintos, el estado es `review`:
 *     elegir sería juzgar.
 *
 * LAS DOS AUTORIDADES (y por qué son complementarias, medido el 18/08/2026):
 *   A) SNOMED CT. CIMA ya trae `vtm.id`, que es un SCTID. Resuelto en RxNav (NLM) por
 *      `idtype=SNOMEDCT&allsrc=1`. Sobre 137 nombres problemáticos: resuelve 81 de los 83 con
 *      identificador INTERNACIONAL (98 %) y 0 de los 54 de la EXTENSIÓN ESPAÑOLA.
 *   B) PubMed. `esearch` devuelve `querytranslation`, donde el motor declara cómo interpretó la
 *      consulta. Si aparece un concepto controlado, ahí está el término inglés que PubMed usa.
 *      Rescata `ácido ursodeoxicólico` y `brentuximab vedotina`, que SNOMED no; y al revés,
 *      SNOMED rescata `ácido ibandrónico` y `ácido alendrónico`, que PubMed no.
 *
 * UNA RUTA VÁLIDA BASTA; LA CONVERGENCIA REFUERZA (corrección de Codex, aceptada). Exigir
 * convergencia desperdiciaría justo la complementariedad medida. El silencio de una autoridad
 * no es discrepancia.
 *
 * FILTRO POSITIVO para PubMed (corrección de Codex): no basta una lista negra sacada de la
 * muestra. Se exige que el concepto CUBRA EL NOMBRE COMPLETO, no un fragmento — PubMed mapea
 * lo que reconoce, y `vacuna anti virus respiratorio sincitial` devuelve `viruses`.
 *
 * Uso:
 *   node scripts/medcheck-compile-identity.mjs            # compila y escribe el baseline
 *   node scripts/medcheck-compile-identity.mjs --seco     # no escribe; imprime lo que haría
 *   node scripts/medcheck-compile-identity.mjs --max=20   # acota el barrido (pruebas)
 *
 * Salida: assets/data/substance-identity-baseline.json
 * Contrato de salida: 0 compilación completa · 2 inconclusa (red/API). Nunca 1: proponer
 * candidatos no es un gate; el que bloquea es el auditor del paso 4.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const args = process.argv.slice(2);
const seco = args.includes('--seco');
const maxArg = args.find(a => a.startsWith('--max='));
const MAX = maxArg ? Number(maxArg.slice(6)) : Infinity;
const HOY = new Date().toISOString().slice(0, 10);

// ---- Resolutor real del repo (no se reimplementa: si cambia, este script cambia con él) ----
const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sin red durante la carga')),
    JSON, Math, Date, String, Object, Array, Set, Map, RegExp, Promise,
    encodeURIComponent, setTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const dict = sandbox.window.innDict;
dict.map = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8')).map;
dict.loaded = true;

// ---- Contrato de red: lo que no se pudo medir es INCONCLUSO, nunca "limpio" ----
let inconcluso = 0;
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function pedir(url, intentos = 3) {
    for (let i = 1; i <= intentos; i += 1) {
        try {
            const r = await fetch(url, { headers: { accept: 'application/json' } });
            if (r.ok) return await r.json();
            if (r.status < 500 && r.status !== 429) return null;   // 404 legítimo
        } catch { /* red */ }
        if (i < intentos) await dormir(400 * i);
    }
    inconcluso += 1;
    return undefined;   // undefined = no se pudo medir; null = medido y ausente
}

const norm = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ---- Comprobación de PARENTESCO, comun a las dos autoridades ----
// Una autoridad puede devolver una CLASE en vez de la sustancia: RxNav da `factor ix fc fusion
// protein` para eftrenonacog alfa, y la propia API advierte de que algunas correspondencias son
// categoricas. Buscar por la clase no es traducir: ensancha. Y PubMed mapea fragmentos.
//
// Regla: el termino ingles propuesto debe compartir RAIZ con algun token del nombre espanol
// (>=5 caracteres) o coincidir en un token exacto (cubre `macrogol 4000` -> `polyethylene glycol
// 4000`). Si no lo comparte NO se descarta y NO se acepta: pasa a `review`, porque puede ser un
// sinonimo legitimo — `acetilsalicilico` -> `aspirin` lo es — y elegir seria juzgar.
function comparteRaiz(es, en) {
  const RUIDO = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'anti', 'para', 'en', 'acido', 'acid', 'alfa', 'alpha', 'beta', 'human', 'humana']);
  const tes = norm(es).split(' ').filter(t => t.length > 2 && !RUIDO.has(t));
  const ten = norm(en).split(' ').filter(t => t.length > 2 && !RUIDO.has(t));
  if (!tes.length || !ten.length) return false;
  // TODOS los tokens significativos del espanol deben quedar cubiertos, no solo uno: un unico
  // token coincidente es justo lo que parece un FRAGMENTO. `vacuna anti algo raro` -> `algo`
  // compartia "algo" y se colaba como traduccion. (Correccion de Codex: ningun token
  // significativo sin consumir.)
  const cubierto = a => ten.some(b => a === b || (a.length >= 5 && b.length >= 5
    && (a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5)))));
  return tes.every(cubierto);
}

// ---- Autoridad A: SNOMED CT (vtm.id de CIMA) vía RxNav ----
async function porSnomed(sctid, nombreEs) {
    const d = await pedir(`https://rxnav.nlm.nih.gov/REST/rxcui.json?idtype=SNOMEDCT&id=${sctid}&allsrc=1`);
    if (d === undefined) return { estado: 'inconcluso' };
    const ids = d?.idGroup?.rxnormId || [];
    if (!ids.length) return { estado: 'ausente' };
    const p = await pedir(`https://rxnav.nlm.nih.gov/REST/rxcui/${ids[0]}/property.json?propName=RxNorm%20Name`);
    if (p === undefined) return { estado: 'inconcluso' };
    const nombre = p?.propConceptGroup?.propConcept?.[0]?.propValue || null;
    // Un identificador sin nombre vigente no sirve para buscar: se registra como ausente, no
    // como hallazgo. Es el caso de las vacunas (conceptos no vigentes).
    if (!nombre) return { estado: 'ausente' };
    // Mismo rasero que PubMed: si no comparte raiz, puede ser una clase y no la sustancia.
    if (!comparteRaiz(nombreEs, nombre)) {
        return { estado: 'ensancha', candidato: nombre, evidencia: `rxcui ${ids[0]} devuelve "${nombre}", que no comparte raiz` };
    }
    return { estado: 'ok', en: nombre, evidencia: `rxcui ${ids[0]} · SNOMEDCT ${sctid}` };
}

// ---- Autoridad B: PubMed, leyendo cómo tradujo él mismo la consulta ----
const CONCEPTO = /"([^"]+)"\[(?:MeSH Terms|Supplementary Concept)\]/g;
async function porPubmed(nombreEs) {
    const p = new URLSearchParams({ db: 'pubmed', term: nombreEs, retmode: 'json', retmax: '0' });
    const d = await pedir(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${p}`);
    if (d === undefined) return { estado: 'inconcluso' };
    const trad = d?.esearchresult?.querytranslation || '';
    const conceptos = [...new Set([...trad.matchAll(CONCEPTO)].map(m => m[1]))];
    if (!conceptos.length) return { estado: 'ausente', evidencia: trad.slice(0, 120) };

    // FILTRO POSITIVO. El concepto tiene que dar cuenta del nombre ENTERO, no de un trozo.
    // Se comprueba que ningún token significativo del nombre español quede sin consumir por el
    // concepto propuesto o por el propio texto de la traducción como forma reconocida.
    const elegido = conceptos.find(c => comparteRaiz(nombreEs, c));
    if (!elegido) {
        return { estado: 'fragmento', candidato: conceptos[0], evidencia: `no cubre el nombre completo: ${conceptos[0]}` };
    }
    return { estado: 'ok', en: elegido, evidencia: `querytranslation: "${elegido}"` };
}

// ---- Recolección: nombres de sustancia sin verificar, con su SCTID y su volumen ----
const NO_INFORMATIVO = /^(multicomponente|varios|asociaciones|combinaciones)$/i;
const LETRAS = ['A', 'B', 'C', 'D', 'G', 'H', 'J', 'L', 'M', 'N', 'P', 'R', 'S', 'V'];

// CIMA PAGINA A 200, y el corpus es grande de verdad: solo la letra A tiene 15752 productos
// comercializados. La primera version de esta funcion leia UNA pagina por letra —2800 de unos
// 70.000— y por eso `esketamina` (SPRAVATO), que es el caso que origino todo este trabajo,
// nunca entro en el barrido. Un compilador que muestrea deja justo los agujeros que existe para
// cerrar. Se recorren todas las paginas.
async function recolectar() {
    const pend = new Map();
    for (const L of LETRAS) {
        let pagina = 1, total = null;
        for (;;) {
        const d = await pedir(`https://cima.aemps.es/cima/rest/medicamentos?atc=${L}&comerc=1&pagina=${pagina}`);
        if (!d) break;
        if (total === null) total = Number(d.totalFilas || 0);
        if (!(d.resultados || []).length) break;
        for (const med of d.resultados || []) {
            const vtm = (med?.vtm?.nombre || '').trim();
            const sctid = med?.vtm?.id ? String(med.vtm.id) : null;
            if (!vtm || NO_INFORMATIVO.test(vtm)) continue;
            const comps = vtm.split(/[+,/]/).map(s => s.trim()).filter(Boolean)
                .map(c => dict.toSearchTerm(c, { allowCounterionTrim: false }));
            // Solo interesa lo que el contrato del paso 0 marca como no verificado.
            if (!comps.some(c => c.verificationStatus === 'unverified')) continue;
            const e = pend.get(vtm) || { sctid, productos: 0, combinacion: comps.length > 1 };
            e.productos += 1;
            pend.set(vtm, e);
        }
            pagina += 1;
            if (total && pagina > Math.ceil(total / 200)) break;
            if (pagina > 400) break;    // tope de seguridad ante una paginacion que no termine
            await dormir(130);
        }
        process.stdout.write(`  ${L}: ${total ?? '?'} productos · acumulados ${pend.size} nombres sin verificar\n`);
    }
    return pend;
}

// ---- Compilación ----
console.log('# Compilador de identidad de sustancia\n');
const pendientes = await recolectar();
console.log(`nombres sin verificar recolectados: ${pendientes.size}`);

// INCREMENTAL. A esta escala una pasada completa son miles de consultas a dos APIs: si el
// compilador tuviera que rehacerlo todo cada vez, no se ejecutaria nunca. Lo ya resuelto en una
// pasada anterior se conserva y no se vuelve a preguntar; se retoma por donde quedo, priorizando
// siempre lo que mas productos arrastra. `--rehacer` fuerza la reconsulta de todo.
const previoJson = existsSync(SALIDA) ? JSON.parse(readFileSync(SALIDA, 'utf8')) : { terms: {} };
const rehacer = args.includes('--rehacer');
const yaResuelto = new Set(rehacer ? [] : Object.entries(previoJson.terms || {})
    .filter(([, v]) => v.status !== 'inconclusive')
    .map(([k]) => k));

const orden = [...pendientes.entries()]
    .filter(([n]) => !yaResuelto.has(n))
    .sort((a, b) => b[1].productos - a[1].productos)
    .slice(0, MAX);
console.log(`ya resueltos en pasadas anteriores: ${yaResuelto.size} · a consultar ahora: ${orden.length}`);

// Se parte del baseline previo: una pasada acotada AMPLIA el ledger, no lo sustituye.
const terms = rehacer ? {} : { ...(previoJson.terms || {}) };
const cuenta = { verified: 0, review: 0, unresolved: 0, manual: 0, inconclusive: 0 };

for (const [nombre, meta] of orden) {
    // Las COMBINACIONES no se cosechan del texto combinado: PubMed devolvería el fragmento que
    // reconozca (`ácido alendrónico + colecalciferol` → `cholecalciferol`). Se resuelven desde
    // los componentes estructurados de CIMA, que exige el endpoint de detalle: paso siguiente.
    if (meta.combinacion) {
        terms[nombre] = { status: 'manual', reason: 'combinacion: resolver por componentes estructurados de CIMA',
                          products: meta.productos, checked: HOY };
        cuenta.manual += 1;
        continue;
    }
    const [a, b] = [await porSnomed(meta.sctid || '0', nombre), await porPubmed(nombre)];
    await dormir(320);

    const registro = { products: meta.productos, checked: HOY, sctid: meta.sctid || null,
                       sources: { snomed: a.estado, pubmed: b.estado } };

    // CONVERGENCIA ANTES QUE PARENTESCO. Dos autoridades independientes que aterrizan en la
    // MISMA cadena no estan ensanchando: se estan confirmando. Y el parentesco de raiz falla
    // justo donde la traduccion es correcta pero translitera —`micofenolico`/`mycophenolic`,
    // mi->my y f->ph—, que es el caso que mato la regla de sufijos. Cuando ambas coinciden, la
    // coincidencia manda sobre el parecido ortografico.
    const propA = a.en || a.candidato || null;
    const propB = b.en || b.candidato || null;
    const convergen = propA && propB && norm(propA) === norm(propB);

    if (a.estado === 'inconcluso' || b.estado === 'inconcluso') {
        registro.status = 'inconclusive';
        registro.reason = 'no se pudo consultar una de las autoridades';
        cuenta.inconclusive += 1;
    } else if (convergen) {
        registro.status = 'verified'; registro.en = propA; registro.method = 'convergencia';
        registro.evidence = [a.evidencia, b.evidencia].filter(Boolean); cuenta.verified += 1;
    } else if (a.estado === 'ok' && b.estado === 'ok') {
        // Ambas resuelven pero a terminos DISTINTOS. Elegir seria juzgar: se registran las dos.
        registro.status = 'review'; registro.candidates = [a.en, b.en];
        registro.evidence = [a.evidencia, b.evidencia]; cuenta.review += 1;
    } else if (a.estado === 'ok') {
        registro.status = 'verified'; registro.en = a.en; registro.method = 'snomed';
        registro.evidence = [a.evidencia]; cuenta.verified += 1;
    } else if (b.estado === 'ok') {
        registro.status = 'verified'; registro.en = b.en; registro.method = 'pubmed';
        registro.evidence = [b.evidencia]; cuenta.verified += 1;
    } else if (a.estado === 'ensancha' || b.estado === 'fragmento') {
        // Hay candidato, pero ENSANCHA (una clase en vez de la sustancia) o solo cubre un
        // fragmento. No se acepta y no se tira: puede ser un sinonimo legitimo. Decide un humano.
        registro.status = 'review';
        registro.candidates = [a.candidato, b.candidato].filter(Boolean);
        registro.reason = [a.evidencia, b.evidencia].filter(Boolean).join(' · ');
        cuenta.review += 1;
    } else {
        registro.status = 'unresolved';
        registro.reason = 'ninguna autoridad lo resuelve';
        cuenta.unresolved += 1;
    }
    terms[nombre] = registro;
    process.stdout.write(`  ${String(meta.productos).padStart(3)} prod · ${nombre.slice(0, 42).padEnd(44)} ${registro.status}${registro.method ? '(' + registro.method + ')' : ''}${registro.en ? ' -> ' + registro.en : ''}\n`);
}

console.log(`\nresumen: ${JSON.stringify(cuenta)}`);
if (inconcluso) console.log(`[aviso] ${inconcluso} peticiones agotaron reintentos: la pasada es INCONCLUSA`);

const baseline = {
    version: HOY,
    note: 'Baseline de identidad de sustancia. CANDIDATOS, no traducciones autorizadas: la '
        + 'incorporacion a inn-es-en.json es una decision humana. Estados: verified (una autoridad '
        + 'oficial lo resuelve; convergencia si ambas coinciden) · review (dos candidatos distintos: '
        + 'elegir seria juzgar) · unresolved (ninguna autoridad, o PubMed solo reconocio un fragmento) '
        + '· manual (combinacion: pendiente de resolver por componentes estructurados) · inconclusive '
        + '(no se pudo medir). Se guarda estado, termino y fecha; NUNCA recuentos historicos.',
    sources: {
        snomed: 'CIMA vtm.id (SNOMED CT) -> RxNav idtype=SNOMEDCT (NLM)',
        pubmed: 'eutils esearch querytranslation (concepto MeSH / Supplementary Concept)',
    },
    terms,
};

if (seco) {
    console.log(`\n[en seco] no se escribe nada. Se habrian registrado ${Object.keys(terms).length} terminos.`);
} else if (inconcluso) {
    console.log('\nNO se escribe el baseline: una pasada inconclusa consolidaria como revisado lo que no se pudo medir.');
} else {
    // Los veredictos HUMANOS y lo ya promovido mandan siempre sobre lo que diga una recompilacion:
    // una pasada automatica no puede deshacer una decision suya. Se restauran al final, incluso
    // con `--rehacer`.
    for (const [k, v] of Object.entries(previoJson.terms || {})) {
        if (v.status === 'curated' || v.human || v.promoted) baseline.terms[k] = v;
    }
    writeFileSync(SALIDA, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
    console.log(`\nescrito ${SALIDA.replace(ROOT, '.')}`);
}

process.exitCode = inconcluso ? 2 : 0;
