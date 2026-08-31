#!/usr/bin/env node
/**
 * MedCheck — test del ETL y de la capa de utilización observada.
 *
 * NO comprueba que el ETL «funcione»: eso lo pasaría un script que devolviera 0 siempre. Rompe
 * cada guarda y exige que el código se niegue. Las guardas existen porque cada una impide publicar
 * una cifra que parece honesta y no lo es:
 *
 *   1. la cabecera se localiza por CONTENIDO — se prueban los cinco diseños reales de 2021 a 2025
 *   2. MUTANTE: con índices de columna fijos, el diseño de 2021 leería la DHD de 2023 en la
 *      columna equivocada; se exige que el mapeo por contenido dé columnas distintas por año
 *   3. un ATC5 con envases y sin DDD marca su grupo como «parcial», nunca como «completo»
 *   4. MUTANTE: si `construirGrupos` ignorase los huérfanos, S01ED saldría «completo» con
 *      5 millones de envases fuera del denominador
 *   5. un ATC4 con DHD 0,00 no genera cuotas (dividir por un cero redondeado da cualquier cosa)
 *   6. las validaciones BLOQUEAN ante volumen bajo, unidad cambiada, valor negativo y periodo
 *      que retrocede, y solo AVISAN ante lo que no justifica congelar el dato
 *   7. la DHD redondeada a cero se marca con `z` y jamás se sirve como 0
 *   8. la UI no traduce DHD a personas — se vigila el texto fuente, que es donde reaparecería
 *   9. el ATC de la pestaña se toma del nivel 5, nunca de `atcs[0]`
 *
 * No toca la red.
 *
 * Uso: node scripts/medcheck-test-utilizacion.mjs
 */
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  mapearColumnas, construirArbol, nivelDe, padreDe, fechaFuenteISO, RE_NIVEL, PERIMETRO,
} from './etl-utilizacion/build-utilizacion.mjs';
import { validar, UMBRALES } from './etl-utilizacion/validaciones.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let fallos = 0;
const ok = (nombre, cond, detalle = '') => {
  if (cond) { console.log(`  ok    ${nombre}`); return; }
  fallos++;
  console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

// Los cinco diseños REALES medidos en las tablas anuales ATC4 del Ministerio (30/08/2026).
// La fila de cabecera se mueve y las columnas cambiaron entre 2022 y 2023.
const DISENOS = [
  { anio: 2021, fila: 8, celdas: { A: 'CODIGO', B: 8, D: '2021', E: 10, G: '2020', H: '▲%', I: '2021' }, envases: 'D', dhd: 'I' },
  { anio: 2022, fila: 11, celdas: { A: 'CODIGO', B: 8, D: '2022', E: 10, G: '2021', H: '▲%', I: '2022' }, envases: 'D', dhd: 'I' },
  { anio: 2023, fila: 9, celdas: { A: 'CÓDIGO', B: 'DESCRIPCIÓN', C: '2023', D: '% *', E: '2022', F: '▲%', G: '2023' }, envases: 'C', dhd: 'G' },
  { anio: 2024, fila: 10, celdas: { A: 'CÓDIGO', B: 'DESCRIPCIÓN', C: '2024', D: '% *', E: '2023', F: '▲%', G: '2024' }, envases: 'C', dhd: 'G' },
  { anio: 2025, fila: 9, celdas: { A: 'CÓDIGO', B: 'DESCRIPCIÓN', C: '2025', D: '% *', E: '2024', F: '▲%', G: '2025' }, envases: 'C', dhd: 'G' },
];

const filasCon = (d) => [
  { n: 1, celdas: {} },
  { n: 3, celdas: { A: `CONSUMO EN RECETAS SNS ... - Año ${d.anio}` } },
  { n: d.fila, celdas: d.celdas },
  { n: d.fila + 1, celdas: { A: 'R03AK', B: 'Adrenergicos...', C: 1, D: 2, E: 3, F: 4, G: 5, H: 6, I: 7 } },
];

// ── 1 y 2 ────────────────────────────────────────────────────────────────────
console.log('\n1) la cabecera se localiza por contenido en los cinco diseños reales');
for (const d of DISENOS) {
  const r = mapearColumnas(filasCon(d), d.anio);
  ok(`${d.anio}: cabecera en la fila ${d.fila}`, r?.fila === d.fila, r ? `fila=${r.fila}` : 'no encontrada');
  ok(`${d.anio}: envases en ${d.envases}, DHD en ${d.dhd}`,
    r?.mapa.envases === d.envases && r?.mapa.dhd === d.dhd,
    r ? `envases=${r.mapa.envases} dhd=${r.mapa.dhd}` : '');
}

console.log('\n2) MUTANTE: un índice de columna fijo no puede servir para todos los años');
{
  const c2021 = mapearColumnas(filasCon(DISENOS[0]), 2021).mapa;
  const c2025 = mapearColumnas(filasCon(DISENOS[4]), 2025).mapa;
  ok('la columna de DHD NO es la misma en 2021 y 2025', c2021.dhd !== c2025.dhd, `${c2021.dhd} vs ${c2025.dhd}`);
  ok('la columna de envases NO es la misma en 2021 y 2025', c2021.envases !== c2025.envases);
  // Y con el año equivocado el mapeo debe fallar en vez de inventar columnas.
  ok('con el año equivocado devuelve null', mapearColumnas(filasCon(DISENOS[4]), 1999) === null);
  ok('sin fila de cabecera devuelve null', mapearColumnas([{ n: 1, celdas: { A: 'R03AK07' } }], 2025) === null);
}

// ── 3, 4 y 5 ─────────────────────────────────────────────────────────────────
console.log('\n3-5) el árbol se construye en cinco niveles y el denominador se clasifica igual en todos');
{
  // Datos reales de 2025 recortados: R (respiratorio) completo hasta ATC5, más S01ED —el caso del
  // timolol en combinación, 5,06 M de envases sin DDD dentro de un grupo cuya DHD total es 1,24—
  // y P02CC, cuya DHD es 0,00 por redondeo.
  const niveles = {
    1: new Map([
      ['R', { n: 'SISTEMA RESPIRATORIO', env: 80130.83, dhd: 117.41 }],
      ['S', { n: 'ORGANOS DE LOS SENTIDOS', env: 9000, dhd: 6.2 }],
      ['P', { n: 'ANTIPARASITARIOS', env: 12, dhd: 0, z: 1 }],
    ]),
    2: new Map([
      ['R03', { n: 'AGENTES CONTRA PADECIMIENTOS OBSTRUCTIVOS', env: 30000, dhd: 45.2 }],
      ['S01', { n: 'OFTALMOLOGICOS', env: 8000, dhd: 5.9 }],
      ['P02', { n: 'ANTIHELMINTICOS', env: 12, dhd: 0, z: 1 }],
    ]),
    3: new Map([
      ['R03A', { n: 'ADRENERGICOS, INHALATORIOS', env: 25192.96, dhd: 39.74 }],
      ['S01E', { n: 'ANTIGLAUCOMATOSOS', env: 7000, dhd: 4.1 }],
      ['P02C', { n: 'ANTINEMATODOS', env: 12, dhd: 0, z: 1 }],
    ]),
    4: new Map([
      ['R03AK', { n: 'Adrenergicos en combinacion con corticosteroides', env: 11699.87, dhd: 19.79 }],
      ['S01ED', { n: 'Agentes betabloqueantes', env: 6017.39, dhd: 1.24 }],
      ['P02CC', { n: 'Derivados de la tetrahidropirimidina', env: 12, dhd: 0, z: 1 }],
    ]),
    5: new Map([
      ['R03AK07', { n: 'Formoterol y budesonida', env: 4266.16, dhd: 7.13 }],
      ['R03AK08', { n: 'Formoterol y beclometasona', env: 2826.36, dhd: 4.73 }],
      ['R03AK10', { n: 'Vilanterol y fluticasona f.', env: 2362.26, dhd: 3.95 }],
      ['R03AK06', { n: 'Salmeterol y fluticasona', env: 1387.32, dhd: 2.32 }],
      ['R03AK13', { n: 'Salbutamol y beclometasona', env: 386.34, dhd: 0.72 }],
      ['R03AK14', { n: 'Indacaterol y mometasona', env: 297.66, dhd: 0.5 }],
      ['R03AK11', { n: 'Formoterol y fluticasona', env: 173.77, dhd: 0.44 }],
      ['S01ED01', { n: 'Timolol', env: 700, dhd: 0.9 }],
      ['S01ED02', { n: 'Betaxolol', env: 100, dhd: 0.14 }],
      ['S01ED05', { n: 'Carteolol', env: 150, dhd: 0.2 }],
      ['S01ED51', { n: 'Timolol, combinaciones con', env: 5063.53 }], // envases sí, DDD no
      ['P02CC01', { n: 'Pirantel', env: 12, dhd: 0, z: 1 }],
    ]),
  };
  const a = construirArbol(niveles);

  // ── la jerarquía se reconstruye por longitud de código, sin tabla aparte ──
  ok('nivelDe deduce el nivel por longitud',
    nivelDe('R') === 1 && nivelDe('R03') === 2 && nivelDe('R03A') === 3
    && nivelDe('R03AK') === 4 && nivelDe('R03AK07') === 5);
  ok('padreDe sube un nivel', padreDe('R03AK07') === 'R03AK' && padreDe('R03AK') === 'R03A'
    && padreDe('R03A') === 'R03' && padreDe('R03') === 'R' && padreDe('R') === null);
  ok('cada nodo apunta a su padre', a.R03AK07.p === 'R03AK' && a.R03AK.p === 'R03A' && a.R03A.p === 'R03');
  ok('la raíz no tiene padre', a.R.p === undefined);
  ok('los cinco niveles están en el árbol',
    [1, 2, 3, 4, 5].every(n => Object.values(a).some(x => x.niv === n)));

  // ── el denominador se clasifica igual a cualquier altura ──
  ok('R03AK queda «completo»', a.R03AK.den === 'completo', a.R03AK.den);
  ok('R03AK ordena sus hijos de mayor a menor DHD',
    a.R03AK.h[0] === 'R03AK07' && a.R03AK.h.at(-1) === 'R03AK11');
  ok('la cuota de R03AK07 es 36,0 %', Math.abs(7.13 / a.R03AK.dhd * 100 - 36.0) < 0.05);

  ok('S01ED queda «parcial»', a.S01ED.den === 'parcial', a.S01ED.den);
  ok('S01ED nombra al miembro sin DDD', a.S01ED.sin_ddd.includes('S01ED51'));
  ok('MUTANTE: S01ED no se cuela como «completo» pese a cuadrar la suma', a.S01ED.den !== 'completo');
  ok('el miembro sin DDD no aparece entre los hijos con cuota', !a.S01ED.h.includes('S01ED51'));

  ok('P02CC (DHD 0,00 por redondeo) queda «nulo»', a.P02CC.den === 'nulo', a.P02CC.den);
  ok('una hoja no lleva clasificación de denominador', a.R03AK07.den === undefined);

  // ── el descuadre inexplicado también se caza en niveles altos ──
  const rotas = JSON.parse(JSON.stringify(niveles, (k, v) => v));
  const nivelesMal = { ...niveles, 3: new Map([['R03A', { n: 'x', env: 1, dhd: 999 }]]) };
  const aMal = construirArbol(nivelesMal);
  ok('un nodo cuya suma de hijos no cuadra queda «nulo»', aMal.R03A.den === 'nulo', aMal.R03A.den);

  // ── el reparto de un nivel alto usa sus hijos directos, no las hojas ──
  ok('R03A reparte entre ATC4, no entre ATC5', a.R03A.h.includes('R03AK') && !a.R03A.h.includes('R03AK07'));
  ok('R reparte entre ATC2', a.R.h.includes('R03'));

  // Todos los patrones de nivel casan con sus códigos.
  ok('RE_NIVEL valida cada código en su nivel',
    Object.entries(a).every(([k, v]) => RE_NIVEL[v.niv].test(k)));
}

// ── 6 ───────────────────────────────────────────────────────────────────────
console.log('\n6) las validaciones bloquean lo que debe bloquear y solo avisan del resto');
{
  // Árbol sintético con la forma real: cinco niveles conectados y volumen por encima de los mínimos.
  const base = () => {
    const nodos = {};
    const letras = 'ABCDGHJLMNPRSV'.split('');
    for (const L of letras) nodos[L] = { n: L, niv: 1, dhd: 10, env: 100 };
    let n2 = 0, n3 = 0, n4 = 0, n5 = 0;
    for (const L of letras) {
      for (let i = 1; i <= 6; i++) {
        const c2 = `${L}${String(i).padStart(2, '0')}`;
        nodos[c2] = { n: c2, niv: 2, dhd: 2, env: 20, p: L }; n2++;
        for (const a of ['A', 'B']) {
          const c3 = c2 + a;
          nodos[c3] = { n: c3, niv: 3, dhd: 1, env: 10, p: c2 }; n3++;
          for (const b of ['A', 'B', 'C']) {
            const c4 = c3 + b;
            nodos[c4] = { n: c4, niv: 4, dhd: 0.5, env: 5, p: c3 }; n4++;
            for (let j = 1; j <= 2; j++) {
              const c5 = c4 + String(j).padStart(2, '0');
              nodos[c5] = { n: c5, niv: 5, dhd: 0.25, env: 2, p: c4 }; n5++;
            }
            nodos[c4].h = [c4 + '01', c4 + '02'];
            nodos[c4].den = 'completo';
          }
          nodos[c3].h = [c3 + 'A', c3 + 'B', c3 + 'C'];
          nodos[c3].den = 'nulo'; // 3 x 0,5 != 1: no se declara completo
        }
        nodos[c2].h = [c2 + 'A', c2 + 'B'];
        nodos[c2].den = 'completo';
      }
      nodos[L].h = Array.from({ length: 6 }, (_, i) => `${L}${String(i + 1).padStart(2, '0')}`);
      nodos[L].den = 'nulo';
    }
    return {
      meta: {
        periodo: '2025',
        n_nodos: Object.keys(nodos).length,
        n_por_nivel: { 1: letras.length, 2: n2, 3: n3, 4: n4, 5: n5 },
        fuente_fecha: '2026-04-01T08:18:17.000Z',
        procedencia: { atc5: { etag: 'x' } },
      },
      nodos,
    };
  };

  const sano = validar(base(), null);
  ok('un dataset sano no bloquea', sano.bloquea === false, sano.errores.join(' | '));

  const truncado = base();
  truncado.nodos = Object.fromEntries(Object.entries(truncado.nodos).slice(0, 40));
  truncado.meta.n_nodos = 40;
  ok('BLOQUEA si el árbol viene truncado', validar(truncado, null).bloquea);

  const sinNivel = base();
  for (const k of Object.keys(sinNivel.nodos)) if (sinNivel.nodos[k].niv === 1) delete sinNivel.nodos[k];
  sinNivel.meta.n_nodos = Object.keys(sinNivel.nodos).length;
  ok('BLOQUEA si falta un nivel entero del árbol', validar(sinNivel, null).bloquea);

  const huerfano = base();
  const algunA4 = Object.keys(huerfano.nodos).find((k) => huerfano.nodos[k].niv === 4);
  huerfano.nodos[algunA4].p = 'ZZZZ';
  ok('BLOQUEA si un nodo apunta a un padre inexistente', validar(huerfano, null).bloquea);

  const hijoRoto = base();
  const algunA3 = Object.keys(hijoRoto.nodos).find((k) => hijoRoto.nodos[k].h?.length && hijoRoto.nodos[k].niv === 3);
  hijoRoto.nodos[algunA3].h = [...hijoRoto.nodos[algunA3].h, 'NOEXISTE99'];
  ok('BLOQUEA si un nodo declara hijos inexistentes', validar(hijoRoto, null).bloquea);

  const negativo = base();
  negativo.nodos[Object.keys(negativo.nodos)[0]].dhd = -3;
  ok('BLOQUEA ante una DHD negativa', validar(negativo, null).bloquea);

  const unidad = base();
  unidad.nodos[Object.keys(unidad.nodos)[0]].dhd = UMBRALES.MAX_DHD + 1;
  ok('BLOQUEA ante una DHD fuera de rango (posible cambio de unidad)', validar(unidad, null).bloquea);

  const manipulado = base();
  manipulado.meta.n_nodos = Object.keys(manipulado.nodos).length + 3;
  ok('BLOQUEA si el recuento y el índice no cuadran', validar(manipulado, null).bloquea);

  const previo = base();
  previo.meta.periodo = '2026';
  ok('BLOQUEA si el periodo retrocede', validar(base(), previo).bloquea);

  const perdidos = base();
  const claves = Object.keys(perdidos.nodos);
  for (const k of claves.slice(0, Math.ceil(claves.length * 0.2))) delete perdidos.nodos[k];
  perdidos.meta.n_nodos = Object.keys(perdidos.nodos).length;
  ok('BLOQUEA si desaparece un 20 % de los códigos', validar(perdidos, base()).bloquea);

  // Lo que NO debe bloquear: un miembro sin DDD es información, no avería.
  const parcial = base();
  const hoja = Object.keys(parcial.nodos).find((k) => parcial.nodos[k].niv === 5);
  parcial.nodos[hoja].dhd = null;
  const padre = parcial.nodos[hoja].p;
  parcial.nodos[padre].den = 'parcial';
  parcial.nodos[padre].sin_ddd = [hoja];
  parcial.nodos[padre].h = parcial.nodos[padre].h.filter((k) => k !== hoja);
  const r = validar(parcial, null);
  ok('un ATC5 con envases y sin DDD AVISA, no bloquea',
    r.bloquea === false && r.avisos.some((a) => /sin DDD|no tienen DDD/i.test(a)), r.errores.join(' | '));

  const cero = base();
  cero.nodos[Object.keys(cero.nodos)[1]].z = 1;
  ok('una DHD redondeada a cero AVISA, no bloquea', validar(cero, null).bloquea === false);

  const sinFecha = base();
  delete sinFecha.meta.fuente_fecha;
  ok('sin «fuente_fecha» AVISA, no bloquea',
    validar(sinFecha, null).bloquea === false
    && validar(sinFecha, null).avisos.some((a) => /fuente_fecha/.test(a)));
}

// ── 7, 8 y 9: contrato con la interfaz ──────────────────────────────────────
console.log('\n7-9) contrato de la interfaz');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const api = readFileSync(join(RAIZ, 'assets', 'js', 'cima-api.js'), 'utf8');

  ok('la DHD redondeada a cero se pinta como «<0,01», nunca como «0,00»',
    /_utilDhd\([\s\S]{0,200}&lt;0,01/.test(app));

  // La equivalencia DHD → personas es el error clásico: una DDD no es una persona. Si alguien la
  // reintroduce, este test la caza en el sitio donde reaparecería, que es el texto de la pestaña.
  const bloqueUtil = app.slice(app.indexOf('renderUtilizacionHtml'), app.indexOf('_emlBadgeHtml(atcCode'));
  // Se miran solo las cadenas que la página puede emitir: los comentarios explican por qué NO se
  // escribe esa frase y nombrarla ahí es legítimo. La primera versión de este test se cazó a sí
  // misma por ese motivo.
  const emitido = bloqueUtil.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok('la pestaña NO traduce DHD a número de personas',
    !/de cada 1\.?000 personas|personas (reciben|toman)|pacientes tratados al d/i.test(emitido));
  ok('la pestaña sí declara que la DDD no es una persona',
    /nota_dhd/.test(bloqueUtil) && /no equivale al número de pacientes|no equivale a la dosis|no cuenta personas|dosis diarias definidas, no personas/i.test(PERIMETRO.nota_dhd));

  ok('el porcentaje parcial se etiqueta como «DHD publicada»',
    /DHD publicada/.test(bloqueUtil) && /denominador === 'parcial'/.test(bloqueUtil));

  ok('el perímetro se pinta siempre en la cabecera de la pestaña',
    /util-scope[\s\S]{0,80}perimetro_corto/.test(bloqueUtil));
  ok('el perímetro nombra la oficina de farmacia', /oficina de farmacia/.test(PERIMETRO.corto));
  ok('la cobertura dice explícitamente que no incluye hospital',
    /No incluye dispensación hospitalaria/.test(PERIMETRO.cobertura));

  ok('el ATC de la pestaña se toma del nivel 5', /atcs\?\.find\(a => a\.nivel === 5\)/.test(app));
  ok('MUTANTE: la pestaña NO usa atcs[0]', !/atc5Util\s*=\s*med\.atcs\?\.\[0\]/.test(app));

  ok('el cliente descarga el árbol una sola vez y lo cachea',
    /getUtilizacionArbol/.test(api) && /medcheck_util_arbol_v1/.test(api) && /_utilArbolPromesa/.test(api));
  ok('y nunca lanza: devuelve null ante cualquier fallo',
    /catch \(_\) \{\s*return null;\s*\}/.test(api.slice(api.indexOf('getUtilizacionArbol'))));

  ok('no hay etiquetas de juicio en la pestaña',
    !/muy utilizado|poco utilizado|más recetado|el más usado|popular/i.test(bloqueUtil));
}

// ── 10. canal hospitalario: el hueco tiene dos causas y no se confunden ─────
console.log('\n10) medicamentos de uso hospitalario: la fuente es ciega, no incompleta');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const bloque = app.slice(app.indexOf('_utilCanal('), app.indexOf('_emlBadgeHtml(atcCode'));
  const emitido = bloque.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // El detector se prueba con los valores REALES que devuelve CIMA en `cpresc`.
  const detecta = (v) => /uso hospitalario|diagn[óo]stico hospitalario/i.test(String(v || ''));
  ok('detecta «Uso Hospitalario» (Keytruda)', detecta('Uso Hospitalario'));
  ok('detecta «Diagnóstico Hospitalario» (Humira)', detecta('Diagnóstico Hospitalario'));
  ok('NO marca una receta ordinaria (Symbicort)', !detecta('Medicamento Sujeto A Prescripción Médica'));
  ok('tolera cpresc ausente', !detecta(undefined) && !detecta(null) && !detecta(''));

  ok('el render recibe cpresc', /renderUtilizacionHtml\(atc5, d, cpresc\)/.test(app));
  ok('las dos llamadas a loadUtilizacion pasan cpresc',
    (app.match(/loadUtilizacion\(atc5Util, med\.cpresc\)/g) || []).length === 2);

  // Lo esencial: un hueco por canal hospitalario NO puede presentarse igual que un hueco por
  // consumo bajo. Si alguien unifica los dos mensajes, el antineoplásico se lee como «no se usa».
  ok('hay una rama específica para el canal hospitalario', /canal === 'H'/.test(emitido));
  ok('esa rama dice explícitamente que el hueco no es consumo bajo',
    /no significa que se use poco/i.test(emitido));
  ok('la rama genérica también avisa de no leerlo como ausencia de uso',
    /No debe leerse como ausencia de\s*\n?\s*uso/i.test(emitido) || /ausencia de\s*<\/strong>?\s*\n?\s*uso/i.test(emitido) || /ausencia de[\s\S]{0,20}uso/i.test(emitido));
  ok('se ofrece dónde SÍ está el dato hospitalario', /donde_esta_el_hospitalario/.test(emitido));

  ok('un fármaco hospitalario CON dato lleva aviso de cifra parcial',
    /avisoParcial/.test(emitido) && /Solo la parte de oficina de farmacia/.test(emitido));
  ok('el aviso parcial se inyecta en el render', /\$\{cabecera\}\$\{avisoParcial\}/.test(emitido));

  ok('existe el bloque «Qué no dice este dato»', /Qué no dice este dato/.test(emitido));
  ok('y niega las tres lecturas peligrosas: personas, preferencia y cobertura total',
    /No dice cuántas personas/.test(emitido)
    && /No dice si es la mejor opción/.test(emitido)
    && /No cubre todo el consumo/.test(emitido));
}

