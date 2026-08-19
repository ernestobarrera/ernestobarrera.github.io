#!/usr/bin/env node
/**
 * MedCheck — auditoría de identidad de sustancia (paso 4 de la hoja de ruta del acta
 * ia-config/actas/2026-08-18_acta-medcheck-identidad-sustancia.md)
 *
 * QUÉ PREGUNTA: ¿ha aparecido en CIMA algún nombre de sustancia que NADIE ha resuelto y que
 * NADIE ha registrado como excepción conocida?
 *
 * POR QUÉ EXISTE. Este agujero se regenera solo. CIMA da altas continuamente, y el fallo no se
 * ve: un nombre nuevo sin traducir no rompe nada, simplemente devuelve menos —o cero— en las
 * fuentes que indexan en inglés, y en pantalla se lee igual que una ausencia real de evidencia.
 * Se descubrió porque el responsable buscó SPRAVATO, no porque saltara ninguna alarma.
 *
 * CONTRATO DE SALIDA, el mismo 0/1/2 que ya usan --cobertura-atc y check-publicado:
 *   0  todo nombre sin verificar está registrado en el baseline con un estado conocido.
 *   1  hay nombres DESCONOCIDOS: ni resueltos ni registrados. Bloquea.
 *   2  INCONCLUSO: no se pudo barrer CIMA entero. No se certifica lo que no se ha medido.
 *
 * LO QUE **NO** BLOQUEA, y es deliberado (corrección a la propuesta de Codex de exigir «cero
 * desconocidos»): un `review` pendiente de decisión humana, un `unresolved` ya registrado o una
 * combinación en `manual` NO bloquean. Están vistos y anotados; convertirlos en gate haría que
 * el guardián avisara siempre y se aprendiera a ignorar, que es el fallo que este proyecto ya
 * ha pagado dos veces con otras señales. Bloquea solo lo que nadie ha mirado nunca.
 *
 * CADUCIDAD: un `verified` con más de 180 días se marca para revisión —el mapeo automático de
 * PubMed cambia con los años—, siguiendo la misma regla que `reconcile-baseline.json`.
 *
 * Uso:
 *   node scripts/medcheck-audit-identity.mjs
 *   node scripts/medcheck-audit-identity.mjs --json     # salida legible por máquina
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// --baseline= permite apuntar a otro fichero: lo usan las pruebas con baselines sintéticos,
// igual que hace medcheck-audit-ontology.mjs. Sin él, el del repo.
const argBaseline = process.argv.slice(2).find(a => a.startsWith('--baseline='));
const BASELINE = argBaseline
    ? resolve(argBaseline.slice('--baseline='.length))   // resolve, no join: la ruta puede venir absoluta
    : join(ROOT, 'assets', 'data', 'substance-identity-baseline.json');
const comoJson = process.argv.includes('--json');
const CADUCIDAD_DIAS = 180;

// Resolutor real del repo: si cambia el contrato, la auditoría cambia con él.
const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sin red en la carga')),
    JSON, Math, Date, String, Object, Array, Set, Map, RegExp, Promise, encodeURIComponent, setTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const dict = sandbox.window.innDict;
dict.map = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8')).map;
dict.loaded = true;

if (!existsSync(BASELINE)) {
    console.error('No existe el baseline de identidad. Corre antes medcheck-compile-identity.mjs.');
    process.exit(2);
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const registrados = baseline.terms || {};

// ---- Barrido de CIMA, ENTERO. Muestrear es lo que dejó fuera a SPRAVATO. ----
const NO_INFORMATIVO = /^(multicomponente|varios|asociaciones|combinaciones)$/i;
const LETRAS = ['A', 'B', 'C', 'D', 'G', 'H', 'J', 'L', 'M', 'N', 'P', 'R', 'S', 'V'];
const dormir = ms => new Promise(r => setTimeout(r, ms));
let truncado = null;

async function pedir(url) {
    for (let i = 1; i <= 3; i += 1) {
        try {
            const r = await fetch(url, { headers: { accept: 'application/json' } });
            if (r.ok) return r.json();
        } catch { /* red */ }
        if (i < 3) await dormir(400 * i);
    }
    return undefined;
}

