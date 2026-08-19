#!/usr/bin/env node
/**
 * MedCheck — contrato de verificación de la identidad de sustancia (paso 0)
 *
 * Nace del caso SPRAVATO (2026-08-18). CIMA llama `esketamina` a la sustancia; el resolutor la
 * devolvía `source:'asis'` —pasó tal cual porque nada parecía raro— y la marcaba
 * `confidence:'high'`. ClinicalTrials.gov devuelve 0 para «esketamina» y 365 para «esketamine»,
 * así que la ficha pintaba un cero limpio, sin aviso, indistinguible de un cero real.
 * Ese caso concreto se resolvió el 19/08 al incorporar la traducción, y el test lo fija para
 * que no se deshaga; el INVARIANTE se sigue probando sobre un término aún sin resolver, tomado
 * del baseline en vez de escrito a mano, para que la prueba no caduque al curarlo.
 *
 * EL CONTRATO QUE SE FIJA AQUÍ:
 *   source === 'asis'  ⇒  verificationStatus === 'unverified'  ⇒  confidence !== 'high'
 *
 * «No comprobado» y «fiable» no pueden ser la misma cosa. Medido: de 3772 componentes de
 * medicamentos comercializados, 929 (~25%) resolvían 'asis' con confianza alta.
 *
 * Y LO QUE EL CONTRATO NO DEBE ROMPER: los términos 'asis' que SÍ recuperan siguen enseñando
 * su número. `ambrisentan` devuelve 84 y no ha de cambiar nada para el usuario. El cambio de
 * confianza solo altera cómo se presenta un CERO, que es justo el caso ambiguo.
 *
 * Sin red: usa el diccionario real del repo y la clase real en `vm`.
 * Uso: node scripts/medcheck-test-identidad.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    JSON, Math, Date, String, Object, Array, Set, Map, RegExp, Promise,
    encodeURIComponent, setTimeout,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8'), sandbox, { filename: 'inn-dict.js' });
const dict = sandbox.window.innDict;
dict.map = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8')).map;
dict.loaded = true;

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`✓ ${name}`);
    else { failures += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const r = (t) => dict.toSearchTerm(t, { allowCounterionTrim: false });

// 1 · EL CASO QUE LO ORIGINÓ, YA ARREGLADO. `esketamina` (SPRAVATO) devolvía 0 estudios en
// ClinicalTrials.gov porque el término viajaba en español, y se presentaba como fiable. El
// compilador la resolvió y se incorporó al diccionario el 19/08. Se fija aquí para que una
// recompilación futura no pueda deshacerlo en silencio.
const esk = r('esketamina');
check('1 · esketamina (SPRAVATO) ya está resuelta',
    esk.source === 'dict' && esk.en === 'esketamine',
    `source ${esk.source} · en ${esk.en}`);
check('1b · y por tanto es curada y fiable',
    esk.verificationStatus === 'curated' && esk.confidence === 'high',
    `${esk.verificationStatus} · ${esk.confidence}`);

// 1c · Y EL INVARIANTE SIGUE VIVO sobre un término que aún nadie ha resuelto. Se toma del
// baseline en vez de fijar un nombre a mano: así el test no caduca cuando ese término se cure.
const baseline = JSON.parse(readFileSync(join(ROOT, 'assets/data/substance-identity-baseline.json'), 'utf8'));
const sinResolver = Object.entries(baseline.terms || {})
    .filter(([, v]) => v.status === 'unresolved')
    .map(([k]) => k)
    .find(n => r(n).source === 'asis');
check('1c · hay al menos un término sin resolver con el que probar el invariante',
    Boolean(sinResolver), 'el baseline no tiene ninguno: revisa si el contrato sigue teniendo sentido');
if (sinResolver) {
    const x = r(sinResolver);
    check(`1d · «${sinResolver}» sigue marcado sin verificar y no fiable`,
        x.verificationStatus === 'unverified' && x.confidence !== 'high',
        `${x.verificationStatus} · ${x.confidence}`);
}

// 2 · EL INVARIANTE, sobre el diccionario real y una muestra amplia de nombres reales de CIMA.
const muestra = ['ambrisentan', 'almagato', 'glicerol', 'abiraterona', 'riociguat',
    'alectinib', 'aflibercept', 'lercanidipino', 'omeprazol', 'acido folico', 'acido alendronico',
    'vacuna anti herpes zoster', 'multicomponente', 'insulina regular'];
const rotos = muestra.map(r).filter(x =>
    x.source === 'asis' && (x.verificationStatus !== 'unverified' || x.confidence === 'high'));
check('2 · INVARIANTE: asis ⇒ unverified ⇒ nunca high',
    rotos.length === 0, `${rotos.length} incumplen: ${rotos.map(x => x.raw).join(', ')}`);

// 3 · Nada queda sin sellar: toda salida del resolutor declara su estado.
const sinSellar = muestra.map(r).filter(x => !x.verificationStatus);
check('3 · toda resolución declara verificationStatus',
    sinSellar.length === 0, `${sinSellar.length} sin sellar`);

// 4 · Lo curado NO se degrada: una entrada del diccionario sigue siendo fiable.
const ler = r('lercanidipino');
check('4 · una entrada curada sigue siendo fiable',
    ler.source === 'dict' && ler.verificationStatus === 'curated' && ler.confidence === 'high',
    `${ler.source} · ${ler.verificationStatus} · ${ler.confidence}`);
check('4b · y conserva su traducción', ler.en === 'lercanidipine', String(ler.en));

// 5 · NO SE ROMPE LO QUE FUNCIONABA. Un termino 'asis' que ya recuperaba sigue enviandose
// igual: el contrato solo cambia como se PRESENTA un cero, no lo que se consulta.
for (const [t, esperado] of [['ambrisentan', 'ambrisentan'], ['almagato', 'almagato']]) {
    const x = r(t);
    check(`5 · ${t}: el término enviado NO cambia`, (x.en || x.baseEs) === esperado, `${x.en || x.baseEs}`);
}

// 6 · MUTACIÓN: si alguien devuelve 'asis' a confianza alta, la suite tiene que caerse.
// Se reintroduce el defecto en memoria y se comprueba que el detector lo ve.
const original = dict._stampVerification.bind(dict);
dict._stampVerification = (out) => { const o = original(out); if (o.source === 'asis') o.confidence = 'high'; return o; };
const conDefecto = muestra.map(r).filter(x => x.source === 'asis' && x.confidence === 'high');
dict._stampVerification = original;
check('6 · el detector del invariante caza el defecto reintroducido',
    conDefecto.length > 0, 'el detector no vería la regresión');

// 7 · EL DICCIONARIO PUBLICADO TIENE QUE SER EL QUE SE SIRVE. Aquí se perdió la sesión 46:
// se incorporaron 756 identidades al JSON y se bumpó `dict` (el <script> de inn-dict.js),
// pero NO `innjson` (la URL del JSON que vive DENTRO de inn-dict.js). El navegador siguió
// pidiendo inn-es-en.json?v=20260624a y, como se pide con cache:'force-cache', sirvió la copia
// de junio sin revalidar jamás: esketamina estaba en el repo Y en producción, y aun así no
// llegaba a la pantalla. El fallo es invisible mirando el código y mirando el servidor.
// La señal que lo caza: el token ?v= no puede ser ANTERIOR a la fecha que el propio JSON
// declara en su campo `version`.
const innSrc = readFileSync(join(ROOT, 'assets/js/inn-dict.js'), 'utf8');
const tokenMatch = /inn-es-en\.json\?v=(\d{8})[a-z]?/.exec(innSrc);
const dictVersion = JSON.parse(readFileSync(join(ROOT, 'assets/data/inn-es-en.json'), 'utf8')).version;
const fechaJson = String(dictVersion || '').replace(/-/g, '');
check('7 · inn-dict.js declara un cache-bust del JSON', !!tokenMatch, 'no se encontró ?v= en inn-dict.js');
check('7b · el JSON declara su fecha de versión', /^\d{8}$/.test(fechaJson), String(dictVersion));
check('7c · el cache-bust no es anterior al dato que sirve',
    !!tokenMatch && /^\d{8}$/.test(fechaJson) && tokenMatch[1] >= fechaJson,
    'v=' + (tokenMatch ? tokenMatch[1] : '?') + ' < version ' + fechaJson +
    ' — falta: node scripts/medcheck-bump-version.mjs innjson');

console.log('');
if (failures) {
    console.log(`${failures} fallo(s) — el contrato de identidad no se sostiene.`);
    process.exitCode = 1;
} else {
    console.log('Contrato de identidad en verde: lo no comprobado no se declara fiable,');
    console.log('lo curado no se degrada y el término enviado no cambia.');
}
