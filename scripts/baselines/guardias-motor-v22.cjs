// COPIA CONGELADA del motor v2.2 (commit cdd6462). Solo la usa el banco de pruebas para
// comprobar que el reparto óptimo de la v2.3 nunca es peor que el voraz anterior. No editar.
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
 *  - Puntuación de cada candidato: menos guardias y más déficit primero;
 *    −1000 si ya tiene 2 en la semana ISO; −50 si repite tipo y +20 si alterna;
 *    −10 si se desequilibra avisos/urgencias (fuera de 45–55 %); −3 por cada
 *    lunes o viernes previo si el día es lunes o viernes. Empates: orden de la
 *    lista de médicos, o desempate aleatorio con semilla si está activado.
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
 * AÑADIDO EN LA v2.2: cambios de turno en fechas concretas. Sin ninguno, el
 * reparto es idéntico al de la v2.1 (lo vigila la misma línea base).
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
      ultimaCopia: typeof entrada.ultimaCopia === "string" ? entrada.ultimaCopia : null,
    };
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
    let totalDisponibilidad = 0;
    activos.forEach((medico) => {
      let huecos = 0;
      laborables.forEach((fecha) => {
        if (!puedeTrabajarParaObjetivo(ctx, medico.nombre, fecha)) return;
        if (FRANJAS.includes(franjaDelDia(ctx, medico, fecha))) huecos += 2;
      });
      const reduccion = ctx.reducciones.get(medico.nombre);
      const jornada = reduccion ? reduccion.porcentaje / 100 : 1;
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
    return { objetivos: ajustados, totalPuestos };
  };

  // --- Asignación --------------------------------------------------------------------

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

  const elegir = (candidatos, cuentas, tipo, fecha, algoritmo) => {
    if (candidatos.length === 0) return SIN_ASIGNAR;
    const semana = semanaISO(fecha);
    const diaSemana = fecha.getUTCDay();

    const puntuados = candidatos.map((candidato) => {
      const asignadas = cuentas.asignaciones[candidato] || 0;
      let puntuacion = 100 - asignadas;
      puntuacion += ((cuentas.objetivos[candidato] || 0) - asignadas) * 10;

      if ((cuentas.porSemana[candidato]?.[semana] || 0) >= 2) puntuacion -= 1000;

      const ultimoTipo = cuentas.ultimoTipo[candidato];
      if (ultimoTipo === tipo && asignadas > 0) puntuacion -= 50;
      else if (ultimoTipo && ultimoTipo !== tipo) puntuacion += 20;

      if (asignadas > 0) {
        const porcentajeAvisos = (cuentas.avisos[candidato] || 0) / asignadas;
        if (tipo === "AVISOS" && porcentajeAvisos > 0.55) puntuacion -= 10;
        else if (tipo === "URGENCIAS" && porcentajeAvisos < 0.45) puntuacion -= 10;
      }

      if (diaSemana === 1) puntuacion -= (cuentas.lunes[candidato] || 0) * 3;
      else if (diaSemana === 5) puntuacion -= (cuentas.viernes[candidato] || 0) * 3;

      return { candidato, puntuacion };
    });

    puntuados.sort((a, b) => b.puntuacion - a.puntuacion);

    if (algoritmo.usarAleatoriedad) {
      const mejor = puntuados[0].puntuacion;
      const empatados = puntuados.filter((c) => Math.abs(c.puntuacion - mejor) < 0.01);
      if (empatados.length > 1) {
        const rng = mulberry32((algoritmo.semilla ?? Date.now()) + fecha.getTime());
        for (let i = empatados.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [empatados[i], empatados[j]] = [empatados[j], empatados[i]];
        }
        return empatados[0].candidato;
      }
    }
    return puntuados[0].candidato;
  };

  /**
   * Genera el calendario de un mes. `cfg` es el estado normalizado. No modifica
   * `cfg`. Devuelve también los avisos que la interfaz debe enseñar.
   */
  const generarCalendario = (cfg, anio, mes) => {
    const ctx = crearContexto(cfg);
    const saldos = saldosParaMes(cfg.historico, anio, mes);
    const factor = cfg.historico.factorCompensacion ?? FACTOR_POR_DEFECTO;
    const { objetivos, totalPuestos } = calcularObjetivos(cfg, ctx, anio, mes, saldos, factor);
    const algoritmo = cfg.configuracionAlgoritmo;

    const activos = cfg.medicos.filter((m) => m.activo);
    const cuentas = {
      objetivos,
      asignaciones: {},
      avisos: {},
      urgencias: {},
      lunes: {},
      viernes: {},
      porSemana: {},
      ultimoTipo: {},
    };
    activos.forEach((m) => {
      ["asignaciones", "avisos", "urgencias", "lunes", "viernes"].forEach((k) => {
        cuentas[k][m.nombre] = 0;
      });
      cuentas.porSemana[m.nombre] = {};
    });

    const dias = [];
    let cubiertos = 0;
    for (let dia = 1; dia <= diasDelMes(anio, mes); dia++) {
      const fecha = fechaUTC(anio, mes, dia);
      const diaSemana = fecha.getUTCDay();
      if (!esLaborable(ctx, fecha)) {
        dias.push({
          dia,
          fecha: aISO(fecha),
          esLaborable: false,
          tipo: diaSemana === 0 || diaSemana === 6 ? "Fin de semana" : "Festivo",
        });
        continue;
      }

      const registro = { dia, fecha: aISO(fecha), esLaborable: true };
      const disponibles = {
        MAÑANA: cfg.medicos
          .filter((m) => m.activo && puedeTrabajar(ctx, m.nombre, fecha) && cubreFranja(ctx, m, fecha, "MAÑANA"))
          .map((m) => m.nombre),
        TARDE: cfg.medicos
          .filter((m) => m.activo && puedeTrabajar(ctx, m.nombre, fecha) && cubreFranja(ctx, m, fecha, "TARDE"))
          .map((m) => m.nombre),
      };
      const hoy = [];

      PUESTOS.forEach((puesto) => {
        const candidatos = disponibles[puesto.franja].filter((c) => !hoy.includes(c));
        const medico = elegir(candidatos, cuentas, puesto.tipo, fecha, algoritmo);
        registro[puesto.clave] = medico;
        if (medico === SIN_ASIGNAR) return;

        cubiertos++;
        hoy.push(medico);
        if (puesto.tipo === "AVISOS") cuentas.avisos[medico] = (cuentas.avisos[medico] || 0) + 1;
        else cuentas.urgencias[medico] = (cuentas.urgencias[medico] || 0) + 1;
        cuentas.ultimoTipo[medico] = puesto.tipo;
        cuentas.asignaciones[medico] = (cuentas.asignaciones[medico] || 0) + 1;
        if (diaSemana === 1) cuentas.lunes[medico] = (cuentas.lunes[medico] || 0) + 1;
        if (diaSemana === 5) cuentas.viernes[medico] = (cuentas.viernes[medico] || 0) + 1;
        const semana = semanaISO(fecha);
        if (!cuentas.porSemana[medico]) cuentas.porSemana[medico] = {};
        cuentas.porSemana[medico][semana] = (cuentas.porSemana[medico][semana] || 0) + 1;
      });
      dias.push(registro);
    }

    return {
      anio,
      mes,
      clave: claveMes(anio, mes),
      dias,
      resumen: {
        asignaciones: cuentas.asignaciones,
        avisos: cuentas.avisos,
        urgencias: cuentas.urgencias,
        lunes: cuentas.lunes,
        viernes: cuentas.viernes,
        objetivos,
      },
      totales: { puestos: totalPuestos, cubiertos, descubiertos: totalPuestos - cubiertos },
      mixtosSinPlan: Array.from(ctx.mixtosSinPlan),
      cambiosTurno: analizarCambiosTurno(cfg, cambiosEfectivosDelMes(ctx, claveMes(anio, mes))),
      compensacion: { saldos, factor, meses: mesesQueCuentan(cfg.historico, anio, mes) },
    };
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
    Object.keys(resultado.resumen.objetivos).forEach((medico) => {
      const asignadas = resultado.resumen.asignaciones[medico] || 0;
      const desviacion = asignadas - resultado.resumen.objetivos[medico];
      if (Math.abs(desviacion) > Math.abs(peor.desviacion)) peor = { medico, desviacion };
      maximo = Math.max(maximo, asignadas);
      minimo = Math.min(minimo, asignadas);
    });
    return {
      correcta: Math.abs(peor.desviacion) <= UMBRAL_DESVIACION,
      peor,
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
    normalizarEstado,
    detectarFichero,
    mesesQueCuentan,
    saldosParaMes,
    saldoVigente,
    generarCalendario,
    analizarCambiosTurno,
    agruparCambiosTurno,
    diferenciasDelMes,
    evaluarEquidad,
    parsearImportacionMedicos,
    leerTurno,
  };
});
