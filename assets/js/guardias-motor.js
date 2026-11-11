/*
 * Motor de reparto del gestor de guardias (guardias.html).
 *
 * Sin DOM: recibe la configuración y devuelve el calendario. Lo usan
 * guardias-app.js en el navegador y scripts/guardias-test-motor.mjs en Node.
 *
 * REGLAS DE NEGOCIO (cualquier cambio aquí debe pasar el banco de pruebas, que
 * incluye una línea base generada con el motor anterior a la v2.1):
 *  - Cada día laborable tiene 4 puestos, en este orden: avisos de mañana,
 *    urgencias de mañana, avisos de tarde y urgencias de tarde.
 *  - Un médico no ocupa dos puestos el mismo día.
 *  - Candidatos: activos, disponibles (sin ausencia, día excluido ni exclusión
 *    puntual) y en la franja que les toca ese día.
 *  - Franja de un médico en un día (franjaDelDia), por este orden:
 *      1. un cambio de turno registrado para esa fecha (cambiosTurno), que vale
 *         para cualquier médico, no solo para los MIXTO;
 *      2. su turno fijo (MAÑANA o TARDE) o, si es MIXTO, su planificación
 *         semanal o, sin ella, L/X/V tarde y M/J mañana.
 *    La disponibilidad va antes que todo esto: un cambio de turno no devuelve
 *    al médico un día de ausencia, día excluido o exclusión puntual.
 *  - Objetivo de cada médico: los puestos del mes repartidos en proporción a sus
 *    puestos disponibles por su % de jornada. Las exclusiones puntuales no lo
 *    reducen. Cada día disponible cuenta 2 puestos sea cual sea la franja, así
 *    que un cambio de turno mueve al médico de franja sin cambiar su objetivo.
 *  - Compensación: objetivo − saldo × factor, con un ajuste máximo del 30 % del
 *    objetivo base y renormalizado para que el total no cambie.
 *  - Reparto (v2.3, ver «Asignación»): óptimo exacto, en este orden de
 *    prioridad: cubrir el máximo de puestos; romper lo menos posible el tope de
 *    2 guardias por semana ISO (también entre meses, si se conoce el anterior);
 *    mínima suma de (asignadas − objetivo)²; una por semana antes que dos.
 *    Después, sin cambiar cuántas hace cada uno: reparto de lunes y viernes,
 *    evitar días seguidos y equilibrar avisos/urgencias alternando el tipo.
 *    Con aleatoriedad, la semilla solo elige entre soluciones igual de buenas.
 *  - Todos los números (resumen, totales, incidencias) salen de
 *    evaluarCalendario, que sirve igual para un calendario generado que para uno
 *    editado a mano.
 *
 * HASTA LA v2.2 el reparto era voraz, día a día con una puntuación por
 * candidato; podía dejar a alguien a más de 2 guardias de su objetivo cuando
 * había reparto mejor (scripts/baselines/guardias-motor-v22.cjs lo conserva
 * para comprobar que el óptimo nunca es peor).
 *
 * CAMBIOS DELIBERADOS RESPECTO AL MOTOR ANTERIOR (v2.1):
 *  - Factor de compensación 0 % ahora significa sin compensación (antes se
 *    convertía en 50 %).
 *  - El saldo de un mes suma solo los meses guardados ANTERIORES a él dentro de
 *    la ventana (antes, todos los guardados: incluía el propio mes al
 *    regenerarlo y la ventana se medía desde la fecha de hoy, con un mes de más).
 *  - El histórico ya no se borra al salir de la ventana: solo deja de contar.
 *  - Las fechas se calculan en UTC, sin depender de la zona horaria del equipo.
 *
 * AÑADIDO EN LA v2.2: cambios de turno en fechas concretas.
 * AÑADIDO EN LA v2.3: reparto óptimo, calendarios guardados y editables
 * (evaluarCalendario, puestos fijados y sugerirReajustes) y tope semanal entre
 * meses (semanasPrevias). Los objetivos no cambian respecto a la v2.2.
 */
