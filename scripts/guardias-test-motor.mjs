// Banco de pruebas del motor del gestor de guardias (assets/js/guardias-motor.js).
//
//   node scripts/guardias-test-motor.mjs
//
// Sale con 0 si todo pasa y con 1 si algo falla. No usa red ni dependencias.
// No está en el CI de MedCheck (ese recorre solo scripts/medcheck-test-*.mjs):
// se ejecuta a mano antes de publicar cambios en el gestor de guardias.
//
// Qué vigila:
//  1. Línea base: el reparto coincide con el del motor anterior a la v2.1 en
//     configuraciones aleatorias (scripts/baselines/guardias-motor-golden.json).
//  2. Las reglas de negocio descritas en la cabecera del motor.
//  3. Los fallos corregidos en la v2.1, para que no vuelvan.
//  4. Los cambios de turno en fechas concretas (v2.2): precedencia, objetivo
//     intacto, datos dañados y tramos. Sin cambios, la línea base del punto 1
//     garantiza que el reparto es el de siempre.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const M = require(join(raiz, "assets/js/guardias-motor.js"));

let fallos = 0;
let pasan = 0;
const prueba = (nombre, fn) => {
  try {
    fn();
    pasan++;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA ${nombre}\n        ${e.message}`);
  }
};
const igual = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);
};
const cierto = (v, msg) => {
  if (!v) throw new Error(msg);
};
const cerca = (a, b, tol, msg) => {
  if (Math.abs(a - b) > tol) throw new Error(`${msg}: ${a} no está a ±${tol} de ${b}`);
};

const cfgBase = (extra = {}) =>
  M.normalizarEstado({
    medicos: [
      { nombre: "A", turno: "MAÑANA", activo: true },
      { nombre: "B", turno: "MAÑANA", activo: true },
      { nombre: "C", turno: "MAÑANA", activo: true },
      { nombre: "D", turno: "TARDE", activo: true },
      { nombre: "E", turno: "TARDE", activo: true },
      { nombre: "F", turno: "TARDE", activo: true },
    ],
    ...extra,
  });
const filas = (r) => r.dias.filter((d) => d.esLaborable);
const nombresDelDia = (d) => M.PUESTOS.map((p) => d[p.clave]);

// Calidad de un reparto en el orden de prioridades del motor: cobertura, veces
// que se rompe el tope semanal y suma de (asignadas − objetivo)².
const calidad = (dias, objetivos, asignaciones) => {
  let cubiertos = 0;
  const semanas = {};
  dias.forEach((d) => {
    if (!d.esLaborable) return;
    nombresDelDia(d).forEach((n) => {
      if (n === M.SIN_ASIGNAR) return;
      cubiertos++;
      const k = `${n}|${M.claveSemana(M.desdeISO(d.fecha))}`;
      semanas[k] = (semanas[k] || 0) + 1;
    });
  });
  const exceso = Object.values(semanas).reduce((s, n) => s + Math.max(0, n - M.TOPE_SEMANAL), 0);
  const cuadrados = Object.keys(objetivos).reduce((s, n) => s + ((asignaciones[n] || 0) - objetivos[n]) ** 2, 0);
  return { cubiertos, exceso, cuadrados };
};
// El nuevo no puede ser peor que el viejo en ese orden (lexicográfico).
const noPeor = (nuevo, viejo) =>
  nuevo.cubiertos > viejo.cubiertos ||
  (nuevo.cubiertos === viejo.cubiertos && (nuevo.exceso < viejo.exceso || (nuevo.exceso === viejo.exceso && nuevo.cuadrados <= viejo.cuadrados + 1e-9)));

console.log("\nLínea base (motor anterior a la v2.1)");
const base = JSON.parse(readFileSync(join(raiz, "scripts/baselines/guardias-motor-golden.json"), "utf8"));
prueba(`la línea base tiene casos (${base.casos.length})`, () => cierto(base.casos.length >= 10, "menos de 10 casos"));
base.casos.forEach((c) => {
  prueba(`caso ${c.caso} (${c.mes}/${c.anio}): mismos objetivos y reparto no peor que el anterior`, () => {
    const r = M.generarCalendario(M.normalizarEstado(c.cfg), c.anio, c.mes);
    igual(r.resumen.objetivos, c.esperado.objetivos, "objetivos");
    const fechas = r.dias.map((d) => d.fecha);
    const diasViejo = c.esperado.dias.map((d, i) =>
      Array.isArray(d) ? Object.fromEntries([["fecha", fechas[i]], ["esLaborable", true], ...M.PUESTOS.map((p, j) => [p.clave, d[j]])]) : { fecha: fechas[i], esLaborable: false }
    );
    const viejo = calidad(diasViejo, c.esperado.objetivos, c.esperado.asignaciones);
    const nuevo = calidad(r.dias, r.resumen.objetivos, r.resumen.asignaciones);
    cierto(noPeor(nuevo, viejo), `peor que el anterior: ${JSON.stringify(nuevo)} frente a ${JSON.stringify(viejo)}`);
  });
});

console.log("\nReglas de negocio");
const nov = M.generarCalendario(cfgBase(), 2026, 11);
prueba("4 puestos por día laborable y ninguno en fin de semana", () => {
  cierto(filas(nov).length === 21, `noviembre 2026 tiene 21 laborables, salen ${filas(nov).length}`);
  igual(nov.totales.puestos, 84, "puestos");
  cierto(nov.dias.filter((d) => !d.esLaborable).every((d) => d.tipo === "Fin de semana"), "días no laborables");
});
prueba("nadie ocupa dos puestos el mismo día", () => {
  filas(nov).forEach((d) => {
    const n = nombresDelDia(d).filter((x) => x !== M.SIN_ASIGNAR);
    cierto(new Set(n).size === n.length, `repetido el ${d.fecha}`);
  });
});
prueba("los de MAÑANA solo van por la mañana y los de TARDE por la tarde", () => {
  filas(nov).forEach((d) => {
    cierto(["A", "B", "C"].includes(d.avisos_manana) && ["A", "B", "C"].includes(d.urgencias_manana), `mañana del ${d.fecha}`);
    cierto(["D", "E", "F"].includes(d.avisos_tarde) && ["D", "E", "F"].includes(d.urgencias_tarde), `tarde del ${d.fecha}`);
  });
});
prueba("los objetivos suman los puestos del mes", () => {
  cerca(Object.values(nov.resumen.objetivos).reduce((a, b) => a + b, 0), 84, 0.05, "suma de objetivos");
});
prueba("un festivo no tiene guardias y baja los puestos", () => {
  const r = M.generarCalendario(cfgBase({ festivos: ["2026-11-02"] }), 2026, 11);
  igual(r.dias[1].tipo, "Festivo", "tipo del 2/11");
  igual(r.totales.puestos, 80, "puestos");
});
prueba("una ausencia impide asignar y reduce el objetivo", () => {
  const r = M.generarCalendario(cfgBase({ ausencias: [{ medico: "A", inicio: "2026-11-09", fin: "2026-11-20" }] }), 2026, 11);
  filas(r)
    .filter((d) => d.fecha >= "2026-11-09" && d.fecha <= "2026-11-20")
    .forEach((d) => cierto(!nombresDelDia(d).includes("A"), `A asignado el ${d.fecha}`));
  cierto(r.resumen.objetivos.A < nov.resumen.objetivos.A, "el objetivo de A no baja");
});
prueba("una exclusión puntual impide asignar ese día pero NO reduce el objetivo", () => {
  const r = M.generarCalendario(cfgBase({ exclusionesPuntuales: [{ medico: "A", fecha: "2026-11-10" }] }), 2026, 11);
  cierto(!nombresDelDia(r.dias[9]).includes("A"), "A asignado el 10/11");
  igual(r.resumen.objetivos.A, nov.resumen.objetivos.A, "objetivo de A");
});
prueba("un día excluido no se asigna nunca y reduce el objetivo", () => {
  const r = M.generarCalendario(cfgBase({ reducciones: [{ medico: "A", porcentaje: 100, diasExcluidos: "VIERNES" }] }), 2026, 11);
  filas(r)
    .filter((d) => new Date(`${d.fecha}T00:00:00Z`).getUTCDay() === 5)
    .forEach((d) => cierto(!nombresDelDia(d).includes("A"), `A asignado el viernes ${d.fecha}`));
  cierto(r.resumen.objetivos.A < nov.resumen.objetivos.A, "el objetivo de A no baja");
});
prueba("jornada del 50 %: la mitad de objetivo que un compañero igual a jornada completa", () => {
  const r = M.generarCalendario(cfgBase({ reducciones: [{ medico: "A", porcentaje: 50, diasExcluidos: "" }] }), 2026, 11);
  cerca(r.resumen.objetivos.A / r.resumen.objetivos.B, 0.5, 0.01, "proporción A/B");
});
prueba("MIXTO con plan: solo va a la franja planificada de cada día", () => {
  const cfg = cfgBase({
    medicos: [...cfgBase().medicos, { nombre: "X", turno: "MIXTO", activo: true }],
    planificacionesTurnos: [{ medico: "X", L: "MAÑANA", M: "MAÑANA", X: "MAÑANA", J: "MAÑANA", V: "MAÑANA" }],
  });
  const r = M.generarCalendario(cfg, 2026, 11);
  filas(r).forEach((d) => cierto(d.avisos_tarde !== "X" && d.urgencias_tarde !== "X", `X por la tarde el ${d.fecha}`));
  igual(r.mixtosSinPlan, [], "mixtos sin plan");
});
prueba("MIXTO sin plan: L/X/V tarde, M/J mañana, y se avisa", () => {
  const cfg = cfgBase({ medicos: [...cfgBase().medicos, { nombre: "X", turno: "MIXTO", activo: true }] });
  const r = M.generarCalendario(cfg, 2026, 11);
  filas(r).forEach((d) => {
    const dia = new Date(`${d.fecha}T00:00:00Z`).getUTCDay();
    const enManana = d.avisos_manana === "X" || d.urgencias_manana === "X";
    const enTarde = d.avisos_tarde === "X" || d.urgencias_tarde === "X";
    if ([1, 3, 5].includes(dia)) cierto(!enManana, `X por la mañana el ${d.fecha}`);
    else cierto(!enTarde, `X por la tarde el ${d.fecha}`);
  });
  igual(r.mixtosSinPlan, ["X"], "mixtos sin plan");
});
prueba("con personal suficiente nadie hace una 3.ª guardia en la misma semana", () => {
  const cfg = cfgBase({
    medicos: "ABCDEFGHIJKL".split("").map((n, i) => ({ nombre: n, turno: i < 6 ? "MAÑANA" : "TARDE", activo: true })),
  });
  const r = M.generarCalendario(cfg, 2026, 11);
  const porSemana = {};
  filas(r).forEach((d) => {
    const s = M.semanaISO(new Date(`${d.fecha}T00:00:00Z`));
    nombresDelDia(d).forEach((n) => {
      porSemana[`${n}|${s}`] = (porSemana[`${n}|${s}`] || 0) + 1;
    });
  });
  cierto(Object.values(porSemana).every((v) => v <= 2), "alguien tiene 3 o más en una semana");
});
prueba("un puesto sin candidatos queda como --- y se cuenta como descubierto", () => {
  const r = M.generarCalendario(cfgBase({ medicos: cfgBase().medicos.slice(0, 4) }), 2026, 11);
  igual(r.totales.descubiertos, 21, "descubiertos (solo hay un médico de tarde)");
  cierto(filas(r).every((d) => d.urgencias_tarde === M.SIN_ASIGNAR), "urgencias de tarde");
});
prueba("un inactivo no recibe guardias ni objetivo", () => {
  const cfg = cfgBase();
  cfg.medicos[0].activo = false;
  const r = M.generarCalendario(cfg, 2026, 11);
  cierto(!("A" in r.resumen.objetivos), "A tiene objetivo");
  filas(r).forEach((d) => cierto(!nombresDelDia(d).includes("A"), `A asignado el ${d.fecha}`));
});
prueba("sin aleatoriedad, el mismo mes sale siempre igual", () => {
  igual(M.generarCalendario(cfgBase(), 2026, 11).dias, nov.dias, "calendario");
});
prueba("con aleatoriedad y la misma semilla, sale igual", () => {
  const cfg = cfgBase({ configuracionAlgoritmo: { usarAleatoriedad: true, semilla: 12345 } });
  igual(M.generarCalendario(cfg, 2026, 11).dias, M.generarCalendario(cfg, 2026, 11).dias, "calendario");
});

console.log("\nCambios de turno en fechas concretas (v2.2)");
const conCambios = (cambiosTurno, extra = {}) => cfgBase({ cambiosTurno, ...extra });
const diaDe = (r, iso) => r.dias.find((d) => d.fecha === iso);
const enManana = (d, n) => d.avisos_manana === n || d.urgencias_manana === n;
const enTarde = (d, n) => d.avisos_tarde === n || d.urgencias_tarde === n;
prueba("un médico de MAÑANA con cambio a TARDE ese día solo puede ir por la tarde", () => {
  // Con D, E y F ausentes el 10/11, A es el único candidato de tarde: tiene que salir ahí.
  const r = M.generarCalendario(
    conCambios([{ medico: "A", fecha: "2026-11-10", turno: "TARDE" }], {
      ausencias: ["D", "E", "F"].map((medico) => ({ medico, inicio: "2026-11-10", fin: "2026-11-10" })),
    }),
    2026,
    11
  );
  const d = diaDe(r, "2026-11-10");
  cierto(!enManana(d, "A"), "A sigue yendo por la mañana");
  cierto(enTarde(d, "A"), "A no cubre la tarde aunque es el único de tarde");
  filas(r)
    .filter((x) => x.fecha !== "2026-11-10")
    .forEach((x) => cierto(!enTarde(x, "A"), `A por la tarde el ${x.fecha} sin cambio`));
});
prueba("el cambio manda sobre la planificación semanal de un MIXTO", () => {
  const cfg = cfgBase({
    medicos: [...cfgBase().medicos, { nombre: "X", turno: "MIXTO", activo: true }],
    planificacionesTurnos: [{ medico: "X", L: "MAÑANA", M: "MAÑANA", X: "MAÑANA", J: "MAÑANA", V: "MAÑANA" }],
    cambiosTurno: [{ medico: "X", fecha: "2026-11-11", turno: "TARDE" }],
    ausencias: ["D", "E", "F"].map((medico) => ({ medico, inicio: "2026-11-11", fin: "2026-11-11" })),
  });
  const r = M.generarCalendario(cfg, 2026, 11);
  cierto(enTarde(diaDe(r, "2026-11-11"), "X"), "X no cubre la tarde del 11/11");
  igual(r.cambiosTurno.map((c) => [c.cambia, c.habitual]), [[true, "MAÑANA"]], "análisis del cambio");
});
prueba("un cambio de turno NO cambia ningún objetivo", () => {
  const cambios = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-17"].map((fecha) => ({ medico: "B", fecha, turno: "TARDE" }));
  igual(M.generarCalendario(conCambios(cambios), 2026, 11).resumen.objetivos, nov.resumen.objetivos, "objetivos");
});
prueba("la ausencia manda sobre el cambio de turno", () => {
  // A sería el único candidato de tarde el 10/11: si la ausencia no mandara, saldría ahí.
  const ausentes = ["D", "E", "F"].map((medico) => ({ medico, inicio: "2026-11-10", fin: "2026-11-10" }));
  const r = M.generarCalendario(
    conCambios([{ medico: "A", fecha: "2026-11-10", turno: "TARDE" }], {
      ausencias: [{ medico: "A", inicio: "2026-11-09", fin: "2026-11-13" }, ...ausentes],
    }),
    2026,
    11
  );
  const d = diaDe(r, "2026-11-10");
  cierto(!nombresDelDia(d).includes("A"), "A asignado estando ausente");
  igual([d.avisos_tarde, d.urgencias_tarde], [M.SIN_ASIGNAR, M.SIN_ASIGNAR], "tarde del 10/11");
  igual(r.cambiosTurno[0].motivo, "ausencia", "motivo");
});
prueba("la exclusión puntual y el día excluido también mandan sobre el cambio", () => {
  const a = M.analizarCambiosTurno(
    cfgBase({
      exclusionesPuntuales: [{ medico: "A", fecha: "2026-11-10" }],
      reducciones: [{ medico: "B", porcentaje: 100, diasExcluidos: "VIERNES" }],
    }),
    [
      { medico: "A", fecha: "2026-11-10", turno: "TARDE" },
      { medico: "B", fecha: "2026-11-13", turno: "TARDE" },
    ]
  );
  igual(a.map((c) => c.motivo), ["exclusion-puntual", "dia-excluido"], "motivos");
});
prueba("un cambio en fin de semana, festivo, inactivo o desconocido no tiene efecto ni rompe nada", () => {
  const cfg = conCambios(
    [
      { medico: "A", fecha: "2026-11-07", turno: "TARDE" },
      { medico: "A", fecha: "2026-11-02", turno: "TARDE" },
      { medico: "B", fecha: "2026-11-10", turno: "TARDE" },
      { medico: "NADIE", fecha: "2026-11-10", turno: "TARDE" },
    ],
    { festivos: ["2026-11-02"] }
  );
  cfg.medicos[1].activo = false;
  const r = M.generarCalendario(cfg, 2026, 11);
  igual(r.cambiosTurno.map((c) => c.motivo), ["no-laborable", "no-laborable", "inactivo", "medico-desconocido"], "motivos");
  const sin = cfgBase({ festivos: ["2026-11-02"] });
  sin.medicos[1].activo = false;
  igual(r.dias, M.generarCalendario(sin, 2026, 11).dias, "calendario");
});
prueba("un cambio a la franja que ya tenía no altera nada y se marca como tal", () => {
  const r = M.generarCalendario(conCambios([{ medico: "A", fecha: "2026-11-10", turno: "MAÑANA" }]), 2026, 11);
  igual(r.dias, nov.dias, "calendario");
  igual(r.cambiosTurno[0].motivo, "ya-es-su-franja", "motivo");
});
prueba("datos dañados (franja o fecha inválidas) se ignoran sin romper el reparto", () => {
  const r = M.generarCalendario(
    conCambios([
      { medico: "A", fecha: "2026-11-10", turno: "NOCHE" },
      { medico: "A", fecha: "2026-11-31", turno: "TARDE" },
      { medico: "A", fecha: "10/11/2026", turno: "TARDE" },
      null,
    ]),
    2026,
    11
  );
  igual(r.dias, nov.dias, "calendario");
  igual(r.cambiosTurno, [], "cambios del mes");
});
prueba("dos cambios para el mismo médico y día: vale el último", () => {
  // Con D, E y F ausentes, si valiera el primero (TARDE), A cubriría la tarde.
  const ausentes = ["D", "E", "F"].map((medico) => ({ medico, inicio: "2026-11-10", fin: "2026-11-10" }));
  const r = M.generarCalendario(
    conCambios(
      [
        { medico: "A", fecha: "2026-11-10", turno: "TARDE" },
        { medico: "A", fecha: "2026-11-10", turno: "MAÑANA" },
      ],
      { ausencias: ausentes }
    ),
    2026,
    11
  );
  cierto(!enTarde(diaDe(r, "2026-11-10"), "A"), "A cubre la tarde: ha valido el primer cambio");
  igual(r.cambiosTurno.map((c) => c.turno), ["MAÑANA"], "un solo cambio efectivo, el último");
});
prueba("el resultado solo informa de los cambios del mes generado", () => {
  const r = M.generarCalendario(
    conCambios([
      { medico: "A", fecha: "2026-10-30", turno: "TARDE" },
      { medico: "A", fecha: "2026-11-10", turno: "TARDE" },
      { medico: "A", fecha: "2026-12-01", turno: "TARDE" },
    ]),
    2026,
    11
  );
  igual(r.cambiosTurno.map((c) => c.fecha), ["2026-11-10"], "fechas");
});
prueba("si los cambios vacían una franja, se ve como puesto sin cubrir (no se inventa nadie)", () => {
  const r = M.generarCalendario(conCambios(["D", "E", "F"].map((medico) => ({ medico, fecha: "2026-11-10", turno: "MAÑANA" }))), 2026, 11);
  const d = diaDe(r, "2026-11-10");
  igual([d.avisos_tarde, d.urgencias_tarde], [M.SIN_ASIGNAR, M.SIN_ASIGNAR], "tarde del 10/11");
  igual(r.totales.descubiertos, 2, "descubiertos");
});
prueba("un MIXTO sin plan con cambio todos los días laborables no salta como «sin plan»", () => {
  const laborables = filas(nov).map((d) => ({ medico: "X", fecha: d.fecha, turno: "MAÑANA" }));
  const cfg = cfgBase({ medicos: [...cfgBase().medicos, { nombre: "X", turno: "MIXTO", activo: true }], cambiosTurno: laborables });
  igual(M.generarCalendario(cfg, 2026, 11).mixtosSinPlan, [], "mixtos sin plan");
});
prueba("generar con cambios no modifica la configuración recibida", () => {
  const cfg = conCambios([{ medico: "A", fecha: "2026-11-10", turno: "TARDE" }]);
  const antes = JSON.stringify(cfg);
  M.generarCalendario(cfg, 2026, 11);
  M.agruparCambiosTurno(cfg);
  igual(JSON.stringify(cfg), antes, "configuración");
});
prueba("tramos: se unen los días seguidos saltando fines de semana y festivos", () => {
  const cfg = cfgBase({ festivos: ["2026-11-09"] });
  const fechas = ["2026-11-05", "2026-11-06", "2026-11-10", "2026-11-11", "2026-11-13"];
  const tramos = M.agruparCambiosTurno(cfg, [
    ...fechas.map((fecha) => ({ medico: "A", fecha, turno: "TARDE" })),
    { medico: "A", fecha: "2026-11-16", turno: "MAÑANA" },
    { medico: "B", fecha: "2026-11-06", turno: "TARDE" },
  ]);
  igual(
    tramos.map((t) => [t.medico, t.desde, t.hasta, t.turno, t.fechas.length]),
    [
      ["A", "2026-11-05", "2026-11-11", "TARDE", 4],
      ["B", "2026-11-06", "2026-11-06", "TARDE", 1],
      ["A", "2026-11-13", "2026-11-13", "TARDE", 1],
      ["A", "2026-11-16", "2026-11-16", "MAÑANA", 1],
    ],
    "tramos"
  );
});
prueba("fechasEntre: rango incluido, un solo día, al revés, inválido o de más de un año", () => {
  igual(M.fechasEntre("2026-12-30", "2027-01-02"), ["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], "cruce de año");
  igual(M.fechasEntre("2026-11-10"), ["2026-11-10"], "un día");
  igual(M.fechasEntre("2026-11-10", "2026-11-09"), null, "al revés");
  igual(M.fechasEntre("2026-02-30", "2026-03-02"), null, "30 de febrero");
  igual(M.fechasEntre("2026-01-01", "2027-01-02"), null, "más de un año");
  igual(M.fechasEntre("2028-01-01", "2028-12-31").length, 366, "año bisiesto completo");
});
prueba("las copias antiguas cargan sin cambios y las nuevas los conservan", () => {
  igual(M.normalizarEstado({ medicos: [] }).cambiosTurno, [], "copia antigua");
  const c = [{ medico: "A", fecha: "2026-11-10", turno: "TARDE" }];
  igual(M.normalizarEstado(JSON.parse(JSON.stringify({ medicos: [], cambiosTurno: c }))).cambiosTurno, c, "ida y vuelta");
});

console.log("\nCompensación histórica");
const conHistorico = (meses, extra = {}) =>
  cfgBase({ historico: { meses, factorCompensacion: 0.5, ventanaHistorico: 6, ...extra } });
const mesCon = (difA) => ({ A: { asignadas: 10, objetivo: 10 - difA, diferencia: difA } });
prueba("quien hizo de más recibe menos objetivo, y al revés", () => {
  const mas = M.generarCalendario(conHistorico({ "2026-10": mesCon(3) }), 2026, 11);
  const menos = M.generarCalendario(conHistorico({ "2026-10": mesCon(-3) }), 2026, 11);
  cierto(mas.resumen.objetivos.A < nov.resumen.objetivos.A, "con saldo positivo no baja");
  cierto(menos.resumen.objetivos.A > nov.resumen.objetivos.A, "con saldo negativo no sube");
});
prueba("el ajuste no pasa del 30 % del objetivo base", () => {
  const r = M.generarCalendario(conHistorico({ "2026-10": mesCon(100) }, { factorCompensacion: 1 }), 2026, 11);
  cierto(r.resumen.objetivos.A >= nov.resumen.objetivos.A * 0.7 * 0.95, "ajuste mayor del 30 %");
});
prueba("FALLO CORREGIDO: factor 0 % = sin compensación (antes se convertía en 50 %)", () => {
  const r = M.generarCalendario(conHistorico({ "2026-10": mesCon(3) }, { factorCompensacion: 0 }), 2026, 11);
  igual(r.resumen.objetivos, nov.resumen.objetivos, "objetivos");
  igual(M.normalizarEstado({ historico: { factorCompensacion: 0 } }).historico.factorCompensacion, 0, "factor normalizado");
});
prueba("FALLO CORREGIDO: regenerar un mes ya guardado no se compensa contra sí mismo", () => {
  const r = M.generarCalendario(conHistorico({ "2026-11": mesCon(3) }), 2026, 11);
  igual(r.resumen.objetivos, nov.resumen.objetivos, "objetivos");
  igual(r.compensacion.meses, [], "meses que cuentan");
});
prueba("FALLO CORREGIDO: la ventana cuenta los N meses anteriores al mes generado", () => {
  const meses = { "2026-04": mesCon(1), "2026-05": mesCon(1), "2026-10": mesCon(1), "2026-12": mesCon(1) };
  const historico = M.normalizarEstado({ historico: { meses, ventanaHistorico: 6 } }).historico;
  igual(M.mesesQueCuentan(historico, 2026, 11), ["2026-05", "2026-10"], "ventana de noviembre");
  igual(M.saldosParaMes(historico, 2026, 11), { A: 2 }, "saldo de noviembre");
  igual(M.mesesQueCuentan(historico, 2027, 1), ["2026-10", "2026-12"], "ventana que cruza de año");
});
prueba("saldo vigente = el que se aplicaría al mes siguiente al último guardado", () => {
  const historico = M.normalizarEstado({ historico: { meses: { "2026-09": mesCon(1), "2026-10": mesCon(2) } } }).historico;
  igual(M.saldoVigente(historico), { A: 3 }, "saldo vigente");
  igual(M.saldoVigente(M.normalizarEstado({}).historico), {}, "sin histórico");
});
prueba("lo que se guarda en el histórico es asignadas − objetivo", () => {
  const d = M.diferenciasDelMes(nov);
  Object.keys(d).forEach((n) => cerca(d[n].diferencia, d[n].asignadas - d[n].objetivo, 1e-9, n));
});

console.log("\nFechas");
prueba("FALLO CORREGIDO: el calendario no depende de la zona horaria del equipo", () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  const r = M.generarCalendario(cfgBase(), 2026, 11);
  process.env.TZ = original;
  igual(r.dias, nov.dias, "calendario en otra zona horaria");
});

console.log("\nImportación rápida de médicos");
const imp = (t) => M.parsearImportacionMedicos(t);
prueba("Nombre ⇥ Turno", () => igual(imp("GARCIA\tMAÑANA").filas[0], { linea: 1, nombre: "GARCIA", turno: "MAÑANA", jornada: null }, "fila"));
prueba("FALLO CORREGIDO: Nombre ⇥ Turno ⇥ Jornada (el ejemplo de la propia página)", () =>
  igual(imp("GARCIA\tMAÑANA\t100").filas[0], { linea: 1, nombre: "GARCIA", turno: "MAÑANA", jornada: 100 }, "fila"));
prueba("Nombre ⇥ Categoría ⇥ Turno", () =>
  igual(imp("GARCIA\tMedicina de Familia\tTARDE").filas[0], { linea: 1, nombre: "GARCIA", turno: "TARDE", jornada: null }, "fila"));
prueba("Nombre ⇥ Categoría ⇥ Turno ⇥ Jornada", () =>
  igual(imp("GARCIA\tMF\tMIXTO\t80%").filas[0], { linea: 1, nombre: "GARCIA", turno: "MIXTO", jornada: 80 }, "fila"));
prueba("acepta punto y coma, minúsculas, sin tilde y plurales", () => {
  const r = imp("ruiz;mañana\nsanz;MANANAS\npaz;tardes");
  igual(r.filas.map((f) => f.turno), ["MAÑANA", "MAÑANA", "TARDE"], "turnos");
  igual(r.filas[0].nombre, "RUIZ", "nombre en mayúsculas");
});
prueba("ignora una fila de títulos y una tabulación final de Excel", () => {
  const r = imp("Nombre\tTurno\nGARCIA\tTARDE\t\n");
  igual(r.filas.length, 1, "filas");
  igual(r.errores, [], "errores");
});
prueba("informa de turno y jornada no válidos con su número de línea", () => {
  const r = imp("A\tNOCHE\nB\tMAÑANA\t150\nC");
  igual(r.errores.map((e) => e.linea), [1, 2, 3], "líneas con error");
});

console.log("\nFicheros y compatibilidad");
prueba("detecta configuración, histórico y copia completa", () => {
  igual(M.detectarFichero({ medicos: [], festivos: [] }), { configuracion: true, historico: false }, "configuración (v1.5)");
  igual(M.detectarFichero({ version: "1.0", historico: { meses: {} } }), { configuracion: false, historico: true }, "histórico");
  igual(M.detectarFichero({ medicos: [], historico: { meses: {} } }), { configuracion: true, historico: true }, "copia completa");
  igual(M.detectarFichero({ foo: 1 }), { configuracion: false, historico: false }, "otra cosa");
});
prueba("datos de la v1 o parciales se completan sin tocar los existentes", () => {
  const e = M.normalizarEstado({ medicos: [{ nombre: "A", turno: "MAÑANA", activo: true }], historico: { meses: { "2026-01": {} } } });
  igual(e.medicos.length, 1, "médicos");
  igual(e.planificacionesTurnos, [], "planificaciones");
  igual(e.historico.factorCompensacion, 0.5, "factor por defecto");
  igual(e.historico.ventanaHistorico, 6, "ventana por defecto");
  igual(e.configuracionAlgoritmo.semilla, null, "semilla");
  igual(M.normalizarEstado({ historico: { factorCompensacion: null } }).historico.factorCompensacion, 0.5, "factor null");
});
prueba("generar no modifica la configuración recibida", () => {
  const cfg = cfgBase({ festivos: ["2026-11-02"] });
  const antes = JSON.stringify(cfg);
  M.generarCalendario(cfg, 2026, 11);
  igual(JSON.stringify(cfg), antes, "configuración");
});
prueba("equidad: se mide contra el objetivo, no en guardias brutas", () => {
  // Equipo de 12: con 3 por franja, el tope de 2 guardias semanales obliga a repartir a partes iguales.
  const r = M.generarCalendario(
    cfgBase({
      medicos: "ABCDEFGHIJKL".split("").map((n, i) => ({ nombre: n, turno: i < 6 ? "MAÑANA" : "TARDE", activo: true })),
      reducciones: [{ medico: "A", porcentaje: 50, diasExcluidos: "" }],
    }),
    2026,
    11
  );
  const eq = M.evaluarEquidad(r);
  cierto(eq.rango > 2, "el rango bruto supera 2 por la jornada reducida");
  cierto(eq.correcta, `marca desequilibrio (peor: ${JSON.stringify(eq.peor)})`);
});

console.log("\nReparto óptimo, recálculo y edición (v2.3)");
const V22 = require(join(raiz, "scripts/baselines/guardias-motor-v22.cjs"));
const aleatorio = (semilla) => {
  let s = semilla;
  return () => {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
// Configuraciones aleatorias reproducibles, con todo lo que admite la v2.2.
const casoAleatorio = (semilla) => {
  const r = aleatorio(semilla);
  const ent = (a, b) => a + Math.floor(r() * (b - a + 1));
  const elige = (xs) => xs[Math.floor(r() * xs.length)];
  const anio = ent(2025, 2027);
  const mes = ent(1, 12);
  const ult = M.diasDelMes(anio, mes);
  const iso = (d) => M.aISO(M.fechaUTC(anio, mes, d));
  const franja = () => elige(["MAÑANA", "TARDE"]);
  const medicos = Array.from({ length: ent(4, 18) }, (_, i) => ({ nombre: `MED${i}`, turno: elige(["MAÑANA", "TARDE", "MIXTO", "MIXTO"]), activo: r() > 0.1 }));
  const nombres = medicos.map((m) => m.nombre);
  const dias = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"];
  const historico = { meses: {}, factorCompensacion: elige([0, 0.25, 0.5, 1]), ventanaHistorico: ent(1, 6) };
  for (let k = 1; k <= historico.ventanaHistorico; k++) {
    if (r() < 0.5) continue;
    const m = M.desplazarMes(anio, mes, -k);
    historico.meses[M.claveMes(m.anio, m.mes)] = Object.fromEntries(nombres.filter(() => r() < 0.8).map((n) => [n, { diferencia: Math.round((r() * 6 - 3) * 100) / 100 }]));
  }
  return {
    anio,
    mes,
    cfg: M.normalizarEstado({
      medicos,
      reducciones: nombres.filter(() => r() < 0.3).map((n) => ({ medico: n, porcentaje: elige([50, 75, 87, 100]), diasExcluidos: r() < 0.4 ? elige(dias) : "" })),
      festivos: Array.from({ length: ent(0, 3) }, () => iso(ent(1, ult))),
      ausencias: Array.from({ length: ent(0, 6) }, () => {
        const a = ent(1, ult);
        return { medico: elige(nombres), inicio: iso(a), fin: iso(Math.min(ult, a + ent(0, 10))) };
      }),
      exclusionesPuntuales: Array.from({ length: ent(0, 5) }, () => ({ medico: elige(nombres), fecha: iso(ent(1, ult)) })),
      planificacionesTurnos: medicos.filter((m) => m.turno === "MIXTO" && r() < 0.7).map((m) => ({ medico: m.nombre, L: franja(), M: franja(), X: franja(), J: franja(), V: franja() })),
      cambiosTurno: Array.from({ length: ent(0, 6) }, () => ({ medico: elige(nombres), fecha: iso(ent(1, ult)), turno: franja() })),
      historico,
      configuracionAlgoritmo: { usarAleatoriedad: r() < 0.3, semilla: ent(1, 99999) },
    }),
  };
};

const N_ALEATORIOS = 400;
prueba(`en ${N_ALEATORIOS} configuraciones aleatorias: mismos objetivos y nunca peor que el motor v2.2`, () => {
  let mejores = 0;
  for (let i = 1; i <= N_ALEATORIOS; i++) {
    const { anio, mes, cfg } = casoAleatorio(i * 7919);
    const viejo = V22.generarCalendario(cfg, anio, mes);
    const nuevo = M.generarCalendario(cfg, anio, mes);
    igual(nuevo.resumen.objetivos, viejo.resumen.objetivos, `objetivos del caso ${i}`);
    const cv = calidad(viejo.dias, viejo.resumen.objetivos, viejo.resumen.asignaciones);
    const cn = calidad(nuevo.dias, nuevo.resumen.objetivos, nuevo.resumen.asignaciones);
    cierto(noPeor(cn, cv), `caso ${i} (${mes}/${anio}) peor: ${JSON.stringify(cn)} frente a ${JSON.stringify(cv)}`);
    if (cn.cuadrados < cv.cuadrados - 1e-9 || cn.exceso < cv.exceso) mejores++;
  }
  cierto(mejores > N_ALEATORIOS / 2, `solo mejora en ${mejores} de ${N_ALEATORIOS}`);
});
prueba("un calendario generado no tiene más incidencias que el tope semanal inevitable", () => {
  for (let i = 1; i <= 150; i++) {
    const { anio, mes, cfg } = casoAleatorio(i * 104729);
    const r = M.generarCalendario(cfg, anio, mes);
    const otras = r.incidencias.filter((x) => x.tipo !== "tope-semanal");
    igual(otras, [], `incidencias del caso ${i}`);
  }
});
prueba("evaluar un calendario generado devuelve exactamente lo mismo", () => {
  for (let i = 1; i <= 60; i++) {
    const { anio, mes, cfg } = casoAleatorio(i * 31337);
    const r = M.generarCalendario(cfg, anio, mes);
    igual(M.evaluarCalendario(cfg, anio, mes, r.dias), r, `caso ${i}`);
  }
});

// Diciembre de 2026 del caso real que motivó la v2.3, con nombres sustituidos por letras.
const casoReal = M.normalizarEstado({
  medicos: [
    ["A", "MAÑANA"], ["B", "MIXTO"], ["C", "MAÑANA"], ["D", "MIXTO"], ["E", "MAÑANA"],
    ["F", "MAÑANA"], ["G", "MIXTO"], ["H", "MIXTO"], ["I", "MIXTO"], ["J", "MIXTO"],
  ].map(([nombre, turno]) => ({ nombre, turno, activo: true })),
  reducciones: [{ medico: "J", porcentaje: 87, diasExcluidos: "" }],
  festivos: ["2026-12-07", "2026-12-08", "2026-12-24", "2026-12-25", "2026-12-31"],
  ausencias: [
    ["A", "2026-12-09", "2026-12-11"], ["A", "2026-12-17", "2026-12-18"], ["C", "2026-12-01", "2026-12-02"], ["C", "2026-12-09", "2026-12-09"],
    ["C", "2026-12-23", "2026-12-30"], ["E", "2026-12-01", "2026-12-11"], ["F", "2026-12-02", "2026-12-03"], ["F", "2026-12-23", "2026-12-30"],
    ["G", "2026-12-04", "2026-12-09"], ["D", "2026-12-28", "2026-12-30"], ["I", "2026-12-28", "2026-12-30"], ["J", "2026-12-28", "2026-12-30"],
  ].map(([medico, inicio, fin]) => ({ medico, inicio, fin })),
  planificacionesTurnos: [
    ["B", "MAÑANA", "MAÑANA", "TARDE", "TARDE", "MAÑANA"], ["G", "TARDE", "MAÑANA", "TARDE", "TARDE", "MAÑANA"],
    ["H", "MAÑANA", "TARDE", "MAÑANA", "MAÑANA", "TARDE"], ["I", "TARDE", "TARDE", "MAÑANA", "MAÑANA", "TARDE"],
    ["J", "MAÑANA", "MAÑANA", "TARDE", "MAÑANA", "TARDE"], ["D", "TARDE", "TARDE", "MAÑANA", "MAÑANA", "TARDE"],
  ].map(([medico, L, Ma, X, J, V]) => ({ medico, L, M: Ma, X, J, V })),
});
const real = M.generarCalendario(casoReal, 2026, 12);
const equipo12 = cfgBase({ medicos: "ABCDEFGHIJKL".split("").map((n, i) => ({ nombre: n, turno: i < 6 ? "MAÑANA" : "TARDE", activo: true })) });
prueba("caso real: el motor v2.2 dejaba a C en 3 con objetivo 5,6 (desviación 2,6)", () => {
  const v = V22.generarCalendario(casoReal, 2026, 12);
  igual(v.resumen.asignaciones.C, 3, "C con el motor anterior");
  cerca(M.evaluarEquidad(v).peor.desviacion, -2.58, 0.01, "peor desviación anterior");
});
prueba("caso real: con el óptimo todos quedan a menos de 0,6 de su objetivo y nadie hace 3 en una semana", () => {
  const eq = M.evaluarEquidad(real);
  cierto(Math.abs(eq.peor.desviacion) <= 0.61, `peor ${JSON.stringify(eq.peor)}`);
  igual([eq.minimo, eq.maximo], [5, 9], "de 5 a 9 guardias");
  igual(real.totales.descubiertos, 2, "las 2 tardes sin nadie disponible siguen sin cubrir");
  igual(real.incidencias, [], "incidencias");
});
prueba("caso real: los puestos sin cubrir son tardes con un solo médico disponible", () => {
  const vacios = real.dias.filter((d) => d.esLaborable && nombresDelDia(d).includes(M.SIN_ASIGNAR)).map((d) => d.fecha);
  igual(vacios, ["2026-12-28", "2026-12-29"], "fechas");
  vacios.forEach((f) => cierto(real.dias.find((d) => d.fecha === f).urgencias_tarde === M.SIN_ASIGNAR, "queda vacía la urgencia, no el aviso"));
});

prueba("una edición a mano se recalcula en cascada y se marca la incidencia", () => {
  const dias = JSON.parse(JSON.stringify(real.dias));
  const dia = dias.find((d) => d.fecha === "2026-12-14");
  const quitado = dia.avisos_manana;
  dia.avisos_manana = "E"; // E es de mañana y está disponible el 14
  const ev = M.evaluarCalendario(casoReal, 2026, 12, dias);
  igual(ev.resumen.asignaciones.E, real.resumen.asignaciones.E + 1, "E suma una");
  igual(ev.resumen.asignaciones[quitado], real.resumen.asignaciones[quitado] - 1, "el sustituido resta una");
  igual(ev.resumen.objetivos, real.resumen.objetivos, "los objetivos no dependen del calendario");
  const fuera = JSON.parse(JSON.stringify(real.dias));
  fuera.find((d) => d.fecha === "2026-12-14").avisos_tarde = "A"; // A es de mañana
  fuera.find((d) => d.fecha === "2026-12-09").avisos_manana = "A"; // A está ausente el 9
  fuera.find((d) => d.fecha === "2026-12-15").urgencias_tarde = "ZETA"; // no existe
  const tipos = M.evaluarCalendario(casoReal, 2026, 12, fuera).incidencias.map((i) => `${i.fecha}:${i.medico}:${i.tipo}`);
  cierto(tipos.includes("2026-12-14:A:otra-franja"), `otra franja: ${tipos}`);
  cierto(tipos.includes("2026-12-09:A:ausencia"), `ausencia: ${tipos}`);
  cierto(tipos.includes("2026-12-15:ZETA:desconocido"), `desconocido: ${tipos}`);
});
prueba("se detectan dos puestos el mismo día y la 3.ª guardia de la semana", () => {
  const dias = JSON.parse(JSON.stringify(real.dias));
  const d14 = dias.find((d) => d.fecha === "2026-12-14");
  d14.urgencias_manana = d14.avisos_manana;
  const tipos = M.evaluarCalendario(casoReal, 2026, 12, dias).incidencias.map((i) => i.tipo);
  cierto(tipos.includes("doble"), `doble: ${tipos}`);
  const r = M.generarCalendario(equipo12, 2026, 11);
  igual(r.incidencias, [], "con 6 por franja el reparto respeta el tope");
  const semana = JSON.parse(JSON.stringify(r.dias));
  ["2026-11-02", "2026-11-03", "2026-11-04"].forEach((f) => {
    const d = semana.find((x) => x.fecha === f);
    M.PUESTOS.forEach((p) => d[p.clave] === "A" && (d[p.clave] = "B"));
    d.avisos_manana = "A";
  });
  const tope = M.evaluarCalendario(equipo12, 2026, 11, semana).incidencias.filter((i) => i.tipo === "tope-semanal" && i.medico === "A");
  igual(tope.map((x) => x.semana), ["2026-W45"], "solo la semana del 2/11");
  cierto(tope[0].guardias >= 3 && ["2026-11-02", "2026-11-03", "2026-11-04"].every((f) => tope[0].fechas.includes(f)), JSON.stringify(tope));
});
prueba("reajustar el resto respeta las celdas fijadas y sigue siendo lo mejor posible con ellas", () => {
  const fijas = [
    { fecha: "2026-12-01", puesto: "avisos_manana", medico: "B" },
    { fecha: "2026-12-02", puesto: "avisos_tarde", medico: "J" },
    { fecha: "2026-12-03", puesto: "urgencias_tarde", medico: M.SIN_ASIGNAR },
  ];
  const r = M.generarCalendario(casoReal, 2026, 12, { fijas });
  fijas.forEach((f) => igual(r.dias.find((d) => d.fecha === f.fecha)[f.puesto], f.medico, `fijada ${f.fecha}`));
  const eq = M.evaluarEquidad(r);
  cierto(Math.abs(eq.peor.desviacion) < 1.5, `sigue equilibrado: ${JSON.stringify(eq.peor)}`);
  igual(r.totales.cubiertos, real.totales.cubiertos - 1, "solo falta el puesto que se dejó vacío a propósito");
});
prueba("fijar todo el calendario devuelve el mismo calendario", () => {
  const fijas = real.dias.filter((d) => d.esLaborable).flatMap((d) => M.PUESTOS.map((p) => ({ fecha: d.fecha, puesto: p.clave, medico: d[p.clave] })));
  igual(M.generarCalendario(casoReal, 2026, 12, { fijas }).dias, real.dias, "calendario");
});
prueba("el tope semanal cuenta las guardias del mes anterior en la semana compartida", () => {
  // Del 30/11 (lunes) al 4/12 es la misma semana ISO: si A y B ya hicieron 2 el 30/11, no repiten esa semana.
  const cfg = equipo12;
  const previas = { A: { [M.claveSemana(M.desdeISO("2026-11-30"))]: 2 }, B: { [M.claveSemana(M.desdeISO("2026-11-30"))]: 2 } };
  const r = M.generarCalendario(cfg, 2026, 12, { semanasPrevias: previas });
  const primera = filas(r).filter((d) => d.fecha <= "2026-12-04").flatMap(nombresDelDia);
  cierto(!primera.includes("A") && !primera.includes("B"), `A o B repiten en la semana del 30/11: ${primera}`);
  cierto(!filas(M.generarCalendario(cfg, 2026, 12)).filter((d) => d.fecha <= "2026-12-04").every((d) => !nombresDelDia(d).includes("A")), "sin previas A sí entra");
});
prueba("las sugerencias pasan guardias de quien va por encima a quien va por debajo, sin crear incidencias", () => {
  const dias = JSON.parse(JSON.stringify(real.dias));
  // Se desequilibra a propósito: B hace las mañanas de C.
  dias.filter((d) => d.esLaborable && ["2026-12-15", "2026-12-21"].includes(d.fecha)).forEach((d) => {
    M.PUESTOS.forEach((p) => d[p.clave] === "C" && (d[p.clave] = "H"));
  });
  const ev = M.evaluarCalendario(casoReal, 2026, 12, dias);
  const sugerencias = M.sugerirReajustes(casoReal, ev);
  cierto(sugerencias.length > 0, "no sugiere nada");
  const s = sugerencias.find((x) => !x.cubre);
  cierto(s && ev.resumen.asignaciones[s.de] - ev.resumen.objetivos[s.de] > ev.resumen.asignaciones[s.a] - ev.resumen.objetivos[s.a] + 1, "va de más a menos");
  dias.find((d) => d.fecha === s.fecha)[s.puesto] = s.a;
  const tras = M.evaluarCalendario(casoReal, 2026, 12, dias);
  cierto(M.evaluarEquidad(tras).sumaCuadrados < M.evaluarEquidad(ev).sumaCuadrados, "la sugerencia mejora");
  igual(tras.incidencias.length, ev.incidencias.length, "no añade incidencias");
});
prueba("un hueco cubrible se sugiere cubrir el primero", () => {
  const dias = JSON.parse(JSON.stringify(real.dias));
  dias.find((d) => d.fecha === "2026-12-14").urgencias_tarde = M.SIN_ASIGNAR;
  const s = M.sugerirReajustes(casoReal, M.evaluarCalendario(casoReal, 2026, 12, dias));
  cierto(s[0] && s[0].cubre && s[0].fecha === "2026-12-14" && s[0].puesto === "urgencias_tarde", JSON.stringify(s[0]));
});
prueba("avisos y urgencias: cada médico queda a una de la paridad como mucho, salvo puestos únicos", () => {
  const r = M.generarCalendario(cfgBase(), 2026, 11);
  Object.keys(r.resumen.objetivos).forEach((n) => cierto(Math.abs(r.resumen.avisos[n] - r.resumen.urgencias[n]) <= 1, `${n}: ${r.resumen.avisos[n]}/${r.resumen.urgencias[n]}`));
});
prueba("rendimiento: 18 médicos en un mes largo tarda menos de 1 s", () => {
  const cfg = M.normalizarEstado({ medicos: Array.from({ length: 18 }, (_, i) => ({ nombre: `M${i}`, turno: ["MAÑANA", "TARDE", "MIXTO"][i % 3], activo: true })) });
  const t = Date.now();
  M.generarCalendario(cfg, 2026, 3);
  cierto(Date.now() - t < 1000, `${Date.now() - t} ms`);
});

console.log(`\n${pasan} pasan, ${fallos} fallan`);
process.exit(fallos ? 1 : 0);