// ── 10 bis. lo que corrigió la revisión de Codex ────────────────────────────
console.log('\n10 bis) correcciones de la revisión cruzada');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const bloque = app.slice(app.indexOf('_utilCanal('), app.indexOf('_emlBadgeHtml(atcCode'));
  const emitido = bloque.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // (a) H y DH dejan de tratarse igual. DH puede dispensarse en oficina de farmacia, así que
  // afirmar «la mayor parte se dispensa en el hospital» sería decir de más.
  ok('el canal distingue H de DH', /return 'H'/.test(bloque) && /return 'DH'/.test(bloque));
  ok('hay rama propia para H y para DH en el hueco', /canal === 'H'/.test(emitido) && /canal === 'DH'/.test(emitido));
  ok('solo H afirma que la mayor parte se dispensa en hospital',
    /uso hospitalario: la mayor parte de su dispensación ocurre/i.test(emitido));
  ok('DH no lo afirma: dice «puede faltar parte»', /Puede faltar parte del consumo/.test(emitido)
    && !/diagnóstico hospitalario[\s\S]{0,120}mayor parte de su uso se dispensa/i.test(emitido));

  // (b) El porcentaje se llama siempre «de la DHD publicada». La aritmética puede cuadrar y la
  // cobertura no: dentro de un mismo ATC5 la DHD puede excluir vías sin DDD (ejemplo G04BE del
  // propio Ministerio), y eso es indetectable desde el dato.
  ok('el porcentaje se etiqueta SIEMPRE «DHD publicada»',
    (emitido.match(/DHD publicada/g) || []).length >= 2);
  ok('MUTANTE: ya no se afirma «todos sus principios activos con consumo tienen DDD»',
    !/Todos sus principios activos con consumo tienen DDD/i.test(emitido));
  ok('la cautela de vías de administración está en «Qué no dice»',
    /No siempre cubre todas las vías/.test(emitido));

  // (c) La nota del consumo hospitalario ya no es absoluta.
  ok('nota_hospital acota la afirmación a la serie mensual',
    /serie mensual/i.test(PERIMETRO.nota_hospital)
    && /No existe una serie hospitalaria en DHD/i.test(PERIMETRO.nota_hospital));
  ok('donde_esta_el_hospitalario reconoce que sí hay ATC5',
    /desglosa el consumo hospitalario por[\s\S]{0,30}principio activo/i.test(PERIMETRO.donde_esta_el_hospitalario));
  ok('y apunta al monográfico vigente (2024)', /InfAnual2024/.test(PERIMETRO.donde_esta_el_hospitalario_url));

  // (d) Atribución exigida por el aviso legal del Ministerio.
  ok('el perímetro lleva la atribución legal',
    /aviso legal/i.test(PERIMETRO.atribucion || '') && /fecha de última\s*actualización/i.test(PERIMETRO.atribucion || ''));
}

