/*
 * Guía rápida del gestor de guardias (guardias.html y guardias-v2.html).
 *
 * Tour de primera visita sin dependencias externas: la página presume de no
 * cargar ningún framework y debe seguir funcionando en redes que bloquean CDNs.
 *
 * No toca datos. Solo cambia la sección y la pestaña visibles, bloquea los clics
 * sobre la página mientras está abierta y, al cerrar, devuelve la vista a donde
 * estaba. Se lanza sola la primera vez solo si el navegador no tiene médicos
 * guardados (usuario nuevo); quien ya trabaja con la herramienta no la ve salvo
 * que pulse «Guía rápida».
 */
(() => {
  "use strict";

  const CLAVE_VISTA = "guardiasGuiaVista_v1";
  const CLAVE_DATOS = "sistemaGuardias_v16";
  const MARGEN = 16;
  const HOLGURA_FOCO = 6;

  const PASOS = [
    {
      titulo: "Guía rápida",
      seccion: "configuracion",
      pestana: "tabMedicos",
      texto:
        "Esta herramienta reparte cada mes los <b>cuatro puestos de cada día laborable</b> " +
        "(avisos y urgencias, de mañana y de tarde) de forma equitativa entre los médicos, y " +
        "<b>compensa</b> a quien haya hecho de más o de menos en meses anteriores." +
        "<br><br>Los datos se quedan <b>en este navegador</b>: no se envían a ningún servidor." +
        "<br><br>Puedes salir en cualquier momento con <kbd>Esc</kbd>.",
    },
    {
      titulo: "¿Te han pasado ficheros? Empieza aquí",
      el: ".nav-right > div",
      texto:
        "Si alguien ya usaba la herramienta y te ha enviado sus ficheros, impórtalos antes de nada:" +
        "<ul><li><b>Config → 📥 Importar</b>: médicos, festivos, ausencias…</li>" +
        "<li><b>Histórico → 📈 Importar</b>: los saldos de meses anteriores, necesarios para compensar.</li></ul>" +
        "Si empiezas de cero, pasa al siguiente paso.",
    },
    {
      titulo: "Da de alta a los médicos",
      el: "#tabMedicos > .form-group:nth-child(-n+3), #tabMedicos > button",
      seccion: "configuracion",
      pestana: "tabMedicos",
      texto:
        "Escribe el nombre, elige el turno y pulsa <b>Agregar Médico</b>." +
        "<br><br>El <b>turno</b> decide a qué guardias puede ir cada uno: MAÑANA, TARDE o MIXTO " +
        "(alterna mañana y tarde según el día de la semana).",
    },
    {
      titulo: "O pega la lista desde Excel",
      el: () => [document.getElementById("importacionMasiva")?.closest(".form-group")],
      seccion: "configuracion",
      pestana: "tabMedicos",
      texto:
        "Si tienes la plantilla en una hoja de cálculo, copia las columnas, pégalas aquí y pulsa " +
        "<b>Procesar Importación</b>. Columnas que acepta:" +
        "<ul><li><code>Nombre · Turno</code></li>" +
        "<li><code>Nombre · Categoría · Turno · Jornada%</code></li></ul>",
    },
    {
      titulo: "Indica cuándo no puede trabajar cada uno",
      el: "#configuracion .tabs",
      seccion: "configuracion",
      texto:
        "<ul><li><b>Jornada y Exclusiones</b>: jornada reducida o días fijos sin guardia. Le baja el objetivo.</li>" +
        "<li><b>Ausencias</b>: vacaciones y bajas. También le bajan el objetivo.</li>" +
        "<li><b>Excl. Puntuales</b>: un día suelto. <b>No</b> le baja el objetivo: el sistema intentará darle esa guardia otro día.</li>" +
        "<li><b>Plan. Turnos</b>: qué días hace mañana y cuáles tarde cada médico MIXTO.</li></ul>" +
        "<b>Parámetros Avanzados</b> puede quedarse como está.",
    },
    {
      titulo: "Añade los festivos",
      el: "#tabFestivos > .form-group, #tabFestivos > button",
      seccion: "configuracion",
      pestana: "tabFestivos",
      texto:
        "Los fines de semana se excluyen solos, pero los festivos <b>nacionales, autonómicos y locales</b> " +
        "hay que añadirlos aquí. Si falta alguno, el calendario pondrá guardias ese día.",
    },
    {
      titulo: "Guarda la configuración",
      el: 'nav button[onclick="guardarEnMemoria()"]',
      texto:
        "<b>Los cambios no se guardan solos.</b> Cuando termines, pulsa <b>Guardado</b> " +
        "(o <kbd>Alt</kbd>+<kbd>S</kbd>). Si cierras la pestaña sin hacerlo, perderás lo que hayas añadido.",
    },
    {
      titulo: "Genera el mes",
      el: "#calendario > .form-group, #calendario > button",
      seccion: "calendario",
      texto:
        "Elige <b>mes y año</b> (compruébalos bien) y pulsa <b>Generar Guardias</b>." +
        '<br><br>En el calendario, una celda <span class="guia-descubierto">---</span> es un puesto ' +
        "<b>sin cubrir</b>: ese día no quedaba nadie disponible en esa franja." +
        "<br><br>Si algo no cuadra, corrige festivos o ausencias y vuelve a generarlo: " +
        "no cuenta hasta que lo guardes en el histórico.",
    },
    {
      titulo: "Cierra el mes en el histórico",
      seccion: "calendario",
      texto:
        'Cuando el calendario sea el definitivo, pulsa <span class="guia-boton">💾 Guardar en Histórico</span> ' +
        "<b>una vez por mes</b>." +
        "<br><br>Así se recuerda quién hizo de más o de menos y se compensa el mes siguiente. " +
        "Si no lo guardas, el próximo reparto no tendrá en cuenta este mes.",
    },
    {
      titulo: "Haz copia de seguridad",
      el: ".nav-right > div",
      texto:
        "Si se borran los datos del navegador o cambias de ordenador, se pierde todo. " +
        "<b>Exporta</b> la configuración (📄) y el histórico (📊) al cerrar cada mes: " +
        "son también los ficheros que pasarías a otra persona." +
        "<br><br>Para repasar, tienes esta guía en <b>❓ Guía rápida</b> y el detalle en <b>Manual de uso</b>.",
    },
  ];

  const ESTILOS = `
    header { flex-wrap: wrap; gap: 8px; }
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
    .guia-caja code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; font-size: 0.8rem; }
    .guia-caja kbd {
      border: 1px solid #cbd5e1; border-bottom-width: 2px; border-radius: 3px;
      padding: 0 4px; font-size: 0.78rem; background: #f8fafc; font-family: inherit;
    }
    .guia-botones { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
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

  const hayDatosGuardados = () => {
    try {
      const datos = JSON.parse(leer(CLAVE_DATOS) || "null");
      return Boolean(datos && Array.isArray(datos.medicos) && datos.medicos.length > 0);
    } catch (e) {
      return false;
    }
  };

  const movimientoReducido = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- Navegación por la página, reutilizando sus propias funciones ---------

  const irASeccion = (id) => {
    if (typeof mostrarSeccion !== "function") return;
    const enlace = document.querySelector(`.nav-link[onclick*="'${id}'"]`);
    mostrarSeccion(id, enlace ? { currentTarget: enlace } : null);
  };

  const abrirPestana = (id) => {
    if (typeof abrirTab !== "function") return;
    const boton = document.querySelector(`.tab-button[onclick*="'${id}'"]`);
    if (boton) abrirTab({ currentTarget: boton }, id);
  };

  const leerVista = () => {
    const seccion = Array.from(document.querySelectorAll(".seccion")).find(
      (s) => s.style.display !== "none"
    );
    const pestana = document.querySelector(".tab-content.active");
    return { seccion: seccion ? seccion.id : "configuracion", pestana: pestana ? pestana.id : "tabMedicos" };
  };

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

  const llevarAVista = (rect) => {
    const alto = window.innerHeight;
    if (rect.top >= MARGEN && rect.bottom <= alto - MARGEN) return;
    const destino = window.scrollY + rect.top - 80;
    window.scrollTo({ top: Math.max(0, destino), behavior: movimientoReducido() ? "auto" : "smooth" });
  };

  const colocar = () => {
    marcoPendiente = false;
    if (!caja) return;
    const ancho = window.innerWidth;
    const alto = window.innerHeight;
    const rect = rectUnion(nodosVisibles(PASOS[indice]));
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
      top: `${rect.top - HOLGURA_FOCO}px`,
      left: `${rect.left - HOLGURA_FOCO}px`,
      width: `${rect.right - rect.left + HOLGURA_FOCO * 2}px`,
      height: `${rect.bottom - rect.top + HOLGURA_FOCO * 2}px`,
    });

    const abajo = alto - rect.bottom - HOLGURA_FOCO;
    const arriba = rect.top - HOLGURA_FOCO;
    let top;
    if (abajo >= altoCaja + 12 + MARGEN) top = rect.bottom + HOLGURA_FOCO + 12;
    else if (arriba >= altoCaja + 12 + MARGEN) top = rect.top - HOLGURA_FOCO - 12 - altoCaja;
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

  // --- Construcción y pasos ----------------------------------------------------

  const insertarEstilos = () => {
    if (document.getElementById("guia-estilos")) return;
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
        <button type="button" class="guia-saltar" data-accion="salir">Saltar guía</button>
        <button type="button" class="secondary" data-accion="anterior">‹ Anterior</button>
        <button type="button" data-accion="siguiente">Siguiente ›</button>
      </div>`;
    caja.addEventListener("click", (e) => {
      const accion = e.target.closest("[data-accion]")?.dataset.accion;
      if (accion === "salir") cerrar();
      if (accion === "anterior") mostrarPaso(indice - 1);
      if (accion === "siguiente") mostrarPaso(indice + 1);
    });

    document.body.append(capa, foco, caja);
  };

  const mostrarPaso = (nuevo) => {
    if (nuevo >= PASOS.length) {
      cerrar();
      return;
    }
    indice = Math.max(0, nuevo);
    const paso = PASOS[indice];
    if (paso.seccion) irASeccion(paso.seccion);
    if (paso.pestana) abrirPestana(paso.pestana);

    const ultimo = indice === PASOS.length - 1;
    caja.querySelector(".guia-progreso span").style.width = `${((indice + 1) / PASOS.length) * 100}%`;
    caja.querySelector("#guiaPaso").textContent = `Paso ${indice + 1} de ${PASOS.length}`;
    caja.querySelector("#guiaTitulo").textContent = paso.titulo;
    caja.querySelector("#guiaTexto").innerHTML = paso.texto;
    caja.querySelector('[data-accion="anterior"]').hidden = indice === 0;
    caja.querySelector('[data-accion="salir"]').hidden = ultimo;
    const siguiente = caja.querySelector('[data-accion="siguiente"]');
    siguiente.textContent = ultimo ? "Entendido" : indice === 0 ? "Empezar ›" : "Siguiente ›";

    const rect = rectUnion(nodosVisibles(paso));
    if (rect) llevarAVista(rect);
    colocar();
    // La pestaña entra con una animación de 0,2 s: se recoloca cuando termina.
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
      const siguiente = e.shiftKey
        ? (actual - 1 + botones.length) % botones.length
        : (actual + 1) % botones.length;
      e.preventDefault();
      botones[siguiente].focus();
    } else if (e.altKey) {
      // Los atajos Alt+letra de la página cambiarían la vista por debajo de la guía.
      e.preventDefault();
    } else {
      return;
    }
    e.stopPropagation();
  };

  const iniciar = () => {
    if (caja) return;
    insertarEstilos();
    vistaInicial = leerVista();
    focoPrevio = document.activeElement;
    crearNodos();
    document.addEventListener("keydown", alPulsarTecla, true);
    window.addEventListener("resize", pedirColocacion);
    window.addEventListener("scroll", pedirColocacion, true);
    mostrarPaso(0);
  };

  const cerrar = () => {
    if (!caja) return;
    escribir(CLAVE_VISTA, new Date().toISOString());
    document.removeEventListener("keydown", alPulsarTecla, true);
    window.removeEventListener("resize", pedirColocacion);
    window.removeEventListener("scroll", pedirColocacion, true);
    [capa, foco, caja].forEach((n) => n.remove());
    capa = foco = caja = null;
    if (vistaInicial) {
      irASeccion(vistaInicial.seccion);
      abrirPestana(vistaInicial.pestana);
    }
    window.scrollTo({ top: 0 });
    const boton = document.getElementById("btnGuia");
    const destino = focoPrevio && document.contains(focoPrevio) && focoPrevio !== document.body ? focoPrevio : boton;
    if (destino) destino.focus({ preventScroll: true });
  };

  const arrancar = () => {
    const boton = document.getElementById("btnGuia");
    if (boton) boton.addEventListener("click", iniciar);
    if (!leer(CLAVE_VISTA) && !hayDatosGuardados()) window.setTimeout(iniciar, 500);
  };

  window.iniciarGuiaGuardias = iniciar;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
