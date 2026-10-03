/**
 * MedCheck — guarda de cobertura del censo de CIMA (ETL del índice de financiación)
 *
 * POR QUÉ EXISTE ESTE FICHERO. El 2026-10-03 el ETL abortó con «42028 presentaciones (mínimo
 * 55000)» y dejó el índice sellado con la generación de septiembre mientras el catálogo del
 * Worker avanzaba a la de octubre: el cliente vio dos generaciones distintas y apagó la faceta
 * de financiación. No había desplome. AEMPS había limpiado su censo: medido ese día sobre los dos
 * censos completos (el del 10/09 y el del 03/10, 336 y 211 páginas), de los 25.386 nregistros
 * presentes en ambos las presentaciones comercializadas pasaron de 20.569 a 20.577 —ocho MÁS—.
 * Lo que desapareció fueron 18.157 filas con `comerc: false` y 1.335 registros enteros que CIMA
 * ya no sirve (comprobado uno a uno contra /medicamento?nregistro=: respuesta vacía), que
 * aportaban 6.986 presentaciones comercializadas. El campo `comerc` venía en las dos pasadas en
 * todas las filas: no hubo cambio de contrato, hubo retirada de registros.
 *
 * LA GUARDA VIGILABA LA CIFRA EQUIVOCADA. `MIN_PRESENTACIONES = 55000` contaba las filas CRUDAS
 * del crawl, de las que dos tercios son presentaciones no comercializadas que el índice descarta
 * tres líneas después: medía cuánta morralla publica CIMA ese mes, no la cobertura de nada. Y era
 * un absoluto calibrado con UNA sola observación, la del 2026-09-09, porque el índice tenía tres
 * semanas de vida.
 *
 * QUÉ VIGILA AHORA, y la idea que lo sostiene: la atrición es normal y la amputación no. Que un
 * registro revocado desaparezca del censo es el curso ordinario de un catálogo de medicamentos;
 * que a un medicamento VIVO se le caigan las presentaciones comercializadas es un cambio de
 * contrato de la fuente o un crawl a medias. Por eso la comparación se hace sobre la
 * INTERSECCIÓN con el índice ya publicado, no sobre los totales: los totales mezclan las dos
 * cosas y hacen que una limpieza del catálogo parezca un desplome.
 *
 * Y TIENE PUERTA DE SALIDA, que es lo que la distingue de un bloqueo permanente. Si la caída es
 * real, `--aceptar-censo "<motivo>"` deja constancia en `_meta.censo_aceptado` y sigue. Una
 * guarda que solo puede ceder editando su propio código acaba apagando la función que protege,
 * que es exactamente lo que pasó en octubre.
 */

/** Respaldos ABSOLUTOS. No miden deriva, solo catástrofe: sirven cuando no hay índice publicado
 *  del que anclar (primera pasada) o cuando se desploma todo a la vez. Van holgados a propósito:
 *  el que detecta la deriva fina es el ancla relativa, no estos. */
export const MIN_NREGISTROS = 20000;
export const MIN_COMERCIALIZADAS = 15000;

/** Caída máxima tolerada de presentaciones comercializadas EN LOS NREGISTROS COMUNES. Un 10 %
 *  sobre ~20.500 son ~2.000 presentaciones: ninguna reorganización del catálogo mueve eso en un
 *  mes, y un crawl truncado o un cambio de criterio de `comerc` lo cruzan de sobra. */
export const CAIDA_MAX_EN_COMUNES = 0.10;

/** Pérdida de registros que se REPORTA sin bloquear. Es atrición esperable; se dice para que
 *  quede en el log del run y se pueda mirar si un mes se desmadra. */
export const PERDIDA_REGISTROS_AVISO = 0.10;

/**
 * Resume el censo crawleado con el MISMO criterio que usa el índice (`comerc !== false`), para
 * que la guarda y el dato publicado no cuenten cosas distintas.
 */
export function resumirCenso(pres) {
    const porNregistro = new Map();
    let filas = 0;
    for (const p of pres) {
        filas += 1;
        if (!p?.nregistro || !p?.cn) continue;
        const n = String(p.nregistro);
        if (!porNregistro.has(n)) porNregistro.set(n, 0);
        if (p.comerc !== false) porNregistro.set(n, porNregistro.get(n) + 1);
    }
    let comercializadas = 0;
    for (const c of porNregistro.values()) comercializadas += c;
    return { filas, nregistros: porNregistro.size, comercializadas, porNregistro };
}

/**
 * Ancla del índice ya publicado: `nregistro -> presentaciones comercializadas` (posición 0 de
 * cada entrada). Devuelve null si no hay índice del que anclar, que es un estado legítimo —la
 * primera pasada— y no un fallo.
 */
