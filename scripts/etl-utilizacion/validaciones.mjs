/**
 * MedCheck — controles de calidad del ETL de utilización.
 *
 * Ninguno es hipotético: cada uno responde a algo observado en la fuente el 30/08/2026 o a una
 * propiedad medida del dato. La regla de oro es la de `etl-biomarkers`: ante anomalía no se
 * publica, y KV conserva la última versión válida. Un ETL que publica lo que sea con tal de
 * terminar es peor que uno que no corre.
 *
 * `bloquea` distingue lo que impide publicar de lo que solo hay que mirar. Confundirlos tiene
 * coste en las dos direcciones: bloquear por un aviso deja el dato congelado sin motivo, y avisar
 * por un error publica cifras malas.
 */

/** Umbrales. Aquí arriba para que se vean y se discutan, no enterrados en el código. */
export const UMBRALES = Object.freeze({
  // Misma tolerancia que aplica `construirArbol` al descuadre de la DHD: el redondeo de la
  // fuente mueve las últimas cifras, un descuadre real las mueve mucho más.
  TOLERANCIA_SUMA: 0.02,
  MIN_ATC5: 700,              // 2025 trae 951; una caída a 700 ya es anómala
  MIN_ATC4: 300,              // 2025 trae 366
  MIN_NODOS: 1200,            // 2025 trae 1.575 en los cinco niveles
  CAIDA_CODIGOS: 0.05,        // >5 % de códigos desaparecidos respecto al anterior
  // Cuántos nodos traen DHD numérica. En 2025 son 1.222 de 1.575 (77,6 %); el resto viene con la
  // celda vacía en origen. Si esa proporción se desploma, no es que el Ministerio haya dejado de
  // calcular dosis: es que hemos dejado de saber leerlas, y cada código perdido se publicaría como
  // «sin DHD», indistinguible de una ausencia legítima. `parsear` ya bloquea si una celda trae algo
  // no numérico; esto cubre el caso en que la columna venga vacía o el mapeo apunte a otra parte.
  MIN_COBERTURA_DHD: 0.60,
  CAIDA_COBERTURA_DHD: 0.10,  // >10 puntos menos que la pasada anterior
  VARIACION_ATC5: 0.5,        // >50 % interanual en un ATC5: mirar, no bloquear
  DESCUADRE_GRUPO: 0.02,      // suma de hijos vs total del padre
  // La DHD mas alta del fichero de 2025 es 96,24 (omeprazol); el ATC4 mas alto, 127,88 (IBP), y el
  // ATC1 mas alto ronda las centenas. Un valor de 2.000 no puede ser consumo real: seria un cambio
  // de unidad en origen.
  MAX_DHD: 2000,
});

const RE_POR_NIVEL = { 1: /^[A-V]$/, 2: /^[A-V]\d{2}$/, 3: /^[A-V]\d{2}[A-Z]$/, 4: /^[A-V]\d{2}[A-Z]{2}$/, 5: /^[A-V]\d{2}[A-Z]{2}\d{2}$/ };