((raiz, fabrica) => {
  const motor = fabrica();
  if (typeof module === "object" && module.exports) module.exports = motor;
  else raiz.GuardiasMotor = motor;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const TURNOS = ["MAÑANA", "TARDE", "MIXTO"];
  const FRANJAS = ["MAÑANA", "TARDE"];
  const MAXIMO_DIAS_RANGO = 366;
  const CLAVES_DIA = ["L", "M", "X", "J", "V"];
  const NOMBRES_DIA = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
  const PUESTOS = [
    { clave: "avisos_manana", franja: "MAÑANA", tipo: "AVISOS" },
    { clave: "urgencias_manana", franja: "MAÑANA", tipo: "URGENCIAS" },
    { clave: "avisos_tarde", franja: "TARDE", tipo: "AVISOS" },
    { clave: "urgencias_tarde", franja: "TARDE", tipo: "URGENCIAS" },
  ];
  const SIN_ASIGNAR = "---";
  const AJUSTE_MAXIMO = 0.3;
  const FACTOR_POR_DEFECTO = 0.5;
  const VENTANA_POR_DEFECTO = 6;
  const UMBRAL_DESVIACION = 1.5;

  // --- Fechas (todas a medianoche UTC) ----------------------------------------

  const fechaUTC = (anio, mes, dia) => new Date(Date.UTC(anio, mes - 1, dia));
  const aISO = (fecha) => fecha.toISOString().slice(0, 10);
  const diasDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const claveMes = (anio, mes) => `${anio}-${String(mes).padStart(2, "0")}`;

  const desplazarMes = (anio, mes, delta) => {
    const total = anio * 12 + (mes - 1) + delta;
    return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
  };

  /** «AAAA-MM-DD» a fecha UTC, o null si no es una fecha real (rechaza el 31/02). */
  const desdeISO = (texto) => {
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || ""));
    if (!partes) return null;
    const fecha = fechaUTC(Number(partes[1]), Number(partes[2]), Number(partes[3]));
    return aISO(fecha) === partes[0] ? fecha : null;
  };

  /**
   * Fechas ISO de `desde` a `hasta`, ambas incluidas. Sin `hasta`, solo `desde`.
   * null si alguna no es válida, si están al revés o si pasan de un año.
   */
  const fechasEntre = (desde, hasta) => {
    const inicio = desdeISO(desde);
    const fin = hasta ? desdeISO(hasta) : inicio;
    if (!inicio || !fin || fin < inicio) return null;
    const dias = Math.round((fin - inicio) / 86400000) + 1;
    if (dias > MAXIMO_DIAS_RANGO) return null;
    return Array.from({ length: dias }, (_, i) => aISO(new Date(inicio.getTime() + i * 86400000)));
  };

  const semanaISO = (fecha) => {
    const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - inicio) / 86400000 + 1) / 7);
  };

  // --- Estado ---------------------------------------------------------------------

  const lista = (valor) => (Array.isArray(valor) ? valor : []);
  const objeto = (valor) => (valor && typeof valor === "object" && !Array.isArray(valor) ? valor : {});
  // null, "" y undefined no son números (Number(null) sería 0 y anularía la compensación).
  const numero = (valor) => (valor === null || valor === undefined || valor === "" ? NaN : Number(valor));

  /**
   * Completa con valores por defecto lo que falte (datos de la v1, ficheros
   * antiguos o parciales) sin tocar los elementos: los nombres son la clave que
   * une médicos, restricciones e histórico.
   */
  const normalizarEstado = (datos) => {
    const entrada = objeto(datos);
    const historico = objeto(entrada.historico);
    const algoritmo = objeto(entrada.configuracionAlgoritmo);
    const factor = numero(historico.factorCompensacion);
    const ventana = numero(historico.ventanaHistorico);
    const semilla = numero(algoritmo.semilla);
    return {
      version: 2,
      medicos: lista(entrada.medicos),
      reducciones: lista(entrada.reducciones),
      festivos: lista(entrada.festivos),
      ausencias: lista(entrada.ausencias),
      exclusionesPuntuales: lista(entrada.exclusionesPuntuales),
      planificacionesTurnos: lista(entrada.planificacionesTurnos),
      cambiosTurno: lista(entrada.cambiosTurno),
      historico: {
        meses: objeto(historico.meses),
        saldoAcumulado: objeto(historico.saldoAcumulado),
        factorCompensacion: Number.isFinite(factor) && factor >= 0 && factor <= 1 ? factor : FACTOR_POR_DEFECTO,
        ventanaHistorico: Number.isFinite(ventana) && ventana >= 1 ? Math.round(ventana) : VENTANA_POR_DEFECTO,
      },
      configuracionAlgoritmo: {
        usarAleatoriedad: Boolean(algoritmo.usarAleatoriedad),
        semilla: Number.isFinite(semilla) ? semilla : null,
        rotacionInicial: algoritmo.rotacionInicial || 0,
      },
      calendarios: normalizarCalendarios(entrada.calendarios),
      ultimaCopia: typeof entrada.ultimaCopia === "string" ? entrada.ultimaCopia : null,
      ultimoCambio: typeof entrada.ultimoCambio === "string" ? entrada.ultimoCambio : null,
    };
  };

  /**
   * Calendarios guardados por mes («AAAA-MM»): el que se ve y edita (`dias`), el
   * último generado (`generados`) y los puestos cambiados a mano (`manuales`,
   * «fecha|puesto»). Lo que no tenga esa forma se descarta.
   */
  const normalizarCalendarios = (valor) => {
    const salida = {};
    Object.entries(objeto(valor)).forEach(([clave, cal]) => {
      if (!/^\d{4}-\d{2}$/.test(clave) || !cal || !Array.isArray(cal.dias)) return;
      const limpiar = (dias) =>
        lista(dias)
          .filter((d) => d && desdeISO(d.fecha) && d.fecha.startsWith(`${clave}-`))
          .map((d) => Object.fromEntries([["fecha", d.fecha], ...PUESTOS.map((p) => [p.clave, typeof d[p.clave] === "string" && d[p.clave] ? d[p.clave] : SIN_ASIGNAR])]));
      salida[clave] = {
        dias: limpiar(cal.dias),
        generados: limpiar(Array.isArray(cal.generados) ? cal.generados : cal.dias),
        manuales: lista(cal.manuales).filter((m) => typeof m === "string"),
        generadoEl: typeof cal.generadoEl === "string" ? cal.generadoEl : null,
        editadoEl: typeof cal.editadoEl === "string" ? cal.editadoEl : null,
        firma: typeof cal.firma === "string" ? cal.firma : null,
      };
    });
    return salida;
  };

  /** Qué trae un fichero importado: configuración, histórico o ambos. */
  const detectarFichero = (datos) => {
    const entrada = objeto(datos);
    return {
      configuracion: Array.isArray(entrada.medicos),
      historico: Boolean(entrada.historico && typeof entrada.historico.meses === "object" && entrada.historico.meses),
    };
  };

  // --- Disponibilidad ------------------------------------------------------------

  const primeraPorMedico = (elementos) => {
    const mapa = new Map();
    elementos.forEach((e) => {
      if (e && !mapa.has(e.medico)) mapa.set(e.medico, e);
    });
    return mapa;
  };

  const crearContexto = (cfg) => ({
    festivos: new Set(cfg.festivos),
    reducciones: primeraPorMedico(cfg.reducciones),
    planes: primeraPorMedico(cfg.planificacionesTurnos),
    ausencias: cfg.ausencias.map((a) => ({
      medico: a.medico,
      inicio: Date.parse(a.inicio),
      fin: Date.parse(a.fin),
    })),
    exclusiones: new Set(cfg.exclusionesPuntuales.map((e) => `${e.medico}|${e.fecha}`)),
    cambios: indexarCambios(cfg.cambiosTurno),
    mixtosSinPlan: new Set(),
  });

  /**
   * Índice «médico|fecha» → franja. Se ignora lo que no sea una franja válida
   * en una fecha válida; si hay dos para el mismo día, vale el último, igual
   * que cuando se registra uno nuevo encima de otro.
   */
  const indexarCambios = (cambios) => {
    const indice = new Map();
    cambios.forEach((c) => {
      if (c && FRANJAS.includes(c.turno) && desdeISO(c.fecha)) indice.set(`${c.medico}|${c.fecha}`, c.turno);
    });
    return indice;
  };

  const esLaborable = (ctx, fecha) => {
    const dia = fecha.getUTCDay();
    if (dia === 0 || dia === 6) return false;
    return !ctx.festivos.has(aISO(fecha));
  };

  const estaAusente = (ctx, nombre, fecha) => {
    const t = fecha.getTime();
    return ctx.ausencias.some((a) => a.medico === nombre && a.inicio <= t && t <= a.fin);
  };

  const tieneDiaExcluido = (ctx, nombre, fecha) => {
    const reduccion = ctx.reducciones.get(nombre);
    if (!reduccion || !reduccion.diasExcluidos) return false;
    const dias = String(reduccion.diasExcluidos)
      .split(",")
      .map((d) => d.trim());
    const nombreDia = NOMBRES_DIA[fecha.getUTCDay()];
    if (nombreDia === "MIERCOLES") return dias.includes("MIERCOLES") || dias.includes("MIÉRCOLES");
    return dias.includes(nombreDia);
  };

  const tieneExclusionPuntual = (ctx, nombre, fecha) => ctx.exclusiones.has(`${nombre}|${aISO(fecha)}`);

  const puedeTrabajar = (ctx, nombre, fecha) =>
    !estaAusente(ctx, nombre, fecha) && !tieneDiaExcluido(ctx, nombre, fecha) && !tieneExclusionPuntual(ctx, nombre, fecha);

  // Para el objetivo no cuentan las exclusiones puntuales: esa guardia se recupera otro día.
  const puedeTrabajarParaObjetivo = (ctx, nombre, fecha) =>
    !estaAusente(ctx, nombre, fecha) && !tieneDiaExcluido(ctx, nombre, fecha);

  const turnoMixto = (ctx, nombre, fecha) => {
    const dia = fecha.getUTCDay();
    const plan = ctx.planes.get(nombre);
    if (plan && dia >= 1 && dia <= 5) return plan[CLAVES_DIA[dia - 1]] || "MAÑANA";
    ctx.mixtosSinPlan.add(nombre);
    if (dia === 1 || dia === 3 || dia === 5) return "TARDE";
    return "MAÑANA";
  };

  /** Franja que le toca sin cambios puntuales: su turno fijo o, si es MIXTO, su plan. */
  const franjaHabitual = (ctx, medico, fecha) => (medico.turno === "MIXTO" ? turnoMixto(ctx, medico.nombre, fecha) : medico.turno);

  /** Franja que le toca ese día: el cambio puntual, si lo hay, manda sobre la habitual. */
  const franjaDelDia = (ctx, medico, fecha) => ctx.cambios.get(`${medico.nombre}|${aISO(fecha)}`) ?? franjaHabitual(ctx, medico, fecha);

  const cubreFranja = (ctx, medico, fecha, franja) => franjaDelDia(ctx, medico, fecha) === franja;

  // --- Cambios de turno en fechas concretas ---------------------------------------------

  /**
   * Qué hace un cambio de turno con la configuración actual. `cambia` es true
   * solo si ese día mueve de verdad al médico de franja; si no, `motivo` dice
   * por qué: fecha-invalida, turno-invalido, medico-desconocido, no-laborable,
   * inactivo, ausencia, dia-excluido, exclusion-puntual o ya-es-su-franja.
   * Usa un contexto propio: no deja rastro en el aviso de MIXTO sin plan.
   */
  const efectoDeCambio = (cfg, ctx, cambio) => {
    const fecha = desdeISO(cambio.fecha);
    if (!fecha) return { cambia: false, motivo: "fecha-invalida" };
    if (!FRANJAS.includes(cambio.turno)) return { cambia: false, motivo: "turno-invalido" };
    const medico = cfg.medicos.find((m) => m.nombre === cambio.medico);
    if (!medico) return { cambia: false, motivo: "medico-desconocido" };
    if (!esLaborable(ctx, fecha)) return { cambia: false, motivo: "no-laborable" };
    if (!medico.activo) return { cambia: false, motivo: "inactivo" };
    if (estaAusente(ctx, medico.nombre, fecha)) return { cambia: false, motivo: "ausencia" };
    if (tieneDiaExcluido(ctx, medico.nombre, fecha)) return { cambia: false, motivo: "dia-excluido" };
    if (tieneExclusionPuntual(ctx, medico.nombre, fecha)) return { cambia: false, motivo: "exclusion-puntual" };
    const habitual = franjaHabitual(ctx, medico, fecha);
    if (habitual === cambio.turno) return { cambia: false, motivo: "ya-es-su-franja", habitual };
    return { cambia: true, motivo: null, habitual };
  };

  /** Efecto de cada cambio (los registrados o los que se van a registrar). */
  const analizarCambiosTurno = (cfg, cambios = cfg.cambiosTurno) => {
    const ctx = crearContexto(cfg);
    return cambios.map((c) => ({ medico: c.medico, fecha: c.fecha, turno: c.turno, ...efectoDeCambio(cfg, ctx, c) }));
  };

  // Dos fechas son del mismo tramo si entre ellas solo hay fines de semana o festivos.
  const seguidas = (ctx, anterior, siguiente) => {
    const entre = fechasEntre(anterior, siguiente);
    return Boolean(entre && entre.length >= 2 && entre.slice(1, -1).every((iso) => !esLaborable(ctx, desdeISO(iso))));
  };

  /**
   * Agrupa los cambios en tramos para enseñarlos: mismo médico, misma franja y
   * días laborables seguidos. «Del 3 al 14 de tarde» es un tramo, no diez filas.
   */
  const agruparCambiosTurno = (cfg, cambios = cfg.cambiosTurno) => {
    const ctx = crearContexto(cfg);
    const ordenados = cambios
      .filter((c) => c && typeof c.fecha === "string")
      .sort((a, b) => String(a.medico).localeCompare(String(b.medico)) || a.fecha.localeCompare(b.fecha));
    const tramos = [];
    let actual = null;
    ordenados.forEach((c) => {
      if (actual && actual.medico === c.medico && actual.turno === c.turno && seguidas(ctx, actual.hasta, c.fecha)) {
        actual.hasta = c.fecha;
        actual.fechas.push(c.fecha);
        return;
      }
      actual = { medico: c.medico, turno: c.turno, desde: c.fecha, hasta: c.fecha, fechas: [c.fecha] };
      tramos.push(actual);
    });
    return tramos.sort((a, b) => a.desde.localeCompare(b.desde) || String(a.medico).localeCompare(String(b.medico), "es"));
  };

  // Los cambios que valen de verdad (uno por médico y día) en un mes.
  const cambiosEfectivosDelMes = (ctx, clave) =>
    Array.from(ctx.cambios, ([llave, turno]) => {
      const corte = llave.lastIndexOf("|");
      return { medico: llave.slice(0, corte), fecha: llave.slice(corte + 1), turno };
    })
      .filter((c) => c.fecha.startsWith(`${clave}-`))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.medico).localeCompare(String(b.medico)));

  // --- Histórico y compensación ----------------------------------------------------

  /** Meses guardados que cuentan para el mes indicado: los `ventana` anteriores a él. */
  const mesesQueCuentan = (historico, anio, mes) => {
    const ventana = historico.ventanaHistorico || VENTANA_POR_DEFECTO;
    const desde = desplazarMes(anio, mes, -ventana);
    const hasta = desplazarMes(anio, mes, -1);
    const claveDesde = claveMes(desde.anio, desde.mes);
    const claveHasta = claveMes(hasta.anio, hasta.mes);
    return Object.keys(historico.meses)
      .filter((clave) => clave >= claveDesde && clave <= claveHasta)
      .sort();
  };

  const saldosParaMes = (historico, anio, mes) => {
    const saldos = {};
    mesesQueCuentan(historico, anio, mes).forEach((clave) => {
      const datosMes = objeto(historico.meses[clave]);
      Object.keys(datosMes).forEach((medico) => {
        saldos[medico] = (saldos[medico] || 0) + (Number(datosMes[medico]?.diferencia) || 0);
      });
    });
    return saldos;
  };

  /** Mes siguiente al último guardado (o null si no hay histórico). */
  const mesSiguienteAlHistorico = (historico) => {
    const claves = Object.keys(historico.meses).sort();
    if (claves.length === 0) return null;
    const [anio, mes] = claves[claves.length - 1].split("-").map(Number);
    return desplazarMes(anio, mes, 1);
  };

  /** Saldo que se aplicaría al mes siguiente al último guardado. Se guarda por compatibilidad con la v1. */
  const saldoVigente = (historico) => {
    const siguiente = mesSiguienteAlHistorico(historico);
    return siguiente ? saldosParaMes(historico, siguiente.anio, siguiente.mes) : {};
  };

  const calcularObjetivos = (cfg, ctx, anio, mes, saldos, factor) => {
    const activos = cfg.medicos.filter((m) => m.activo);
    const laborables = [];
    for (let dia = 1; dia <= diasDelMes(anio, mes); dia++) {
      const fecha = fechaUTC(anio, mes, dia);
      if (esLaborable(ctx, fecha)) laborables.push(fecha);
    }
    const totalPuestos = laborables.length * PUESTOS.length;

    const disponibilidad = {};
    const diasDisponibles = {};
    const jornadas = {};
    let totalDisponibilidad = 0;
    activos.forEach((medico) => {
      let huecos = 0;
      laborables.forEach((fecha) => {
        if (!puedeTrabajarParaObjetivo(ctx, medico.nombre, fecha)) return;
        if (FRANJAS.includes(franjaDelDia(ctx, medico, fecha))) huecos += 2;
      });
      const reduccion = ctx.reducciones.get(medico.nombre);
      const jornada = reduccion ? reduccion.porcentaje / 100 : 1;
      diasDisponibles[medico.nombre] = huecos / 2;
      jornadas[medico.nombre] = Math.round(jornada * 100);
      disponibilidad[medico.nombre] = huecos * jornada;
      totalDisponibilidad += disponibilidad[medico.nombre];
    });

    const base = {};
    if (totalDisponibilidad > 0) {
      activos.forEach((medico) => {
        base[medico.nombre] = (disponibilidad[medico.nombre] / totalDisponibilidad) * totalPuestos;
      });
    }

    const ajustados = {};
    activos.forEach((medico) => {
      const nombre = medico.nombre;
      const objetivoBase = base[nombre] || 0;
      const ajuste = -(saldos[nombre] || 0) * factor;
      const maximo = objetivoBase * AJUSTE_MAXIMO;
      ajustados[nombre] = Math.max(0, objetivoBase + Math.max(-maximo, Math.min(maximo, ajuste)));
    });

    const totalBase = Object.values(base).reduce((a, b) => a + b, 0);
    const totalAjustado = Object.values(ajustados).reduce((a, b) => a + b, 0);
    if (totalAjustado > 0) {
      const escala = totalBase / totalAjustado;
      Object.keys(ajustados).forEach((nombre) => {
        ajustados[nombre] = parseFloat((ajustados[nombre] * escala).toFixed(2));
      });
    }
    return { objetivos: ajustados, totalPuestos, diasDisponibles, jornadas, base };
  };

  // --- Asignación (v2.3: reparto óptimo) ---------------------------------------------
  //
  // El reparto se hace en tres pasos. Solo el primero decide CUÁNTAS guardias
  // hace cada médico; los otros dos solo reordenan sin cambiar esa cuenta.
  //  1. Quién cubre cada franja de cada día: flujo de coste mínimo, que da la
  //     solución exacta (no una aproximación) a este orden de prioridades:
  //       a) cubrir el máximo de puestos;
  //       b) romper el tope semanal las menos veces posibles;
  //       c) acercar a cada médico a su objetivo: mínima suma de
  //          (asignadas − objetivo)², que reparte el error en vez de cargarlo
  //          en uno;
  //       d) preferir una guardia por semana antes que dos.
  //  2. Mejora por intercambios entre dos médicos de la misma franja en días
  //     distintos, que no cambian las cuentas: reparte lunes y viernes y evita
  //     guardias en días seguidos.
  //  3. Dentro de cada franja, quién hace avisos y quién urgencias: equilibra
  //     avisos/urgencias de cada médico y alterna el tipo.

  const TOPE_SEMANAL = 2;
  // Escalas de coste: cada prioridad pesa más que todas las siguientes juntas.
  const PESO_COBERTURA = 1e13;
  const PESO_TOPE = 1e10;
  const PESO_EQUIDAD = 1e4;
  const PESO_SEGUNDA_SEMANAL = 100;
  const PESO_DIAS_SEGUIDOS = 60;
  const PESO_LUNES_VIERNES = 30;

  /** Semana ISO con su año («2026-W53»): el tope semanal cruza meses y años. */
  const claveSemana = (fecha) => {
    const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return `${d.getUTCFullYear()}-W${String(semanaISO(fecha)).padStart(2, "0")}`;
  };

  // Generador pseudoaleatorio con semilla (Mulberry32).
  const mulberry32 = (semilla) => {
    let s = semilla;
    return () => {
      let t = (s += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** Red de flujo con costes. Caminos más baratos sucesivos (SPFA, admite costes negativos). */
  const crearRed = () => {
    const aristas = [];
    const salientes = [];
    const nodo = () => salientes.push([]) - 1;
    const arista = (u, v, cap, coste) => {
      salientes[u].push(aristas.length);
      aristas.push({ v, cap, coste });
      salientes[v].push(aristas.length);
      aristas.push({ v: u, cap: 0, coste: -coste });
      return aristas.length - 2;
    };
    const flujoCosteMinimo = (s, t) => {
      const n = salientes.length;
      for (;;) {
        const dist = new Array(n).fill(Infinity);
        const previa = new Array(n).fill(-1);
        const enCola = new Array(n).fill(false);
        const cola = [s];
        dist[s] = 0;
        enCola[s] = true;
        for (let i = 0; i < cola.length; i++) {
          const u = cola[i];
          enCola[u] = false;
          for (const e of salientes[u]) {
            const a = aristas[e];
            if (a.cap > 0 && dist[u] + a.coste < dist[a.v]) {
              dist[a.v] = dist[u] + a.coste;
              previa[a.v] = e;
              if (!enCola[a.v]) {
                enCola[a.v] = true;
                cola.push(a.v);
              }
            }
          }
        }
        // Solo se sigue mientras el camino abarata (todo puesto cubierto lo hace).
        if (dist[t] === Infinity || dist[t] >= 0) return;
        let cuello = Infinity;
        for (let v = t; v !== s; v = aristas[previa[v] ^ 1].v) cuello = Math.min(cuello, aristas[previa[v]].cap);
        for (let v = t; v !== s; v = aristas[previa[v] ^ 1].v) {
          aristas[previa[v]].cap -= cuello;
          aristas[previa[v] ^ 1].cap += cuello;
        }
      }
    };
    return { nodo, arista, aristas, flujoCosteMinimo };
  };

  // Coste de la j-ésima guardia de un médico en una misma semana.
  // Lineal por encima del tope: cuenta cuántas veces se rompe, no reparte los excesos a costa de la equidad.
  const costeSemanal = (j) => (j <= 1 ? 0 : j <= TOPE_SEMANAL ? PESO_SEGUNDA_SEMANAL : PESO_TOPE);
  const costeSemanalAcumulado = (n) => {
    let total = 0;
    for (let j = 1; j <= n; j++) total += costeSemanal(j);
    return total;
  };

  /** Días laborables del mes con lo que el reparto necesita de cada uno. */
  const laborablesDelMes = (ctx, anio, mes) => {
    const dias = [];
    for (let dia = 1; dia <= diasDelMes(anio, mes); dia++) {
      const fecha = fechaUTC(anio, mes, dia);
      if (esLaborable(ctx, fecha)) dias.push({ fecha, iso: aISO(fecha), semana: claveSemana(fecha), diaSemana: fecha.getUTCDay() });
    }
    return dias;
  };

  /** Puestos fijados a mano: «fecha|puesto» → médico (o --- si se quiere vacío). */
  const indexarFijas = (fijas, laborables) => {
    const fechas = new Set(laborables.map((l) => l.iso));
    const indice = new Map();
    lista(fijas).forEach((f) => {
      if (f && typeof f.medico === "string" && f.medico && fechas.has(f.fecha) && PUESTOS.some((p) => p.clave === f.puesto)) {
        indice.set(`${f.fecha}|${f.puesto}`, f.medico);
      }
    });
    return indice;
  };

  /** Guardias de la semana que ya cuentan antes de repartir: las de meses vecinos. */
  const indexarSemanasPrevias = (semanasPrevias) => {
    const usado = {};
    Object.entries(objeto(semanasPrevias)).forEach(([medico, semanas]) => {
      Object.entries(objeto(semanas)).forEach(([semana, n]) => {
        const cuenta = Number(n) || 0;
        if (cuenta > 0) {
          usado[medico] = usado[medico] || {};
          usado[medico][semana] = (usado[medico][semana] || 0) + cuenta;
        }
      });
    });
    return usado;
  };

  const repartir = (cfg, ctx, anio, mes, objetivos, opciones) => {
    const activos = cfg.medicos.filter((m) => m.activo);
    const laborables = laborablesDelMes(ctx, anio, mes);
    const porIso = new Map(laborables.map((l) => [l.iso, l]));
    const fijas = indexarFijas(opciones.fijas, laborables);
    const usadoSemana = indexarSemanasPrevias(opciones.semanasPrevias);
    const usadoTotal = {};
    const diasOcupados = new Set();
    const contarSemana = (nombre, semana, delta) => {
      usadoSemana[nombre] = usadoSemana[nombre] || {};
      usadoSemana[nombre][semana] = (usadoSemana[nombre][semana] || 0) + delta;
    };
    fijas.forEach((medico, llave) => {
      if (medico === SIN_ASIGNAR) return;
      const iso = llave.slice(0, 10);
      usadoTotal[medico] = (usadoTotal[medico] || 0) + 1;
      contarSemana(medico, porIso.get(iso).semana, 1);
      diasOcupados.add(`${medico}|${iso}`);
    });

    // Paso 1: flujo de coste mínimo.
    const red = crearRed();
    const S = red.nodo();
    const T = red.nodo();
    const nodoFranja = new Map();
    laborables.forEach((l) =>
      FRANJAS.forEach((franja) => {
        const libres = PUESTOS.filter((p) => p.franja === franja && !fijas.has(`${l.iso}|${p.clave}`)).length;
        if (libres === 0) return;
        const n = red.nodo();
        nodoFranja.set(`${l.iso}|${franja}`, n);
        red.arista(n, T, libres, 0);
      })
    );
    const algoritmo = cfg.configuracionAlgoritmo;
    const rng = algoritmo.usarAleatoriedad ? mulberry32(((algoritmo.semilla ?? Date.now()) + anio * 12 + mes) >>> 0) : null;
    const elegibles = new Map(); // nombre → Map(iso → franja)
    const opcionesDia = [];
    activos.forEach((medico) => {
      const nombre = medico.nombre;
      const huecos = [];
      laborables.forEach((l) => {
        if (diasOcupados.has(`${nombre}|${l.iso}`) || !puedeTrabajar(ctx, nombre, l.fecha)) return;
        const franja = franjaDelDia(ctx, medico, l.fecha);
        if (nodoFranja.has(`${l.iso}|${franja}`)) huecos.push({ ...l, franja });
      });
      elegibles.set(nombre, new Map(huecos.map((h) => [h.iso, h.franja])));
      if (huecos.length === 0) return;
      const nm = red.nodo();
      // Objetivo en centésimas: (k − obj)² − (k − 1 − obj)² = 2k − 1 − 2·obj, en enteros.
      const objetivoC = Math.round((objetivos[nombre] || 0) * 100);
      const previas = usadoTotal[nombre] || 0;
      for (let k = previas + 1; k <= previas + huecos.length; k++) {
        red.arista(S, nm, 1, -PESO_COBERTURA + (200 * k - 100 - 2 * objetivoC) * PESO_EQUIDAD);
      }
      const nodosSemana = new Map();
      huecos.forEach((h) => {
        let ns = nodosSemana.get(h.semana);
        if (ns === undefined) {
          ns = red.nodo();
          nodosSemana.set(h.semana, ns);
          const usado = usadoSemana[nombre]?.[h.semana] || 0;
          const cuantos = huecos.filter((x) => x.semana === h.semana).length;
          for (let j = usado + 1; j <= usado + cuantos; j++) red.arista(nm, ns, 1, costeSemanal(j));
        }
        const desempate = rng ? Math.floor(rng() * 10) : 0;
        opcionesDia.push({ arista: red.arista(ns, nodoFranja.get(`${h.iso}|${h.franja}`), 1, desempate), nombre, iso: h.iso, franja: h.franja });
      });
    });
    red.flujoCosteMinimo(S, T);

    // Quién va a cada franja de cada día (sin los fijados), en orden de la lista.
    const libres = new Map();
    opcionesDia.forEach((o) => {
      if (red.aristas[o.arista].cap !== 0) return;
      const llave = `${o.iso}|${o.franja}`;
      if (!libres.has(llave)) libres.set(llave, []);
      libres.get(llave).push(o.nombre);
      diasOcupados.add(`${o.nombre}|${o.iso}`);
      usadoTotal[o.nombre] = (usadoTotal[o.nombre] || 0) + 1;
      contarSemana(o.nombre, porIso.get(o.iso).semana, 1);
    });

    // Paso 2: intercambios que no cambian cuántas hace cada uno. Trabaja con
    // índices de día: ocupado[nombre][i] = 1 si ese día ya tiene guardia.
    const indice = new Map(laborables.map((l, i) => [l.iso, i]));
    const siguiente = laborables.map((l) => indice.get(aISO(new Date(l.fecha.getTime() + 86400000))) ?? -1);
    const ocupado = new Map();
    const ocupacion = (nombre) => {
      if (!ocupado.has(nombre)) ocupado.set(nombre, Uint8Array.from(laborables, (l) => (diasOcupados.has(`${nombre}|${l.iso}`) ? 1 : 0)));
      return ocupado.get(nombre);
    };
    const costeSecundario = (nombre) => {
      const dias = ocupacion(nombre);
      let lunes = 0;
      let viernes = 0;
      let seguidos = 0;
      for (let i = 0; i < dias.length; i++) {
        if (!dias[i]) continue;
        if (laborables[i].diaSemana === 1) lunes++;
        else if (laborables[i].diaSemana === 5) viernes++;
        if (siguiente[i] >= 0 && dias[siguiente[i]]) seguidos++;
      }
      let semanal = 0;
      Object.values(usadoSemana[nombre] || {}).forEach((n) => (semanal += costeSemanalAcumulado(n)));
      return semanal + seguidos * PESO_DIAS_SEGUIDOS + (lunes * lunes + viernes * viernes) * PESO_LUNES_VIERNES;
    };
    const mover = (nombre, desde, hasta) => {
      const dias = ocupacion(nombre);
      dias[desde] = 0;
      dias[hasta] = 1;
      contarSemana(nombre, laborables[desde].semana, -1);
      contarSemana(nombre, laborables[hasta].semana, 1);
    };
    const puedeIr = (nombre, i, franja) => elegibles.get(nombre)?.get(laborables[i].iso) === franja && !ocupacion(nombre)[i];
    const grupos = [...libres.entries()].map(([llave, nombres]) => {
      const [iso, franja] = llave.split("|");
      return { dia: indice.get(iso), franja, nombres };
    });
    grupos.sort((x, y) => x.dia - y.dia || x.franja.localeCompare(y.franja));
    for (let pasada = 0; pasada < 30; pasada++) {
      let mejora = false;
      for (let i = 0; i < grupos.length; i++) {
        for (let j = i + 1; j < grupos.length; j++) {
          const A = grupos[i];
          const B = grupos[j];
          if (A.franja !== B.franja || A.dia === B.dia) continue;
          for (let a = 0; a < A.nombres.length; a++) {
            for (let b = 0; b < B.nombres.length; b++) {
              const x = A.nombres[a];
              const y = B.nombres[b];
              if (x === y || !puedeIr(x, B.dia, A.franja) || !puedeIr(y, A.dia, A.franja)) continue;
              const antes = costeSecundario(x) + costeSecundario(y);
              mover(x, A.dia, B.dia);
              mover(y, B.dia, A.dia);
              if (costeSecundario(x) + costeSecundario(y) < antes) {
                A.nombres[a] = y;
                B.nombres[b] = x;
                mejora = true;
              } else {
                mover(x, B.dia, A.dia);
                mover(y, A.dia, B.dia);
              }
            }
          }
        }
      }
      if (!mejora) break;
    }

    // Paso 3: avisos o urgencias dentro de cada franja, en orden cronológico.
    const orden = new Map(cfg.medicos.map((m, i) => [m.nombre, i]));
    const avisos = {};
    const urgencias = {};
    const ultimoTipo = {};
    const anotar = (nombre, tipo) => {
      if (nombre === SIN_ASIGNAR) return;
      if (tipo === "AVISOS") avisos[nombre] = (avisos[nombre] || 0) + 1;
      else urgencias[nombre] = (urgencias[nombre] || 0) + 1;
      ultimoTipo[nombre] = tipo;
    };
    const resultado = new Map();
    laborables.forEach((l) => {
      const registro = {};
      FRANJAS.forEach((franja) => {
        const puestos = PUESTOS.filter((p) => p.franja === franja);
        puestos.forEach((p) => {
          const fijo = fijas.get(`${l.iso}|${p.clave}`);
          if (fijo !== undefined) registro[p.clave] = fijo;
        });
        const pendientes = [...(libres.get(`${l.iso}|${franja}`) || [])];
        puestos.forEach((p) => {
          if (registro[p.clave] !== undefined) return;
          if (pendientes.length === 0) {
            registro[p.clave] = SIN_ASIGNAR;
            return;
          }
          // Primero quien más necesita este tipo para quedar a la par; luego quien hizo el otro la última vez.
          const necesidad = (n) => (p.tipo === "AVISOS" ? (urgencias[n] || 0) - (avisos[n] || 0) : (avisos[n] || 0) - (urgencias[n] || 0));
          const alterna = (n) => (ultimoTipo[n] && ultimoTipo[n] !== p.tipo ? 1 : 0);
          pendientes.sort((a, b) => necesidad(b) - necesidad(a) || alterna(b) - alterna(a) || orden.get(a) - orden.get(b));
          registro[p.clave] = pendientes.shift();
        });
        puestos.forEach((p) => anotar(registro[p.clave], p.tipo));
      });
      resultado.set(l.iso, registro);
    });
    return resultado;
  };

  /**
   * Por qué un médico no puede ocupar un puesto de esa franja ese día, o null si
   * puede. Lo usan el recálculo y el editor, para que nunca discrepen.
   */
  const motivoPuesto = (ctx, medico, fecha, franja) => {
    if (!medico) return "desconocido";
    if (!medico.activo) return "inactivo";
    if (estaAusente(ctx, medico.nombre, fecha)) return "ausencia";
    if (tieneDiaExcluido(ctx, medico.nombre, fecha)) return "dia-excluido";
    if (tieneExclusionPuntual(ctx, medico.nombre, fecha)) return "exclusion-puntual";
    if (franjaDelDia(ctx, medico, fecha) !== franja) return "otra-franja";
    return null;
  };

  /** motivoPuesto para la interfaz: nombre, fecha ISO y franja. */
  const comprobarPuesto = (cfg, nombre, iso, franja) => {
    const fecha = desdeISO(iso);
    if (!fecha) return "fecha-invalida";
    const ctx = crearContexto(cfg);
    if (!esLaborable(ctx, fecha)) return "no-laborable";
    return motivoPuesto(ctx, cfg.medicos.find((m) => m.nombre === nombre), fecha, franja);
  };

  /** Prepara lo común a generar y a evaluar: contexto, saldos y objetivos del mes. */
  const prepararMes = (cfg, anio, mes) => {
    const ctx = crearContexto(cfg);
    const saldos = saldosParaMes(cfg.historico, anio, mes);
    const factor = cfg.historico.factorCompensacion ?? FACTOR_POR_DEFECTO;
    return { ctx, saldos, factor, ...calcularObjetivos(cfg, ctx, anio, mes, saldos, factor) };
  };

  /**
   * Recalcula TODO a partir de un calendario (generado o editado a mano): el
   * resumen, los totales y las incidencias contra la configuración actual. Es la
   * única fuente de los números que se enseñan y de lo que se guarda en el
   * histórico, para que un calendario editado se cuente igual que uno generado.
   * `diasEntrada`: [{ fecha, avisos_manana, urgencias_manana, avisos_tarde, urgencias_tarde }].
   */
  const evaluarCalendario = (cfg, anio, mes, diasEntrada, opciones = {}) => {
    const { ctx, saldos, factor, objetivos, totalPuestos, diasDisponibles, jornadas } = prepararMes(cfg, anio, mes);
    const porFecha = new Map(lista(diasEntrada).filter((d) => d && typeof d.fecha === "string").map((d) => [d.fecha, d]));
    const medicos = new Map(cfg.medicos.map((m) => [m.nombre, m]));
    const cuentas = { asignaciones: {}, avisos: {}, urgencias: {}, lunes: {}, viernes: {} };
    Object.keys(objetivos).forEach((n) => Object.values(cuentas).forEach((c) => (c[n] = 0)));
    const semanas = indexarSemanasPrevias(opciones.semanasPrevias);
    const fechasSemana = {};
    const incidencias = [];
    const dias = [];
    let cubiertos = 0;

    for (let dia = 1; dia <= diasDelMes(anio, mes); dia++) {
      const fecha = fechaUTC(anio, mes, dia);
      const iso = aISO(fecha);
      const diaSemana = fecha.getUTCDay();
      if (!esLaborable(ctx, fecha)) {
        dias.push({ dia, fecha: iso, esLaborable: false, tipo: diaSemana === 0 || diaSemana === 6 ? "Fin de semana" : "Festivo" });
        continue;
      }
      const entrada = objeto(porFecha.get(iso));
      const registro = { dia, fecha: iso, esLaborable: true };
      const hoy = new Set();
      PUESTOS.forEach((p) => {
        const valor = typeof entrada[p.clave] === "string" && entrada[p.clave].trim() ? entrada[p.clave] : SIN_ASIGNAR;
        registro[p.clave] = valor;
        if (valor === SIN_ASIGNAR) return;
        cubiertos++;
        const incidencia = (tipo) => incidencias.push({ fecha: iso, puesto: p.clave, medico: valor, tipo });
        const motivo = motivoPuesto(ctx, medicos.get(valor), fecha, p.franja);
        if (motivo) incidencia(motivo);
        if (hoy.has(valor)) incidencia("doble");
        hoy.add(valor);
        if (!(valor in cuentas.asignaciones)) return;
        cuentas.asignaciones[valor]++;
        if (p.tipo === "AVISOS") cuentas.avisos[valor]++;
        else cuentas.urgencias[valor]++;
        if (diaSemana === 1) cuentas.lunes[valor]++;
        if (diaSemana === 5) cuentas.viernes[valor]++;
        const semana = claveSemana(fecha);
        semanas[valor] = semanas[valor] || {};
        semanas[valor][semana] = (semanas[valor][semana] || 0) + 1;
        fechasSemana[`${valor}|${semana}`] = [...(fechasSemana[`${valor}|${semana}`] || []), iso];
      });
      dias.push(registro);
    }
    Object.entries(semanas).forEach(([medico, porSemana]) =>
      Object.entries(porSemana).forEach(([semana, n]) => {
        const fechas = fechasSemana[`${medico}|${semana}`];
        if (n > TOPE_SEMANAL && fechas) incidencias.push({ fecha: fechas[fechas.length - 1], medico, tipo: "tope-semanal", semana, guardias: n, fechas });
      })
    );
    incidencias.sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.medico).localeCompare(String(b.medico)));

    return {
      anio,
      mes,
      clave: claveMes(anio, mes),
      dias,
      resumen: { ...cuentas, objetivos, diasDisponibles, jornadas },
      totales: { puestos: totalPuestos, cubiertos, descubiertos: totalPuestos - cubiertos },
      incidencias,
      mixtosSinPlan: Array.from(ctx.mixtosSinPlan),
      cambiosTurno: analizarCambiosTurno(cfg, cambiosEfectivosDelMes(ctx, claveMes(anio, mes))),
      compensacion: { saldos, factor, meses: mesesQueCuentan(cfg.historico, anio, mes) },
    };
  };

  /**
   * Genera el calendario de un mes. `cfg` es el estado normalizado y no se modifica.
   * Opciones: `fijas` [{ fecha, puesto, medico }] son puestos decididos a mano que se
   * respetan («reajustar el resto»); `semanasPrevias` { médico: { "2026-W49": n } }
   * son guardias de meses vecinos que cuentan para el tope semanal.
   */
  const generarCalendario = (cfg, anio, mes, opciones = {}) => {
    const { ctx, objetivos } = prepararMes(cfg, anio, mes);
    const reparto = repartir(cfg, ctx, anio, mes, objetivos, objeto(opciones));
    const dias = Array.from(reparto, ([fecha, registro]) => ({ fecha, ...registro }));
    return evaluarCalendario(cfg, anio, mes, dias, opciones);
  };

  /** Médicos activos que pueden ir ese día a esa franja (para explicar un puesto vacío). */
  const disponiblesEnFranja = (cfg, iso, franja) => {
    const ctx = crearContexto(cfg);
    const fecha = desdeISO(iso);
    if (!fecha || !esLaborable(ctx, fecha)) return [];
    return cfg.medicos.filter((m) => m.activo && puedeTrabajar(ctx, m.nombre, fecha) && franjaDelDia(ctx, m, fecha) === franja).map((m) => m.nombre);
  };

  /** Guardias de cada médico por semana ISO en un calendario (para el tope entre meses). */
  const guardiasPorSemana = (dias) => {
    const semanas = {};
    lista(dias).forEach((d) => {
      const fecha = desdeISO(d && d.fecha);
      if (!fecha) return;
      PUESTOS.forEach((p) => {
        const medico = d[p.clave];
        if (typeof medico !== "string" || !medico || medico === SIN_ASIGNAR) return;
        const semana = claveSemana(fecha);
        semanas[medico] = semanas[medico] || {};
        semanas[medico][semana] = (semanas[medico][semana] || 0) + 1;
      });
    });
    return semanas;
  };

  /**
   * Cambios de un puesto a otro médico que acercan el reparto a los objetivos sin
   * crear incidencias: cubren un puesto vacío o pasan una guardia de quien va por
   * encima a quien va por debajo (solo si la diferencia entre ambos pasa de 1,
   * porque si no el cambio no mejora a nadie). Para orientar retoques a mano.
   */
  const sugerirReajustes = (cfg, evaluacion, opciones = {}) => {
    const ctx = crearContexto(cfg);
    const r = evaluacion.resumen;
    const desvio = (n) => (r.asignaciones[n] || 0) - (r.objetivos[n] || 0);
    const semanas = indexarSemanasPrevias(opciones.semanasPrevias);
    Object.entries(guardiasPorSemana(evaluacion.dias)).forEach(([m, s]) =>
      Object.entries(s).forEach(([k, n]) => {
        semanas[m] = semanas[m] || {};
        semanas[m][k] = (semanas[m][k] || 0) + n;
      })
    );
    const conIncidencia = new Set(evaluacion.incidencias.filter((i) => i.puesto).map((i) => `${i.fecha}|${i.puesto}`));
    const activos = cfg.medicos.filter((m) => m.activo && m.nombre in r.objetivos);
    const propuestas = [];
    evaluacion.dias
      .filter((d) => d.esLaborable)
      .forEach((d) => {
        const fecha = desdeISO(d.fecha);
        const semana = claveSemana(fecha);
        const hoy = new Set(PUESTOS.map((p) => d[p.clave]));
        PUESTOS.forEach((p) => {
          const actual = d[p.clave];
          const vacio = actual === SIN_ASIGNAR;
          if (!vacio && !(actual in r.objetivos)) return;
          if (!vacio && conIncidencia.has(`${d.fecha}|${p.clave}`)) return;
          activos.forEach((m) => {
            if (m.nombre === actual || hoy.has(m.nombre)) return;
            if (!puedeTrabajar(ctx, m.nombre, fecha) || franjaDelDia(ctx, m, fecha) !== p.franja) return;
            if ((semanas[m.nombre]?.[semana] || 0) >= TOPE_SEMANAL) return;
            const dY = desvio(m.nombre);
            const cambio = vacio ? (dY + 1) ** 2 - dY ** 2 : 2 + 2 * dY - 2 * desvio(actual);
            if (!vacio && cambio > -0.01) return;
            propuestas.push({ fecha: d.fecha, puesto: p.clave, de: actual, a: m.nombre, cubre: vacio, mejora: -cambio });
          });
        });
      });
    // Primero cubrir huecos; luego la que más mejora. Una por pareja (de → a), la primera fecha.
    propuestas.sort((x, y) => Number(y.cubre) - Number(x.cubre) || y.mejora - x.mejora || x.fecha.localeCompare(y.fecha));
    const vistas = new Set();
    return propuestas
      .filter((p) => {
        const llave = p.cubre ? `${p.fecha}|${p.puesto}` : `${p.de}>${p.a}`;
        if (vistas.has(llave)) return false;
        vistas.add(llave);
        return true;
      })
      .slice(0, opciones.maximo || 8);
  };

  /** Lo que se guarda en el histórico de un mes: diferencia entre asignadas y objetivo. */
  const diferenciasDelMes = (resultado) => {
    const datos = {};
    Object.keys(resultado.resumen.objetivos).forEach((medico) => {
      const asignadas = resultado.resumen.asignaciones[medico] || 0;
      const objetivo = resultado.resumen.objetivos[medico] || 0;
      datos[medico] = { asignadas, objetivo, diferencia: asignadas - objetivo };
    });
    return datos;
  };

  /**
   * Equidad del mes medida contra el objetivo de cada uno (que ya descuenta
   * jornada, ausencias y compensación), no contra el número bruto de guardias.
   */
  const evaluarEquidad = (resultado) => {
    let peor = { medico: null, desviacion: 0 };
    let maximo = -Infinity;
    let minimo = Infinity;
    let sumaCuadrados = 0;
    let fuera = 0;
    Object.keys(resultado.resumen.objetivos).forEach((medico) => {
      const asignadas = resultado.resumen.asignaciones[medico] || 0;
      const desviacion = asignadas - resultado.resumen.objetivos[medico];
      if (Math.abs(desviacion) > Math.abs(peor.desviacion)) peor = { medico, desviacion };
      if (Math.abs(desviacion) > UMBRAL_DESVIACION) fuera++;
      sumaCuadrados += desviacion * desviacion;
      maximo = Math.max(maximo, asignadas);
      minimo = Math.min(minimo, asignadas);
    });
    return {
      correcta: Math.abs(peor.desviacion) <= UMBRAL_DESVIACION,
      peor,
      fuera,
      sumaCuadrados: Math.round(sumaCuadrados * 100) / 100,
      maximo: Number.isFinite(maximo) ? maximo : 0,
      minimo: Number.isFinite(minimo) ? minimo : 0,
      rango: Number.isFinite(maximo) ? maximo - minimo : 0,
    };
  };

  // --- Importación rápida de médicos ---------------------------------------------------

  const quitarTildes = (texto) => texto.normalize("NFD").replace(/\p{M}/gu, "");

  const leerTurno = (texto) => {
    const limpio = quitarTildes(String(texto || "").trim().toUpperCase()).replace(/S$/, "");
    if (limpio === "MANANA") return "MAÑANA";
    if (limpio === "TARDE") return "TARDE";
    if (limpio === "MIXTO" || limpio === "MIXTA") return "MIXTO";
    return null;
  };

  const leerJornada = (texto) => {
    const numero = Number(String(texto).replace("%", "").replace(",", ".").trim());
    return Number.isFinite(numero) && numero > 0 && numero <= 100 ? Math.round(numero) : null;
  };

  /**
   * Interpreta filas pegadas desde Excel. Columnas: Nombre y Turno obligatorias;
   * Categoría y Jornada % opcionales. Acepta tabulador o, si no hay, punto y coma.
   */
  const parsearImportacionMedicos = (texto) => {
    const filas = [];
    const errores = [];
    String(texto || "")
      .split(/\r?\n/)
      .forEach((linea, i) => {
        if (!linea.trim()) return;
        const numero = i + 1;
        const separador = linea.includes("\t") ? "\t" : ";";
        const campos = linea.split(separador).map((c) => c.trim());
        while (campos.length > 0 && campos[campos.length - 1] === "") campos.pop();

        let nombre = campos[0] || "";
        let turno = null;
        let jornada = null;
        let textoJornada = null;

        if (campos.length === 2) {
          turno = leerTurno(campos[1]);
        } else if (campos.length === 3) {
          if (leerTurno(campos[1])) {
            turno = leerTurno(campos[1]);
            textoJornada = campos[2];
          } else {
            turno = leerTurno(campos[2]);
          }
        } else if (campos.length === 4) {
          turno = leerTurno(campos[2]);
          textoJornada = campos[3];
        } else {
          errores.push({ linea: numero, motivo: campos.length < 2 ? "falta la columna de turno" : `tiene ${campos.length} columnas (máximo 4)` });
          return;
        }

        if (!turno) {
          // Una primera fila de títulos («Nombre · Turno») se ignora sin error.
          if (filas.length === 0 && errores.length === 0 && /TURNO/i.test(linea)) return;
          errores.push({ linea: numero, motivo: "turno no reconocido (usa MAÑANA, TARDE o MIXTO)" });
          return;
        }
        if (textoJornada !== null && textoJornada !== "") {
          jornada = leerJornada(textoJornada);
          if (jornada === null) {
            errores.push({ linea: numero, motivo: `jornada «${textoJornada}» no válida (un número de 1 a 100)` });
            return;
          }
        }
        nombre = nombre.toUpperCase().trim();
        if (!nombre) {
          errores.push({ linea: numero, motivo: "nombre vacío" });
          return;
        }
        filas.push({ linea: numero, nombre, turno, jornada });
      });
    return { filas, errores };
  };

  return {
    TURNOS,
    FRANJAS,
    PUESTOS,
    SIN_ASIGNAR,
    NOMBRES_DIA,
    UMBRAL_DESVIACION,
    FACTOR_POR_DEFECTO,
    VENTANA_POR_DEFECTO,
    fechaUTC,
    aISO,
    desdeISO,
    fechasEntre,
    diasDelMes,
    claveMes,
    desplazarMes,
    semanaISO,
    claveSemana,
    TOPE_SEMANAL,
    normalizarEstado,
    detectarFichero,
    mesesQueCuentan,
    saldosParaMes,
    saldoVigente,
    generarCalendario,
    evaluarCalendario,
    guardiasPorSemana,
    sugerirReajustes,
    disponiblesEnFranja,
    comprobarPuesto,
    normalizarCalendarios,
    analizarCambiosTurno,
    agruparCambiosTurno,
    diferenciasDelMes,
    evaluarEquidad,
    parsearImportacionMedicos,
    leerTurno,
  };
});
