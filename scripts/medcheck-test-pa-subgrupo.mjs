#!/usr/bin/env node
/**
 * MedCheck — banda de principios activos agrupada por SUBGRUPO ATC (Indicaciones)
 *
 * PREGUNTA QUE RESPONDE: al buscar por indicación, ¿los chips de principio activo salen
 * repartidos por subgrupo terapéutico (nivel 4 del ATC), en el MISMO subgrupo que sus tarjetas y
 * con el MISMO recuento que la banda plana?
 *
 * Nació de una petición clínica (2026-11-11): al buscar por indicación, ver los principios activos
 * agrupados por clase —como en los laxantes— para entender la farmacología de los grupos dentro de
 * la indicación. Los datos de abajo son los reales de
 * CIMA para A06A (laxantes) el 2026-11-11, recortados: 7 subgrupos, y dos principios activos
 * —glicerol y los fosfatos— que viven en dos subgrupos a la vez.
 *
 * LO QUE PROTEGE:
 *   1. Paridad con las tarjetas: un chip cae en el subgrupo de sus propias tarjetas. Si la banda
 *      eligiera el nivel ATC a su manera, el chip «lactulosa» podría salir bajo un subgrupo y sus
 *      tarjetas bajo otro.
 *   2. Paridad con la banda plana: la suma de los recuentos de un PA entre subgrupos es su
 *      recuento plano. Si no, el número de un chip cambiaría según cómo se pinte la banda.
 *   3. Fidelidad: un PA en dos subgrupos sale en los dos; el nombre del grupo es el de la AEMPS.
 *   4. Que no se esconda un filtro puesto: la caja con un chip activo nace abierta aunque haya
 *      tantos subgrupos que las demás nazcan plegadas.
 *   5. Que agrupar solo ocurra donde aporta: con un solo subgrupo, o sin ATC, la banda es plana.
 *
 * Se ejecutan los métodos REALES de assets/js/cima-app.js.
 *
 * Uso: node scripts/medcheck-test-pa-subgrupo.mjs
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
const apiSrc = readFileSync(join(ROOT, 'assets/js/cima-api.js'), 'utf8');
const appSrc = readFileSync(join(ROOT, 'assets/js/cima-app.js'), 'utf8');
vm.runInContext(apiSrc, sandbox, { filename: 'cima-api.js' });
vm.runInContext(`${appSrc}\n;window.__C = MedCheckApp;`, sandbox, { filename: 'cima-app.js' });
const C = sandbox.window.__C;
const nuevaApp = (activos = []) => {
    const app = Object.create(C.prototype);
    app.groupingState = { activeIngredientFilters: new Set(activos) };
    return app;
};

let fallos = 0;
const ok = (nombre, cond, detalle) => {
    if (cond) console.log(`✓ ${nombre}`);
    else { fallos += 1; console.log(`✗ ${nombre}${detalle !== undefined ? ` — ${detalle}` : ''}`); }
};
const eq = (nombre, got, exp) => ok(nombre, JSON.stringify(got) === JSON.stringify(exp),
    `esperado ${JSON.stringify(exp)}, obtenido ${JSON.stringify(got)}`);

// ── Datos: laxantes A06A, como los deja el enriquecimiento de cima-api.js ─────────────────────
const SUB = {
    A06AA: 'Emolientes', A06AB: 'Laxantes de contacto', A06AC: 'Laxantes formadores de volumen',
    A06AD: 'Laxantes osmóticos', A06AG: 'Enemas', A06AH: 'Antagonistas de los receptores opioides periféricos',
    A06AX: 'Otros laxantes',
};
let nreg = 0;
const med = (pa, code5, { nivel = true } = {}) => ({
    nregistro: String(++nreg),
    nombre: `${pa.toUpperCase()} ${nreg}`,
    vtm: { nombre: pa },
    atcs: [
        { codigo: 'A06A', nombre: 'LAXANTES', ...(nivel ? { nivel: 3 } : {}) },
        { codigo: code5.slice(0, 5), nombre: SUB[code5.slice(0, 5)] || null, ...(nivel ? { nivel: 4 } : {}) },
        { codigo: code5, nombre: null, ...(nivel ? { nivel: 5 } : {}) },
    ],
});
const rep = (n, ...args) => Array.from({ length: n }, () => med(...args));
const laxantes = [
    ...rep(3, 'parafina liquida', 'A06AA01'),
    ...rep(6, 'bisacodilo', 'A06AB02'), ...rep(4, 'picosulfato de sodio', 'A06AB08'), ...rep(2, 'senósidos A-B', 'A06AB06'),
    ...rep(5, 'Plantago ovata', 'A06AC01'),
    ...rep(7, 'macrogol', 'A06AD15'), ...rep(4, 'lactulosa', 'A06AD11'), ...rep(1, 'lactitol', 'A06AD12'),
    ...rep(3, 'dihidrógenofosfato sodio + hidrógenofosfato disodio', 'A06AD17'),
    ...rep(7, 'glicerol', 'A06AG04'), ...rep(2, 'dihidrógenofosfato sodio + hidrógenofosfato disodio', 'A06AG01'),
    ...rep(2, 'naloxegol', 'A06AH03'), ...rep(2, 'metilnaltrexona', 'A06AH01'), ...rep(1, 'naldemedina', 'A06AH05'),
    ...rep(12, 'glicerol', 'A06AX01'), ...rep(2, 'prucaloprida', 'A06AX05'),
    // Sin `nivel` declarado: la regla cae al respaldo por longitud del código.
    med('linaclotida', 'A06AX04', { nivel: false }),
];

// ── 1. Reparto por subgrupo ──────────────────────────────────────────────────────────────────
console.log('— Reparto por subgrupo —');
const app = nuevaApp();
const grupos = app.extractPAsBySubgroup(laxantes);
ok('agrupa: devuelve una lista', Array.isArray(grupos));
eq('siete subgrupos, uno por código de nivel 4',
    grupos.map(g => g.code).sort(), Object.keys(SUB).sort());
eq('el nombre del grupo es el de la AEMPS', grupos.find(g => g.code === 'A06AD')?.nombre, 'Laxantes osmóticos');
ok('orden: más medicamentos primero', grupos.every((g, i) => i === 0 || grupos[i - 1].total >= g.total),
    grupos.map(g => `${g.code}:${g.total}`).join(' '));
eq('empate (osmóticos y otros, 15 cada uno): decide el código, estable entre repintados',
    grupos.slice(0, 2).map(g => g.code), ['A06AD', 'A06AX']);
const enGrupo = (code) => (grupos.find(g => g.code === code)?.pas || []).map(p => p.name);
ok('lactulosa, macrogol y lactitol caen en los osmóticos',
    ['lactulosa', 'macrogol', 'lactitol'].every(p => enGrupo('A06AD').includes(p)), enGrupo('A06AD'));
ok('los antagonistas opioides periféricos forman su propio grupo',
    JSON.stringify(enGrupo('A06AH').sort()) === JSON.stringify(['metilnaltrexona', 'naldemedina', 'naloxegol']), enGrupo('A06AH'));
ok('un registro sin `nivel` cae por longitud del código (linaclotida → A06AX)', enGrupo('A06AX').includes('linaclotida'));
const cuenta = (code, pa) => grupos.find(g => g.code === code)?.pas.find(p => p.name === pa)?.count;
eq('glicerol sale en enemas con SU recuento', cuenta('A06AG', 'glicerol'), 7);
eq('… y en otros laxantes con el suyo', cuenta('A06AX', 'glicerol'), 12);

// ── 2. Paridad con las tarjetas y con la banda plana ─────────────────────────────────────────
console.log('— Paridad (la misma regla en las tres superficies) —');
const tarjetas = app.groupResultsByField(laxantes, 'atc');
const subDeTarjeta = new Map();
for (const g of tarjetas) for (const m of g.meds) subDeTarjeta.set(m.nregistro, g.subtitle);
const discrepan = laxantes.filter(m => app._atcSubgrupo(m)?.code !== subDeTarjeta.get(m.nregistro));
eq('cada medicamento: subgrupo del chip = subgrupo de su tarjeta', discrepan.map(m => m.nombre), []);
const plana = app.extractUniquePrincipiosActivos(laxantes);
const sumaAgrupada = new Map();
for (const g of grupos) for (const p of g.pas) sumaAgrupada.set(p.name, (sumaAgrupada.get(p.name) || 0) + p.count);
const descuadres = plana.filter(p => sumaAgrupada.get(p.name) !== p.count).map(p => p.name);
eq('cada PA: suma de recuentos agrupados = recuento plano', descuadres, []);
eq('ningún PA aparece agrupado sin estar en la plana',
    [...sumaAgrupada.keys()].filter(n => !plana.some(p => p.name === n)), []);

// ── 3. Cuándo NO se agrupa ───────────────────────────────────────────────────────────────────
console.log('— Cuándo no se agrupa —');
eq('un solo subgrupo → null (banda plana)', app.extractPAsBySubgroup(rep(3, 'lactulosa', 'A06AD11')), null);
eq('sin ATC → null', app.extractPAsBySubgroup([{ vtm: { nombre: 'x' } }, { vtm: { nombre: 'y' } }]), null);
const conHuerfano = app.extractPAsBySubgroup([...rep(2, 'lactulosa', 'A06AD11'), ...rep(2, 'bisacodilo', 'A06AB02'), { nregistro: 'h', vtm: { nombre: 'sinatc' } }]);
eq('un medicamento sin ATC no se pierde: grupo final sin código', conHuerfano.at(-1), { code: '', nombre: null, total: 1, pas: [{ name: 'sinatc', count: 1 }] });

// ── 4. Lo que se pinta ───────────────────────────────────────────────────────────────────────
console.log('— Lo que se pinta —');
const html = app.renderPAFilterChips(plana, { subgrupos: grupos });
const cajas = html.match(/<details class="pa-subgrupo[^"]*"/g) || [];
eq('una caja por subgrupo', cajas.length, 7);
eq('el chip de glicerol se pinta dos veces (una por subgrupo)', (html.match(/data-pa="glicerol"/g) || []).length, 2);
ok('el nombre oficial aparece como cabecera', html.includes('>Laxantes osmóticos<'));
ok('con 7 subgrupos (≤ 12) todas las cajas nacen abiertas', (html.match(/<details[^>]*\sopen>/g) || []).length === 7);
const cajaDe = (h, code) => (h.match(new RegExp(`<details[^>]*data-subgrupo="${code}"[\\s\\S]*?</details>`)) || [''])[0];
ok('el chip de lactulosa está DENTRO de la caja de osmóticos', cajaDe(html, 'A06AD').includes('data-pa="lactulosa"'));
ok('… y no en la de contacto', !cajaDe(html, 'A06AB').includes('data-pa="lactulosa"'));
ok('sin subgrupos la banda es la plana de siempre', !app.renderPAFilterChips(plana).includes('pa-subgrupo'));
ok('con un único PA no hay banda', app.renderPAFilterChips([{ name: 'a', count: 3 }], { subgrupos: grupos }) === '');

// Muchos subgrupos: plegadas, salvo la del filtro puesto y la que el usuario abrió a mano.
const muchos = Array.from({ length: 14 }, (_, i) => {
    const code = `C09${String.fromCharCode(65 + i)}A`;
    return { code, nombre: `Grupo ${i}`, total: 2, pas: [{ name: `pa${i}`, count: 2 }] };
});
const appSel = nuevaApp(['pa3']);
appSel._paSubgrupoManual = new Map([[muchos[5].code, true]]);
const htmlMuchos = appSel.renderPAFilterChips([{ name: 'pa0', count: 2 }, { name: 'pa1', count: 2 }], { subgrupos: muchos });
const abiertas = (htmlMuchos.match(/<details[^>]*data-subgrupo="([^"]+)"[^>]*\sopen>/g) || [])
    .map(s => s.match(/data-subgrupo="([^"]+)"/)[1]);
eq('con 14 subgrupos nacen plegadas salvo la del chip activo y la abierta a mano',
    abiertas.sort(), [muchos[3].code, muchos[5].code].sort());
ok('la caja con el filtro puesto lo marca', cajaDe(htmlMuchos, muchos[3].code).includes('has-active'));
// Plegada a mano ANTES de poner el filtro: el filtro manda, no puede quedar escondido.
appSel._paSubgrupoManual = new Map([[muchos[3].code, false]]);
const htmlPlegada = appSel.renderPAFilterChips([{ name: 'pa0', count: 2 }, { name: 'pa1', count: 2 }], { subgrupos: muchos });
ok('una caja plegada a mano se abre si tiene el chip activo', /^<details[^>]*\sopen>/.test(cajaDe(htmlPlegada, muchos[3].code)),
    cajaDe(htmlPlegada, muchos[3].code).slice(0, 160));

// ── 5. Dónde se usa (complemento de fuente: el efecto ya lo prueban los bloques de arriba) ──
console.log('— Dónde se usa —');
const cuerpo = (nombre) => {
    const i = appSrc.indexOf(`\n    ${nombre}(`);
    return i < 0 ? '' : appSrc.slice(i, appSrc.indexOf('\n    }\n', i));
};
const ind = cuerpo('displayGroupedIndicationResults');
ok('Indicaciones pasa los subgrupos a la banda', ind.includes('this.renderPAFilterChips(paList, { subgrupos: paSubgrupos })'));
ok('Indicaciones agrupa sobre el MISMO conjunto facetado que la lista plana',
    /const paList = this\.extractUniquePrincipiosActivos\(sinFiltroPA\)/.test(ind) && ind.includes('this.extractPAsBySubgroup(sinFiltroPA)'));
ok('Indicaciones engancha la memoria de cajas abiertas', ind.includes('this._wirePASubgrupos(resultsContainer)'));
eq('Buscar sigue con la banda plana (una sola llamada con subgrupos en todo el fichero)',
    (appSrc.match(/this\.renderPAFilterChips\([^)]*subgrupos/g) || []).length, 1);

console.log(fallos ? `\n${fallos} fallo(s)` : '\nOK');
process.exit(fallos ? 1 : 0);