export function anclaDeIndice(publicado) {
    const fin = publicado && typeof publicado.fin === 'object' ? publicado.fin : null;
    if (!fin) return null;
    const m = new Map();
    for (const [nreg, fila] of Object.entries(fin)) {
        if (Array.isArray(fila) && Number.isFinite(fila[0])) m.set(String(nreg), fila[0]);
    }
    return m.size ? m : null;
}

/**
 * Veredicto de la guarda. Función PURA: no lee ficheros ni red, para que el banco pueda
 * ejercitarla con censos sintéticos. Devuelve `{ abortar, motivo, lineas, comparacion }`.
 */
export function veredictoCenso({ censo, ancla = null, motivoAceptado = null }) {
    const lineas = [];
    const comparacion = {
        filas: censo.filas,
        nregistros: censo.nregistros,
        comercializadas: censo.comercializadas,
    };

    if (ancla) {
        let comunes = 0;
        let antes = 0;
        let ahora = 0;
        for (const [nreg, col0] of ancla) {
            if (!censo.porNregistro.has(nreg)) continue;
            comunes += 1;
            antes += col0;
            ahora += censo.porNregistro.get(nreg);
        }
        const desaparecidos = ancla.size - comunes;
        const nuevos = censo.nregistros - comunes;
        const caida = antes > 0 ? (antes - ahora) / antes : 0;
        Object.assign(comparacion, {
            nregistros_comunes: comunes,
            nregistros_desaparecidos: desaparecidos,
            nregistros_nuevos: nuevos,
            comercializadas_en_comunes_antes: antes,
            comercializadas_en_comunes_ahora: ahora,
            caida_en_comunes: Number(caida.toFixed(4)),
        });
        lineas.push(`censo: ${censo.filas} filas · ${censo.nregistros} nregistros · `
            + `${censo.comercializadas} comercializadas`);
        lineas.push(`ancla: ${comunes} comunes · comercializadas ${antes} -> ${ahora} `
            + `(${(caida * 100).toFixed(2)} % de caída) · ${desaparecidos} registros que CIMA ya `
            + `no sirve · ${nuevos} nuevos`);
        // La pérdida de registros se DICE y no bloquea: un registro revocado que desaparece del
        // censo no es un medicamento que la app pierda, es uno que CIMA ya no responde.
        if (desaparecidos / ancla.size > PERDIDA_REGISTROS_AVISO) {
            lineas.push(`AVISO: desaparece el ${(desaparecidos / ancla.size * 100).toFixed(1)} % `
                + `de los registros del índice publicado. No bloquea (atrición del catálogo), `
                + `pero mírelo si se repite.`);
        }
        if (caida > CAIDA_MAX_EN_COMUNES) {
            const motivo = `cobertura amputada: en los ${comunes} medicamentos que siguen en CIMA, `
                + `las presentaciones comercializadas caen de ${antes} a ${ahora} `
                + `(${(caida * 100).toFixed(2)} %, máximo `
                + `${(CAIDA_MAX_EN_COMUNES * 100).toFixed(0)} %)`;
            if (motivoAceptado) {
                lineas.push(`CAÍDA ACEPTADA a mano: ${motivoAceptado}`);
                comparacion.censo_aceptado = {
                    motivo: motivoAceptado,
                    caida_en_comunes: comparacion.caida_en_comunes,
                };
            } else {
                return {
                    abortar: true,
                    motivo: `${motivo}. Si el recorte es real, repita con `
                        + `--aceptar-censo "<motivo>" y quedará escrito en _meta.censo_aceptado`,
                    lineas,
                    comparacion,
                };
            }
        }
    } else {
        lineas.push(`censo: ${censo.filas} filas · ${censo.nregistros} nregistros · `
            + `${censo.comercializadas} comercializadas · SIN índice publicado del que anclar: `
            + `solo valen los respaldos absolutos`);
    }

    // Los absolutos van al final: con ancla o sin ella, un desplome global no pasa.
    if (censo.nregistros < MIN_NREGISTROS) {
        return {
            abortar: true,
            motivo: `censo anómalo: ${censo.nregistros} nregistros `
                + `(mínimo absoluto ${MIN_NREGISTROS})`,
            lineas,
            comparacion,
        };
    }
    if (censo.comercializadas < MIN_COMERCIALIZADAS) {
        return {
            abortar: true,
            motivo: `censo anómalo: ${censo.comercializadas} presentaciones comercializadas `
                + `(mínimo absoluto ${MIN_COMERCIALIZADAS})`,
            lineas,
            comparacion,
        };
    }

    return { abortar: false, motivo: null, lineas, comparacion };
}