// ── 10 ter. el guard de duplicados ahora es real ───────────────────────────
console.log('\n10 ter) duplicados: se cazan donde se pierden, en el parseo');
{
  const cabecera = { n: 9, celdas: { A: 'CÓDIGO', B: 'DESCRIPCIÓN', C: '2025', D: '% *', E: '2024', F: '▲%', G: '2025' } };
  const fila = (n, cod, dhd) => ({ n, celdas: { A: cod, B: 'x', C: 100, D: 0.01, E: 90, F: 0.1, G: dhd } });

  // No se puede construir un XLSX aquí, así que se prueba `parsear` a través de un buffer real no
  // es viable; en su lugar se comprueba la propiedad que importa con el mismo algoritmo: dos filas
  // con el mismo código deben provocar un error, no una sobreescritura silenciosa.
  const simular = (filas) => {
    const out = new Map();
    for (const f of filas) {
      if (f.n <= cabecera.n) continue;
      const cod = f.celdas.A;
      if (typeof cod !== 'string' || !/^[A-V]\d{2}[A-Z]{2}\d{2}$/.test(cod)) continue;
      if (out.has(cod)) throw new Error(`duplicado ${cod}`);
      out.set(cod, { dhd: f.celdas.G });
    }
    return out;
  };
  let rompio = false;
  try { simular([cabecera, fila(10, 'R03AK07', 7.13), fila(11, 'R03AK07', 9.99)]); } catch { rompio = true; }
  ok('dos filas con el mismo ATC5 LANZAN', rompio);
  ok('sin duplicados no lanza', simular([cabecera, fila(10, 'R03AK07', 7.13), fila(11, 'R03AK08', 4.73)]).size === 2);

  // Y el parser real debe llevar esa guarda escrita, no solo la simulación del test.
  const etl = readFileSync(join(RAIZ, 'scripts', 'etl-utilizacion', 'build-utilizacion.mjs'), 'utf8');
  ok('`parsear` tiene la guarda de duplicado antes del set', /if \(out\.has\(clave\)\) \{[\s\S]{0,240}throw new Error/.test(etl));
  ok('MUTANTE: la validación ya NO pretende cazar duplicados',
    !/hay códigos repetidos en origen/.test(readFileSync(join(RAIZ, 'scripts', 'etl-utilizacion', 'validaciones.mjs'), 'utf8')));
}

// ── 10 quater. la fecha que vigila el watchdog es la de la fuente ──────────
console.log('\n10 quater) el watchdog mira el reloj del Ministerio, no el nuestro');
{
  ok('fechaFuenteISO convierte un Last-Modified HTTP',
    fechaFuenteISO('Wed, 01 Apr 2026 08:18:17 GMT') === '2026-04-01T08:18:17.000Z',
    String(fechaFuenteISO('Wed, 01 Apr 2026 08:18:17 GMT')));
  ok('y tolera ausencia o basura', fechaFuenteISO(null) === null && fechaFuenteISO('no es fecha') === null);

  const wd = readFileSync(join(RAIZ, 'scripts', 'watchdog', 'check_freshness.py'), 'utf8');
  const bloque = wd.slice(wd.indexOf('utilizacion:meta'), wd.indexOf('utilizacion:meta') + 400);
  ok('la fuente utilizacion vigila `fuente_fecha`', /"date_fields":\s*\["fuente_fecha"\]/.test(bloque), bloque.slice(0, 160));
  ok('MUTANTE: NO vigila `generated_at`, que se refresca cada mes sin que la fuente cambie',
    !/generated_at/.test(bloque));
}

// ── 10 quinquies. analítica del Worker ─────────────────────────────────────
console.log('\n10 quinquies) el quick win se puede medir');
{
  const wk = readFileSync(join(RAIZ, '..', 'medcheck-worker', 'index.js'), 'utf8');
  ok('«modal-utilizacion» es una vista válida', /'modal-utilizacion'/.test(wk));
  ok('el Worker extrae el ATC de /utilizacion/by-atc/', /path\.startsWith\('\/utilizacion\/by-atc\/'\)/.test(wk));
  ok('y devuelve el código en mayúsculas', /match\[1\]\.toUpperCase\(\)/.test(wk.slice(wk.indexOf("'/utilizacion/by-atc/'"))));
  ok('/utilizacion/ sigue en los endpoints registrados', /'\/utilizacion\/',/.test(wk));
}

// ── 11. el perímetro lleva la pista del dato hospitalario ──────────────────
console.log('\n11) el ETL declara dónde sí está el consumo hospitalario');
{
  ok('nota_hospitalarios explica por qué falta', /no se facturan por receta/i.test(PERIMETRO.nota_hospitalarios || ''));
  ok('donde_esta_el_hospitalario nombra el informe anual', /Prestación Farmacéutica/i.test(PERIMETRO.donde_esta_el_hospitalario || ''));
  ok('y advierte de que es en euros, no en DDD',
    /euros|precio de venta/i.test(PERIMETRO.donde_esta_el_hospitalario || '')
    && /no en DDD|no en dosis/i.test(PERIMETRO.donde_esta_el_hospitalario || ''));
  ok('con URL', /^https:\/\/www\.sanidad\.gob\.es\//.test(PERIMETRO.donde_esta_el_hospitalario_url || ''));
}

// ── 12. la vista principal existe y está cableada ──────────────────────────
console.log('\n12) «Utilización» es una vista principal, al nivel de Buscar');
{
  const html = readFileSync(join(RAIZ, 'medcheck.html'), 'utf8');
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const wk = readFileSync(join(RAIZ, '..', 'medcheck-worker', 'index.js'), 'utf8');

  ok('hay pestaña de navegación en el HTML', /data-view="utilization"/.test(html));
  ok('está entre las nav-tab, no dentro del modal',
    /<button class="nav-tab" data-view="utilization">/.test(html));
  ok('el conmutador de vistas la resuelve', /case 'utilization': await this\.renderUtilizacionView\(\)/.test(app));
  ok('existe el render de la vista', /async renderUtilizacionView\(\)/.test(app));
  ok('la vista se pinta contra el árbol descargado', /this\._utilArbolVista/.test(app));
  ok('la analítica la reconoce', /utilization:\s*'utilizacion'/.test(app) && /'utilizacion',/.test(wk));

  const vista = app.slice(app.indexOf('async renderUtilizacionView()'), app.indexOf('_engancharUtilizacionView() {'));
  const emitido = vista.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  ok('la vista tiene miga de pan para subir', /util-crumbs/.test(emitido) && /data-util-ir/.test(emitido));
  ok('y buscador por código o principio activo', /util-buscar/.test(emitido));
  ok('el perímetro se pinta también aquí', /util-scope[\s\S]{0,80}perimetro_corto/.test(emitido));
  ok('lleva el bloque «Qué no dice este dato»', /Qué no dice este dato/.test(emitido));
  ok('y avisa de que los hospitalarios no aparecen en absoluto',
    /uso\s*\n?\s*hospitalario[\s\S]{0,80}no aparecen en absoluto/.test(emitido));
  ok('dice explícitamente que no indica qué prescribir',
    /no dice cuál conviene prescribir/i.test(emitido));
  ok('no hay etiquetas de juicio en la vista',
    !/muy utilizado|poco utilizado|más recetado|el más usado|ranking|popular/i.test(emitido));

  // MUTANTE: la vista no puede quedar como único sitio; la ficha sigue teniendo su pestaña.
  ok('la pestaña del modal sigue existiendo', /data-tab="utilizacion"/.test(app));
  // Y la inyección duplicada en Indicaciones se retiró: dos navegaciones para lo mismo confunden.
  ok('MUTANTE: ya no se inyecta el panel en la vista Indicaciones',
    !/inyectarUtilizacionEnNavegacion/.test(app));
}

// ── 13. el ETL arranca de verdad al invocarlo ──────────────────────────────
console.log('\n13) el ETL se ejecuta cuando se le llama, en cualquier sistema operativo');
{
  const etl = readFileSync(join(RAIZ, 'scripts', 'etl-utilizacion', 'build-utilizacion.mjs'), 'utf8');

  // Nace de un fallo real en el primer run del workflow: el guard de módulo principal comparaba
  // `import.meta.url` con «file:///» + process.argv[1] concatenado. En Windows casaba; en Linux
  // la ruta ya empieza por «/», así que salía `file:////home/...` con cuatro barras, nunca casaba
  // y node terminaba con éxito SIN HACER NADA. 48 ms, cero salida, cero fichero, paso en verde.
  ok('el guard usa pathToFileURL, no concatenación de cadenas',
    /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/.test(etl));
  ok('MUTANTE: ya no se concatena «file:///» con argv[1]',
    !/file:\/\/\/\$\{process\.argv\[1\]/.test(etl));

  // La prueba que de verdad lo caza: invocarlo como proceso y exigir que diga algo. Si el guard
  // vuelve a romperse, `main()` no corre y la salida es exactamente vacía.
  const dirVacio = mkdtempSync(join(tmpdir(), 'medcheck-etl-'));
  const r = spawnSync(process.execPath, [
    join(RAIZ, 'scripts', 'etl-utilizacion', 'build-utilizacion.mjs'),
    '--from-dir', dirVacio, '--anio', '2025', '--out', join(dirVacio, 'salida.json'),
  ], { encoding: 'utf8' });
  const salida = (r.stdout || '') + (r.stderr || '');
  ok('invocado como proceso, produce salida', salida.trim().length > 0,
    `stdout=${(r.stdout || '').length}B stderr=${(r.stderr || '').length}B status=${r.status}`);
  ok('y con un directorio vacío BLOQUEA en vez de fingir que fue bien',
    r.status === 1, `status=${r.status}`);
  ok('el motivo del bloqueo se explica', /ERRORES|nodos en el árbol|No hay ni un nodo/.test(salida),
    salida.slice(0, 160));

  // `--head-only` sí toca la red; se prueba solo el contrato de que la opción existe.
  ok('la opción --head-only sigue declarada', /--head-only/.test(etl));
}

// ── 14. la capa es enlazable y navegable ───────────────────────────────────
//
// Nace de un fallo real: la vista se publicó funcionando y el enlace
// `medcheck.html?view=utilization` aterrizaba en Buscar. La causa no estaba en la vista sino en
// una lista blanca de OTRO módulo que nadie tocó al añadirla, y por eso ningún test la vio.
//
// Las dos listas se comprueban aquí porque son el patrón de fallo que se repite: cada vista o
// pestaña nueva exige una entrada en una lista que vive lejos de ella y no da ningún error
// cuando falta. Simplemente cae al valor por defecto, en silencio.
console.log('\n14) la capa se puede enlazar, compartir y recorrer');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');

  const listaVistas = app.slice(app.indexOf('const validViews = ['), app.indexOf('const targetView'));
  ok('`?view=utilization` está en la lista blanca de vistas', /'utilization'/.test(listaVistas));
  ok('MUTANTE: si se cae de la lista, el enlace aterrizaría en Buscar',
    /validViews\.includes\(view\) \? view : 'search'/.test(app));

  const listaTabs = (app.match(/const validModalTabs = \[[^\]]*\]/) || [''])[0];
  ok('`&tab=utilizacion` está en la lista blanca de pestañas de ficha', /'utilizacion'/.test(listaTabs));
  ok('y la ficha sabe abrirse en esa pestaña', /initialTab === 'utilizacion'/.test(app));

  // Los cortes se hacen por la FIRMA de cada método, no por su nombre: el nombre aparece antes
  // en las llamadas y el trozo analizado saldría desplazado, dando por buena una comprobación
  // que en realidad mira otro sitio.
  const desde = (firma) => app.indexOf(firma);
  const FIRMA_REPARTO = 'renderUtilizacionRepartoHtml(d, g, {';
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // El nodo del árbol viaja en la URL. Sin esto no se puede compartir un grupo concreto, Atrás
  // expulsa de la vista entera en vez de subir un nivel, y recargar devuelve a la raíz.
  const entrada = sinComentarios(app.slice(desde('async renderUtilizacionView()'), desde('async irAUtilizacion(cod)')));
  ok('la vista lee el nodo pedido en la URL', /getURLParams\(\)\.atc/.test(entrada));
  ok('y lo valida contra el árbol antes de abrirlo',
    /arbol\.nodos\[pedido\] \? pedido : null/.test(entrada));

  const enganche = sinComentarios(app.slice(desde('_engancharUtilizacionView() {'), desde(FIRMA_REPARTO)));
  ok('navegar por el árbol escribe el nodo en la URL',
    /updateURL\(cod \? \{ view: 'utilization', atc: cod \}/.test(enganche));

  // Un ATC5 es hoja de la jerarquía pero NO un callejón: su nodo es donde vive el único puente
  // hacia CIMA. El corte anterior dejaba el principio activo —lo que el médico busca— sin enlace.
  const reparto = app.slice(desde(FIRMA_REPARTO), desde('renderUtilizacionHtml(atc5, d, cpresc) {'));
  ok('MUTANTE: el reparto ya no corta el enlace en el nivel 5',
    !/navegable && m\.nivel < 5/.test(reparto));
  ok('todos los miembros del reparto llevan a algún sitio',
    /data-\$\{accion\}="\$\{esc\(m\.atc\)\}"/.test(reparto));
  ok('en la ficha el destino es la vista completa',
    /navegable \? 'util-baja' : 'util-vista'/.test(reparto));

  // La pestaña de la ficha tenía el reparto pintado y ninguna salida: no se podía ni saltar a un
  // principio activo hermano ni volver a la vista con ese grupo abierto.
  ok('existe el salto a la vista desde cualquier punto', /async irAUtilizacion\(cod\)/.test(app));
  ok('la ficha ofrece salida hacia el árbol', /util-tab-actions/.test(app));
  ok('y los enlaces de la ficha están enganchados',
    /querySelectorAll\('\[data-util-vista\]'\)/.test(app));

  const css = readFileSync(join(RAIZ, 'assets', 'css', 'cima-app.css'), 'utf8');
  ok('la salida de la ficha tiene estilo propio', /\.util-tab-actions\s*\{/.test(css));
}

console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
