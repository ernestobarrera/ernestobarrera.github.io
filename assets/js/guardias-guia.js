/*
 * Ayuda del gestor de guardias (guardias.html): menú «❓ Ayuda» y dos recorridos.
 *
 *  - Guía rápida: de cero a un mes cerrado. Se lanza sola una vez por versión
 *    (CLAVE_VISTA), tenga o no datos el navegador: así quien ya la vio conoce
 *    las novedades. Desde el primer paso se puede saltar a «Novedades».
 *  - Novedades: solo lo nuevo de la versión, para quien ya usa la herramienta.
 *  - Configuración en detalle: una parada por pestaña, para quien ya ha visto la
 *    rápida o hereda una configuración y quiere entenderla.
 *
 * Sin dependencias externas: la página no carga ningún framework y debe
 * funcionar en redes que bloquean CDNs. No toca datos: cambia la sección y la
 * pestaña visibles (a través de window.GuardiasApp), bloquea los clics sobre la
 * página mientras está abierta y, al cerrar, devuelve la vista a donde estaba.
 */
(() => {
  "use strict";

  // Cambiar el sufijo en cada versión con novedades hace que la guía vuelva a salir a todos.
  const CLAVE_VISTA = "guardiasGuiaVista_v2.3";
  const MARGEN = 16;
  const HOLGURA = 6;

  const app = () => window.GuardiasApp;
  const $ = (id) => document.getElementById(id);
  const contenedorDe = (id) => () => [$(id)?.closest(".table-container")];
  const hayDatos = () => Boolean(app()?.resumen().medicos);
  const sinCalendario = () => $("areaResultado")?.hidden !== false;
  // En los pasos del resultado, si aún no hay calendario se avisa de dónde saldrá.
  const siNoHayCalendario = (texto) => () =>
    (sinCalendario() ? "<i>Aparecerá aquí cuando generes un mes.</i><br><br>" : "") + texto;

  const TEXTO_EDITAR =
    "Pulsa <b>cualquier guardia</b> para cambiarla. Solo se puede elegir entre los médicos de la lista: arriba salen " +
    "los disponibles, ordenados de quien más le falta para su objetivo a quien más le sobra, y <b>«equilibra»</b> " +
    "marca los cambios que acercan el reparto. También puedes intercambiar con otro puesto del mismo día." +
    "<br><br>Todo se recalcula al momento. <b>✎</b> marca lo cambiado a mano y <b>⚠</b> lo que incumple la " +
    "configuración. <b>↶ Deshacer</b> (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) quita el último cambio y <b>⟳ Reajustar el " +
    "resto</b> mantiene tus cambios y recoloca lo demás.";
  const TEXTO_RESUMEN =
    "<b>Días</b>: los que cada médico puede hacer guardia este mes (en su franja, sin ausencias). <b>Objetivo</b>: " +
    "las guardias que le tocan en proporción a esos días y a su jornada." +
    "<br><br>Por eso <b>es normal que unos hagan más guardias que otros</b>. Lo que dice si el reparto es justo es " +
    "<b>Dif.</b> (asignadas − objetivo): verde, amarillo o rojo." +
    "<br><br><b>Pulsa el nombre de un médico</b> para resaltar todas sus guardias en el calendario.";
  const TEXTO_ANALISIS =
    "Dice en una frase si el reparto está equilibrado y si es <b>el mejor posible</b> con esa configuración, " +
    "explica cada puesto sin cubrir y, si has cambiado guardias a mano, propone <b>retoques</b> que se aplican con un botón.";
  const TEXTO_COPIAR =
    "Los botones de copiar dejan el calendario <b>en el portapapeles, con formato</b>: no se ve nada al pulsar, pero " +
    "luego pegas con <kbd>Ctrl</kbd>+<kbd>V</kbd> en <b>Excel, en un chat de Teams o en un correo</b>." +
    "<br><br>«Calendario, resumen y análisis» incluye también la tabla de cada médico y la explicación.";

  const RUTAS = {
    rapida: [
      {
        titulo: "Guía rápida",
        seccion: "configuracion",
        pestana: "tabMedicos",
        texto:
          "Esta herramienta reparte cada mes los <b>cuatro puestos de cada día laborable</b> " +
          "(avisos y urgencias, de mañana y de tarde) de forma equitativa, y <b>compensa</b> a quien " +
          "haya hecho de más o de menos en meses anteriores." +
          "<br><br>Todo se guarda solo, <b>en este navegador</b>: no se envía nada a ningún servidor." +
          "<br><br>Puedes salir con <kbd>Esc</kbd> y volver a verla en <b>❓ Ayuda</b>.",
        extra: () => (hayDatos() ? { texto: "Solo novedades de la v2.3 ›", ruta: "novedades" } : null),
      },
      {
        titulo: () => (app().resumen().medicos ? "Ya hay datos en este navegador" : "¿Cómo empiezas?"),
        seccion: "configuracion",
        el: () => (app().resumen().medicos ? [$("zonaDatos")] : [$("bienvenida")]),
        texto: () => {
          const { medicos, meses } = app().resumen();
          if (medicos) {
            return (
              `Aquí ya hay <b>${medicos} médicos</b> y <b>${meses} ${meses === 1 ? "mes" : "meses"} de histórico</b>. ` +
              "Revisa que estén al día. Si alguien te pasa una copia más reciente, cárgala con <b>⬆ Importar</b>."
            );
          }
          return (
            "Elige según lo que tengas:" +
            "<ul><li><b>Tengo una copia</b>: impórtala y listo.</li>" +
            "<li><b>Los datos están en otro ordenador</b>: exporta allí la copia y tráela.</li>" +
            "<li><b>Empiezo de cero</b>: sigue esta guía.</li></ul>" +
            "Si no sabes si hay copia, pregunta a quien llevaba antes las guardias. Si no aparece, empezar de cero " +
            "también vale: la compensación arrancará desde el primer mes que guardes."
          );
        },
      },
      {
        titulo: "Da de alta a los médicos",
        el: "#altaMedico",
        seccion: "configuracion",
        pestana: "tabMedicos",
        texto:
          "Escribe el nombre, elige el turno y pulsa <b>Agregar médico</b>." +
          "<br><br>El <b>turno</b> decide a qué guardias puede ir: MAÑANA, TARDE o MIXTO (alterna según el día). " +
          "Turno y estado se pueden cambiar después en la propia lista.",
      },
      {
        titulo: "O pega la lista desde Excel",
        el: "#importacionRapida",
        seccion: "configuracion",
        pestana: "tabMedicos",
        texto:
          "Copia las columnas de la hoja de cálculo, pégalas aquí y pulsa <b>Procesar importación</b>." +
          "<br><br><b>Nombre</b> y <b>Turno</b> son obligatorias; <b>Categoría</b> y <b>Jornada %</b>, opcionales. " +
          "Si alguna fila falla, se queda en el cuadro con el motivo.",
      },
      {
        titulo: "Indica cuándo no puede trabajar cada uno",
        el: "#configuracion .tabs",
        seccion: "configuracion",
        texto:
          "<ul><li><b>Jornada y Exclusiones</b>: jornada reducida o días fijos sin guardia. Le baja el objetivo.</li>" +
          "<li><b>Ausencias</b>: vacaciones y bajas. También le bajan el objetivo.</li>" +
          "<li><b>Excl. Puntuales</b>: un día suelto. <b>No</b> le baja el objetivo.</li>" +
          "<li><b>Plan y cambios de turno</b>: qué días hace mañana y cuáles tarde cada MIXTO, y los cambios de " +
          "turno de cualquiera en fechas concretas.</li></ul>" +
          "En <b>❓ Ayuda → Configuración en detalle</b> hay una parada por pestaña.",
      },
      {
        titulo: "Añade los festivos",
        el: "#tabFestivos > .form-group, #tabFestivos > button",
        seccion: "configuracion",
        pestana: "tabFestivos",
        texto:
          "Los fines de semana se excluyen solos, pero los festivos <b>nacionales, autonómicos y locales</b> " +
          "hay que añadirlos. Si falta alguno, el calendario pondrá guardias ese día.",
      },
      {
        titulo: "Genera el mes",
        el: "#formularioMes",
        seccion: "calendario",
        texto:
          "Por defecto aparece el mes siguiente. Pulsa <b>Generar guardias</b>." +
          "<br><br>El reparto es <b>el mejor posible</b>: deja a cada médico lo más cerca que se puede de lo que le " +
          "toca, respetando franjas, ausencias y el tope de 2 guardias por semana. El calendario se guarda: si " +
          "cambias de mes y vuelves, sigue ahí.",
      },
      {
        titulo: "Revisa y cambia guardias",
        el: contenedorDe("tablaCalendario"),
        seccion: "calendario",
        texto: siNoHayCalendario(
          'Encima del calendario salen los avisos: una celda <span class="guia-descubierto">---</span> es un puesto ' +
            "<b>sin cubrir</b>.<br><br>" +
            TEXTO_EDITAR
        ),
      },
      {
        titulo: "Lee el resumen",
        el: contenedorDe("tablaResumen"),
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_RESUMEN),
      },
      {
        titulo: "Estadísticas y análisis",
        el: "#estadisticasDetalladas",
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_ANALISIS),
      },
      {
        titulo: "Cópialo a Excel, Teams o un correo",
        el: '[data-accion="copiar-calendario"], [data-accion="copiar-todo"]',
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_COPIAR),
      },
      {
        titulo: "Cierra el mes en el histórico",
        el: "#btnGuardarHistorico",
        seccion: "calendario",
        texto:
          'Cuando el calendario sea el definitivo, pulsa <span class="guia-boton">💾 Guardar en el histórico</span>.' +
          "<br><br>Así se recuerda quién hizo de más o de menos y se compensa en los meses siguientes. " +
          "Si cambias el calendario después, la página avisa y el botón pasa a <b>Actualizar en el histórico</b>.",
      },
      {
        titulo: "Haz copia de seguridad",
        el: "#zonaDatos",
        texto:
          "Aquí ves cuándo se guardó por última vez. Pero ese guardado <b>solo existe en este navegador</b>: " +
          "si se borran los datos de navegación o cambias de ordenador, se pierde." +
          "<br><br>Al cerrar cada mes, pulsa <b>⬇ Exportar copia</b>: es tu respaldo y el fichero que pasarás a " +
          "quien te sustituya. Si hay cambios sin exportar, aquí sale <b>⚠ Cambios sin exportar</b> y el botón se " +
          "resalta hasta que lo hagas.",
        extra: { texto: "Configuración en detalle ›", ruta: "configuracion" },
      },
    ],

    novedades: [
      {
        titulo: "Novedades de la v2.3",
        seccion: "calendario",
        texto:
          "<ul><li><b>Reparto óptimo</b>: antes se decidía día a día y podía dejar a alguien a más de dos guardias de " +
          "su objetivo aunque hubiera un reparto mejor. Ahora se calcula el mejor reparto posible del mes. " +
          "Los objetivos no cambian.</li>" +
          "<li><b>Calendario editable</b>, con todo recalculado al momento.</li>" +
          "<li><b>Resumen y análisis</b> más claros, y <b>copia</b> también para Teams y correo.</li></ul>" +
          "Te lo enseño en cinco pasos.",
      },
      {
        titulo: "Cambia guardias pulsando",
        el: contenedorDe("tablaCalendario"),
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_EDITAR),
      },
      {
        titulo: "Resumen: Días y resaltar",
        el: contenedorDe("tablaResumen"),
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_RESUMEN),
      },
      {
        titulo: "Análisis en claro",
        el: "#estadisticasDetalladas",
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_ANALISIS),
      },
      {
        titulo: "Copiar a Excel, Teams o correo",
        el: '[data-accion="copiar-calendario"], [data-accion="copiar-todo"]',
        seccion: "calendario",
        texto: siNoHayCalendario(TEXTO_COPIAR),
      },
      {
        titulo: "No olvides exportar",
        el: "#zonaDatos",
        texto:
          "Cuando cambies un calendario o guardes un mes en el histórico, arriba sale <b>⚠ Cambios sin exportar</b>. " +
          "Pulsa <b>⬇ Exportar copia</b> y sustituye el fichero compartido: el calendario, con tus cambios, va dentro." +
          "<br><br>La guía completa sigue en <b>❓ Ayuda</b>.",
      },
    ],

    configuracion: [
      {
        titulo: "La lista de médicos",
        el: contenedorDe("tablaMedicos"),
        seccion: "configuracion",
        pestana: "tabMedicos",
        texto:
          "<b>Turno</b> y <b>Activo</b> se cambian aquí mismo." +
          "<br><br>Un médico <b>inactivo</b> no recibe guardias ni cuenta para el reparto, pero conserva su " +
          "configuración y su histórico: úsalo para quien falta una temporada. <b>Eliminar</b> borra también " +
          "su jornada, ausencias y planificación.",
      },
      {
        titulo: "Jornada y días excluidos",
        el: "#tabJornada .fila-campos, #tabJornada fieldset, #tabJornada > button",
        seccion: "configuracion",
        pestana: "tabJornada",
        texto:
          "Al elegir un médico se cargan sus datos." +
          "<ul><li><b>Jornada %</b>: su objetivo baja en proporción (al 50 %, la mitad que un compañero igual a jornada completa).</li>" +
          "<li><b>Días excluidos</b>: ese día de la semana nunca se le asigna, y también le baja el objetivo.</li></ul>",
      },
      {
        titulo: "Ausencias",
        el: "#tabAusencias .fila-campos, #tabAusencias > button",
        seccion: "configuracion",
        pestana: "tabAusencias",
        texto:
          "Vacaciones, bajas, formación… <b>Desde</b> y <b>hasta</b>, ambos incluidos." +
          "<br><br>Esos días no se le asigna y su objetivo baja, porque no está.",
      },
      {
        titulo: "Exclusiones puntuales",
        el: "#tabExclPunt .fila-campos, #tabExclPunt > button",
        seccion: "configuracion",
        pestana: "tabExclPunt",
        texto:
          "Un día suelto en que no puede (una cita, un curso)." +
          "<br><br>Ese día no se le asigna, pero su objetivo <b>no</b> baja: el sistema intentará darle esa " +
          "guardia otro día. Si va a faltar varios días, mejor como ausencia.",
      },
      {
        titulo: "Planificación de los MIXTO",
        el: "#tabPlanTurnos > .form-group, #tablaPlanTurno, #tabPlanTurnos > .botonera",
        seccion: "configuracion",
        pestana: "tabPlanTurnos",
        texto:
          "Para cada médico MIXTO, qué días hace mañana y cuáles tarde. Ese día solo puede ir a guardias de esa franja." +
          "<br><br>Sin planificación se usa lunes, miércoles y viernes de tarde y martes y jueves de mañana, y al " +
          "generar sale un aviso.",
      },
      {
        titulo: "Cambios de turno en fechas concretas",
        el: "#bloqueCambiosTurno .fila-campos, #vistaPreviaCambio, #bloqueCambiosTurno > .botonera",
        seccion: "configuracion",
        pestana: "tabPlanTurnos",
        texto:
          "Para <b>cualquier médico</b>, no solo los MIXTO: los días en que pasa consulta en la otra franja (un cambio " +
          "con un compañero, una semana de tarde…). Elige médico, desde, hasta y franja." +
          "<br><br>Antes de registrarlo, un recuadro explica qué va a pasar. Su objetivo del mes <b>no</b> cambia y, " +
          "si ese día tiene ausencia, manda la ausencia. En el calendario, <b>⇄</b> marca esas guardias.",
      },
      {
        titulo: "Compensación histórica",
        el: "#bloqueCompensacion",
        seccion: "configuracion",
        pestana: "tabParametros",
        texto:
          "<ul><li><b>Factor</b>: qué parte del saldo de cada médico se corrige el mes siguiente. 50 % por defecto; " +
          "0 % la desactiva. El ajuste nunca pasa del 30 % de su objetivo.</li>" +
          "<li><b>Ventana</b>: cuántos meses anteriores al que se genera cuentan (6 por defecto). Los más antiguos " +
          "se conservan, pero dejan de contar.</li></ul>",
      },
      {
        titulo: "Desempate",
        el: "#bloqueDesempate",
        seccion: "configuracion",
        pestana: "tabParametros",
        texto:
          "Si dos médicos empatan, por defecto gana el primero de la lista. El <b>desempate aleatorio</b> reparte " +
          "esa suerte sin tocar la equidad; con una <b>semilla</b> fija, el mismo mes sale siempre igual.",
      },
      {
        titulo: "Histórico y saldos",
        el: "#panelHistorico",
        seccion: "configuracion",
        pestana: "tabParametros",
        texto:
          "Qué meses hay guardados y cuáles cuentan para el mes elegido en Calendario. Debajo, el <b>saldo</b> de " +
          "cada médico: positivo si hizo de más." +
          "<br><br>En <b>Ver detalle por meses</b> se puede borrar un mes guardado por error. Si un nombre del " +
          "histórico no coincide con la lista, se avisa aquí.",
      },
    ],
  };

  const ESTILOS = `
    /* Espacio al final mientras dura la guía: así cualquier zona puede subir arriba y dejar sitio a la caja. */
    html.guia-activa body { padding-bottom: 70vh; }
    .guia-capa { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 10000; }
    .guia-foco {
      position: fixed; z-index: 10001; pointer-events: none; border-radius: 8px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.6);
      outline: 2px solid #4a6fa5; outline-offset: 2px;
      transition: top 0.2s, left 0.2s, width 0.2s, height 0.2s;
    }
    .guia-foco.guia-sin-objetivo { outline: none; }
    .guia-caja {
      position: fixed; z-index: 10002; width: min(380px, calc(100vw - 32px));
      max-height: calc(100vh - 32px); overflow-y: auto;
      background: #fff; color: #334155; border: 1px solid #cbd5e1; border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25); padding: 14px 16px 12px;
      font-size: 0.88rem; line-height: 1.45;
    }
    .guia-progreso { height: 3px; background: #e2e8f0; border-radius: 2px; margin-bottom: 10px; overflow: hidden; }
    .guia-progreso span { display: block; height: 100%; background: #4a6fa5; transition: width 0.2s; }
    .guia-paso { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
    .guia-caja h3 { margin: 2px 0 8px; font-size: 1rem; color: #1e293b; }
    .guia-caja ul { margin: 6px 0 6px 18px; }
    .guia-caja li { margin-bottom: 4px; }
    .guia-botones { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .guia-botones .guia-saltar {
      margin-right: auto; background: transparent; color: #64748b; border: none;
      padding: 6px 2px; text-decoration: underline;
    }
    .guia-botones .guia-saltar:hover { background: transparent; color: #334155; }
    .guia-descubierto {
      background: #fee2e2; color: #b91c1c; font-weight: 800; border: 2px dashed #ef4444;
      padding: 0 6px; border-radius: 3px;
    }
    .guia-boton {
      display: inline-block; background: #28a745; color: #fff; padding: 1px 8px;
      border-radius: 4px; font-weight: 600; white-space: nowrap;
    }
    @media (prefers-reduced-motion: reduce) {
      .guia-foco, .guia-progreso span { transition: none; }
    }
  `;

  let pasos = [];
  let capa = null;
  let foco = null;
  let caja = null;
  let indice = 0;
  let vistaInicial = null;
  let focoPrevio = null;
  let marcoPendiente = false;

  const leer = (clave) => {
    try {
      return localStorage.getItem(clave);
    } catch (e) {
      return null;
    }
  };

  const escribir = (clave, valor) => {
    try {
      localStorage.setItem(clave, valor);
    } catch (e) {
      /* Sin almacenamiento la guía volverá a salir: no es un error. */
    }
  };

  const valor = (v) => (typeof v === "function" ? v() : v);
  const movimientoReducido = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // --- Geometría -------------------------------------------------------------

  const nodosVisibles = (paso) => {
    if (!paso.el) return [];
    const nodos = typeof paso.el === "function" ? paso.el() : document.querySelectorAll(paso.el);
    return Array.from(nodos).filter((n) => n && n.getClientRects().length > 0);
  };

  const rectUnion = (nodos) => {
    if (nodos.length === 0) return null;
    const r = { top: Infinity, left: Infinity, right: -Infinity, bottom: -Infinity };
    nodos.forEach((n) => {
      const b = n.getBoundingClientRect();
      r.top = Math.min(r.top, b.top);
      r.left = Math.min(r.left, b.left);
      r.right = Math.max(r.right, b.right);
      r.bottom = Math.max(r.bottom, b.bottom);
    });
    return r;
  };

  /**
   * Desplaza la página para que se vean la zona resaltada y la caja. Si caben
   * las dos, sube la zona arriba del todo y deja la caja debajo; si no caben
   * (zona muy alta en un móvil), al menos enseña el principio de la zona.
   */
  const llevarAVista = (rect) => {
    const alto = window.innerHeight;
    const necesario = caja.offsetHeight + 12 + MARGEN;
    const visible = rect.top >= MARGEN && rect.bottom <= alto - MARGEN;
    const hayHueco = alto - rect.bottom - HOLGURA >= necesario || rect.top - HOLGURA >= necesario;
    if (visible && hayHueco) return;
    const caben = rect.bottom - rect.top + HOLGURA * 2 + necesario + MARGEN <= alto;
    const destino = window.scrollY + rect.top - (caben ? MARGEN + HOLGURA : 80);
    window.scrollTo({ top: Math.max(0, destino), behavior: movimientoReducido() ? "auto" : "smooth" });
  };

  const colocar = () => {
    marcoPendiente = false;
    if (!caja) return;
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    const rect = rectUnion(nodosVisibles(pasos[indice]));
    const anchoCaja = caja.offsetWidth;
    const altoCaja = caja.offsetHeight;

    if (!rect) {
      foco.classList.add("guia-sin-objetivo");
      Object.assign(foco.style, { top: `${alto / 2}px`, left: `${ancho / 2}px`, width: "0px", height: "0px" });
      caja.style.left = `${Math.max(MARGEN, (ancho - anchoCaja) / 2)}px`;
      caja.style.top = `${Math.max(MARGEN, (alto - altoCaja) / 2)}px`;
      return;
    }

    foco.classList.remove("guia-sin-objetivo");
    Object.assign(foco.style, {
      top: `${rect.top - HOLGURA}px`,
      left: `${rect.left - HOLGURA}px`,
      width: `${rect.right - rect.left + HOLGURA * 2}px`,
      height: `${rect.bottom - rect.top + HOLGURA * 2}px`,
    });

    const abajo = alto - rect.bottom - HOLGURA;
    const arriba = rect.top - HOLGURA;
    let top;
    if (abajo >= altoCaja + 12 + MARGEN) top = rect.bottom + HOLGURA + 12;
    else if (arriba >= altoCaja + 12 + MARGEN) top = rect.top - HOLGURA - 12 - altoCaja;
    else top = alto - altoCaja - MARGEN;

    const left = Math.min(Math.max(MARGEN, rect.left), ancho - anchoCaja - MARGEN);
    caja.style.top = `${Math.max(MARGEN, top)}px`;
    caja.style.left = `${Math.max(MARGEN, left)}px`;
  };

  const pedirColocacion = () => {
    if (marcoPendiente) return;
    marcoPendiente = true;
    window.requestAnimationFrame(colocar);
  };

  // --- Recorrido -------------------------------------------------------------

  const insertarEstilos = () => {
    if ($("guia-estilos")) return;
    const style = document.createElement("style");
    style.id = "guia-estilos";
    style.textContent = ESTILOS;
    document.head.appendChild(style);
  };

  const crearNodos = () => {
    capa = document.createElement("div");
    capa.className = "guia-capa";
    capa.addEventListener("click", (e) => e.stopPropagation());

    foco = document.createElement("div");
    foco.className = "guia-foco";

    caja = document.createElement("div");
    caja.className = "guia-caja";
    caja.setAttribute("role", "dialog");
    caja.setAttribute("aria-modal", "true");
    caja.setAttribute("aria-labelledby", "guiaTitulo");
    caja.innerHTML = `
      <div class="guia-progreso"><span></span></div>
      <div class="guia-paso" id="guiaPaso"></div>
      <div aria-live="polite">
        <h3 id="guiaTitulo"></h3>
        <div id="guiaTexto"></div>
      </div>
      <div class="guia-botones">
        <button type="button" class="guia-saltar" data-guia-accion="salir">Saltar guía</button>
        <button type="button" class="secondary" data-guia-accion="anterior">‹ Anterior</button>
        <button type="button" class="secondary" data-guia-accion="extra" hidden></button>
        <button type="button" data-guia-accion="siguiente">Siguiente ›</button>
      </div>`;
    caja.addEventListener("click", (e) => {
      e.stopPropagation();
      const accion = e.target.closest("[data-guia-accion]")?.dataset.guiaAccion;
      if (accion === "salir") cerrar();
      else if (accion === "anterior") mostrarPaso(indice - 1);
      else if (accion === "siguiente") mostrarPaso(indice + 1);
      else if (accion === "extra") {
        const ruta = valor(pasos[indice].extra)?.ruta;
        cerrar({ restaurar: false });
        if (ruta) iniciar(ruta);
      }
    });

    document.body.append(capa, foco, caja);
  };

  const mostrarPaso = (nuevo) => {
    if (nuevo >= pasos.length) {
      cerrar();
      return;
    }
    indice = Math.max(0, nuevo);
    const paso = pasos[indice];
    if (paso.seccion) app().irASeccion(paso.seccion);
    if (paso.pestana) app().abrirPestana(paso.pestana);

    const ultimo = indice === pasos.length - 1;
    caja.querySelector(".guia-progreso span").style.width = `${((indice + 1) / pasos.length) * 100}%`;
    $("guiaPaso").textContent = `Paso ${indice + 1} de ${pasos.length}`;
    $("guiaTitulo").textContent = valor(paso.titulo);
    $("guiaTexto").innerHTML = valor(paso.texto);
    caja.querySelector('[data-guia-accion="anterior"]').hidden = indice === 0;
    caja.querySelector('[data-guia-accion="salir"]').hidden = ultimo;
    const extra = caja.querySelector('[data-guia-accion="extra"]');
    const datosExtra = valor(paso.extra);
    extra.hidden = !datosExtra;
    extra.textContent = datosExtra ? datosExtra.texto : "";
    const siguiente = caja.querySelector('[data-guia-accion="siguiente"]');
    siguiente.textContent = ultimo ? "Entendido" : indice === 0 ? "Empezar ›" : "Siguiente ›";

    const rect = rectUnion(nodosVisibles(paso));
    if (rect) llevarAVista(rect);
    colocar();
    // Las pestañas entran con una animación de 0,2 s: se recoloca cuando termina.
    window.setTimeout(pedirColocacion, 260);
    siguiente.focus({ preventScroll: true });
  };

  const alPulsarTecla = (e) => {
    if (!caja) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      mostrarPaso(indice + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      mostrarPaso(indice - 1);
    } else if (e.key === "Tab") {
      const botones = Array.from(caja.querySelectorAll("button")).filter((b) => !b.hidden);
      const actual = botones.indexOf(document.activeElement);
      const destino = e.shiftKey ? (actual - 1 + botones.length) % botones.length : (actual + 1) % botones.length;
      e.preventDefault();
      botones[destino].focus();
    } else if (e.altKey) {
      // Los atajos Alt+letra de la página cambiarían la vista por debajo de la guía.
      e.preventDefault();
    } else {
      return;
    }
    e.stopPropagation();
  };

  const iniciar = (ruta = "rapida") => {
    if (caja || !app() || !RUTAS[ruta]) return;
    cerrarMenu();
    insertarEstilos();
    pasos = RUTAS[ruta];
    if (!vistaInicial) vistaInicial = { seccion: app().seccionVisible(), pestana: app().pestanaActiva() };
    if (!focoPrevio) focoPrevio = document.activeElement;
    crearNodos();
    document.documentElement.classList.add("guia-activa");
    document.addEventListener("keydown", alPulsarTecla, true);
    window.addEventListener("resize", pedirColocacion);
    window.addEventListener("scroll", pedirColocacion, true);
    mostrarPaso(0);
  };

  const cerrar = ({ restaurar = true } = {}) => {
    if (!caja) return;
    escribir(CLAVE_VISTA, new Date().toISOString());
    document.removeEventListener("keydown", alPulsarTecla, true);
    window.removeEventListener("resize", pedirColocacion);
    window.removeEventListener("scroll", pedirColocacion, true);
    [capa, foco, caja].forEach((n) => n.remove());
    capa = foco = caja = null;
    document.documentElement.classList.remove("guia-activa");
    if (!restaurar) return;
    if (vistaInicial) {
      app().irASeccion(vistaInicial.seccion);
      app().abrirPestana(vistaInicial.pestana);
    }
    window.scrollTo({ top: 0 });
    const destino = focoPrevio && document.contains(focoPrevio) && focoPrevio !== document.body ? focoPrevio : $("btnGuia");
    destino?.focus({ preventScroll: true });
    vistaInicial = null;
    focoPrevio = null;
  };

  // --- Menú «❓ Ayuda» --------------------------------------------------------

  const menu = () => $("menuAyuda");

  const cerrarMenu = () => {
    if (!menu() || menu().hidden) return;
    menu().hidden = true;
    $("btnGuia").setAttribute("aria-expanded", "false");
  };

  const abrirMenu = () => {
    menu().hidden = false;
    $("btnGuia").setAttribute("aria-expanded", "true");
    menu().querySelector("button")?.focus();
  };

  const prepararMenu = () => {
    const boton = $("btnGuia");
    if (!boton || !menu()) return;
    document.querySelectorAll("[data-pasos]").forEach((n) => {
      const ruta = RUTAS[n.dataset.pasos];
      if (ruta) n.textContent = `${ruta.length} pasos`;
    });
    boton.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menu().hidden) abrirMenu();
      else cerrarMenu();
    });
    menu().addEventListener("click", (e) => {
      const opcion = e.target.closest("button");
      if (!opcion) return;
      if (opcion.dataset.guia) {
        e.stopPropagation();
        iniciar(opcion.dataset.guia);
      }
      cerrarMenu();
    });
    menu().addEventListener("keydown", (e) => {
      const opciones = Array.from(menu().querySelectorAll("button"));
      const actual = opciones.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const paso = e.key === "ArrowDown" ? 1 : -1;
        opciones[(actual + paso + opciones.length) % opciones.length].focus();
      } else if (e.key === "Escape") {
        cerrarMenu();
        boton.focus();
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".menu-ayuda")) cerrarMenu();
    });
  };

  const arrancar = () => {
    prepararMenu();
    // Una vez por versión, a todos: los nuevos aprenden a usarla y los de antes ven las novedades.
    if (app() && !leer(CLAVE_VISTA)) window.setTimeout(() => iniciar("rapida"), 500);
  };

  window.iniciarGuiaGuardias = iniciar;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
