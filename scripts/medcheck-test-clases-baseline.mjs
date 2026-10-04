#!/usr/bin/env node
/**
 * MedCheck — test de la aceptación por CLASE en el baseline de reconciliación
 *
 * Por qué existe. El 2026-10-03 el gate de release bloqueó la publicación con 10 hallazgos y 9 eran
 * registros NUEVOS de clases ya adjudicadas: `61523` era un Fragmin más, con once hermanos ya
 * aceptados y la razón escrita; dobutamina repetía la homonimia de naloxona; pinazepam, lo de
 * lorazepam. Un gate que frena lo viejo con matrícula nueva se acaba saltando a mano, y entonces
 * ya no frena nada.
 *
 * Lo que se prueba, y el equilibrio es el punto: una clase cubre a los hermanos de la misma
 * sustancia, pero SOLO si su 4.1 sigue diciendo lo que se adjudicó. El día que un producto de
 * dalteparina reciba de verdad una indicación en ERC, su texto no traerá la frase del circuito
 * extracorpóreo y volverá a bloquear. Sin esa segunda condición, la clase sería un falso negativo
 * esperando su turno.
 *
 * Se ejercita el código REAL: se extrae `claseQueCubre` del auditor y se ejecuta. Si alguien lo
 * edita, este banco corre lo editado.
 *
 * Uso: node scripts/medcheck-test-clases-baseline.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AUDITOR = join(ROOT, 'scripts', 'medcheck-audit-ontology.mjs');
const BASELINE = join(ROOT, 'scripts', 'baselines', 'reconcile-baseline.json');

let fallos = 0;
function check(nombre, got, esperado) {
    const ok = JSON.stringify(got) === JSON.stringify(esperado);
    if (!ok) fallos += 1;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${nombre}`);
    if (!ok) console.log(`      esperado ${JSON.stringify(esperado)} · obtenido ${JSON.stringify(got)}`);
}

// ── Extracción del código real ────────────────────────────────────────────────
const fuente = readFileSync(AUDITOR, 'utf8');
function extraer(nombre) {
    const i = fuente.indexOf(`function ${nombre}(`);
    if (i < 0) throw new Error(`no encuentro function ${nombre} en el auditor`);
    let nivel = 0; let visto = false;
    for (let j = i; j < fuente.length; j += 1) {
        if (fuente[j] === '{') { nivel += 1; visto = true; }
        else if (fuente[j] === '}') { nivel -= 1; if (visto && nivel === 0) return fuente.slice(i, j + 1); }
    }
    throw new Error(`function ${nombre} sin cerrar`);
}
const constantes = [
    /const ACCEPTED_MAX_AGE_DAYS = \d+;/,
    /const CLASE_CATEGORIAS = new Set\(\[[\s\S]*?\]\);/,
];
const trozos = constantes.map((re) => {
    const m = fuente.match(re);
    if (!m) throw new Error(`no encuentro ${re}`);
    return m[0];
});
const mod = `${trozos.join('\n')}
${extraer('plegarTexto')}
${extraer('daysSince')}
${extraer('claseQueCubre')}
export { claseQueCubre, plegarTexto, CLASE_CATEGORIAS, ACCEPTED_MAX_AGE_DAYS };`;
const { claseQueCubre } = await import(
    `data:text/javascript;base64,${Buffer.from(mod, 'utf8').toString('base64')}`
);

const HOY = new Date().toISOString().slice(0, 10);
const clase = (extra = {}) => ({
    status: 'accepted',
    categoria: 'contextual',
    vtm: 'dalteparina sodio',
    exige: 'hemodialisis y hemofiltracion',
    reason: 'la ERC es el escenario, no la diana',
    reviewedAt: HOY,
    reviewedBy: 'Ernesto Barrera',
    ...extra,
});
const known = (c) => ({ clases: { 'dalteparina-circuito-extracorporeo': c } });
// [nregistro, nombre, vtm, excerpt, hash41]
const gapFragmin = ['99999', 'FRAGMIN 5.000 UI NUEVO ENVASE', 'dalteparina sodio',
    '…prevención de los coágulos del sistema extracorpóreo durante la hemodiálisis y hemofiltración en los enfermos con insuficiencia renal crónica…', 'abc'];

// ── Lo que la clase SÍ cubre ──────────────────────────────────────────────────
check('un envase nuevo de la misma sustancia, con el mismo texto → cubierto',
    claseQueCubre(known(clase()), gapFragmin)?.clave, 'dalteparina-circuito-extracorporeo');
check('la frase se compara sin acentos ni mayúsculas (CIMA no es consistente)',
    !!claseQueCubre(known(clase({ exige: 'HEMODIÁLISIS Y HEMOFILTRACIÓN' })), gapFragmin), true);
check('la sustancia se compara por inclusión: «dalteparina sodio» cubre «dalteparina sodio (EFG)»',
    !!claseQueCubre(known(clase()), [...gapFragmin.slice(0, 2), 'dalteparina sodio (EFG)', gapFragmin[3], 'x']), true);

// ── Lo que NO cubre: aquí está el valor del banco ─────────────────────────────
check('MISMA sustancia pero la 4.1 ya no dice lo adjudicado → NO cubierto, bloquea',
    claseQueCubre(known(clase()), [...gapFragmin.slice(0, 3),
        '…tratamiento de la enfermedad renal crónica en estadio 3 o superior…', 'x']), null);
check('otra sustancia con el mismo texto → NO cubierto',
    claseQueCubre(known(clase()), [...gapFragmin.slice(0, 2), 'enoxaparina sodio', gapFragmin[3], 'x']), null);
check('clase sin `exige` → NO cubre nada (sería «esta sustancia nunca bloquea»)',
    claseQueCubre(known(clase({ exige: '' })), gapFragmin), null);
check('clase sin razón escrita → no cubre', claseQueCubre(known(clase({ reason: '  ' })), gapFragmin), null);
check('clase sin responsable → no cubre', claseQueCubre(known(clase({ reviewedBy: '' })), gapFragmin), null);
check('clase en `review` → no cubre (estar en el baseline no es revisión)',
    claseQueCubre(known(clase({ status: 'review' })), gapFragmin), null);
check('categoría inventada → no cubre (el esquema no se aprueba por omisión)',
    claseQueCubre(known(clase({ categoria: 'porque-si' })), gapFragmin), null);
check('clase caducada a los 180 días → no cubre, se renueva a mano',
    claseQueCubre(known(clase({ reviewedAt: '2025-01-01' })), gapFragmin), null);
check('fecha ilegible → no cubre', claseQueCubre(known(clase({ reviewedAt: 'el martes' })), gapFragmin), null);
check('término sin clases → no cubre', claseQueCubre({ gaps: {} }, gapFragmin), null);
check('un hallazgo sin extracto no se cubre por clase (no se puede comprobar la frase)',
    claseQueCubre(known(clase()), [...gapFragmin.slice(0, 3), '', 'x']), null);

// ── Las clases declaradas en el baseline real son válidas ─────────────────────
const real = JSON.parse(readFileSync(BASELINE, 'utf8'));
let declaradas = 0;
for (const [term, v] of Object.entries(real.terms || {})) {
    for (const [clave, c] of Object.entries(v.clases || {})) {
        declaradas += 1;
        const falta = ['categoria', 'vtm', 'exige', 'reason', 'reviewedAt', 'reviewedBy']
            .filter((k) => !String(c[k] || '').trim());
        check(`baseline: la clase «${clave}» (${term}) está completa`, falta, []);
        // Y de verdad cubre a su propio caso: una clase que no cubre nada es una clase mal escrita.
        const propio = ['0', 'producto de prueba', c.vtm, `… ${c.exige} …`, 'x'];
        check(`baseline: «${clave}» cubre un texto con su propia frase`,
            !!claseQueCubre(v, propio), true);
    }
}
check('hay clases declaradas en el baseline', declaradas > 0, true);

console.log(`\n[clases] ${fallos} ${fallos === 1 ? 'fallo' : 'fallos'}`);
process.exit(fallos === 0 ? 0 : 1);
