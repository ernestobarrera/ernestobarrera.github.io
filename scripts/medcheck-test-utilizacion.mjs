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

  const bloqueUtil = app.slice(app.indexOf('renderUtilizacionHtml'), app.indexOf('_emlBadgeHtml(atcCode'));
  // Se miran solo las cadenas que la página puede emitir: los comentarios explican por qué NO se
  // escribe una frase y nombrarla ahí es legítimo. La primera versión de este test se cazó a sí
  // misma por ese motivo.
  const emitido = bloqueUtil.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  // ── CAMBIO DE POLÍTICA (01/09/2026) ──────────────────────────────────────────────────────
  //
  // Hasta hoy la regla era «la DHD no se traduce a personas, nunca», y este test la vigilaba.
  // Se cambia con base documental, no por comodidad: la nota metodológica del Ministerio —que es
  // LA FUENTE de este dato— hace ella misma esa lectura, literalmente: «Dosis Habitante Día
  // (DHD): nº de dosis diarias definidas (DDD) por 1.000 habitantes y día. Este parámetro nos
  // proporciona la estimación de cuántas personas de cada 1.000 están recibiendo al día una
  // DDD». El WHO Collaborating Centre dice lo mismo: «may provide a rough estimate of the
  // proportion of the study population treated daily», válido sobre todo en tratamientos
  // crónicos y con buena concordancia entre la dosis prescrita real y la DDD.
  //
  // Callar una lectura que la propia fuente publica no era prudencia: era dejar la cifra en una
  // unidad que casi nadie maneja. Lo que este test vigila ahora es la frontera exacta: se puede
  // decir «personas que RECIBEN UNA DDD», que es lo que se cuenta; no se puede decir «personas
  // que TOMAN el fármaco», que es el salto que la fuente no da.
  //
  // Se busca en TODO el fichero y no en un recorte: la versión anterior de esta comprobación
  // seguía en verde después del cambio porque el texto se había movido a otro método, fuera del
  // slice. Un detector que deja de mirar donde está el texto no protege de nada.
  const emitidoTodo = app.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok('la lectura en personas existe y usa el denominador de la fuente',
    /De cada 1\.000 personas/.test(emitidoTodo));
  ok('y termina en «una dosis diaria definida», que es lo que de verdad se cuenta',
    /dosis diaria\s*\n?\s*definida \(DDD\)/.test(emitidoTodo));
  ok('MUTANTE: nunca dice que esas personas «toman» o «consumen» el fármaco',
    !/personas?\s+(toman|consumen|est[áa]n tomando)|pacientes tratados al d/i.test(emitidoTodo));
  ok('el denominador no se reescala para que salga un entero más bonito',
    !/de cada 10\.000 personas|de cada 100 personas/i.test(emitidoTodo));
  ok('la cifra va acompañada de qué es una DDD y de que no es la dosis prescrita',
    /_utilNotaDdd\(\)/.test(app) && /no es la dosis que se\s*\n?\s*prescribe/i.test(emitidoTodo));
  ok('y de que es una estimación, no un recuento de pacientes',
    /estimación y no un recuento de\s*\n?\s*pacientes/i.test(emitidoTodo));
  ok('con las dos condiciones que pone la OMS: crónicos y dosis parecida a la DDD',
    /tratamientos crónicos y cuando la dosis real se\s*\n?\s*parece/i.test(emitidoTodo));
  ok('el perímetro sigue declarando que la DDD no es la dosis prescrita',
    /no equivale al número de pacientes|no equivale a la dosis|no cuenta personas|dosis diarias definidas, no personas/i.test(PERIMETRO.nota_dhd));

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

  // Los límites ya no se escriben dentro de cada render. Estaban duplicados con palabras
  // distintas y desplegados en las dos superficies: ocho advertencias en letra pequeña antes de
  // que nadie hubiera explicado qué significaba la cifra. Ahora hay UNO, plegado, y las dos
  // superficies lo llaman — que es lo que garantiza que digan lo mismo.
  ok('la ficha llama al bloque único de límites', /\$\{this\._utilLimitesHtml\(\)\}/.test(emitido));

  const limpio = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const limites = limpio(app.slice(app.indexOf('_utilLimitesHtml() {'), app.indexOf('_utilNotaDdd() {')));
  ok('existe el bloque «Qué no dice este dato»', /Qué <em>no<\/em> dice este dato/.test(limites));
  ok('está plegado, no compitiendo con la cifra', /<details class="util-limits">/.test(limites));
  ok('y niega las cuatro lecturas peligrosas: pacientes, preferencia, cobertura y vías',
    /No cuenta pacientes, cuenta dosis/.test(limites)
    && /No dice qué conviene prescribir/.test(limites)
    && /No cubre todo el consumo/.test(limites)
    && /No cubre todas las vías/.test(limites));
  ok('MUTANTE: el texto no vuelve a duplicarse en los renders',
    (app.match(/Qué <em>no<\/em> dice este dato/g) || []).length === 1);
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
  ok('la cautela de vías de administración sigue en «Qué no dice»',
    /No cubre todas las vías/.test(app));

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
  ok('la vista llama al mismo bloque único de límites', /\$\{this\._utilLimitesHtml\(\)\}/.test(emitido));
  ok('y ese bloque avisa de que los hospitalarios no aparecen en absoluto',
    /uso hospitalario[\s\S]{0,60}no aparecen en absoluto/.test(app));
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

  // «Ver medicamentos con X» no hacía absolutamente nada. `searchByATCCode` escribe en
  // `#indication-results`, que solo existe una vez montada la vista Indicaciones; llamado desde
  // Utilización reventaba con un TypeError sobre `null`, sin error visible y sin efecto. Es el
  // único puente de esta capa hacia CIMA, así que el fallo se llevaba por delante la función.
  const puente = sinComentarios(app.slice(app.indexOf("querySelectorAll('[data-util-medicamentos]')"),
    app.indexOf("const input = this.content.querySelector('#util-buscar')")));
  ok('el salto a los medicamentos monta antes la vista que va a escribir',
    /await this\.loadView\('indications', false\)/.test(puente));
  ok('MUTANTE: y lo hace ANTES de llamar a searchByATCCode',
    puente.indexOf("loadView('indications'") < puente.indexOf('searchByATCCode('));

  const css = readFileSync(join(RAIZ, 'assets', 'css', 'cima-app.css'), 'utf8');
  ok('la salida de la ficha tiene estilo propio', /\.util-tab-actions\s*\{/.test(css));
  // Solo `.util-meta a` y `.util-outofscope a` declaraban color; cualquier enlace en una nota
  // caía al azul por defecto del navegador, invisible sobre el fondo oscuro de MedCheck.
  ok('todos los enlaces de la capa tienen color declarado',
    /\.util-note a,[\s\S]{0,80}\{ color: var\(--primary\) \}|\.util-note a,/.test(css));
}

