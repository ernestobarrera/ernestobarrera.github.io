#!/usr/bin/env node
/**
 * MedCheck — test de la agrupación de resultados por ATC (`groupResultsByField(_, 'atc')`)
 *
 * PREGUNTA QUE RESPONDE: al agrupar por ATC, ¿el grupo es el SUBGRUPO TERAPÉUTICO y su nombre es
 * el de ese subgrupo?
 *
 * Nació el 2026-09-10 de una petición clínica de Ernesto: usar la clasificación ATC para poder
 * elegir POTENCIA en los corticoides. Al mirarlo apareció que el código no hacía lo que su propio
 * comentario decía —«use level 5 if available, else level 4, else level 3»—: tomaba `med.atcs[0]`,
 * y CIMA devuelve los niveles en orden ascendente, así que `[0]` es SIEMPRE el nivel 3 y el
 * recorte no llegaba nunca a bajar de ahí.
 *
 * CONSECUENCIA MEDIDA, con datos reales de CIMA: Dermosa Hidrocortisona (D07AA02, baja potencia),
 * Adventan (D07AC14, potente) y Clovate (D07AD01, muy potente) caían los tres en el mismo grupo,
 * «D07A - CORTICOSTEROIDES, MONOFARMACOS». La distinción que el usuario buscaba estaba en el dato
 * y la agrupación la borraba.
 *
 * LO QUE ESTE TEST PROTEGE ES LA FIDELIDAD A LA FUENTE, no una preferencia de diseño: el nombre
 * del grupo tiene que ser el que la AEMPS le da a ESE código. Pintar «D07AC» junto al nombre de
 * otro nivel es atribuir a la clasificación oficial algo que no dice.
 *
 * Se ejecuta el método REAL extraído de assets/js/cima-app.js.
 *
 * Uso: node scripts/medcheck-test-agrupacion-atc.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {
    window: {}, document: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red en tests')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Promise, Map, Set, RegExp, URL, URLSearchParams,
    navigator: { onLine: true }, location: { search: '', href: '' },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(`${appSrc}\n;window.__C = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const app = Object.create(sandbox.window.__C.prototype);

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};
const eq = (nombre, got, exp) => ok(nombre, JSON.stringify(got) === JSON.stringify(exp),
    `esperado ${JSON.stringify(exp)}, obtenido ${JSON.stringify(got)}`);

/** Un medicamento tal y como lo deja el enriquecimiento de `cima-api.js`: los tres niveles, en
 *  orden ascendente, que es como los devuelve CIMA. */
const med = (nombre, ...niveles) => ({
    nombre,
    atcs: niveles.map(([codigo, nom, nivel]) => ({ codigo, nombre: nom, nivel })),
});

// Los tres casos reales, con los nombres literales de la maestra ATC de CIMA (maestra=7).
const D07A = ['D07A', 'CORTICOSTEROIDES, MONOFARMACOS', 3];
const corticoides = [
    med('Dermosa Hidrocortisona 10 mg/g pomada', D07A,
        ['D07AA', 'Corticosteroides de baja potencia (grupo I)', 4], ['D07AA02', 'Hidrocortisona', 5]),
    med('ADVENTAN 1 mg/g CREMA', D07A,
        ['D07AC', 'Corticosteroides potentes (grupo III)', 4], ['D07AC14', 'Metilprednisolona, aceponato de', 5]),
    med('BATMEN 2,5 MG/G CREMA', D07A,
        ['D07AC', 'Corticosteroides potentes (grupo III)', 4], ['D07AC18', 'Prednicarbato', 5]),
    med('CLOVATE 0,5 mg/g CREMA', D07A,
        ['D07AD', 'Corticosteroides muy potentes (grupo IV)', 4], ['D07AD01', 'Clobetasol', 5]),
];

console.log('— Corticoides tópicos: el nivel 4 del ATC ES la potencia —');
const grupos = app.groupResultsByField(corticoides, 'atc');
eq('se separan por potencia, no todos en D07A',
    grupos.map(g => g.subtitle).sort(), ['D07AA', 'D07AC', 'D07AD']);