export function validar(doc, previo) {
  const errores = [];
  const avisos = [];
  const nodos = doc.nodos ?? {};
  const codigos = Object.keys(nodos);
  const hojas = codigos.filter((k) => nodos[k].niv === 5);
  const conHijos = codigos.filter((k) => nodos[k].h?.length);


  // ── reparto por envases: las cinco puertas, revalidadas sobre el documento construido ─────
  //
  // `construirArbol` ya las aplica al crear el árbol, pero una validación que confía en que el
  // productor hizo bien su trabajo no valida nada: si alguien relaja una puerta allí, esto tiene
  // que caerse. Son BLOQUEANTES, no avisos: un reparto de envases que mezclase magnitudes o cuyo
  // denominador no cuadrase con la fuente publicaría un porcentaje que no se sostiene.
  const porEnvases = codigos.filter((k) => nodos[k].mag === 'env');
  for (const k of porEnvases) {
    const v = nodos[k];
    if (typeof v.dhd === 'number') {
      errores.push(`${k}: reparto por envases en un nodo que SÍ tiene DHD (${v.dhd}). Son magnitudes distintas y no pueden convivir.`);
    }
    if (!Array.isArray(v.he) || v.he.length < 2) {
      errores.push(`${k}: reparto por envases con ${v.he?.length ?? 0} miembros. Con menos de dos no hay reparto que mostrar.`);
    }
    if (v.h?.length) {
      errores.push(`${k}: tiene reparto por DHD y por envases a la vez.`);
    }
    const conDhd = (v.he ?? []).filter((c) => typeof nodos[c]?.dhd === 'number');
    if (conDhd.length) {
      errores.push(`${k}: reparto por envases con hijos que tienen DHD (${conDhd.join(', ')}). Mezclaría dos escalas en la misma barra.`);
    }
    // La única comprobación que puede desmentir el dato contra la fuente.
    const suma = (v.he ?? []).reduce((acc, c) => acc + (nodos[c]?.env ?? 0), 0);
    if (!(v.env > 0) || Math.abs(suma - v.env) / v.env > UMBRALES.TOLERANCIA_SUMA) {
      errores.push(`${k}: la suma de envases de sus hijos (${suma}) no cuadra con la del grupo (${v.env}).`);
    }
  }
  // Y a la inversa: un `he` sin su marca, o una marca sin su `he`, es un árbol a medio construir.
  for (const k of codigos) {
    const v = nodos[k];
    if (v.he?.length && v.mag !== 'env') errores.push(`${k}: tiene reparto por envases sin declarar la magnitud.`);
    if (v.mag === 'env' && !v.he?.length) errores.push(`${k}: declara magnitud de envases y no trae reparto.`);
  }
  // Si la cifra se desploma, la fuente ha cambiado algo en las filas sin DDD. No es un error:
  // es un cambio que merece una mirada humana antes de publicar.
  if (previo?.meta?.n_grupos_envases > 0 && porEnvases.length < previo.meta.n_grupos_envases * 0.7) {
    avisos.push(`Los grupos con reparto por envases caen de ${previo.meta.n_grupos_envases} a ${porEnvases.length}. ¿Ha cambiado el diseño del fichero?`);
  }

  // ── 1. volumen mínimo ────────────────────────────────────────────────────
  if (codigos.length < UMBRALES.MIN_NODOS) {
    errores.push(`Solo ${codigos.length} nodos en el árbol (mínimo ${UMBRALES.MIN_NODOS}). Fichero truncado o mal parseado.`);
  }
  if (hojas.length < UMBRALES.MIN_ATC5) {
    errores.push(`Solo ${hojas.length} códigos ATC5 (mínimo ${UMBRALES.MIN_ATC5}).`);
  }
  if (codigos.filter((k) => nodos[k].niv === 4).length < UMBRALES.MIN_ATC4) {
    errores.push(`Solo ${codigos.filter((k) => nodos[k].niv === 4).length} códigos ATC4 (mínimo ${UMBRALES.MIN_ATC4}).`);
  }
  // Los cinco niveles tienen que estar. Si falta uno, el árbol queda desconectado y la navegación
  // se rompe en silencio a mitad del descenso.
  for (const n of [1, 2, 3, 4, 5]) {
    if (!codigos.some((k) => nodos[k].niv === n)) errores.push(`No hay ni un nodo de nivel ATC${n}.`);
  }

  // ── 2. valores imposibles ────────────────────────────────────────────────
  for (const [k, v] of Object.entries(nodos)) {
    if (v.dhd !== null && v.dhd !== undefined && (v.dhd < 0 || !Number.isFinite(v.dhd))) errores.push(`${k}: DHD imposible (${v.dhd}).`);
    if (v.env !== undefined && v.env !== null && (v.env < 0 || !Number.isFinite(v.env))) errores.push(`${k}: envases imposibles (${v.env}).`);
    if (v.dhd > UMBRALES.MAX_DHD) errores.push(`${k}: DHD ${v.dhd} fuera de rango plausible. ¿Cambio de unidad?`);
  }

  // ── 3. coherencia del recuento ───────────────────────────────────────────
  // Los duplicados de origen NO se detectan aquí: para cuando el dataset llega a esta función ya
  // son un solo elemento del índice, y comparar el recuento consigo mismo siempre sale verde. Esa
  // era la trampa de la versión anterior. El duplicado lo caza `parsear()`, que lanza al verlo.
  const declarados = doc.meta?.n_nodos;
  if (declarados !== undefined && declarados !== codigos.length) {
    errores.push(`El fichero declara ${declarados} nodos y el índice tiene ${codigos.length}: el dataset se ha manipulado tras construirse.`);
  }
  // Y que la fecha de la fuente viaje: sin ella el watchdog vigila su propio reloj.
  if (!doc.meta?.fuente_fecha && doc.meta?.procedencia?.atc5) {
    avisos.push('El dataset no lleva `fuente_fecha`: el watchdog no podrá distinguir «la fuente no publica» de «el ETL no corre».');
  }

  // ── 3 bis. cobertura de la DHD ───────────────────────────────────────────
  // Una desaparición masiva de cifras no rompe nada: el árbol sigue completo, los recuentos
  // cuadran y todo sale verde. Lo único que cambia es que cientos de fichas pasan a decir que
  // no hay DHD, que es una afirmación sobre el mundo. Por eso se mide y bloquea.
  const conDhd = codigos.filter((k) => typeof nodos[k].dhd === 'number').length;
  const cobertura = codigos.length ? conDhd / codigos.length : 0;
  if (cobertura < UMBRALES.MIN_COBERTURA_DHD) {
    errores.push(
      `Solo ${conDhd} de ${codigos.length} nodos (${(cobertura * 100).toFixed(1)} %) traen DHD numérica, `
      + `por debajo del mínimo ${(UMBRALES.MIN_COBERTURA_DHD * 100).toFixed(0)} %. `
      + 'O la fuente ha cambiado de formato o el mapeo de columnas apunta a otro sitio.',
    );
  }
  const nodosAnt = previo?.nodos ? Object.keys(previo.nodos) : [];
  if (nodosAnt.length) {
    const covAnt = nodosAnt.filter((k) => typeof previo.nodos[k].dhd === 'number').length / nodosAnt.length;
    if (covAnt - cobertura > UMBRALES.CAIDA_COBERTURA_DHD) {
      errores.push(
        `La cobertura de DHD cae de ${(covAnt * 100).toFixed(1)} % a ${(cobertura * 100).toFixed(1)} %, `
        + `más de ${(UMBRALES.CAIDA_COBERTURA_DHD * 100).toFixed(0)} puntos. Cada código perdido se `
        + 'publicaría como «sin DHD», que en la ficha se lee como que la fuente no la trae.',
      );
    }
  }

  // ── 4. integridad del árbol ──────────────────────────────────────────────
  let huerfanos = 0;
  for (const [k, v] of Object.entries(nodos)) {
    if (v.niv === 1) continue;
    if (!v.p) { huerfanos++; continue; }
    if (!nodos[v.p]) errores.push(`${k}: su padre ${v.p} no está en el árbol.`);
    else if (nodos[v.p].niv !== v.niv - 1) errores.push(`${k}: su padre ${v.p} es de nivel ${nodos[v.p].niv}, no ${v.niv - 1}.`);
  }
  if (huerfanos > codigos.length * 0.05) {
    errores.push(`${huerfanos} nodos sin padre (más del 5 %). El árbol está desconectado.`);
  } else if (huerfanos) {
    avisos.push(`${huerfanos} nodos sin padre en el árbol; el Ministerio publica algún código cuyo nivel superior no aparece.`);
  }
  // Un hijo declarado que no existe rompería el render del panel de navegación.
  for (const k of conHijos) {
    const rotos = nodos[k].h.filter((c) => !nodos[c]);
    if (rotos.length) errores.push(`${k}: declara hijos inexistentes (${rotos.slice(0, 3).join(', ')}).`);
  }

  // ── 5. coherencia padre / hijos ──────────────────────────────────────────
  let descuadrados = 0;
  for (const k of conHijos) {
    const v = nodos[k];
    if (v.den !== 'completo' || typeof v.dhd !== 'number' || v.dhd <= 0) continue;
    const suma = v.h.reduce((s, c) => s + (nodos[c]?.dhd ?? 0), 0);
    if (Math.abs(suma - v.dhd) / v.dhd > UMBRALES.DESCUADRE_GRUPO) {
      descuadrados++;
      errores.push(`${k}: marcado «completo» pero la suma de hijos (${suma.toFixed(2)}) no cuadra con su DHD (${v.dhd}).`);
    }
  }

  // ── 6. estructura ATC ────────────────────────────────────────────────────
  const malFormados = codigos.filter((k) => !RE_POR_NIVEL[nodos[k].niv]?.test(k));
  if (malFormados.length) errores.push(`Códigos que no encajan con su nivel: ${malFormados.slice(0, 5).join(', ')}`);

  // ── 7. deriva respecto a la versión anterior ─────────────────────────────
  const previosNodos = previo?.nodos ?? null;
  if (previosNodos) {
    const antes = Object.keys(previosNodos);
    const perdidos = antes.filter((k) => !nodos[k]);
    if (antes.length && perdidos.length / antes.length > UMBRALES.CAIDA_CODIGOS) {
      errores.push(`Desaparecen ${perdidos.length} de ${antes.length} códigos (${(perdidos.length / antes.length * 100).toFixed(1)} %). Ej.: ${perdidos.slice(0, 5).join(', ')}`);
    }
    if (previo.meta?.periodo > doc.meta.periodo) {
      errores.push(`El periodo retrocede: ${previo.meta.periodo} → ${doc.meta.periodo}.`);
    }
    // La variación fuerte es un AVISO: puede ser un cambio real de DDD o de práctica, y bloquear
    // por ello congelaría el dato justo cuando más interesa mirarlo.
    if (previo.meta?.periodo === doc.meta.periodo) {
      const saltos = [];
      for (const [k, v] of Object.entries(nodos)) {
        const p = previosNodos[k];
        if (typeof v.dhd !== 'number' || typeof p?.dhd !== 'number' || p.dhd < 0.5) continue;
        if (Math.abs(v.dhd - p.dhd) / p.dhd > UMBRALES.VARIACION_ATC5) saltos.push(`${k} ${p.dhd}→${v.dhd}`);
      }
      if (saltos.length) avisos.push(`Mismo periodo republicado con ${saltos.length} cambios grandes: ${saltos.slice(0, 5).join(', ')}`);
    }
  }

  // ── 8. observaciones que no bloquean pero deben verse ────────────────────
  const sinDhd = hojas.filter((k) => nodos[k].dhd === null);
  const sinDhdConEnv = sinDhd.filter((k) => (nodos[k].env ?? 0) > 0);
  if (sinDhdConEnv.length) {
    avisos.push(`${sinDhdConEnv.length} códigos ATC5 tienen envases y no tienen DDD asignada por la OMS: quedan fuera de toda DHD.`);
  }
  const parciales = conHijos.filter((k) => nodos[k].den === 'parcial').length;
  const nulos = conHijos.filter((k) => nodos[k].den === 'nulo').length;
  if (parciales) avisos.push(`${parciales} nodos con denominador parcial: su reparto se presenta como «% de la DHD publicada».`);
  const ceros = codigos.filter((k) => nodos[k].z === 1).length;
  if (ceros) avisos.push(`${ceros} códigos con DHD redondeada a 0,00: se muestran como «<0,01», nunca como «0».`);
  const noCanonicos = doc.meta?.procedencia?.ficheros_no_canonicos ?? [];
  if (noCanonicos.length) avisos.push(`Ficheros con nombre no canónico en origen: ${noCanonicos.join(', ')}`);

  const nv = doc.meta?.n_por_nivel ?? {};
  const lineas = [
    '── validación del árbol de utilización ──',
    `periodo             ${doc.meta?.periodo}`,
    `nodos               ${codigos.length}   (ATC1 ${nv[1] ?? '?'} · ATC2 ${nv[2] ?? '?'} · ATC3 ${nv[3] ?? '?'} · ATC4 ${nv[4] ?? '?'} · ATC5 ${nv[5] ?? '?'})`,
    `sin DDD (ATC5)      ${sinDhd.length}   (de ellos con envases: ${sinDhdConEnv.length})`,
    `nodos con hijos     ${conHijos.length}   (completo: ${conHijos.filter((k) => nodos[k].den === 'completo').length}, parcial: ${parciales}, nulo: ${nulos})`,
    `descuadres          ${descuadrados}`,
    '',
    errores.length ? `ERRORES (${errores.length}) — bloquean la publicación:` : 'ERRORES: ninguno',
    ...errores.map((e) => `  ✗ ${e}`),
    '',
    avisos.length ? `AVISOS (${avisos.length}) — no bloquean:` : 'AVISOS: ninguno',
    ...avisos.map((a) => `  · ${a}`),
  ];

  return { bloquea: errores.length > 0, errores, avisos, texto: lineas.join('\n') };
}