const sinVerificar = new Map();
let productos = 0;
for (const L of LETRAS) {
    let pagina = 1, total = null;
    for (;;) {
        const d = await pedir(`https://cima.aemps.es/cima/rest/medicamentos?atc=${L}&comerc=1&pagina=${pagina}`);
        if (d === undefined) { truncado = `no se pudo leer la letra ${L}, página ${pagina}`; break; }
        if (total === null) total = Number(d.totalFilas || 0);
        const lote = d.resultados || [];
        if (!lote.length) break;
        for (const med of lote) {
            productos += 1;
            const vtm = (med?.vtm?.nombre || '').trim();
            if (!vtm || NO_INFORMATIVO.test(vtm)) continue;
            const comps = vtm.split(/[+,/]/).map(s => s.trim()).filter(Boolean)
                .map(c => dict.toSearchTerm(c, { allowCounterionTrim: false }));
            if (!comps.some(c => c.verificationStatus === 'unverified')) continue;
            sinVerificar.set(vtm, (sinVerificar.get(vtm) || 0) + 1);
        }
        pagina += 1;
        if (total && pagina > Math.ceil(total / 200)) break;
        if (pagina > 400) break;
        await dormir(130);
    }
    if (truncado) break;
}

// ---- Clasificación ----
const hoy = Date.now();
const dias = f => (f ? Math.round((hoy - Date.parse(f)) / 86400000) : Infinity);

const desconocidos = [];   // BLOQUEAN: nadie los ha mirado nunca
const caducados = [];      // avisan: verified con más de 180 días
const anotados = { review: 0, unresolved: 0, manual: 0, verified: 0 };

for (const [nombre, prods] of sinVerificar) {
    const reg = registrados[nombre];
    if (!reg) { desconocidos.push({ nombre, productos: prods }); continue; }
    anotados[reg.status] = (anotados[reg.status] || 0) + 1;
    if (reg.status === 'verified' && dias(reg.checked) > CADUCIDAD_DIAS) {
        caducados.push({ nombre, productos: prods, dias: dias(reg.checked) });
    }
}

const inconcluso = Boolean(truncado);
const resultado = {
    estado: inconcluso ? 'inconcluso' : (desconocidos.length ? 'divergencia' : 'ok'),
    productos_barridos: productos,
    nombres_sin_verificar: sinVerificar.size,
    registrados_en_baseline: sinVerificar.size - desconocidos.length,
    desconocidos: desconocidos.sort((a, b) => b.productos - a.productos),
    caducados,
    anotados,
    truncado,
};

if (comoJson) {
    console.log(JSON.stringify(resultado, null, 2));
} else {
    console.log('# Auditoría de identidad de sustancia\n');
    console.log(`- productos comercializados barridos: ${productos}`);
    console.log(`- nombres sin verificar: ${sinVerificar.size}`);
    console.log(`- registrados en el baseline: ${resultado.registrados_en_baseline}`);
    console.log(`- por estado: ${JSON.stringify(anotados)}`);
    console.log('');
    if (inconcluso) {
        console.log(`## INCONCLUSO\n- ${truncado}`);
        console.log('  No se certifica lo que no se ha podido medir. Repite la pasada.');
    } else if (desconocidos.length) {
        console.log(`## DESCONOCIDOS — ${desconocidos.length} nombres que nadie ha mirado (BLOQUEA)\n`);
        for (const d of desconocidos.slice(0, 25)) console.log(`  ${String(d.productos).padStart(4)} prod · ${d.nombre}`);
        if (desconocidos.length > 25) console.log(`  … y ${desconocidos.length - 25} más`);
        console.log('\n  Se resuelven corriendo medcheck-compile-identity.mjs, que los registrará');
        console.log('  con un estado conocido aunque no los pueda traducir.');
    } else {
        console.log('## OK — todo nombre sin verificar está registrado con un estado conocido.');
    }
    if (caducados.length) {
        console.log(`\n## CADUCADOS — ${caducados.length} verificados con más de ${CADUCIDAD_DIAS} días (avisan, no bloquean)`);
        for (const c of caducados.slice(0, 10)) console.log(`  ${c.nombre} · comprobado hace ${c.dias} días`);
    }
    console.log('');
    console.log('Recuerda: un `review` pendiente de tu decisión, un `unresolved` registrado o una');
    console.log('combinación en `manual` NO bloquean. Están vistos y anotados. Bloquea solo lo que');
    console.log('nadie ha mirado nunca — un guardián que avisa siempre se aprende a ignorar.');
}

process.exitCode = inconcluso ? 2 : (desconocidos.length ? 1 : 0);