ok('el grupo de los potentes junta a los dos que lo son',
    grupos.find(g => g.subtitle === 'D07AC')?.meds.length === 2,
    grupos.find(g => g.subtitle === 'D07AC')?.meds.length);
eq('el nombre del grupo es el del subgrupo, con las palabras de la AEMPS',
    grupos.find(g => g.subtitle === 'D07AA')?.name,
    'D07AA - Corticosteroides de baja potencia (grupo I)');
eq('y el de los muy potentes también',
    grupos.find(g => g.subtitle === 'D07AD')?.name,
    'D07AD - Corticosteroides muy potentes (grupo IV)');
ok('ningún grupo se queda en el nivel 3, que era el defecto',
    !grupos.some(g => g.subtitle === 'D07A'), grupos.map(g => g.subtitle).join(','));

// El código y el nombre TIENEN QUE SER DEL MISMO NIVEL. Es la parte que no se puede relajar:
// «D07AC» con el nombre de D07A atribuye a la clasificación oficial algo que no dice.
console.log('\n— Código y nombre, siempre del mismo nivel —');
for (const g of grupos) {
    const [codigo, ...resto] = g.name.split(' - ');
    const nombre = resto.join(' - ');
    const fuente = corticoides.flatMap(m => m.atcs).find(a => a.codigo === codigo);
    ok(`${codigo} lleva su propio nombre`, !!fuente && fuente.nombre === nombre, nombre);
}

// No es un arreglo solo dermatológico: el nivel 4 separa decisiones clínicas distintas en
// cualquier grupo. Aquí, IECA solo frente a IECA con diurético.
console.log('\n— Vale para cualquier grupo, no solo para la piel —');
const cardio = [
    med('ENALAPRIL', ['C09A', 'IECA, MONOFARMACOS', 3], ['C09AA', 'Inhibidores de la ECA, monofármacos', 4], ['C09AA02', 'Enalapril', 5]),
    med('ENALAPRIL/HIDROCLOROTIAZIDA', ['C09B', 'IECA, COMBINACIONES', 3], ['C09BA', 'Inhibidores de la ECA y diuréticos', 4], ['C09BA02', 'Enalapril y diuréticos', 5]),
];
eq('IECA solo y IECA con diurético no comparten grupo',
    app.groupResultsByField(cardio, 'atc').map(g => g.subtitle).sort(), ['C09AA', 'C09BA']);

// Degradación: no todo registro trae los tres niveles. Sin grupo no hay pantalla, así que se cae
// hacia lo que haya en vez de mandar el medicamento a «Otros».
console.log('\n— Se degrada hacia lo que haya, nunca a "Otros" —');
eq('solo nivel 3: se usa el nivel 3',
    app.groupResultsByField([med('X', D07A)], 'atc')[0].subtitle, 'D07A');
eq('sin `nivel` declarado, la longitud del código hace de respaldo',
    app.groupResultsByField([{ nombre: 'X', atcs: [{ codigo: 'D07A', nombre: 'a' }, { codigo: 'D07AC', nombre: 'Corticosteroides potentes (grupo III)' }] }], 'atc')[0].subtitle,
    'D07AC');
eq('sin ATC ninguno, cae en Otros como antes',
    app.groupResultsByField([{ nombre: 'X' }], 'atc')[0].name, 'Otros');
eq('lista de ATC vacía, también',
    app.groupResultsByField([{ nombre: 'X', atcs: [] }], 'atc')[0].name, 'Otros');
// `atcs` que no es un array no puede tumbar el repintado entero de resultados.
eq('un `atcs` malformado no rompe la agrupación',
    app.groupResultsByField([{ nombre: 'X', atcs: 'D07AC' }], 'atc')[0].name, 'Otros');

// Aserción de FUENTE: el nivel 5 es el principio activo, y agrupar por él es no agrupar (cada
// medicamento en su propio grupo). Que nadie «afine» un paso más.
console.log('\n— El nivel 5 no es un grupo —');
const porNivel5 = app.groupResultsByField(corticoides, 'atc');
ok('cuatro medicamentos no producen cuatro grupos', porNivel5.length === 3, porNivel5.length);

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