// ── 15. el código ATC lleva su nombre clínico ──────────────────────────────
//
// La ontología se escribió para ir en un solo sentido (indicación → ATC, para buscar). Leerla al
// revés responde la pregunta que le faltaba a esta capa: delante de `R03AK07`, qué se busca
// cuando se busca esto. El método se EJECUTA contra la ontología real del repo, no se comprueba
// por regex: lo que importa aquí es el resultado, no que exista la función.
console.log('\n15) la ontología, leída al revés, pone nombre clínico a cada nodo');
{
  const api = readFileSync(join(RAIZ, 'assets', 'js', 'cima-api.js'), 'utf8');
  const ont = JSON.parse(readFileSync(join(RAIZ, 'assets', 'data', 'clinical-ontology.json'), 'utf8'));

  const cuerpo = api.slice(api.indexOf('indicacionesDeATC(atc, {'), api.indexOf('    /**\n     * Obtiene la URL base'));
  const CimaAPI = { CLINICAL_DICTIONARY: ont.terms };
  const metodo = new Function('CimaAPI', `return function(){ const o = { ${cuerpo.trimEnd()} }; return o.indicacionesDeATC; }`)(CimaAPI)();
  const ctx = {};
  const inds = (atc, o) => metodo.call(ctx, atc, o).map(h => h.termino);

  ok('R03AK07 se busca como asma y EPOC', inds('R03AK07').includes('asma'));
  ok('A02BC01 se busca como reflujo', inds('A02BC01').includes('reflujo'));
  ok('C10AA05 se busca como dislipemia', inds('C10AA05').includes('dislipemia'));

  // Un ATC inventado no puede inventarse un contexto clínico.
  ok('un código que no existe no devuelve nada', metodo.call(ctx, 'Z99ZZ99').length === 0);
  ok('entrada vacía no revienta', metodo.call(ctx, '').length === 0 && metodo.call(ctx, null).length === 0);
  ok('respeta el tope de términos', metodo.call(ctx, 'C09AA02', { max: 2 }).length <= 2);

  // La herencia va SOLO hacia abajo. Al revés, «C» acumularía todos los términos
  // cardiovasculares del diccionario y el resultado sería ruido, no contexto.
  ok('un grupo anatómico no acumula los términos de sus hijos',
    metodo.call(ctx, 'C').length <= metodo.call(ctx, 'C10AA05').length);

  // Los términos que la propia ontología marca como insuficientes sin filtro por la sección 4.1
  // no pueden atribuirse a un grupo ATC entero: ahí el código no delimita la indicación.
  const conFiltro41 = Object.entries(ont.terms)
    .filter(([, v]) => v.status === 'needsSection41Filter').map(([k]) => k);
  const atribuidos = new Set();
  for (const [, v] of Object.entries(ont.terms)) {
    const codigos = Array.isArray(v.atc) ? v.atc : (v.atc ? [v.atc] : []);
    for (const c of codigos) metodo.call(ctx, c, { max: 99 }).forEach(h => atribuidos.add(h.termino));
  }
  ok(`MUTANTE: ninguno de los ${conFiltro41.length} términos con filtro 4.1 se cuela`,
    conFiltro41.every(t => !atribuidos.has(t)),
    conFiltro41.filter(t => atribuidos.has(t)).join(', '));

  // Y el rótulo, que es donde está el riesgo de afirmar de más: la ontología dice qué búsquedas
  // incluyen este código, NO que el grupo tenga esa indicación autorizada.
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const bloque = app.slice(app.indexOf('_utilIndicacionesHtml(atc) {'), app.indexOf('async irAIndicacion(termino)'));
  const emitido = bloque.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  ok('el rótulo dice «se llega aquí buscando»', /Se llega aquí buscando/.test(emitido));
  ok('MUTANTE: no dice «indicado para» ni «sirve para»',
    !/indicado para|sirve para|tratamiento de/i.test(emitido));
  ok('y remite a la sección 4.1 para la indicación autorizada',
    /secci[óo]n 4\.1/i.test(emitido));

  ok('los términos abren la búsqueda por indicación', /async irAIndicacion\(termino\)/.test(app)
    && /data-util-indicacion/.test(app));
  ok('y están enganchados en la vista', /querySelectorAll\('\[data-util-indicacion\]'\)/.test(app));

  // Esencial OMS: marcador, no juicio. Si el pie apareciera siempre, en un grupo sin ninguno
  // sugeriría lo contrario de lo que dice.
  ok('el marcador de esencial OMS está en el reparto', /util-eml-dot/.test(app));
  ok('la leyenda solo se pinta si hay alguno', /hayEml\s*\n?\s*\?/.test(app) || /const leyendaEml = hayEml/.test(app));
  ok('la leyenda cita la licencia de la OMS', /CC BY-NC-SA 3\.0 IGO/.test(app));
  ok('y aclara que no es un juicio de preferencia',
    /no qué se prescribe\s*\n?\s*más ni qué es mejor/.test(app));

  const css = readFileSync(join(RAIZ, 'assets', 'css', 'cima-app.css'), 'utf8');
  ok('los términos y el marcador tienen estilo propio',
    /\.util-ind-chip\s*\{/.test(css) && /\.util-eml-dot\s*\{/.test(css));
  ok('el chip no repite el fallo de `--surface-raised` sin fallback',
    /--surface-raised, var\(--bg-secondary\)\)/.test(css));
}

// ── 16. el denominador de los porcentajes está a la vista ──────────────────
//
// Nace de una confusión real leyendo la pestaña: en A10BJ se ven 6,68 · 2,21 · 0,17 con sus
// 73,7 % · 24,4 % · 1,9 %, y arriba del todo la cifra del fármaco abierto. Ninguna de las cuatro
// es el 100 %. La aritmética era correcta (6,68+2,21+0,17 = 9,06, el total del grupo), pero ese
// 9,06 no se pintaba en la ficha —solo en la vista navegable—, así que había que sumar
// mentalmente para saber sobre qué se calculaba el porcentaje. Un porcentaje cuyo denominador
// no aparece obliga a un cálculo que nadie hace, y entonces se lee como si fuera de pacientes.
console.log('\n16) el 100 % se puede ver, no hay que calcularlo');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const reparto = app.slice(app.indexOf('renderUtilizacionRepartoHtml(d, g, {'),
    app.indexOf('renderUtilizacionHtml(atc5, d, cpresc) {'));

  // El total del grupo tiene que estar en las dos superficies, pero no DOS VECES en la misma.
  // En la ficha el reparto es el del grupo PADRE —otro código, otra cifra—, así que su cabecera
  // lo enuncia. En la vista el reparto es el del nodo que ya está pintado justo encima, con su
  // código, su nombre y su cifra: repetirlo era duplicación pura. Quien sostiene el denominador
  // en las dos es la LEYENDA, y por eso se exige que lo lleve en las dos ramas.
  ok('la ficha dice el total del grupo en su cabecera, porque allí es otro código',
    (reparto.match(/DHD en total/g) || []).length === 1
    && /Dentro del grupo \$\{esc\(g\.atc\)\}/.test(reparto));
  ok('la vista no lo repite: su reparto es el del nodo ya pintado arriba',
    /navegable \? `\s*\n\s*<h4 class="util-reparto-titulo">C[óo]mo se reparte<\/h4>`/.test(reparto));
  ok('el denominador nunca queda implícito: la leyenda lo lleva en las DOS ramas',
    (reparto.match(/que son \$\{total\}/g) || []).length === 2);
  ok('la leyenda dice sobre qué se calculan los porcentajes, con su cifra',
    /Los porcentajes se calculan sobre la <strong>DHD publicada<\/strong>/.test(reparto)
    && /que son \$\{total\}/.test(reparto));
  ok('y nombra las magnitudes que NO son, que es donde está el error de lectura',
    (reparto.match(/no sobre envases, ni sobre gasto, ni sobre\s*\n?\s*pacientes/g) || []).length === 2);
  // Cobertura del indicador: qué parte del VOLUMEN dispensado del grupo describe el reparto.
  //
  // Antes esto se cerraba con el absoluto que queda fuera («…que suman 1.068.960 envases»). Un
  // absoluto sin denominador no se puede juzgar, que es justo el defecto que esta leyenda existe
  // para corregir en los porcentajes de arriba. Y daba el mismo aviso, con el mismo peso visual,
  // a G03AC —donde el reparto describe el 2 % del volumen— y a A10BJ, donde describe el 99,9 %.
  //
  // El bloque se EJECUTA, no se comprueba por regex: lo que protege es el número que sale, y
  // sobre todo sus dos extremos. Un grupo parcial que dijera «el 100 %» se contradiría con la
  // frase que lo acompaña, y uno que dijera «el 0 %» negaría el reparto que está pintando.
  const cobSrc = reparto.slice(reparto.indexOf('const envDentro = g.miembros.reduce'),
    reparto.indexOf('const leyenda = parcial'));
  ok('el bloque de cobertura es aislable y ejecutable', cobSrc.length > 0);
  // Se ejecuta con `parcial` y `esc` inyectados: así se comprueba también el HTML que sale,
  // no solo el número. La frase es el producto; el número es un paso intermedio.
  const cobertura = new Function('g', 'parcial', 'esc', 'navegable',
    `${cobSrc} return { cobertura, coberturaTxt, coberturaHtml };`);
  const grupoDe = (dentro, fuera) => ({
    atc: 'X00',
    nombre: 'GRUPO DE PRUEBA',
    miembros: dentro.map((e, i) => ({ atc: `X0${i}`, dhd: 1, envases_miles: e })),
    sin_ddd: fuera.map((e, i) => ({ atc: `Y0${i}`, envases_miles: e })),
  });
  const corre = (dentro, fuera, esParcial = true, esNavegable = true) =>
    cobertura(grupoDe(dentro, fuera), esParcial, (s) => s, esNavegable);

  ok('la cobertura se dice en proporción del volumen, no como absoluto suelto',
    corre([25], [75]).coberturaTxt === 'el 25 %');
  ok('un grupo parcial nunca dice «el 100 %»: se contradiría en la misma frase',
    corre([9990], [10]).coberturaTxt === 'más del 99 %');
  ok('ni «el 0 %», que negaría el reparto que está pintando',
    corre([1], [9999]).coberturaTxt === 'menos del 1 %');
  ok('sin dato de envases no se inventa cobertura: la frase se calla',
    corre([null], [null]).coberturaTxt === null);

  // La frase, no el número. Va ARRIBA porque condiciona cómo se leen los porcentajes: saber
  // que el reparto describe el 2 % del volumen sirve antes de mirarlos, no cuatro párrafos
  // después. Estuvo en la cola de la leyenda y no se encontraba.
  const htmlParcial = corre([2], [98]).coberturaHtml;
  ok('la frase se enuncia en positivo, sobre lo que el reparto SÍ describe',
    /Este reparto describe/.test(htmlParcial) && /de los envases dispensados en/.test(htmlParcial));
  // El grupo, con su nombre. Un código ATC suelto no le dice nada a quien no se lo sabe de
  // memoria, que es casi todo el mundo; y el enlace solo existe donde lleva a alguna parte.
  ok('nombra el grupo, no solo su código, para que el denominador no quede implícito',
    /X00, grupo de prueba/.test(htmlParcial));
  const htmlFicha = corre([2], [98], true, false).coberturaHtml;
  ok('en la FICHA el grupo es enlazable: allí es otro nodo',
    /data-util-vista="X00"/.test(htmlFicha) && /X00, grupo de prueba/.test(htmlFicha));
  ok('en la VISTA no se enlaza: sería un enlace a la página que ya se está mirando',
    !/data-util-vista/.test(htmlParcial));
  ok('un grupo NO parcial no emite la frase', corre([100], [], false).coberturaHtml === '');
  ok('sin cobertura calculable tampoco', corre([null], [null]).coberturaHtml === '');

  // El orden importa tanto como el texto: si vuelve a caer detrás de las barras, deja de avisar.
  const orden = (t) => reparto.indexOf(t);
  ok('la frase va DESPUÉS de la cabecera y ANTES de las barras',
    orden('${coberturaHtml}') > orden('${cabecera}')
    && orden('${coberturaHtml}') < orden('<ul class="util-bars'));
  ok('MUTANTE: ya no cuelga de la cola de la leyenda',
    !/dispensados en el grupo\.` : ''/.test(reparto));
  ok('MUTANTE: ya no se cierra con el absoluto sin denominador',
    !/que suman \$\{Math\.round\(fueraEnv \* 1000\)/.test(reparto));
  ok('la leyenda conserva lo que sí es letra pequeña: QUÉ queda fuera',
    /principios? activos? con consumo real y sin DDD asignada/.test(reparto));
  ok('los miembros del reparto llevan sus envases en las DOS superficies',
    /envases_miles: nodos\[k\]\?\.env \?\? null/.test(app)
    && /envases_miles: arbol\.nodos\[k\]\?\.env \?\? null/.test(
      readFileSync(join(RAIZ, 'assets', 'js', 'cima-api.js'), 'utf8')));
  ok('MUTANTE: sigue sin llamarlo «% del grupo»', !/% del grupo/.test(reparto));

  // El reparto dicho en una frase, para los grupos con competencia real de prescripción. Es
  // aritmética directa sobre la cuota que ya se pinta, así que no añade interpretación; lo que
  // sí añade es el sujeto correcto: son DOSIS las que se reparten, no pacientes.
  const frase = app.slice(app.indexOf('_utilFraseReparto(g) {'), app.indexOf('_utilLimitesHtml() {'));
  ok('la frase reparte DOSIS, nunca pacientes',
    /De cada 100 \$\{sujeto\}/.test(frase)
    && /dosis dispensadas en/.test(frase) && !/pacientes|personas/.test(frase.replace(/\/\*[\s\S]*?\*\//g, ' ')));
  ok('y cambia el sujeto cuando el denominador es parcial',
    /denominador === 'parcial'[\s\S]{0,90}dosis con DDD asignada/.test(frase));
  ok('no aparece si un solo principio activo lo copa', /pct\(conCuota\[0\]\) >= 95\) return ''/.test(frase));
  ok('ni si no hay al menos dos por encima del 10 %',
    /pct\(m\) >= 10/.test(frase) && /nombrados\.length < 2\) return ''/.test(frase));
}

// ── 17. la capa se puede leer ───────────────────────────────────────────────
// El contraste no es preferencia estética: es el suelo por debajo del cual el dato deja de
// estar. `--text-muted` global da 3,75:1 sobre `--bg-dark` y en esta capa sostiene los
// porcentajes del reparto y todas las leyendas —incluida la que dice sobre qué se calcula
// cada cifra—. Se comprueba calculando el ratio WCAG real desde los tokens declarados, no
// mirando si el color «parece» claro: si alguien reajusta la paleta, esto tiene que caerse.
console.log('\n17) contraste: los números y sus leyendas se leen');
{
  const css = readFileSync(join(RAIZ, 'assets', 'css', 'cima-app.css'), 'utf8');
  // Extracción sin RegExp dinámica: el nombre del token lleva guiones y el valor va justo detrás.
  const token = (nombre, ambito = css) => {
    const i = ambito.indexOf(nombre + ':');
    if (i < 0) return undefined;
    const m = ambito.slice(i, i + 60).match(/#[0-9a-fA-F]{6}/);
    return m ? m[0] : undefined;
  };

  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (hex) => {
    const [r, g, b] = hex.slice(1).match(/../g).map((x) => lin(parseInt(x, 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };

  const fondo = token('--bg-dark');
  ok('el fondo de la capa está declarado', !!fondo, String(fondo));

  // El bloque que redefine el token dentro de las dos raíces de la capa.
  const ambito = css.slice(css.indexOf('.util-view,\n.util-tab {'), css.indexOf('.util-head {'));
  const mutedCapa = token('--text-muted', ambito);
  ok('la capa redefine --text-muted en sus dos raíces', !!mutedCapa, String(mutedCapa));
  ok('y lo hace para .util-view Y .util-tab, no solo para una',
    /\.util-view,\s*\n\s*\.util-tab\s*\{/.test(ambito));

  const rCapa = mutedCapa ? ratio(fondo, mutedCapa) : 0;
  ok(`el texto de apoyo de la capa pasa WCAG AA (4,5:1) — mide ${rCapa.toFixed(2)}:1`, rCapa >= 4.5);

  const secundario = token('--text-secondary');
  ok('sigue por debajo de --text-secondary: la jerarquía dato/apoyo se mantiene',
    rCapa < ratio(fondo, secundario));

  // MUTANTE: si la redefinición desapareciera, se heredaría el global y esto volvería a fallar.
  const rGlobal = ratio(fondo, token('--text-muted'));
  ok(`MUTANTE: el token global NO bastaba — da ${rGlobal.toFixed(2)}:1`, rGlobal < 4.5);
}

// ── 18. la capa tiene una sola medida de lectura ────────────────────────────
// La vista era la única de exploración sin tope de ancho (`.pgx-view` se topa en 1200px, el
// shell en 1400px), mientras su propia prosa iba acotada a 62–70ch. En un monitor ancho eso
// producía dos ritmos de lectura: párrafos que rompían línea sobre los 600 px y barras que
// corrían hasta el borde, con el nombre del principio activo y su cifra separados por más de
// 1.000 px. La columna del nombre era la culpable: al ser fraccional (`1.4fr`) crecía con la
// ventana en vez de ceder el espacio a la barra, que es lo único que gana con ser más larga.
console.log('\n18) medida de lectura: la vista no se estira con la ventana');
{
  const css = readFileSync(join(RAIZ, 'assets', 'css', 'cima-app.css'), 'utf8');
  const bloqueVista = css.slice(css.indexOf('.util-view {'), css.indexOf('.util-view-header {'));
  ok('la vista declara un tope de ancho', /max-width:\s*\d+px/.test(bloqueVista), bloqueVista.slice(0, 80));
  ok('y se centra, como .pgx-view', /margin:\s*0 auto/.test(bloqueVista));

  const fila = css.slice(css.indexOf('.util-bar-row {'), css.indexOf('.util-bar-row.is-current'));
  const grid = (fila.match(/grid-template-columns:[^;]+;/) || [''])[0];
  ok('la fila del reparto declara su rejilla', grid.length > 0);

  // Lo que importa no es que exista la regla, sino que el NOMBRE no crezca con la ventana.
  const cols = grid.replace('grid-template-columns:', '').replace(';', '').trim();
  const primera = (cols.match(/^minmax\([^)]*\)/) || [''])[0];
  ok('el tope de la columna del nombre es una longitud absoluta, no una fracción',
    /(rem|px)\)\s*$/.test(primera) && !/fr\)\s*$/.test(primera), primera);
  ok('MUTANTE: la columna del nombre ya no es fraccional', !/1\.4fr/.test(grid), grid);
  ok('la barra sí toma el espacio sobrante', /minmax\(60px,\s*1fr\)/.test(grid));

  // El override de móvil sigue existiendo y sigue siendo más específico por media query.
  ok('la variante estrecha sigue declarada', /@media[^{]*560px[\s\S]{0,400}\.util-bar-row \{ grid-template-columns:/.test(css));
}

// ── 19. cada cautela, una sola vez ──────────────────────────────────────────
// Medido sobre el render de G03AC: el 72 % de los caracteres de la pantalla eran cautelas, y
// cada hecho se decía tres o cuatro veces con palabras distintas. La causa no era descuido de
// redacción sino estructura: había CUATRO emisores que no se conocían entre sí —`_utilNotaDdd`,
// las notas del meta del ETL (`nota_dhd`, `nota_denominador`), el disclaimer de la fuente y el
// desplegable—, cada uno escrito en una sesión distinta y cada uno diciendo lo suyo completo.
// Ahora hay un emisor con dos niveles. Este bloque existe para que no vuelvan a aparecer los
// otros tres: la duplicación se cuela sola, un párrafo cada vez, y nadie la ve hasta que la
// pantalla es tres cuartas partes advertencia.
console.log('\n19) las cautelas no vuelven a duplicarse');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');

  ok('el emisor de cautelas es UNO y tiene dos niveles',
    (app.match(/util-limits-lead/g) || []).length === 1
    && (app.match(/<details class="util-limits">/g) || []).length === 1);
  ok('el nivel visible dice lo que cambia la lectura: dosis, cobertura y espejo-no-juez',
    /dosis dispensadas, no pacientes/.test(app)
    && /no incluye hospital, receta privada/.test(app)
    && /no dice qué conviene prescribir<\/strong>/.test(app));

  // Los tres emisores retirados. Si alguno vuelve, vuelve la duplicación.
  ok('MUTANTE: el render ya no reemite `nota_denominador`', !/\$\{esc\(d\.nota_denominador\)\}/.test(app));
  ok('MUTANTE: el render ya no reemite `nota_dhd`', !/\$\{esc\(d\.nota_dhd\)\}/.test(app));
  ok('MUTANTE: no queda ningún `util-disclaimer` suelto', !/util-disclaimer/.test(app));

  // La nota de la DDD se queda con la DEFINICIÓN y la negación esencial; su matiz sobre crónicos
  // baja al pliegue. «Definir antes de negar»: debajo del número va qué es el dato, no una lista
  // de lo que no es.
  const notaDdd = app.slice(app.indexOf('_utilNotaDdd() {'), app.indexOf('_utilNotaDdd() {') + 700);
  ok('la nota de la DDD define antes de negar', /es la dosis diaria de mantenimiento/.test(notaDdd));
  ok('y conserva la negación que cambia la lectura', /no es la dosis que se[\s\S]{0,20}prescribe/.test(notaDdd));
  ok('pero ya no arrastra el matiz de los crónicos, que vive en el pliegue',
    !/sostiene mejor en tratamientos crónicos/.test(notaDdd));
  ok('ese matiz no se ha perdido: está en el desplegable',
    /sostiene mejor en tratamientos crónicos/.test(app));

  // Y el conteo que resume todo: cada hecho, una vez.
  const veces = (re) => (app.match(re) || []).length;
  ok('«no cuenta pacientes» se dice una vez en el pliegue', veces(/No cuenta pacientes, cuenta dosis/g) === 1);
  ok('«no cubre todo el consumo» se dice una vez', veces(/No cubre todo el consumo/g) === 1);
  ok('«no cubre todas las vías» se dice una vez', veces(/No cubre todas las vías/g) === 1);
}

// ── 20. el punto verde se explica, y lo del denominador va junto ────────────
// Dos cosas que él encontró leyendo G03AC en producción.
//
// (a) El punto de esencial OMS se anunciaba sin nombrarse: «● En la Lista Modelo…» es una frase
//     sin sujeto, y el lector tenía que deducir que el punto significaba eso. Ahora arranca con
//     el rótulo «Esencial OMS», el MISMO que usa `_emlBadgeHtml()` en el resto de la app, para
//     que el punto del reparto y el badge de la ficha se lean como la misma cosa.
// (b) La leyenda del denominador estaba debajo de las barras y la frase de cobertura encima:
//     dos piezas del mismo asunto a cuatro párrafos de distancia.
console.log('\n20) la marca se nombra y el denominador va junto');
{
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const reparto = app.slice(app.indexOf('renderUtilizacionRepartoHtml(d, g, {'),
    app.indexOf('renderUtilizacionHtml(atc5, d, cpresc) {'));

  ok('la leyenda del punto empieza NOMBRANDO la marca',
    /<strong>Esencial OMS<\/strong>:/.test(reparto));
  ok('y usa el mismo rótulo que el badge del resto de la app',
    /Esencial OMS/.test(app.slice(app.indexOf('_emlBadgeHtml(atcCode'))));
  ok('MUTANTE: ya no es una frase sin sujeto que empieza en «En la Lista»',
    !/util-eml-dot"><\/span>\s*\n?\s*En la <a/.test(reparto));
  ok('la licencia sigue citada, pero al final y sin cortar la explicación',
    /util-eml-cred">23\.ª lista, CC BY-NC-SA 3\.0 IGO/.test(reparto));
  ok('y sigue aclarando que no es un juicio de preferencia',
    /no qué se prescribe\s*\n?\s*más ni qué es mejor/.test(reparto));

  // El orden del render, que es lo que agrupa o dispersa el contenido.
  const pos = (t) => reparto.indexOf(t);
  ok('la cobertura y la leyenda del denominador van JUNTAS y antes de las barras',
    pos('${coberturaHtml}') < pos('<p class="util-note">${leyenda}</p>')
    && pos('<p class="util-note">${leyenda}</p>') < pos('<ul class="util-bars'));
  ok('la leyenda del punto se queda DEBAJO: explica una marca que vive en las barras',
    pos('${leyendaEml}') > pos('<ul class="util-bars'));
  ok('MUTANTE: la leyenda del denominador ya no cuelga tras las barras',
    !/<\/ul>[\s\S]{0,40}<p class="util-note">\$\{leyenda\}/.test(reparto));
}


// ── 21. la capa tiene UNA escala tipográfica ────────────────────────────────
// Medido antes de este cambio: 22 tamaños de fuente distintos en la capa, 14 de ellos entre
// 0,70 y 0,95rem. Nadie distingue 0,78 de 0,79rem, así que eso no era jerarquía: era el
// sedimento de nueve sesiones, en las que el mismo rol recibía un tamaño distinto según el día.
// La cifra principal llegó a medir 2,6rem en la ficha y 1,9rem en la vista — el mismo dato con
// dos tamaños según la superficie.
//
// Y `max-width: 62ch` repetido a cuatro tamaños de fuente distintos daba cuatro anchos en
// píxeles distintos, porque `ch` se mide sobre la fuente del PROPIO elemento: tres párrafos
// seguidos rompían línea en tres sitios diferentes. Eso es lo que se veía como saltos
// arbitrarios. La medida pasa a ser una sola, en rem.
console.log('\n21) una escala, no 22 tamaños sueltos');
{
  const css = readFileSync(join(RAIZ, 'assets', 'css', 'cima-app.css'), 'utf8');
  const capa = css.slice(css.indexOf('═══ Utilización observada'));

  const sueltos = [...capa.matchAll(/font-size:\s*([0-9.]+rem)/g)].map((m) => m[1]);
  // Los tres que quedan fuera de la escala a propósito: el h2 de la pantalla, el icono del
  // estado vacío y el badge EML, cuyo tamaño es relativo al h3 que lo contiene.
  const PERMITIDOS = new Set(['1.3rem', '1.5rem', '0.62rem']);
  const intrusos = sueltos.filter((v) => !PERMITIDOS.has(v));
  ok(`no quedan tamaños fuera de la escala (encontrados: ${intrusos.join(', ') || 'ninguno'})`,
    intrusos.length === 0);

  const tokens = ['cifra', 'titulo', 'cuerpo', 'nota', 'credito'];
  // Extracción sin RegExp dinámica: el nombre del token lleva guiones y el valor va detrás.
  const decl = (t) => {
    const clave = '--util-fs-' + t + ':';
    const i = capa.indexOf(clave);
    return i < 0 ? null : capa.slice(i + clave.length, i + clave.length + 60);
  };
  ok('los cinco pasos están declarados y cada uno tiene su rol escrito',
    tokens.every((t) => { const d = decl(t); return d !== null && /^\s*[0-9.]+rem;\s*\/\*/.test(d); }));
  ok('y los cinco se usan', tokens.every((t) => capa.includes(`var(--util-fs-${t})`)));

  // El orden de la escala es lo que la hace jerarquía y no cinco números sueltos.
  const val = (t) => { const d = decl(t); return d === null ? NaN : parseFloat(d.match(/[0-9.]+/)[0]); };
  ok('la escala es monótona: cifra > titulo > cuerpo > nota > credito',
    val('cifra') > val('titulo') && val('titulo') > val('cuerpo')
    && val('cuerpo') > val('nota') && val('nota') > val('credito'));

  ok('una sola medida de lectura, y en rem para no depender del tamaño de fuente',
    /--util-medida:\s*[0-9.]+rem;/.test(capa));
  ok('MUTANTE: ya no queda ninguna medida en `ch`, que daba un ancho por tamaño de fuente',
    !/max-width:\s*[0-9]+ch/.test(capa));

  // La negrita marca la CANTIDAD. Era el único sitio donde caía sobre un verbo.
  const app = readFileSync(join(RAIZ, 'assets', 'js', 'cima-app.js'), 'utf8');
  const lectura = app.slice(app.indexOf('_utilLecturaDhd(dhd'), app.indexOf('_utilFraseReparto'));
  ok('la negrita de la lectura envuelve la cantidad, no el verbo',
    /<strong>\$\{cantidad\}<\/strong> \$\{verbo\}/.test(lectura));
  ok('MUTANTE: el verbo ya no viaja dentro del resalte',
    !/frase = 'una recibe'/.test(lectura) && !/reciben`;[\s\S]{0,80}<strong>\$\{frase\}/.test(lectura));
}
console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} FALLO(S)`}`);
process.exit(fallos === 0 ? 0 : 1);
