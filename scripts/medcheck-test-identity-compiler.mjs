#!/usr/bin/env node
/**
 * MedCheck — test del compilador de identidad de sustancia
 *
 * NO comprueba que compile bien el corpus real: eso lo pasaría un script que devolviera
 * "verified" siempre. Lo que fija son las GUARDAS que lo mantienen dentro de la doctrina
 * «espejo, no juez», rompiendo cada una y exigiendo que la suite se caiga:
 *
 *   1. Dos autoridades que COINCIDEN -> verified por convergencia, aunque no compartan raíz.
 *      (Es el caso `ácido micofenólico` -> `mycophenolic acid`: mi->my, f->ph.)
 *   2. Dos autoridades que DISCREPAN -> review. Nunca se elige una: elegir sería juzgar.
 *   3. Una sola autoridad con nombre de CLASE -> review, no verified. Buscar por la clase
 *      ensancha, no traduce. (Es `eftrenonacog alfa` -> `factor ix fc fusion protein`.)
 *   4. Una sola autoridad que SÍ cubre el nombre -> verified. Una ruta válida basta.
 *   5. PubMed que solo reconoce un FRAGMENTO -> review, nunca verified.
 *      (Es `vacuna anti virus respiratorio sincitial` -> `viruses`.)
 *   6. COMBINACIONES -> manual, jamás cosechadas del texto combinado.
 *   7. Red rota -> pasada INCONCLUSA, salida 2, y NO se escribe el baseline.
 *   8. El compilador NUNCA escribe inn-es-en.json.
 *
 * Usa un CIMA/RxNav/PubMed sintético (medcheck-mock-identity.mjs) vía `node --import`.
 * No toca la red ni los datos reales.
 *
 * Uso: node scripts/medcheck-test-identity-compiler.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMPILADOR = join(__dirname, 'medcheck-compile-identity.mjs');
const MOCK = pathToFileURL(join(__dirname, 'medcheck-mock-identity.mjs')).href;
const DICCIONARIO = join(ROOT, 'assets', 'data', 'inn-es-en.json');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// --seco para no tocar el baseline real del repo durante las pruebas.
function compilar(caso) {
    const r = spawnSync(process.execPath, ['--import', MOCK, COMPILADOR, '--seco'], {
        encoding: 'utf8',
        env: { ...process.env, MC_ID_CASO: caso },
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const resumen = (out) => {
    const m = out.match(/resumen: (\{[^}]*\})/);
    return m ? JSON.parse(m[1]) : null;
};

// 1 · convergencia manda sobre el parecido ortográfico
let r = compilar('convergencia');
check('1 · dos autoridades que coinciden -> verified',
    resumen(r.out)?.verified === 1, JSON.stringify(resumen(r.out)));
check('1b · y se registra el método como convergencia',
    /convergencia/.test(r.out), r.out.split('\n').filter(l => l.includes('prod')).join(' | '));

// 2 · discrepancia: se registran las dos, no se elige
r = compilar('discrepan');
check('2 · dos autoridades que discrepan -> review, no verified',
    resumen(r.out)?.review === 1 && resumen(r.out)?.verified === 0, JSON.stringify(resumen(r.out)));

// 3 · nombre de clase de una sola autoridad
r = compilar('clase');
check('3 · una autoridad con nombre de CLASE -> review, no verified',
    resumen(r.out)?.review === 1 && resumen(r.out)?.verified === 0, JSON.stringify(resumen(r.out)));

// 4 · una ruta válida basta (corrección de Codex: exigir convergencia desperdicia la
// complementariedad medida entre SNOMED y PubMed)
r = compilar('solo-pubmed');
check('4 · una sola autoridad que cubre el nombre -> verified',
    resumen(r.out)?.verified === 1, JSON.stringify(resumen(r.out)));

// 5 · el fragmento no se acepta
r = compilar('fragmento');
check('5 · PubMed que solo reconoce un fragmento -> review',
    resumen(r.out)?.review === 1 && resumen(r.out)?.verified === 0, JSON.stringify(resumen(r.out)));

// 6 · combinaciones fuera de la cosecha automática
r = compilar('combinacion');
check('6 · una combinación va a manual, no se cosecha del texto combinado',
    resumen(r.out)?.manual === 1 && resumen(r.out)?.verified === 0, JSON.stringify(resumen(r.out)));

// 7 · red rota: inconcluso, salida 2, y no escribe
r = compilar('red-rota');
check('7 · red rota -> salida 2 (inconcluso), nunca 0', r.code === 2, `exit ${r.code}`);
check('7b · y lo dice en vez de callarlo', /INCONCLUSA|inconclus/i.test(r.out));

// 8 · invariante duro: el compilador propone, no decide. El diccionario no se toca.
const antes = statSync(DICCIONARIO).mtimeMs;
const contenidoAntes = readFileSync(DICCIONARIO, 'utf8');
compilar('convergencia');
check('8 · el compilador NO escribe inn-es-en.json',
    statSync(DICCIONARIO).mtimeMs === antes && readFileSync(DICCIONARIO, 'utf8') === contenidoAntes,
    'el diccionario ha cambiado');

// 8b · y por análisis de fuente: ninguna escritura apunta al diccionario.
const fuente = readFileSync(COMPILADOR, 'utf8');
const escrituras = [...fuente.matchAll(/writeFileSync\(([^,]+),/g)].map(m => m[1].trim());
check('8b · toda escritura del compilador va al baseline, no al diccionario',
    escrituras.length > 0 && escrituras.every(e => e === 'SALIDA'),
    `escribe en: ${escrituras.join(', ')}`);

console.log('');
if (failures) {
    console.log(`${failures} fallo(s) — el compilador no respeta sus guardas.`);
    process.exitCode = 1;
} else {
    console.log('Compilador en verde: convergencia manda, la discrepancia no se desempata,');
    console.log('la clase y el fragmento no pasan, y el diccionario no se toca.');
}
