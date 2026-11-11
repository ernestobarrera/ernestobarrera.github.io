/*
 * Interfaz del gestor de guardias (guardias.html).
 *
 * El reparto lo calcula guardias-motor.js; aquí solo hay estado, guardado,
 * pintado y eventos. Los datos viven en localStorage con la misma clave y forma
 * que usaban la v1 y la v2.0, para que nadie pierda nada al actualizar.
 *
 * Expone window.GuardiasApp para la guía (guardias-guia.js).
 */
(() => {
  "use strict";

  const M = window.GuardiasMotor;
  if (!M) {
    console.error("Gestor de guardias: falta guardias-motor.js");
    return;
  }

  const CLAVE_DATOS = "sistemaGuardias_v16";
  const DIAS_AVISO_COPIA = 31;
  const NOMBRES_MES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const PLAN_POR_DEFECTO = { L: "TARDE", M: "MAÑANA", X: "TARDE", J: "MAÑANA", V: "TARDE" };
  const COLORES_EXCEL = { "valor-ok": "#c8e6c9", "valor-medio": "#fff9c4", "valor-mal": "#ffcdd2" };

  let estado = M.normalizarEstado({});
  let resultado = null;
  let ultimoGuardado = null;
  let puedeGuardar = true;

  // --- Utilidades -----------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const crear = (etiqueta, props = {}, hijos = []) => {
    const nodo = document.createElement(etiqueta);
    Object.entries(props).forEach(([clave, valor]) => {
      if (valor === undefined || valor === null || valor === false) return;
      if (clave === "texto") nodo.textContent = valor;
      else if (clave === "class") nodo.className = valor;
      else nodo.setAttribute(clave, valor === true ? "" : valor);
    });
    hijos.forEach((h) => nodo.append(h));
    return nodo;
  };

  const decimal = (n, d = 1) => Number(n).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
  const conSigno = (n) => `${n > 0.0001 ? "+" : ""}${decimal(n)}`;
  const formatearFecha = (iso) => {
    if (!iso || !String(iso).includes("-")) return iso;
    const [a, m, d] = String(iso).split("-");
    return `${d}/${m}/${a}`;
  };
  const diaDeLaSemana = (iso) => DIAS_SEMANA[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  const nombreMes = (anio, mes) => `${NOMBRES_MES[mes - 1]} ${anio}`;
  const nombreClaveMes = (clave) => {
    const [a, m] = clave.split("-").map(Number);
    return nombreMes(a, m);
  };
  const hora = (fecha) => fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const diasDesde = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const ordenAlfabetico = (a, b) => a.localeCompare(b, "es");
  const hayDatos = () => estado.medicos.length > 0 || Object.keys(estado.historico.meses).length > 0;
  const activos = () => estado.medicos.filter((m) => m.activo);

  // --- Avisos flotantes y diálogos ----------------------------------------------------

  let temporizadorAviso = null;
  const avisar = (mensaje, { tipo = "info", duracion } = {}) => {
    const toast = $("toast");
    toast.textContent = mensaje;
    toast.className = `toast visible${tipo === "error" ? " toast-error" : tipo === "ok" ? " toast-ok" : ""}`;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => toast.classList.remove("visible"), duracion ?? (tipo === "error" ? 7000 : 4000));
  };

  let cerrarDialogoActual = null;

  /**
   * Abre el diálogo y resuelve con el `valor` del botón pulsado, el `data-valor`
   * de un elemento del cuerpo, o null si se cierra con Esc. Cada apertura
   * reconstruye el contenido, así que ningún diálogo deja roto al siguiente.
   */
  const dialogo = ({ titulo = "", cuerpo, botones, ancho = false }) =>
    new Promise((resolver) => {
      const d = $("dialogo");
      if (cerrarDialogoActual) cerrarDialogoActual(null);
      if (typeof d.showModal !== "function") {
        const texto = typeof cuerpo === "string" ? cuerpo : titulo;
        resolver(window.confirm(texto) ? botones[botones.length - 1].valor : null);
        return;
      }
      const zonaCuerpo = $("dialogoCuerpo");
      const zonaBotones = $("dialogoBotones");
      $("dialogoTitulo").textContent = titulo;
      zonaCuerpo.replaceChildren(typeof cuerpo === "string" ? crear("p", { texto: cuerpo }) : cuerpo);
      zonaBotones.replaceChildren();
      d.classList.toggle("ancho", ancho);

      let terminado = false;
      const alCancelar = (e) => {
        e.preventDefault();
        terminar(null);
      };
      const alClicCuerpo = (e) => {
        const objetivo = e.target.closest("[data-valor]");
        if (objetivo) terminar(objetivo.dataset.valor);
      };
      const terminar = (valor) => {
        if (terminado) return;
        terminado = true;
        cerrarDialogoActual = null;
        d.removeEventListener("cancel", alCancelar);
        zonaCuerpo.removeEventListener("click", alClicCuerpo);
        if (d.open) d.close();
        resolver(valor);
      };
      cerrarDialogoActual = terminar;
      d.addEventListener("cancel", alCancelar);
      zonaCuerpo.addEventListener("click", alClicCuerpo);

      let foco = null;
      botones.forEach((b) => {
        const boton = crear("button", { type: "button", class: b.clase || "", texto: b.texto });
        boton.addEventListener("click", () => terminar(b.valor));
        zonaBotones.append(boton);
        if (b.foco) foco = boton;
      });
      d.showModal();
      (foco || zonaBotones.lastElementChild)?.focus();
    });

  const confirmar = async ({ titulo, mensaje, aceptar = "Aceptar", peligro = false, clase }) =>
    (await dialogo({
      titulo,
      cuerpo: mensaje,
      botones: [
        { texto: "Cancelar", valor: false, clase: "secondary", foco: peligro },
        { texto: aceptar, valor: true, clase: clase || (peligro ? "danger" : ""), foco: !peligro },
      ],
    })) === true;

  // --- Guardado ---------------------------------------------------------------------------

  const cargar = () => {
    let crudo = null;
    try {
      crudo = localStorage.getItem(CLAVE_DATOS);
    } catch (e) {
      puedeGuardar = false;
    }
    if (!crudo) {
      estado = M.normalizarEstado({});
      return;
    }
    try {
      estado = M.normalizarEstado(JSON.parse(crudo));
    } catch (e) {
      // Datos ilegibles: se apartan con otro nombre para no pisarlos.
      try {
        localStorage.setItem(`${CLAVE_DATOS}_ilegible_${Date.now()}`, crudo);
      } catch (e2) {
        /* sin espacio: no se puede hacer más */
      }
      estado = M.normalizarEstado({});
      setTimeout(() => avisar("Los datos guardados estaban dañados y se han apartado. Importa tu última copia.", { tipo: "error" }), 0);
    }
  };

  /** Guarda en el navegador. `cambio` = false cuando no hay nada nuevo que exportar. */
  const guardar = (cambio = true) => {
    // Por compatibilidad con la v1, que lee este campo.
    estado.historico.saldoAcumulado = M.saldoVigente(estado.historico);
    if (cambio) estado.ultimoCambio = new Date().toISOString();
    try {
      localStorage.setItem(CLAVE_DATOS, JSON.stringify(estado));
      puedeGuardar = true;
      ultimoGuardado = new Date();
    } catch (e) {
      puedeGuardar = false;
    }
    pintarEstadoDatos();
  };

  /** Tras cualquier cambio de la configuración. */
  const cambioConfiguracion = () => {
    guardar();
    // Festivos, ausencias, turnos y altas cambian cómo se leen los cambios de turno.
    pintarCambios();
    pintarVistaPreviaCambio();
    // El calendario guardado se recalcula con la nueva configuración (las guardias no se mueven).
    if (resultado) mostrarMes();
    pintarBienvenida();
    pintarPista();
  };

  const pintarEstadoDatos = () => {
    const guardado = $("estadoGuardado");
    const copia = $("estadoCopia");
    $("avisoAlmacenamiento").hidden = puedeGuardar;
    if (!puedeGuardar) {
      guardado.textContent = "⚠ Este navegador no guarda";
      guardado.className = "sin-guardar";
    } else if (ultimoGuardado) {
      guardado.textContent = `✓ Guardado en este navegador · ${hora(ultimoGuardado)}`;
      guardado.className = "guardado";
    } else if (hayDatos()) {
      guardado.textContent = "✓ Datos guardados en este navegador";
      guardado.className = "guardado";
    } else {
      guardado.textContent = "Sin datos todavía";
      guardado.className = "";
    }

    if (!hayDatos()) {
      copia.textContent = "";
      return;
    }
    const sinExportar = hayCambiosSinExportar();
    $("btnExportar").classList.toggle("pendiente", sinExportar);
    $("btnExportar").title = sinExportar
      ? "Hay cambios que aún no están en ningún fichero: descarga la copia y sustituye la del sitio compartido"
      : "Descarga un fichero con la configuración, los calendarios y el histórico: tu copia de seguridad y lo que pasarías a otra persona";
    if (!estado.ultimaCopia) {
      copia.textContent = "⚠ Sin copia de seguridad";
      copia.className = "copia-pendiente";
      return;
    }
    if (sinExportar) {
      copia.textContent = `⚠ Cambios sin exportar (última copia: ${diasDesde(estado.ultimaCopia) <= 0 ? "hoy" : `hace ${plural(diasDesde(estado.ultimaCopia), "día", "días")}`})`;
      copia.className = "copia-pendiente";
      return;
    }
    const dias = diasDesde(estado.ultimaCopia);
    const texto = dias <= 0 ? "Última copia: hoy" : `Última copia: hace ${plural(dias, "día", "días")}`;
    copia.textContent = dias > DIAS_AVISO_COPIA ? `⚠ ${texto}` : texto;
    copia.className = dias > DIAS_AVISO_COPIA ? "copia-pendiente" : "";
  };

  const hayCambiosSinExportar = () => Boolean(estado.ultimoCambio && (!estado.ultimaCopia || estado.ultimoCambio > estado.ultimaCopia));

  // --- Navegación ---------------------------------------------------------------------------

  const irASeccion = (id) => {
    document.querySelectorAll(".seccion").forEach((s) => {
      s.hidden = s.id !== id;
    });
    document.querySelectorAll("[data-seccion]").forEach((b) => {
      const activa = b.dataset.seccion === id;
      b.classList.toggle("active", activa);
      if (activa) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (id === "calendario") pintarPista();
  };

  const abrirPestana = (id) => {
    document.querySelectorAll(".tab-content").forEach((t) => t.classList.toggle("active", t.id === id));
    document.querySelectorAll(".tab-button").forEach((b) => {
      const activa = b.dataset.tab === id;
      b.classList.toggle("active", activa);
      b.setAttribute("aria-selected", String(activa));
    });
    if (id === "tabParametros") pintarHistorico();
  };

  const pintarBienvenida = () => {
    $("bienvenida").hidden = estado.medicos.length > 0;
  };

  const empezarDeCero = () => {
    abrirPestana("tabMedicos");
    $("nuevoMedicoNombre").focus();
    $("altaMedico").scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // --- Tablas: utilidades ----------------------------------------------------------------------

  const cuerpo = (idTabla) => {
    const tbody = $(idTabla).tBodies[0];
    tbody.replaceChildren();
    return tbody;
  };

  const filaVacia = (tbody, columnas, texto) => {
    const celda = tbody.insertRow().insertCell();
    celda.colSpan = columnas;
    celda.className = "vacio";
    celda.textContent = texto;
  };

  const celdaEliminar = (fila, etiqueta, alPulsar) => {
    const celda = fila.insertCell();
    celda.className = "acciones";
    const boton = crear("button", { type: "button", class: "danger pequeno", texto: "Eliminar", "aria-label": etiqueta });
    boton.addEventListener("click", alPulsar);
    celda.append(boton);
  };

  const rellenarSelect = (select, opciones, vacio) => {
    const anterior = select.value;
    select.replaceChildren();
    if (opciones.length === 0) {
      select.append(crear("option", { value: "", texto: vacio }));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    // Cada opción es un texto o { valor, texto } si lo que se ve no es lo que se guarda.
    const valores = opciones.map((o) => (typeof o === "string" ? o : o.valor));
    opciones.forEach((o) => select.append(crear("option", typeof o === "string" ? { value: o, texto: o } : { value: o.valor, texto: o.texto })));
    if (valores.includes(anterior)) select.value = anterior;
  };

  const poblarSelects = () => {
    const nombres = activos()
      .map((m) => m.nombre)
      .sort(ordenAlfabetico);
    const mixtos = activos()
      .filter((m) => m.turno === "MIXTO")
      .map((m) => m.nombre)
      .sort(ordenAlfabetico);
    ["reduccionMedico", "ausenciaMedico", "exclPuntMedico"].forEach((id) =>
      rellenarSelect($(id), nombres, "— Añade médicos activos primero —")
    );
    rellenarSelect($("planTurnoMedico"), mixtos, "— No hay médicos MIXTO activos —");
    rellenarSelect(
      $("cambioMedico"),
      [...activos()].sort((a, b) => ordenAlfabetico(a.nombre, b.nombre)).map((m) => ({ valor: m.nombre, texto: `${m.nombre} · ${m.turno}` })),
      "— Añade médicos activos primero —"
    );
    cargarReduccionEnFormulario();
    cargarPlanEnFormulario();
    pintarVistaPreviaCambio();
  };

  // --- Médicos -----------------------------------------------------------------------------------

  const pintarContadorMedicos = () => {
    const total = estado.medicos.length;
    $("contadorMedicos").textContent = total ? `(${total}; ${activos().length} activos)` : "";
  };

  const pintarMedicos = () => {
    const tbody = cuerpo("tablaMedicos");
    pintarContadorMedicos();
    if (estado.medicos.length === 0) {
      filaVacia(tbody, 4, "Aún no hay médicos. Añádelos arriba, pega la lista desde Excel o importa una copia.");
      return;
    }
    estado.medicos.forEach((medico) => {
      const fila = tbody.insertRow();
      fila.insertCell().textContent = medico.nombre;

      const turno = crear("select", { "aria-label": `Turno de ${medico.nombre}` });
      const opciones = M.TURNOS.includes(medico.turno) ? M.TURNOS : [...M.TURNOS, medico.turno];
      opciones.forEach((t) => turno.append(crear("option", { value: t, texto: t })));
      turno.value = medico.turno;
      turno.addEventListener("change", () => {
        medico.turno = turno.value;
        cambioConfiguracion();
        poblarSelects();
        pintarPlanes();
        avisar(`${medico.nombre}: turno ${medico.turno}.`);
      });
      fila.insertCell().append(turno);

      const activo = crear("input", { type: "checkbox", "aria-label": `${medico.nombre} activo` });
      activo.checked = Boolean(medico.activo);
      activo.addEventListener("change", () => {
        medico.activo = activo.checked;
        cambioConfiguracion();
        poblarSelects();
        pintarContadorMedicos();
        pintarHistorico();
      });
      fila.insertCell().append(activo);

      celdaEliminar(fila, `Eliminar a ${medico.nombre}`, () => eliminarMedico(medico.nombre));
    });
  };

  const agregarMedico = () => {
    const campo = $("nuevoMedicoNombre");
    const nombre = campo.value.trim().toUpperCase();
    if (!nombre) {
      avisar("Escribe el nombre del médico.", { tipo: "error" });
      campo.focus();
      return;
    }
    if (estado.medicos.some((m) => m.nombre === nombre)) {
      avisar("Ya hay un médico con ese nombre.", { tipo: "error" });
      return;
    }
    estado.medicos.push({ nombre, turno: $("nuevoMedicoTurno").value, activo: $("nuevoMedicoActivo").checked });
    campo.value = "";
    validarNombreNuevo();
    cambioConfiguracion();
    pintarMedicos();
    poblarSelects();
    pintarHistorico();
    avisar(`${nombre} añadido.`, { tipo: "ok" });
    campo.focus();
  };

  const aplicarJornada = (nombre, porcentaje) => {
    const existente = estado.reducciones.find((r) => r.medico === nombre);
    if (existente) {
      existente.porcentaje = porcentaje;
      if (porcentaje === 100 && !existente.diasExcluidos) estado.reducciones = estado.reducciones.filter((r) => r !== existente);
    } else if (porcentaje < 100) {
      estado.reducciones.push({ medico: nombre, porcentaje, diasExcluidos: "" });
    }
  };

  const procesarImportacionMasiva = () => {
    const area = $("importacionMasiva");
    const texto = area.value;
    const panel = $("resultadoImportacion");
    if (!texto.trim()) {
      avisar("Pega primero las filas copiadas de Excel.", { tipo: "error" });
      area.focus();
      return;
    }
    const { filas, errores } = M.parsearImportacionMedicos(texto);
    let nuevos = 0;
    let actualizados = 0;
    filas.forEach((f) => {
      const existente = estado.medicos.find((m) => m.nombre === f.nombre);
      if (existente) {
        existente.turno = f.turno;
        actualizados++;
      } else {
        estado.medicos.push({ nombre: f.nombre, turno: f.turno, activo: true });
        nuevos++;
      }
      if (f.jornada !== null) aplicarJornada(f.nombre, f.jornada);
    });
    if (filas.length) cambioConfiguracion();

    // Las filas con error se quedan en el cuadro para corregirlas.
    const lineas = texto.split(/\r?\n/);
    area.value = errores.map((e) => lineas[e.linea - 1]).join("\n");

    const partes = [];
    if (nuevos) partes.push(`${plural(nuevos, "médico añadido", "médicos añadidos")}`);
    if (actualizados) partes.push(`${plural(actualizados, "actualizado", "actualizados")}`);
    panel.replaceChildren(crear("div", { texto: partes.length ? `✓ ${partes.join(", ")}.` : "No se ha importado ninguna fila." }));
    if (errores.length) {
      panel.append(crear("div", { texto: `✗ ${plural(errores.length, "fila con error", "filas con error")} (se han dejado en el cuadro para corregirlas):` }));
      panel.append(crear("ul", {}, errores.map((e) => crear("li", { texto: `Línea ${e.linea}: ${e.motivo}.` }))));
    }
    panel.classList.toggle("con-errores", errores.length > 0);
    panel.hidden = false;

    pintarMedicos();
    pintarReducciones();
    poblarSelects();
    pintarHistorico();
  };

  const eliminarMedico = async (nombre) => {
    const ok = await confirmar({
      titulo: `Eliminar a ${nombre}`,
      mensaje: `Se borrarán también su jornada, ausencias, exclusiones, planificación y cambios de turno. Su histórico se conserva. Si solo va a dejar de hacer guardias un tiempo, mejor desmárcalo como activo.`,
      aceptar: "Eliminar",
      peligro: true,
    });
    if (!ok) return;
    estado.medicos = estado.medicos.filter((m) => m.nombre !== nombre);
    estado.reducciones = estado.reducciones.filter((r) => r.medico !== nombre);
    estado.ausencias = estado.ausencias.filter((a) => a.medico !== nombre);
    estado.exclusionesPuntuales = estado.exclusionesPuntuales.filter((e) => e.medico !== nombre);
    estado.planificacionesTurnos = estado.planificacionesTurnos.filter((p) => p.medico !== nombre);
    estado.cambiosTurno = estado.cambiosTurno.filter((c) => c.medico !== nombre);
    cambioConfiguracion();
    pintarTodo();
    avisar(`${nombre} eliminado.`);
  };

  const validarNombreNuevo = () => {
    const campo = $("nuevoMedicoNombre");
    const valor = campo.value.trim().toUpperCase();
    const repetido = valor !== "" && estado.medicos.some((m) => m.nombre === valor);
    campo.classList.toggle("campo-invalido", repetido);
    let mensaje = campo.parentNode.querySelector(".mensaje-error");
    if (repetido && !mensaje) {
      mensaje = crear("small", { class: "mensaje-error", texto: "Este médico ya existe" });
      campo.parentNode.append(mensaje);
    } else if (!repetido && mensaje) {
      mensaje.remove();
    }
  };

  // --- Jornada y exclusiones ------------------------------------------------------------------

  const diasDeReduccion = (reduccion) =>
    String(reduccion?.diasExcluidos || "")
      .split(",")
      .map((d) => d.trim().replace("MIÉRCOLES", "MIERCOLES"))
      .filter(Boolean);

  const cargarReduccionEnFormulario = () => {
    const nombre = $("reduccionMedico").value;
    const reduccion = estado.reducciones.find((r) => r.medico === nombre);
    $("reduccionPorcentaje").value = reduccion ? reduccion.porcentaje : 100;
    const dias = diasDeReduccion(reduccion);
    document.querySelectorAll('input[name="diasExcluidos"]').forEach((c) => {
      c.checked = dias.includes(c.value);
    });
  };

  const guardarReduccion = () => {
    const medico = $("reduccionMedico").value;
    if (!medico) {
      avisar("Elige un médico.", { tipo: "error" });
      return;
    }
    const porcentaje = Number($("reduccionPorcentaje").value);
    if (!Number.isInteger(porcentaje) || porcentaje < 1 || porcentaje > 100) {
      avisar(
        porcentaje === 0
          ? "Para que no haga guardias, desmárcalo como activo en la lista de médicos."
          : "La jornada debe ser un número entero entre 1 y 100.",
        { tipo: "error" }
      );
      return;
    }
    const dias = Array.from(document.querySelectorAll('input[name="diasExcluidos"]:checked')).map((c) => c.value);
    const existente = estado.reducciones.find((r) => r.medico === medico);
    if (porcentaje === 100 && dias.length === 0) {
      estado.reducciones = estado.reducciones.filter((r) => r.medico !== medico);
      avisar(`${medico}: jornada completa y sin días excluidos.`);
    } else if (existente) {
      existente.porcentaje = porcentaje;
      existente.diasExcluidos = dias.join(", ");
      avisar(`Reducción de ${medico} actualizada.`, { tipo: "ok" });
    } else {
      estado.reducciones.push({ medico, porcentaje, diasExcluidos: dias.join(", ") });
      avisar(`Reducción de ${medico} guardada.`, { tipo: "ok" });
    }
    cambioConfiguracion();
    pintarReducciones();
  };

  const pintarReducciones = () => {
    const tbody = cuerpo("tablaReducciones");
    if (estado.reducciones.length === 0) {
      filaVacia(tbody, 4, "Nadie tiene jornada reducida ni días excluidos.");
      return;
    }
    estado.reducciones.forEach((r) => {
      const fila = tbody.insertRow();
      fila.insertCell().textContent = r.medico;
      fila.insertCell().textContent = `${r.porcentaje} %`;
      fila.insertCell().textContent = r.diasExcluidos || "Ninguno";
      celdaEliminar(fila, `Eliminar la reducción de ${r.medico}`, async () => {
        if (!(await confirmar({ titulo: "Eliminar reducción", mensaje: `${r.medico} pasará a jornada completa y sin días excluidos.`, aceptar: "Eliminar", peligro: true }))) return;
        estado.reducciones = estado.reducciones.filter((x) => x !== r);
        cambioConfiguracion();
        pintarReducciones();
        cargarReduccionEnFormulario();
      });
    });
  };

  // --- Festivos ---------------------------------------------------------------------------------

  const agregarFestivo = () => {
    const campo = $("nuevoFestivo");
    const fecha = campo.value;
    if (!fecha) {
      avisar("Elige una fecha.", { tipo: "error" });
      return;
    }
    const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    if (dia === 0 || dia === 6) {
      avisar(`El ${formatearFecha(fecha)} es ${DIAS_SEMANA[dia].toLowerCase()}: los fines de semana ya se excluyen solos.`);
      return;
    }
    if (estado.festivos.includes(fecha)) {
      avisar("Ese festivo ya está en la lista.");
      return;
    }
    estado.festivos.push(fecha);
    estado.festivos.sort();
    campo.value = "";
    cambioConfiguracion();
    pintarFestivos();
    avisar(`Festivo del ${formatearFecha(fecha)} añadido.`, { tipo: "ok" });
  };

  const pintarFestivos = () => {
    const tbody = cuerpo("tablaFestivos");
    $("contadorFestivos").textContent = estado.festivos.length ? `(${estado.festivos.length})` : "";
    if (estado.festivos.length === 0) {
      filaVacia(tbody, 3, "Sin festivos. Añade los nacionales, autonómicos y locales del año.");
      return;
    }
    estado.festivos.forEach((fecha) => {
      const fila = tbody.insertRow();
      fila.insertCell().textContent = formatearFecha(fecha);
      fila.insertCell().textContent = diaDeLaSemana(fecha) || "";
      celdaEliminar(fila, `Eliminar el festivo del ${formatearFecha(fecha)}`, async () => {
        if (!(await confirmar({ titulo: "Eliminar festivo", mensaje: `¿Quitar el festivo del ${formatearFecha(fecha)}?`, aceptar: "Eliminar", peligro: true }))) return;
        estado.festivos = estado.festivos.filter((f) => f !== fecha);
        cambioConfiguracion();
        pintarFestivos();
      });
    });
  };

  // --- Ausencias --------------------------------------------------------------------------------

  const validarRangoAusencia = () => {
    const inicio = $("ausenciaInicio").value;
    const fin = $("ausenciaFin");
    const malo = Boolean(inicio && fin.value && inicio > fin.value);
    fin.classList.toggle("campo-invalido", malo);
    let mensaje = fin.parentNode.querySelector(".mensaje-error");
    if (malo && !mensaje) fin.parentNode.append(crear("small", { class: "mensaje-error", texto: "La fecha final es anterior a la inicial" }));
    else if (!malo && mensaje) mensaje.remove();
    return !malo;
  };

  const agregarAusencia = () => {
    const medico = $("ausenciaMedico").value;
    const inicio = $("ausenciaInicio").value;
    const fin = $("ausenciaFin").value;
    if (!medico || !inicio || !fin) {
      avisar("Completa médico, fecha inicial y fecha final.", { tipo: "error" });
      return;
    }
    if (!validarRangoAusencia()) {
      avisar("La fecha final no puede ser anterior a la inicial.", { tipo: "error" });
      return;
    }
    estado.ausencias.push({ medico, inicio, fin });
    $("ausenciaInicio").value = "";
    $("ausenciaFin").value = "";
    cambioConfiguracion();
    pintarAusencias();
    avisar(`Ausencia de ${medico} añadida.`, { tipo: "ok" });
  };

  const pintarAusencias = () => {
    const tbody = cuerpo("tablaAusencias");
    if (estado.ausencias.length === 0) {
      filaVacia(tbody, 5, "Sin ausencias registradas.");
      return;
    }
    [...estado.ausencias]
      .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)))
      .forEach((a) => {
        const fila = tbody.insertRow();
        fila.insertCell().textContent = a.medico;
        fila.insertCell().textContent = formatearFecha(a.inicio);
        fila.insertCell().textContent = formatearFecha(a.fin);
        const dias = Math.round((Date.parse(a.fin) - Date.parse(a.inicio)) / 86400000) + 1;
        fila.insertCell().textContent = Number.isFinite(dias) ? dias : "";
        celdaEliminar(fila, `Eliminar la ausencia de ${a.medico}`, async () => {
          if (!(await confirmar({ titulo: "Eliminar ausencia", mensaje: `¿Quitar la ausencia de ${a.medico} del ${formatearFecha(a.inicio)} al ${formatearFecha(a.fin)}?`, aceptar: "Eliminar", peligro: true }))) return;
          estado.ausencias = estado.ausencias.filter((x) => x !== a);
          cambioConfiguracion();
          pintarAusencias();
        });
      });
  };

  // --- Exclusiones puntuales -----------------------------------------------------------------

  const agregarExclusionPuntual = () => {
    const medico = $("exclPuntMedico").value;
    const fecha = $("exclPuntFecha").value;
    if (!medico || !fecha) {
      avisar("Elige un médico y una fecha.", { tipo: "error" });
      return;
    }
    const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    if (dia === 0 || dia === 6 || estado.festivos.includes(fecha)) {
      avisar(`El ${formatearFecha(fecha)} no hay guardias (fin de semana o festivo): no hace falta excluirlo.`);
      return;
    }
    if (estado.exclusionesPuntuales.some((e) => e.medico === medico && e.fecha === fecha)) {
      avisar("Esa exclusión ya está registrada.");
      return;
    }
    estado.exclusionesPuntuales.push({ medico, fecha });
    $("exclPuntFecha").value = "";
    cambioConfiguracion();
    pintarExclusiones();
    avisar(`Exclusión de ${medico} el ${formatearFecha(fecha)} añadida.`, { tipo: "ok" });
  };

  const pintarExclusiones = () => {
    const tbody = cuerpo("tablaExclPunt");
    if (estado.exclusionesPuntuales.length === 0) {
      filaVacia(tbody, 3, "Sin exclusiones puntuales.");
      return;
    }
    [...estado.exclusionesPuntuales]
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .forEach((e) => {
        const fila = tbody.insertRow();
        fila.insertCell().textContent = e.medico;
        fila.insertCell().textContent = `${formatearFecha(e.fecha)} (${(diaDeLaSemana(e.fecha) || "").toLowerCase()})`;
        celdaEliminar(fila, `Eliminar la exclusión de ${e.medico}`, async () => {
          if (!(await confirmar({ titulo: "Eliminar exclusión", mensaje: `¿Quitar la exclusión de ${e.medico} el ${formatearFecha(e.fecha)}?`, aceptar: "Eliminar", peligro: true }))) return;
          estado.exclusionesPuntuales = estado.exclusionesPuntuales.filter((x) => x !== e);
          cambioConfiguracion();
          pintarExclusiones();
        });
      });
  };

  // --- Planificación de mixtos ------------------------------------------------------------------

  const CLAVES_PLAN = ["L", "M", "X", "J", "V"];

  const cargarPlanEnFormulario = () => {
    const plan = estado.planificacionesTurnos.find((p) => p.medico === $("planTurnoMedico").value) || PLAN_POR_DEFECTO;
    CLAVES_PLAN.forEach((k) => {
      $(`turno${k}`).value = plan[k] || PLAN_POR_DEFECTO[k];
    });
  };

  const guardarPlanTurno = () => {
    const medico = $("planTurnoMedico").value;
    if (!medico) {
      avisar("No hay ningún médico MIXTO activo.", { tipo: "error" });
      return;
    }
    const plan = { medico };
    CLAVES_PLAN.forEach((k) => {
      plan[k] = $(`turno${k}`).value;
    });
    const existente = estado.planificacionesTurnos.find((p) => p.medico === medico);
    if (existente) Object.assign(existente, plan);
    else estado.planificacionesTurnos.push(plan);
    cambioConfiguracion();
    pintarPlanes();
    avisar(`Planificación de ${medico} guardada.`, { tipo: "ok" });
  };

  const pintarPlanes = () => {
    const tbody = cuerpo("tablaPlanesGuardados");
    if (estado.planificacionesTurnos.length === 0) {
      filaVacia(tbody, 7, "Sin planificaciones. Los MIXTO sin plan hacen L/X/V tarde y M/J mañana.");
      return;
    }
    estado.planificacionesTurnos.forEach((p) => {
      const fila = tbody.insertRow();
      const medico = estado.medicos.find((m) => m.nombre === p.medico);
      fila.insertCell().textContent = medico && medico.turno !== "MIXTO" ? `${p.medico} (ahora ${medico.turno}: no se usa)` : p.medico;
      CLAVES_PLAN.forEach((k) => {
        fila.insertCell().textContent = String(p[k] || "").charAt(0);
      });
      celdaEliminar(fila, `Eliminar la planificación de ${p.medico}`, async () => {
        if (!(await confirmar({ titulo: "Eliminar planificación", mensaje: `${p.medico} pasará a L/X/V tarde y M/J mañana.`, aceptar: "Eliminar", peligro: true }))) return;
        estado.planificacionesTurnos = estado.planificacionesTurnos.filter((x) => x !== p);
        cambioConfiguracion();
        pintarPlanes();
        cargarPlanEnFormulario();
      });
    });
  };

  // --- Cambios de turno en fechas concretas ------------------------------------------------------
  //
  // Se guarda una entrada por médico y día laborable ({ medico, fecha, turno });
  // aquí se introducen y se enseñan por tramos. Qué efecto tiene cada uno lo
  // decide el motor (analizarCambiosTurno), el mismo que reparte.

  const NO_DISPONIBLE = { ausencia: "con ausencia", "dia-excluido": "en su día excluido", "exclusion-puntual": "con exclusión puntual" };

  const hoyISO = () => {
    const h = new Date();
    return M.aISO(M.fechaUTC(h.getFullYear(), h.getMonth() + 1, h.getDate()));
  };
  const fechaCorta = (iso) => `${diaDeLaSemana(iso).slice(0, 3).toLowerCase()} ${formatearFecha(iso)}`;
  const textoFechas = (desde, hasta) => (desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} → ${fechaCorta(hasta)}`);
  const turnoDe = (nombre) => estado.medicos.find((m) => m.nombre === nombre)?.turno;

  /** Lo que hay escrito en el formulario, ya interpretado. */
  const leerFormularioCambio = () => {
    const medico = $("cambioMedico").value;
    const desde = $("cambioDesde").value;
    const hasta = $("cambioHasta").value;
    const turno = $("cambioTurno").value;
    if (!medico || !desde) return { medico, turno, completo: false };
    const fechas = M.fechasEntre(desde, hasta || desde);
    if (!fechas) {
      const error = hasta && hasta < desde ? "La fecha «hasta» es anterior a «desde»." : "El periodo no es válido (como mucho, un año).";
      return { medico, turno, desde, hasta, completo: true, error };
    }
    // Se registran todos los días laborables del periodo: también los que hoy no
    // cambian nada, para que el cambio siga valiendo si cambia su plan o su ausencia.
    const analisis = M.analizarCambiosTurno(estado, fechas.map((fecha) => ({ medico, fecha, turno })));
    const laborables = analisis.filter((a) => a.motivo !== "no-laborable");
    const previos = new Map(estado.cambiosTurno.filter((c) => c.medico === medico).map((c) => [c.fecha, c.turno]));
    return {
      medico,
      turno,
      desde,
      hasta: hasta || desde,
      completo: true,
      fechas,
      laborables,
      cambian: laborables.filter((a) => a.cambia),
      yaEra: laborables.filter((a) => a.motivo === "ya-es-su-franja"),
      noDisponible: laborables.filter((a) => a.motivo in NO_DISPONIBLE),
      sustituye: laborables.filter((a) => previos.has(a.fecha) && previos.get(a.fecha) !== turno),
      registrados: fechas.filter((f) => previos.has(f)),
    };
  };

  const contarPorMotivo = (lista) =>
    Object.entries(NO_DISPONIBLE)
      .map(([motivo, texto]) => [lista.filter((a) => a.motivo === motivo).length, texto])
      .filter(([n]) => n > 0)
      .map(([n, texto]) => `${n} ${texto}`)
      .join(", ");

  /** Explica, antes de registrarlo, qué va a hacer el cambio. */
  const pintarVistaPreviaCambio = () => {
    const zona = $("vistaPreviaCambio");
    const f = leerFormularioCambio();
    zona.classList.remove("vista-error");
    if (!f.completo) {
      zona.hidden = true;
      return;
    }
    zona.hidden = false;
    if (f.error) {
      zona.textContent = f.error;
      zona.classList.add("vista-error");
      return;
    }
    if (f.laborables.length === 0) {
      zona.textContent = "En esas fechas no hay días laborables (fin de semana o festivo): no hay nada que registrar.";
      return;
    }
    const lineas = [`${f.medico} · ${textoFechas(f.desde, f.hasta)}: ${plural(f.laborables.length, "día laborable", "días laborables")}.`];
    if (f.cambian.length) {
      const desde = [...new Set(f.cambian.map((a) => a.habitual))].join(" o ");
      lineas.push(`En ${plural(f.cambian.length, "día", "días")} pasa de ${desde} a ${f.turno}.`);
    }
    if (f.yaEra.length) lineas.push(`En ${plural(f.yaEra.length, "día", "días")} ya era de ${f.turno}: no cambia nada.`);
    if (f.noDisponible.length) lineas.push(`${contarPorMotivo(f.noDisponible)}: esos días no hace guardias igualmente.`);
    if (f.sustituye.length) lineas.push(`Sustituye ${plural(f.sustituye.length, "cambio ya registrado", "cambios ya registrados")} de esas fechas.`);
    if (f.cambian.length === 0 && f.sustituye.length === 0) lineas.push("Registrarlo no cambiaría nada hoy.");
    zona.textContent = lineas.join(" ");
  };

  const agregarCambioTurno = () => {
    const f = leerFormularioCambio();
    if (!f.medico || !f.completo) {
      avisar("Elige el médico y al menos la fecha «desde».", { tipo: "error" });
      return;
    }
    if (f.error) {
      avisar(f.error, { tipo: "error" });
      return;
    }
    if (f.laborables.length === 0) {
      avisar("En esas fechas no hay días laborables: no hay nada que registrar.");
      return;
    }
    if (f.cambian.length === 0 && f.sustituye.length === 0) {
      avisar(`No cambia nada: esos días ${f.medico} ya pasa consulta de ${f.turno} o no está disponible.`);
      return;
    }
    const nuevas = new Set(f.laborables.map((a) => a.fecha));
    estado.cambiosTurno = estado.cambiosTurno
      .filter((c) => !(c.medico === f.medico && nuevas.has(c.fecha)))
      .concat(f.laborables.map((a) => ({ medico: f.medico, fecha: a.fecha, turno: f.turno })))
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.medico).localeCompare(String(b.medico), "es"));
    $("cambioDesde").value = "";
    $("cambioHasta").value = "";
    cambioConfiguracion();
    avisar(`Cambio registrado: ${f.medico}, ${plural(f.laborables.length, "día", "días")} de ${f.turno}.`, { tipo: "ok" });
  };

  const quitarCambiosDeFechas = async () => {
    const f = leerFormularioCambio();
    if (!f.medico || !f.completo || f.error) {
      avisar(f.error || "Elige el médico y las fechas cuyos cambios quieres quitar.", { tipo: "error" });
      return;
    }
    if (f.registrados.length === 0) {
      avisar(`${f.medico} no tiene cambios de turno entre esas fechas.`);
      return;
    }
    const ok = await confirmar({
      titulo: "Quitar cambios de turno",
      mensaje: `Se quitarán ${plural(f.registrados.length, "cambio", "cambios")} de ${f.medico} (${textoFechas(f.desde, f.hasta)}). Esos días vuelve a su turno habitual.`,
      aceptar: "Quitar",
      peligro: true,
    });
    if (!ok) return;
    const fuera = new Set(f.registrados);
    estado.cambiosTurno = estado.cambiosTurno.filter((c) => !(c.medico === f.medico && fuera.has(c.fecha)));
    cambioConfiguracion();
    avisar(`${plural(f.registrados.length, "cambio quitado", "cambios quitados")}.`, { tipo: "ok" });
  };

  const observacionesDeTramo = (tramo) => {
    const analisis = M.analizarCambiosTurno(estado, tramo.fechas.map((fecha) => ({ medico: tramo.medico, fecha, turno: tramo.turno })));
    const partes = [];
    if (analisis.some((a) => a.motivo === "medico-desconocido")) return "No está en la lista de médicos: no se aplica.";
    if (analisis.some((a) => a.motivo === "inactivo")) partes.push("está inactivo");
    const yaEra = analisis.filter((a) => a.motivo === "ya-es-su-franja").length;
    if (yaEra) partes.push(`${yaEra} ya ${yaEra === 1 ? "era" : "eran"} de ${tramo.turno}`);
    const noDisp = contarPorMotivo(analisis);
    if (noDisp) partes.push(noDisp);
    const festivos = analisis.filter((a) => a.motivo === "no-laborable").length;
    if (festivos) partes.push(`${festivos} ${festivos === 1 ? "cae" : "caen"} en festivo`);
    return partes.join(" · ");
  };

  const pintarCambios = () => {
    const tbody = cuerpo("tablaCambiosTurno");
    const hoy = hoyISO();
    const tramos = M.agruparCambiosTurno(estado);
    const pasados = tramos.filter((t) => t.hasta < hoy);
    const verPasados = $("verCambiosPasados").checked;
    const visibles = verPasados ? tramos : tramos.filter((t) => t.hasta >= hoy);
    $("contadorCambiosPasados").textContent = pasados.length ? `(${pasados.length})` : "";
    $("zonaBorrarPasados").hidden = !(verPasados && pasados.length);

    if (visibles.length === 0) {
      filaVacia(
        tbody,
        6,
        tramos.length ? "No hay cambios de hoy en adelante. Marca «Ver también los ya pasados» para verlos." : "Sin cambios de turno registrados."
      );
      return;
    }
    visibles.forEach((tramo) => {
      const fila = tbody.insertRow();
      if (tramo.hasta < hoy) fila.className = "fila-pasada";
      const turno = turnoDe(tramo.medico);
      fila.insertCell().textContent = turno ? `${tramo.medico} · ${turno}` : tramo.medico;
      fila.insertCell().textContent = textoFechas(tramo.desde, tramo.hasta);
      fila.insertCell().textContent = tramo.fechas.length;
      const celdaTurno = fila.insertCell();
      celdaTurno.textContent = tramo.turno;
      celdaTurno.className = "negrita";
      const obs = fila.insertCell();
      obs.textContent = observacionesDeTramo(tramo);
      obs.className = "observaciones";
      celdaEliminar(fila, `Quitar el cambio de ${tramo.medico} (${textoFechas(tramo.desde, tramo.hasta)})`, async () => {
        const ok = await confirmar({
          titulo: "Quitar cambio de turno",
          mensaje: `¿Quitar el cambio de ${tramo.medico} a ${tramo.turno} (${textoFechas(tramo.desde, tramo.hasta)}, ${plural(tramo.fechas.length, "día", "días")})? Esos días vuelve a su turno habitual.`,
          aceptar: "Quitar",
          peligro: true,
        });
        if (!ok) return;
        const fuera = new Set(tramo.fechas);
        estado.cambiosTurno = estado.cambiosTurno.filter((c) => !(c.medico === tramo.medico && c.turno === tramo.turno && fuera.has(c.fecha)));
        cambioConfiguracion();
      });
    });
  };

  const borrarCambiosPasados = async () => {
    const hoy = hoyISO();
    const pasados = estado.cambiosTurno.filter((c) => String(c.fecha) < hoy);
    if (pasados.length === 0) return;
    const ok = await confirmar({
      titulo: "Borrar cambios ya pasados",
      mensaje: `Se borrarán ${plural(pasados.length, "cambio de turno anterior", "cambios de turno anteriores")} a hoy. No afectan a los meses ya guardados en el histórico; solo, si volvieras a generar uno de esos meses, saldría sin ellos.`,
      aceptar: "Borrar",
      peligro: true,
    });
    if (!ok) return;
    estado.cambiosTurno = estado.cambiosTurno.filter((c) => !(String(c.fecha) < hoy));
    cambioConfiguracion();
  };

  // --- Parámetros e histórico -------------------------------------------------------------------

  const pintarParametros = () => {
    const factor = Math.round(estado.historico.factorCompensacion * 100);
    $("factorCompensacion").value = factor;
    $("valorFactor").textContent = `${factor} %`;
    $("ventanaHistorico").value = estado.historico.ventanaHistorico;
    $("usarAleatoriedad").checked = estado.configuracionAlgoritmo.usarAleatoriedad;
    $("opcionesAleatoriedad").hidden = !estado.configuracionAlgoritmo.usarAleatoriedad;
    $("semillaAleatoria").value = estado.configuracionAlgoritmo.semilla ?? "";
  };

  const guardarFactor = () => {
    estado.historico.factorCompensacion = Number($("factorCompensacion").value) / 100;
    cambioConfiguracion();
    pintarHistorico();
    avisar(
      estado.historico.factorCompensacion === 0
        ? "Compensación histórica desactivada (0 %)."
        : `Factor de compensación: ${Math.round(estado.historico.factorCompensacion * 100)} %.`
    );
  };

  const guardarVentana = () => {
    const ventana = Number($("ventanaHistorico").value);
    if (!Number.isInteger(ventana) || ventana < 1 || ventana > 24) {
      avisar("La ventana debe ser un número entero de 1 a 24 meses.", { tipo: "error" });
      $("ventanaHistorico").value = estado.historico.ventanaHistorico;
      return;
    }
    estado.historico.ventanaHistorico = ventana;
    cambioConfiguracion();
    pintarHistorico();
    avisar(`Ventana de histórico: ${plural(ventana, "mes", "meses")}.`);
  };

  const guardarSemilla = () => {
    const texto = $("semillaAleatoria").value.trim();
    const semilla = Number(texto);
    estado.configuracionAlgoritmo.semilla = texto === "" || !Number.isFinite(semilla) ? null : Math.trunc(semilla);
    cambioConfiguracion();
  };

  const nuevaSemilla = () => {
    const semilla = Math.floor(Math.random() * 1000000);
    $("semillaAleatoria").value = semilla;
    estado.configuracionAlgoritmo.semilla = semilla;
    cambioConfiguracion();
    avisar(`Nueva semilla: ${semilla}.`);
  };

  const mesObjetivo = () => ({ anio: Number($("anio").value), mes: Number($("mes").value) });
  const mesObjetivoValido = () => {
    const { anio, mes } = mesObjetivo();
    return Number.isInteger(anio) && anio >= 2020 && anio <= 2100 && mes >= 1 && mes <= 12;
  };

  const pintarHistorico = () => {
    const claves = Object.keys(estado.historico.meses).sort();
    const resumen = $("resumenHistorico");
    const valido = mesObjetivoValido();
    const { anio, mes } = mesObjetivo();
    const etiquetaMes = valido ? nombreMes(anio, mes) : "el mes elegido";
    const cuentan = valido ? M.mesesQueCuentan(estado.historico, anio, mes) : [];
    const saldos = valido ? M.saldosParaMes(estado.historico, anio, mes) : {};

    if (claves.length === 0) {
      resumen.replaceChildren(
        crear("p", { texto: "Aún no hay meses guardados." }),
        crear("p", { class: "help-text", texto: "Genera un calendario y pulsa «Guardar en histórico» para empezar a compensar." })
      );
    } else {
      const total = claves.reduce((suma, k) => suma + Object.values(estado.historico.meses[k] || {}).reduce((s, m) => s + (m?.asignadas || 0), 0), 0);
      resumen.replaceChildren(
        crear("p", { texto: `Meses guardados: ${claves.length} (de ${nombreClaveMes(claves[0])} a ${nombreClaveMes(claves[claves.length - 1])}), con ${total} guardias.` }),
        crear("p", {
          texto: cuentan.length
            ? `Para ${etiquetaMes} cuentan ${plural(cuentan.length, "mes", "meses")} (ventana de ${estado.historico.ventanaHistorico}): ${cuentan.map(nombreClaveMes).join(", ")}.`
            : `Para ${etiquetaMes} no cuenta ningún mes: ninguno cae en los ${estado.historico.ventanaHistorico} meses anteriores.`,
        })
      );
    }

    $("tituloSaldos").textContent = `Saldos para ${etiquetaMes}`;
    const tbody = cuerpo("tablaHistorico");
    const lista = activos();
    if (lista.length === 0) {
      filaVacia(tbody, 3, "Sin médicos activos.");
    } else {
      const ultimas = claves.slice(-3);
      lista.forEach((medico) => {
        const fila = tbody.insertRow();
        fila.insertCell().textContent = medico.nombre;
        const saldo = saldos[medico.nombre] || 0;
        const celda = fila.insertCell();
        celda.textContent = conSigno(saldo);
        celda.className = `negrita ${Math.abs(saldo) < 0.5 ? "valor-ok" : Math.abs(saldo) < 2 ? "valor-medio" : "valor-mal"}`;
        const recientes = ultimas
          .filter((k) => estado.historico.meses[k]?.[medico.nombre])
          .map((k) => `${k}: ${conSigno(Number(estado.historico.meses[k][medico.nombre].diferencia) || 0)}`);
        fila.insertCell().textContent = recientes.join(" · ") || "Sin datos";
      });
    }

    // Nombres del histórico que no están en la lista: no se compensarán.
    const nombres = new Set(estado.medicos.map((m) => m.nombre));
    const huerfanos = new Set();
    claves.forEach((k) => Object.keys(estado.historico.meses[k] || {}).forEach((n) => !nombres.has(n) && huerfanos.add(n)));
    if (huerfanos.size) {
      const fila = tbody.insertRow();
      const celda = fila.insertCell();
      celda.colSpan = 3;
      celda.className = "vacio";
      celda.textContent = `En el histórico hay nombres que no están en la lista de médicos: ${[...huerfanos].sort(ordenAlfabetico).join(", ")}. Si son los mismos médicos escritos de otra forma, unifica el nombre para que se compensen.`;
    }
  };

  const verDetalleHistorico = async () => {
    const claves = Object.keys(estado.historico.meses).sort();
    if (claves.length === 0) {
      avisar("No hay meses guardados en el histórico.");
      return;
    }
    const valido = mesObjetivoValido();
    const { anio, mes } = mesObjetivo();
    const cuentan = new Set(valido ? M.mesesQueCuentan(estado.historico, anio, mes) : []);
    const tabla = crear("table", {}, [
      crear("thead", {}, [
        crear("tr", {}, ["Mes", "Guardias", "Médicos", valido ? `¿Cuenta para ${nombreMes(anio, mes)}?` : "¿Cuenta?", ""].map((t) => crear("th", { texto: t }))),
      ]),
      crear(
        "tbody",
        {},
        claves.map((k) => {
          const datos = estado.historico.meses[k] || {};
          const total = Object.values(datos).reduce((s, m) => s + (m?.asignadas || 0), 0);
          return crear("tr", {}, [
            crear("td", { texto: nombreClaveMes(k) }),
            crear("td", { texto: String(total) }),
            crear("td", { texto: String(Object.keys(datos).length) }),
            crear("td", { texto: cuentan.has(k) ? "Sí" : "No" }),
            crear("td", {}, [crear("button", { type: "button", class: "danger pequeno", "data-valor": `eliminar:${k}`, texto: "Eliminar", "aria-label": `Eliminar ${nombreClaveMes(k)} del histórico` })]),
          ]);
        })
      ),
    ]);
    const contenedor = crear("div", { class: "table-container" }, [tabla]);
    const valor = await dialogo({ titulo: "Histórico por meses", cuerpo: contenedor, ancho: true, botones: [{ texto: "Cerrar", valor: null, clase: "secondary", foco: true }] });
    if (typeof valor === "string" && valor.startsWith("eliminar:")) await eliminarMesHistorico(valor.slice("eliminar:".length));
  };

  const eliminarMesHistorico = async (clave) => {
    const ok = await confirmar({
      titulo: `Eliminar ${nombreClaveMes(clave)} del histórico`,
      mensaje: "Los saldos se recalcularán sin ese mes. Si lo vuelves a necesitar, tendrás que generarlo y guardarlo otra vez, o importar una copia que lo tenga.",
      aceptar: "Eliminar",
      peligro: true,
    });
    if (ok) {
      delete estado.historico.meses[clave];
      guardar();
      pintarHistorico();
      pintarPista();
      if (resultado) pintarAvisosResultado();
      avisar(`${nombreClaveMes(clave)} eliminado del histórico.`);
    }
    await verDetalleHistorico();
  };

  // --- Calendario ----------------------------------------------------------------------------------
  //
  // Desde la v2.3 el calendario de cada mes se guarda (estado.calendarios) y se
  // puede editar. Todo lo que se enseña sale de M.evaluarCalendario sobre el
  // calendario guardado y la configuración actual: un cambio a mano o en la
  // configuración recalcula en cascada resumen, estadísticas y avisos.

  const TEXTO_PUESTO = {
    avisos_manana: "Avisos de mañana",
    urgencias_manana: "Urgencias de mañana",
    avisos_tarde: "Avisos de tarde",
    urgencias_tarde: "Urgencias de tarde",
  };
  const TEXTO_MOTIVO = {
    desconocido: "no está en la lista de médicos",
    inactivo: "está inactivo",
    ausencia: "tiene una ausencia ese día",
    "dia-excluido": "tiene excluido ese día de la semana",
    "exclusion-puntual": "tiene una exclusión puntual ese día",
    "otra-franja": "ese día no trabaja en esa franja",
    doble: "ya tiene otra guardia ese día",
    "tope-semanal": "pasa de 2 guardias en la semana",
  };
  const MAXIMO_DESHACER = 50;
  let pilaDeshacer = [];
  let resaltado = null;
  let cambiosSinExportarEnSesion = false;

  const fijarMesPorDefecto = () => {
    const hoy = new Date();
    const siguiente = M.desplazarMes(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    $("mes").value = String(siguiente.mes);
    $("anio").value = String(siguiente.anio);
  };

  const fechaHora = (iso) => {
    const f = new Date(iso);
    return Number.isNaN(f.getTime()) ? "" : `${f.toLocaleDateString("es-ES")} ${hora(f)}`;
  };
  const fechaLarga = (iso) => `${diaDeLaSemana(iso).toLowerCase()} ${formatearFecha(iso)}`;
  const nombreCorto = (nombre) => String(nombre).split(",")[0];

  /** Guardias de los meses vecinos ya guardados: cuentan para el tope de la semana que comparten. */
  const semanasVecinas = (anio, mes) => {
    const total = {};
    [-1, 1].forEach((delta) => {
      const v = M.desplazarMes(anio, mes, delta);
      const cal = estado.calendarios[M.claveMes(v.anio, v.mes)];
      if (!cal) return;
      Object.entries(M.guardiasPorSemana(cal.dias)).forEach(([medico, semanas]) =>
        Object.entries(semanas).forEach(([semana, n]) => {
          total[medico] = total[medico] || {};
          total[medico][semana] = (total[medico][semana] || 0) + n;
        })
      );
    });
    return total;
  };

  /** Huella de lo que decide el reparto de un mes: si cambia, el calendario se generó con otros datos. */
  const firmaConfiguracion = (anio, mes) => {
    const datos = JSON.stringify([
      CAMPOS_CONFIGURACION.map((c) => estado[c]),
      estado.historico.factorCompensacion,
      estado.historico.ventanaHistorico,
      M.saldosParaMes(estado.historico, anio, mes),
    ]);
    let h = 5381;
    for (let i = 0; i < datos.length; i++) h = (Math.imul(h, 33) ^ datos.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };

  const compactar = (dias) =>
    dias.filter((d) => d.esLaborable).map((d) => Object.fromEntries([["fecha", d.fecha], ...M.PUESTOS.map((p) => [p.clave, d[p.clave]])]));
  const copiarDias = (dias) => dias.map((d) => ({ ...d }));
  const calendarioDelResultado = () => (resultado ? estado.calendarios[resultado.clave] : null);

  /** Recalcula el resultado del mes elegido desde su calendario guardado. */
  const evaluarMes = () => {
    resultado = null;
    if (!mesObjetivoValido()) return;
    const { anio, mes } = mesObjetivo();
    const cal = estado.calendarios[M.claveMes(anio, mes)];
    if (cal) resultado = M.evaluarCalendario(estado, anio, mes, cal.dias, { semanasPrevias: semanasVecinas(anio, mes) });
  };

  const mostrarMes = () => {
    evaluarMes();
    if (resultado) pintarResultado();
    else $("areaResultado").hidden = true;
  };

  /** El mejor reparto posible con la configuración actual, para comparar un calendario editado. */
  /** Puestos cambiados a mano como «fijas» para el motor. */
  const fijasDe = (cal) =>
    cal.manuales
      .map((llave) => {
        const [fecha, puesto] = llave.split("|");
        const dia = cal.dias.find((d) => d.fecha === fecha);
        return dia ? { fecha, puesto, medico: dia[puesto] } : null;
      })
      .filter(Boolean);

  /** El mejor reparto posible con la configuración actual (respetando `fijas`, si se dan). */
  const referenciaOptima = (fijas = []) => {
    const r = M.generarCalendario(estado, resultado.anio, resultado.mes, { fijas, semanasPrevias: semanasVecinas(resultado.anio, resultado.mes) });
    return { ...M.evaluarEquidad(r), cubiertos: r.totales.cubiertos };
  };
  // Peor que la referencia: cubre menos o, cubriendo lo mismo, se aleja más de los objetivos.
  const peorQue = (eq, cubiertos, ref) => Boolean(ref) && (cubiertos < ref.cubiertos || (cubiertos === ref.cubiertos && eq.sumaCuadrados > ref.sumaCuadrados + 0.01));

  const historicoCoincide = () => {
    const guardado = estado.historico.meses[resultado.clave];
    if (!guardado) return null;
    const actual = M.diferenciasDelMes(resultado);
    const nombres = new Set([...Object.keys(guardado), ...Object.keys(actual)]);
    return [...nombres].every(
      (n) => guardado[n] && actual[n] && Number(guardado[n].asignadas) === actual[n].asignadas && Math.abs(Number(guardado[n].objetivo) - actual[n].objetivo) < 0.005
    );
  };

  const pintarPista = () => {
    const pista = $("pistaCalendario");
    if (!mesObjetivoValido()) {
      pista.textContent = "Elige un mes y un año entre 2020 y 2100.";
      return;
    }
    const { anio, mes } = mesObjetivo();
    const partes = [];
    if (activos().length === 0) partes.push("Aún no hay médicos activos: configúralos antes de generar.");
    const cal = estado.calendarios[M.claveMes(anio, mes)];
    if (cal) {
      partes.push(
        `${nombreMes(anio, mes)} ya tiene calendario${cal.generadoEl ? ` (generado el ${fechaHora(cal.generadoEl)}` : " ("}${
          cal.manuales.length ? `, ${plural(cal.manuales.length, "cambio a mano", "cambios a mano")})` : ")"
        }: se muestra abajo y puedes editarlo.`
      );
    }
    const cuentan = M.mesesQueCuentan(estado.historico, anio, mes);
    if (estado.historico.factorCompensacion === 0) partes.push("Compensación histórica desactivada (factor 0 %).");
    else if (cuentan.length) partes.push(`Se compensará con ${plural(cuentan.length, "mes", "meses")} del histórico (${cuentan.map(nombreClaveMes).join(", ")}).`);
    else partes.push("Sin meses anteriores en el histórico: el reparto será solo por disponibilidad.");
    if (estado.historico.meses[M.claveMes(anio, mes)]) partes.push(`${nombreMes(anio, mes)} ya está guardado en el histórico.`);
    pista.textContent = partes.join(" ");
    $("btnGenerar").textContent = cal ? "Generar de nuevo" : "Generar guardias";
  };

  const alCambiarMes = () => {
    resaltado = null;
    mostrarMes();
    pintarPista();
    pintarHistorico();
  };

  // --- Deshacer ------------------------------------------------------------------------------------

  const apilarDeshacer = (clave, descripcion) => {
    const cal = estado.calendarios[clave];
    pilaDeshacer.push({ clave, descripcion, cal: cal ? JSON.parse(JSON.stringify(cal)) : null });
    if (pilaDeshacer.length > MAXIMO_DESHACER) pilaDeshacer.shift();
  };

  const deshacer = () => {
    if (!resultado) return;
    let i = pilaDeshacer.length - 1;
    while (i >= 0 && pilaDeshacer[i].clave !== resultado.clave) i--;
    if (i < 0) {
      avisar("No hay nada que deshacer en este mes.");
      return;
    }
    const [paso] = pilaDeshacer.splice(i, 1);
    if (paso.cal) estado.calendarios[paso.clave] = paso.cal;
    else delete estado.calendarios[paso.clave];
    tocarCalendario();
    avisar(`Deshecho: ${paso.descripcion}.`);
  };

  /** Tras cualquier cambio en el calendario del mes: guarda, recalcula y repinta. */
  const tocarCalendario = () => {
    cambiosSinExportarEnSesion = true;
    guardar();
    mostrarMes();
    pintarPista();
    pintarHistorico();
  };

  // --- Generar y reajustar -------------------------------------------------------------------------

  const generarGuardias = async () => {
    if (!mesObjetivoValido()) {
      avisar("Elige un mes y un año válidos (2020-2100).", { tipo: "error" });
      return;
    }
    if (activos().length === 0) {
      avisar("Añade al menos un médico activo antes de generar.", { tipo: "error" });
      return;
    }
    const { anio, mes } = mesObjetivo();
    const clave = M.claveMes(anio, mes);
    const previo = estado.calendarios[clave];
    if (previo && previo.manuales.length) {
      const ok = await confirmar({
        titulo: `Generar de nuevo ${nombreMes(anio, mes)}`,
        mensaje: `Este calendario tiene ${plural(previo.manuales.length, "guardia cambiada a mano", "guardias cambiadas a mano")}. Si lo generas de nuevo, se pierden. Para conservarlas y recolocar solo lo demás, usa «Reajustar el resto». (Si te equivocas, podrás deshacerlo.)`,
        aceptar: "Generar de nuevo",
        peligro: true,
      });
      if (!ok) return;
    }
    const nuevo = M.generarCalendario(estado, anio, mes, { semanasPrevias: semanasVecinas(anio, mes) });
    const dias = compactar(nuevo.dias);
    apilarDeshacer(clave, previo ? "generar de nuevo" : "generar el calendario");
    estado.calendarios[clave] = { dias, generados: copiarDias(dias), manuales: [], generadoEl: new Date().toISOString(), editadoEl: null, firma: firmaConfiguracion(anio, mes) };
    resaltado = null;
    tocarCalendario();
    $("areaResultado").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const reajustarResto = async () => {
    const cal = calendarioDelResultado();
    if (!cal || cal.manuales.length === 0) return;
    const ok = await confirmar({
      titulo: "Reajustar el resto del mes",
      mensaje: `Se mantienen tus ${plural(cal.manuales.length, "guardia cambiada", "guardias cambiadas")} a mano y se recoloca todo lo demás para que cada médico quede lo más cerca posible de su objetivo. Puedes deshacerlo.`,
      aceptar: "Reajustar",
    });
    if (!ok) return;
    const { anio, mes, clave } = resultado;
    const nuevo = M.generarCalendario(estado, anio, mes, { fijas: fijasDe(cal), semanasPrevias: semanasVecinas(anio, mes) });
    apilarDeshacer(clave, "reajustar el resto");
    const dias = compactar(nuevo.dias);
    const manuales = new Set(cal.manuales);
    const generados = dias.map((d) => {
      const anterior = cal.generados.find((g) => g.fecha === d.fecha) || {};
      return Object.fromEntries([["fecha", d.fecha], ...M.PUESTOS.map((p) => [p.clave, manuales.has(`${d.fecha}|${p.clave}`) ? anterior[p.clave] ?? M.SIN_ASIGNAR : d[p.clave]])]);
    });
    Object.assign(cal, { dias, generados, generadoEl: new Date().toISOString(), editadoEl: new Date().toISOString(), firma: firmaConfiguracion(anio, mes) });
    tocarCalendario();
    avisar("Resto del mes reajustado. Tus cambios a mano se han mantenido.", { tipo: "ok" });
  };

  const volverAlGenerado = async () => {
    const cal = calendarioDelResultado();
    if (!cal || cal.manuales.length === 0) return;
    const ok = await confirmar({
      titulo: "Descartar los cambios a mano",
      mensaje: `Se quitan las ${plural(cal.manuales.length, "guardia cambiada", "guardias cambiadas")} a mano y vuelve el calendario tal como se generó. Puedes deshacerlo.`,
      aceptar: "Descartar cambios",
      peligro: true,
    });
    if (!ok) return;
    apilarDeshacer(resultado.clave, "descartar los cambios a mano");
    cal.dias = copiarDias(cal.generados);
    cal.manuales = [];
    cal.editadoEl = new Date().toISOString();
    tocarCalendario();
  };

  // --- Edición de un puesto --------------------------------------------------------------------------

  const cambiarPuesto = (cambios, descripcion) => {
    const cal = calendarioDelResultado();
    apilarDeshacer(resultado.clave, descripcion);
    const manuales = new Set(cal.manuales);
    cambios.forEach(({ fecha, puesto, medico }) => {
      const dia = cal.dias.find((d) => d.fecha === fecha);
      const generado = cal.generados.find((d) => d.fecha === fecha);
      dia[puesto] = medico;
      const llave = `${fecha}|${puesto}`;
      if (generado && generado[puesto] === medico) manuales.delete(llave);
      else manuales.add(llave);
    });
    cal.manuales = [...manuales].sort();
    cal.editadoEl = new Date().toISOString();
    tocarCalendario();
  };

  const balance = (nombre) => {
    const r = resultado.resumen;
    const asignadas = r.asignaciones[nombre] || 0;
    return { asignadas, objetivo: r.objetivos[nombre] || 0, dif: asignadas - (r.objetivos[nombre] || 0) };
  };
  const textoBalance = (nombre) => {
    const b = balance(nombre);
    return `${b.asignadas} de ${decimal(b.objetivo)} (${conSigno(b.dif)})`;
  };

  const editarPuesto = async (fecha, puesto) => {
    const cal = calendarioDelResultado();
    const dia = cal?.dias.find((d) => d.fecha === fecha);
    const p = M.PUESTOS.find((x) => x.clave === puesto);
    if (!dia || !p) return;
    const actual = dia[puesto];
    const semana = M.claveSemana(M.desdeISO(fecha));
    const porSemana = semanasVecinas(resultado.anio, resultado.mes);
    Object.entries(M.guardiasPorSemana(cal.dias)).forEach(([m, s]) => {
      porSemana[m] = porSemana[m] || {};
      porSemana[m][semana] = (porSemana[m][semana] || 0) + (s[semana] || 0);
    });
    const otroPuesto = (nombre) => M.PUESTOS.find((x) => x.clave !== puesto && dia[x.clave] === nombre);
    const difActual = actual in resultado.resumen.objetivos ? balance(actual).dif : null;

    const candidatos = activos()
      .filter((m) => m.nombre !== actual)
      .map((m) => {
        const nombre = m.nombre;
        const motivos = [];
        const motivo = M.comprobarPuesto(estado, nombre, fecha, p.franja);
        if (motivo) motivos.push(TEXTO_MOTIVO[motivo] || motivo);
        const ocupado = otroPuesto(nombre);
        const enSemana = porSemana[nombre]?.[semana] || 0;
        if (!ocupado && enSemana >= M.TOPE_SEMANAL) motivos.push(`ya tiene ${enSemana} guardias esa semana`);
        const dif = balance(nombre).dif;
        // Efecto en la suma de (asignadas − objetivo)²: negativo = acerca el reparto a los objetivos.
        const efecto = ocupado ? 0 : (dif + 1) ** 2 - dif ** 2 + (difActual === null ? 0 : (difActual - 1) ** 2 - difActual ** 2);
        return { nombre, motivos, ocupado, enSemana, dif, efecto };
      });
    const validos = candidatos.filter((c) => c.motivos.length === 0 && !c.ocupado).sort((a, b) => a.dif - b.dif || ordenAlfabetico(a.nombre, b.nombre));
    const intercambios = candidatos.filter((c) => c.ocupado && c.motivos.length === 0 && (actual === M.SIN_ASIGNAR || !M.comprobarPuesto(estado, actual, fecha, c.ocupado.franja)));
    const forzados = candidatos.filter((c) => c.motivos.length > 0 || (c.ocupado && !intercambios.includes(c))).sort((a, b) => ordenAlfabetico(a.nombre, b.nombre));

    const boton = (valor, principal, detalle, clase = "") =>
      crear("button", { type: "button", class: `opcion-medico ${clase}`.trim(), "data-valor": valor }, [crear("span", { class: "om-nombre", texto: principal }), crear("span", { class: "om-detalle", texto: detalle })]);
    const bloques = [];
    bloques.push(
      crear("p", { class: "editor-actual" }, [
        document.createTextNode("Ahora: "),
        crear("b", { texto: actual === M.SIN_ASIGNAR ? "sin cubrir" : actual }),
        document.createTextNode(actual in resultado.resumen.objetivos ? ` · lleva ${textoBalance(actual)}` : ""),
      ])
    );
    if (validos.length) {
      bloques.push(crear("h4", { texto: "Disponibles en esta franja" }), crear("p", { class: "help-text", texto: "Ordenados de quien más lejos está por debajo de su objetivo a quien más por encima. «Equilibra» = el cambio acerca el reparto a los objetivos." }));
      bloques.push(
        crear(
          "div",
          { class: "lista-opciones" },
          validos.map((c) =>
            boton(
              `poner:${c.nombre}`,
              c.nombre,
              `${textoBalance(c.nombre)} · ${plural(c.enSemana, "guardia", "guardias")} esa semana${c.efecto < -0.01 ? " · equilibra" : c.efecto > 0.01 ? " · desequilibra" : ""}`,
              c.efecto < -0.01 ? "equilibra" : ""
            )
          )
        )
      );
    } else {
      const porTope = candidatos.filter((c) => !c.ocupado && c.motivos.length === 1 && c.motivos[0].startsWith("ya tiene")).length;
      bloques.push(
        crear("p", {
          class: "help-text",
          texto: porTope
            ? `Nadie más puede sin crear una incidencia: ${plural(porTope, "médico de esta franja ya tiene", "médicos de esta franja ya tienen")} ${M.TOPE_SEMANAL} guardias esa semana. Puedes intercambiar con otro puesto del mismo día o ver «Otros médicos».`
            : "Nadie más está disponible en esta franja ese día sin crear una incidencia (el motivo de cada uno está en «Otros médicos»).",
        })
      );
    }
    if (intercambios.length) {
      bloques.push(crear("h4", { texto: "Intercambiar con otro puesto del mismo día" }));
      bloques.push(
        crear(
          "div",
          { class: "lista-opciones" },
          intercambios.map((c) => boton(`cambiar:${c.nombre}`, `${c.nombre} ⇄`, `${TEXTO_PUESTO[c.ocupado.clave]} pasa a ${actual === M.SIN_ASIGNAR ? "quedar sin cubrir" : nombreCorto(actual)}`))
        )
      );
    }
    if (forzados.length) {
      bloques.push(
        crear("details", { class: "forzados" }, [
          crear("summary", { texto: `Otros médicos (${forzados.length}): crean una incidencia` }),
          crear("p", { class: "help-text", texto: "Úsalo solo para un acuerdo real (por ejemplo, alguien que cubre a un compañero fuera de su franja). Quedará marcado con ⚠." }),
          crear(
            "div",
            { class: "lista-opciones" },
            forzados.map((c) => boton(`poner:${c.nombre}`, c.nombre, `⚠ ${[...c.motivos, ...(c.ocupado ? ["ya tiene otra guardia ese día"] : [])].join("; ")}`, "forzado"))
          ),
        ])
      );
    }
    const generado = cal.generados.find((d) => d.fecha === fecha)?.[puesto];
    const extras = [];
    if (cal.manuales.includes(`${fecha}|${puesto}`) && generado !== undefined) extras.push(boton(`poner:${generado}`, "↺ Volver a lo generado", generado === M.SIN_ASIGNAR ? "sin cubrir" : generado));
    if (actual !== M.SIN_ASIGNAR) extras.push(boton(`poner:${M.SIN_ASIGNAR}`, "Dejar sin cubrir", "el puesto queda vacío (---)", "forzado"));
    if (extras.length) bloques.push(crear("div", { class: "lista-opciones extras" }, extras));

    const valor = await dialogo({
      titulo: `${fechaLarga(fecha)} · ${TEXTO_PUESTO[puesto]}`,
      cuerpo: crear("div", { class: "editor-puesto" }, bloques),
      ancho: true,
      botones: [{ texto: "Cancelar", valor: null, clase: "secondary", foco: true }],
    });
    if (typeof valor !== "string") return;
    const [accion, ...resto] = valor.split(":");
    const nombre = resto.join(":");
    if (accion === "poner") {
      cambiarPuesto([{ fecha, puesto, medico: nombre }], `${formatearFecha(fecha)} ${TEXTO_PUESTO[puesto].toLowerCase()}`);
      avisar(nombre === M.SIN_ASIGNAR ? `${TEXTO_PUESTO[puesto]} del ${formatearFecha(fecha)}: sin cubrir.` : `${TEXTO_PUESTO[puesto]} del ${formatearFecha(fecha)}: ${nombre}. Ahora lleva ${textoBalance(nombre)}.`, { tipo: "ok" });
    } else if (accion === "cambiar") {
      const otro = otroPuesto(nombre);
      cambiarPuesto(
        [
          { fecha, puesto, medico: nombre },
          { fecha, puesto: otro.clave, medico: actual },
        ],
        `intercambio del ${formatearFecha(fecha)}`
      );
      avisar(`Intercambiados ${TEXTO_PUESTO[puesto].toLowerCase()} y ${TEXTO_PUESTO[otro.clave].toLowerCase()} del ${formatearFecha(fecha)}.`, { tipo: "ok" });
    }
  };

  const aplicarSugerencia = (indice) => {
    const s = resultado?.sugerencias?.[indice];
    if (!s) return;
    cambiarPuesto([{ fecha: s.fecha, puesto: s.puesto, medico: s.a }], `retoque del ${formatearFecha(s.fecha)}`);
    avisar(`${TEXTO_PUESTO[s.puesto]} del ${formatearFecha(s.fecha)}: ${s.a}.`, { tipo: "ok" });
  };

  // --- Histórico del mes -----------------------------------------------------------------------------

  const guardarEnHistorico = async () => {
    if (!resultado) return;
    const etiqueta = nombreMes(resultado.anio, resultado.mes);
    const coincide = historicoCoincide();
    const yaGuardado = coincide !== null;
    if (coincide === true) {
      avisar(`${etiqueta} ya está en el histórico con estos mismos números.`);
      return;
    }
    const partes = [
      yaGuardado
        ? `${etiqueta} ya está en el histórico con otros números. Se sustituirá por los de este calendario.`
        : `Se guardará, para cada médico, la diferencia entre sus guardias y su objetivo de ${etiqueta}. Con eso se compensarán los meses siguientes.`,
    ];
    const cal = calendarioDelResultado();
    if (cal?.manuales.length) partes.push(`Incluye tus ${plural(cal.manuales.length, "cambio", "cambios")} a mano.`);
    const graves = resultado.incidencias.filter((i) => i.tipo !== "tope-semanal");
    if (graves.length) partes.push(`Ojo: hay ${plural(graves.length, "guardia que incumple", "guardias que incumplen")} la configuración (marcadas con ⚠).`);
    const ok = await confirmar({
      titulo: `${yaGuardado ? "Actualizar" : "Guardar"} ${etiqueta} en el histórico`,
      mensaje: partes.join(" "),
      aceptar: yaGuardado ? "Actualizar" : "Guardar",
      clase: "success",
    });
    if (!ok) return;
    estado.historico.meses[resultado.clave] = M.diferenciasDelMes(resultado);
    cambiosSinExportarEnSesion = true;
    guardar();
    pintarResultado();
    pintarHistorico();
    pintarPista();
    avisar(`${etiqueta} guardado en el histórico.\nAhora pulsa ⬇ Exportar copia para que el fichero compartido lo tenga.`, { tipo: "ok", duracion: 8000 });
  };

  // --- Pintado del resultado ---------------------------------------------------------------------------

  const clasePorDesviacion = (valor) => {
    const abs = Math.abs(valor);
    if (abs <= 0.5) return "valor-ok";
    if (abs <= M.UMBRAL_DESVIACION) return "valor-medio";
    return "valor-mal";
  };

  const tarjeta = (titulo, lineas, clase = "") =>
    crear("div", { class: `stat-card ${clase}`.trim() }, [crear("h4", { texto: titulo }), ...lineas]);
  const lineaValor = (etiqueta, valor) => crear("div", {}, [document.createTextNode(`${etiqueta}: `), crear("span", { class: "stat-value", texto: String(valor) })]);

  const textoIncidencia = (i) => {
    if (i.tipo === "tope-semanal") return `${i.medico}: ${i.guardias} guardias en la semana del ${i.fechas.map((f) => formatearFecha(f).slice(0, 5)).join(", ")} (el tope es ${M.TOPE_SEMANAL}).`;
    return `${fechaLarga(i.fecha)} · ${TEXTO_PUESTO[i.puesto]} · ${i.medico}: ${TEXTO_MOTIVO[i.tipo] || i.tipo}.`;
  };

  /**
   * Análisis del mes en frases, para la pantalla y para copiar. Cada elemento es
   * { clase, texto } y los textos se entienden sin ver la tabla.
   */
  const analizar = () => {
    const r = resultado.resumen;
    const eq = M.evaluarEquidad(resultado);
    const cal = calendarioDelResultado();
    const manuales = cal?.manuales.length || 0;
    const cambiada = cal && cal.firma && cal.firma !== firmaConfiguracion(resultado.anio, resultado.mes);
    const cubiertos = resultado.totales.cubiertos;
    const ref = manuales || cambiada ? referenciaOptima() : null;
    const refFijas = manuales ? referenciaOptima(fijasDe(cal)) : null;
    const nombres = Object.keys(r.objetivos);
    const lineas = { veredicto: null, claves: [], vacios: [], incidencias: [], ref, eq };
    if (nombres.length === 0) return lineas;
    const peor = `${conSigno(eq.peor.desviacion)} (${eq.peor.medico})`;
    const huecos = (n) => (n > 0 ? ` y ${plural(n, "puesto cubrible queda", "puestos cubribles quedan")} sin cubrir` : "");

    if (peorQue(eq, cubiertos, refFijas)) {
      // Se puede mejorar sin tocar lo decidido a mano.
      lineas.veredicto = {
        clase: "veredicto-mal",
        texto: `⚠ Se puede repartir mejor sin tocar tus cambios a mano: ahora la mayor desviación es ${peor}${huecos(refFijas.cubiertos - cubiertos)}. Con «Reajustar el resto» quedaría en ${conSigno(refFijas.peor.desviacion)}. También puedes aplicar los retoques sugeridos más abajo.`,
      };
    } else if (peorQue(eq, cubiertos, ref) && manuales) {
      // Es lo mejor manteniendo los cambios a mano, pero esos cambios tienen un coste.
      lineas.veredicto = {
        clase: eq.correcta && cubiertos === ref.cubiertos ? "veredicto-ok" : "veredicto-aviso",
        texto: `${eq.correcta && cubiertos === ref.cubiertos ? "✓" : "⚠"} Es el mejor reparto posible manteniendo tus ${plural(manuales, "cambio", "cambios")} a mano. Esos cambios lo alejan algo del óptimo: la mayor desviación es ${peor}${huecos(ref.cubiertos - cubiertos)}; sin ellos sería ${conSigno(ref.peor.desviacion)}.`,
      };
    } else if (peorQue(eq, cubiertos, ref)) {
      lineas.veredicto = {
        clase: "veredicto-mal",
        texto: `⚠ Con la configuración actual hay un reparto mejor: ahora la mayor desviación es ${peor}${huecos(ref.cubiertos - cubiertos)}; generando de nuevo sería ${conSigno(ref.peor.desviacion)}. Pulsa «Generar de nuevo».`,
      };
    } else if (eq.correcta) {
      lineas.veredicto = {
        clase: "veredicto-ok",
        texto: `✓ Reparto equilibrado: todos quedan a menos de ${decimal(M.UMBRAL_DESVIACION)} guardias de lo que les corresponde. La mayor diferencia es ${peor}. Es el reparto más ajustado posible con esta configuración.`,
      };
    } else {
      lineas.veredicto = {
        clase: "veredicto-aviso",
        texto: `⚠ ${plural(eq.fuera, "médico queda", "médicos quedan")} a más de ${decimal(M.UMBRAL_DESVIACION)} guardias de su objetivo (el que más: ${peor}). Aun así es el reparto más ajustado posible: con estas ausencias, turnos y el tope de ${M.TOPE_SEMANAL} guardias por semana no cabe uno mejor. Si guardas el mes en el histórico, la diferencia se compensa en los meses siguientes.`,
      };
    }

    const porObjetivo = [...nombres].sort((a, b) => r.objetivos[a] - r.objetivos[b]);
    const menos = porObjetivo[0];
    const mas = porObjetivo[porObjetivo.length - 1];
    const jornada = (n) => (r.jornadas[n] < 100 ? ` con jornada del ${r.jornadas[n]} %` : "");
    lineas.claves.push(
      `Qué es el objetivo: las guardias que le tocan a cada médico en proporción a los días que puede hacer guardia este mes (columna Días: laborables en su franja sin ausencias ni días excluidos) y a su jornada. Ejemplo: ${nombreCorto(menos)} puede ${plural(r.diasDisponibles[menos], "día", "días")}${jornada(menos)} y le tocan ${decimal(r.objetivos[menos])}; ${nombreCorto(mas)} puede ${plural(r.diasDisponibles[mas], "día", "días")}${jornada(mas)} y le tocan ${decimal(r.objetivos[mas])}.`
    );
    lineas.claves.push(
      `Por eso es normal que unos hagan más guardias que otros: este mes van de ${eq.minimo} a ${eq.maximo} (diferencia de ${eq.rango}) porque los objetivos van de ${decimal(r.objetivos[menos])} a ${decimal(r.objetivos[mas])}. Si el reparto es justo lo dice la columna Dif. (asignadas − objetivo), no la diferencia entre quien más y quien menos hace.`
    );
    lineas.claves.push(
      `Nadie puede hacer ${decimal(r.objetivos[menos])} guardias: quedar a menos de una del objetivo es lo esperable.${
        resultado.compensacion.factor > 0
          ? ` Al guardar el mes en el histórico, quien queda por debajo recibe algo más en los meses siguientes y quien queda por encima, algo menos (compensación al ${Math.round(resultado.compensacion.factor * 100)} %).`
          : " La compensación histórica está desactivada (factor 0 %), así que esas diferencias no se recuperan después."
      }`
    );
    if (resultado.compensacion.factor > 0 && resultado.compensacion.meses.length) {
      lineas.claves.push(`Los objetivos de este mes ya descuentan lo hecho de más o de menos en ${resultado.compensacion.meses.map(nombreClaveMes).join(", ")}.`);
    }
    if (resultado.cambiosTurno.some((c) => c.cambia)) {
      lineas.claves.push("Los cambios de turno mueven a quien cambia a la otra franja sin cambiar su objetivo: pueden desviar un poco el reparto, que el histórico compensa después.");
    }
    if (resultado.totales.descubiertos > 0) {
      lineas.claves.push(`Los ${resultado.totales.descubiertos} puestos sin cubrir no son de nadie: por eso las Dif. suman ${conSigno(-resultado.totales.descubiertos)} entre todos.`);
    }

    resultado.dias
      .filter((d) => d.esLaborable)
      .forEach((d) =>
        M.PUESTOS.forEach((p) => {
          if (d[p.clave] !== M.SIN_ASIGNAR) return;
          const disponibles = M.disponiblesEnFranja(estado, d.fecha, p.franja);
          const ocupados = disponibles.filter((n) => M.PUESTOS.some((x) => x.franja === p.franja && d[x.clave] === n));
          const franja = p.franja === "MAÑANA" ? "de mañana" : "de tarde";
          let motivo;
          if (disponibles.length === 0) motivo = `no hay ningún médico ${franja} disponible ese día`;
          else if (disponibles.length === ocupados.length) motivo = `solo ${disponibles.length === 1 ? "hay un médico" : `hay ${disponibles.length} médicos`} ${franja} disponible${disponibles.length === 1 ? "" : "s"} (${disponibles.map(nombreCorto).join(", ")}) y ya ${disponibles.length === 1 ? "hace" : "hacen"} el otro puesto`;
          else motivo = `hay médicos ${franja} libres (${disponibles.filter((n) => !ocupados.includes(n)).map(nombreCorto).join(", ")}): se puede cubrir a mano`;
          lineas.vacios.push({ texto: `${fechaLarga(d.fecha)} · ${TEXTO_PUESTO[p.clave]}: ${motivo}.`, cubrible: disponibles.length > ocupados.length });
        })
      );
    lineas.incidencias = resultado.incidencias.map(textoIncidencia);
    return lineas;
  };

  const pintarAvisosResultado = () => {
    if (!resultado) return;
    const lista = $("avisosResultado");
    const items = [];
    const aviso = (clase, texto) => items.push(crear("li", { class: clase, texto }));
    const cal = calendarioDelResultado();
    const coincide = historicoCoincide();
    if (cal?.firma && cal.firma !== firmaConfiguracion(resultado.anio, resultado.mes)) {
      aviso(
        "aviso-atencion",
        `La configuración ha cambiado desde que se generó este calendario${cal.generadoEl ? ` (${fechaHora(cal.generadoEl)})` : ""}. Las guardias no se han movido, pero los objetivos, el resumen y los avisos ya están recalculados con la configuración actual. Para un reparto nuevo: «Generar de nuevo» o, si quieres conservar tus cambios a mano, «Reajustar el resto».`
      );
    }
    const graves = resultado.incidencias.filter((i) => i.tipo !== "tope-semanal");
    if (graves.length) aviso("aviso-critico", `${plural(graves.length, "guardia incumple", "guardias incumplen")} la configuración (celdas con ⚠): ${graves.slice(0, 3).map(textoIncidencia).join(" ")}${graves.length > 3 ? " …" : ""}`);
    if (resultado.totales.descubiertos > 0) aviso("aviso-critico", `${plural(resultado.totales.descubiertos, "puesto sin cubrir", "puestos sin cubrir")} (celdas --- en rojo). El motivo de cada uno está en «Estadísticas y análisis».`);
    const topes = resultado.incidencias.filter((i) => i.tipo === "tope-semanal");
    if (topes.length) aviso("aviso-atencion", `${plural(topes.length, "vez se pasa", "veces se pasa")} del tope de ${M.TOPE_SEMANAL} guardias por semana: ${topes.map(textoIncidencia).join(" ")}`);
    if (coincide === false) aviso("aviso-critico", `El histórico de ${nombreMes(resultado.anio, resultado.mes)} no coincide con este calendario (cambió después de guardarlo). Pulsa «Actualizar en el histórico» para que la compensación de los próximos meses use estos números.`);
    if (cal?.manuales.length) aviso("aviso-info", `${plural(cal.manuales.length, "guardia cambiada", "guardias cambiadas")} a mano (marcadas con ✎). El resumen y las estadísticas ya las cuentan.`);
    if (resultado.mixtosSinPlan.length) aviso("aviso-atencion", `Turno MIXTO sin planificar: ${resultado.mixtosSinPlan.join(", ")}. Se ha usado L/X/V tarde y M/J mañana; puedes fijarlo en «Plan y cambios de turno».`);
    const aplicados = resultado.cambiosTurno.filter((c) => c.cambia);
    const sinEfecto = resultado.cambiosTurno.filter((c) => c.motivo in NO_DISPONIBLE || c.motivo === "inactivo");
    if (aplicados.length) aviso("aviso-info", `Este mes se aplican ${plural(aplicados.length, "cambio puntual de turno", "cambios puntuales de turno")}. En el calendario, ⇄ marca a quien hace guardia uno de esos días en la franja que no es la suya habitual.`);
    if (sinEfecto.length) aviso("aviso-info", `${plural(sinEfecto.length, "cambio de turno de este mes no se aplica", "cambios de turno de este mes no se aplican")} porque ese día el médico no está disponible (ausencia, exclusión o inactivo).`);
    if (coincide === true) aviso("aviso-info", `${nombreMes(resultado.anio, resultado.mes)} está guardado en el histórico con estos mismos números.`);
    const comp = resultado.compensacion;
    if (comp.factor === 0) aviso("aviso-info", "Compensación histórica desactivada (factor 0 %).");
    else if (comp.meses.length) aviso("aviso-info", `Compensado con ${plural(comp.meses.length, "mes", "meses")} del histórico (${comp.meses.map(nombreClaveMes).join(", ")}) al ${Math.round(comp.factor * 100)} %.`);
    else aviso("aviso-info", "Sin meses anteriores en el histórico: reparto solo por disponibilidad.");
    lista.replaceChildren(...items);

    const boton = $("btnGuardarHistorico");
    boton.textContent = coincide === null ? `💾 Guardar ${nombreMes(resultado.anio, resultado.mes)} en el histórico` : coincide ? "✓ Guardado en el histórico" : "💾 Actualizar en el histórico";
    boton.classList.toggle("pendiente", coincide === false);
  };

  const pintarBarraEdicion = () => {
    const cal = calendarioDelResultado();
    const hayDeshacer = pilaDeshacer.some((p) => p.clave === resultado.clave);
    const manuales = cal?.manuales.length || 0;
    $("btnDeshacer").disabled = !hayDeshacer;
    $("btnReajustar").hidden = manuales === 0;
    $("btnVolverGenerado").hidden = manuales === 0;
    $("estadoEdicion").textContent = manuales
      ? `${plural(manuales, "guardia cambiada", "guardias cambiadas")} a mano.`
      : "Pulsa cualquier guardia para cambiarla. Pulsa un nombre del resumen para resaltar sus guardias.";
  };

  const pintarCalendario = () => {
    const cal = calendarioDelResultado();
    const manuales = new Set(cal?.manuales || []);
    const incidencias = new Map();
    resultado.incidencias.forEach((i) => {
      if (i.puesto) incidencias.set(`${i.fecha}|${i.puesto}`, [...(incidencias.get(`${i.fecha}|${i.puesto}`) || []), TEXTO_MOTIVO[i.tipo] || i.tipo]);
    });
    const tope = new Map();
    resultado.incidencias.filter((i) => i.tipo === "tope-semanal").forEach((i) => i.fechas.forEach((f) => tope.set(`${i.medico}|${f}`, i.guardias)));
    const conCambio = new Map(resultado.cambiosTurno.filter((c) => c.cambia).map((c) => [`${c.medico}|${c.fecha}`, c.habitual]));
    const tbody = cuerpo("tablaCalendario");
    resultado.dias.forEach((d) => {
      const fila = tbody.insertRow();
      fila.insertCell().textContent = d.dia;
      fila.insertCell().textContent = `${formatearFecha(d.fecha)} ${diaDeLaSemana(d.fecha).slice(0, 3).toLowerCase()}`;
      if (!d.esLaborable) {
        fila.className = "fila-finde";
        const celda = fila.insertCell();
        celda.colSpan = 4;
        celda.className = "finde-festivo";
        celda.textContent = d.tipo;
        return;
      }
      M.PUESTOS.forEach((p) => {
        const celda = fila.insertCell();
        const medico = d[p.clave];
        const llave = `${d.fecha}|${p.clave}`;
        const clases = ["editable"];
        const notas = [];
        celda.textContent = medico;
        if (medico === M.SIN_ASIGNAR) {
          clases.push("alerta-descubierto");
          notas.push("Puesto sin cubrir");
        } else if (conCambio.has(`${medico}|${d.fecha}`)) {
          clases.push("cambio-turno");
          notas.push(`Cambio puntual de turno: ese día pasa consulta de ${p.franja} (habitualmente de ${conCambio.get(`${medico}|${d.fecha}`)})`);
        }
        if (manuales.has(llave)) {
          clases.push("editada");
          const generado = cal.generados.find((g) => g.fecha === d.fecha)?.[p.clave];
          notas.push(`Cambiado a mano${generado ? ` (generado: ${generado})` : ""}`);
        }
        if (incidencias.has(llave)) {
          clases.push("incidencia");
          notas.push(`⚠ ${medico} ${incidencias.get(llave).join("; ")}`);
        }
        if (tope.has(`${medico}|${d.fecha}`)) {
          clases.push("pasa-tope");
          notas.push(`${tope.get(`${medico}|${d.fecha}`)} guardias esa semana (tope ${M.TOPE_SEMANAL})`);
        }
        if (resaltado && medico === resaltado) clases.push("resaltado");
        celda.className = clases.join(" ");
        celda.dataset.fecha = d.fecha;
        celda.dataset.puesto = p.clave;
        celda.tabIndex = 0;
        celda.setAttribute("role", "button");
        celda.setAttribute("aria-label", `${fechaLarga(d.fecha)}, ${TEXTO_PUESTO[p.clave]}: ${medico === M.SIN_ASIGNAR ? "sin cubrir" : medico}. Pulsa para cambiar.`);
        notas.push("Pulsa para cambiar");
        celda.title = notas.join("\n");
      });
    });
  };

  const pintarResumen = () => {
    const r = resultado.resumen;
    const tbody = cuerpo("tablaResumen");
    Object.keys(r.objetivos).forEach((nombre) => {
      const medico = estado.medicos.find((m) => m.nombre === nombre);
      const asignadas = r.asignaciones[nombre] || 0;
      const avisos = r.avisos[nombre] || 0;
      const diferencia = asignadas - r.objetivos[nombre];
      const porcentajeAvisos = asignadas > 0 ? Math.round((avisos / asignadas) * 100) : 0;
      const fila = tbody.insertRow();
      if (resaltado === nombre) fila.className = "fila-resaltada";
      const celdaNombre = fila.insertCell();
      const botonNombre = crear("button", { type: "button", class: "enlace-medico", "data-resaltar": nombre, texto: nombre, title: "Resaltar sus guardias en el calendario", "aria-pressed": String(resaltado === nombre) });
      celdaNombre.append(botonNombre);
      fila.insertCell().textContent = medico ? medico.turno : "";
      const celdaJornada = fila.insertCell();
      celdaJornada.textContent = `${r.jornadas[nombre]} %`;
      if (r.jornadas[nombre] < 100) celdaJornada.className = "negrita";
      fila.insertCell().textContent = r.diasDisponibles[nombre];
      fila.insertCell().textContent = decimal(r.objetivos[nombre]);
      const celdaAsignadas = fila.insertCell();
      celdaAsignadas.textContent = asignadas;
      celdaAsignadas.className = "negrita";
      const celdaDif = fila.insertCell();
      celdaDif.textContent = conSigno(diferencia);
      celdaDif.className = clasePorDesviacion(diferencia);
      fila.insertCell().textContent = avisos;
      fila.insertCell().textContent = r.urgencias[nombre] || 0;
      const celdaPorc = fila.insertCell();
      celdaPorc.textContent = `${porcentajeAvisos} %`;
      celdaPorc.className = porcentajeAvisos >= 35 && porcentajeAvisos <= 65 ? "valor-ok" : "valor-medio";
      fila.insertCell().textContent = r.lunes[nombre] || 0;
      fila.insertCell().textContent = r.viernes[nombre] || 0;
    });
  };

  const pintarEstadisticas = (analisis) => {
    const r = resultado.resumen;
    const bloques = [];
    if (analisis.veredicto) bloques.push(crear("p", { class: `veredicto ${analisis.veredicto.clase}`, texto: analisis.veredicto.texto }));
    if (analisis.claves.length) {
      bloques.push(crear("h4", { texto: "Cómo leer el resumen" }), crear("ul", { class: "lista-analisis" }, analisis.claves.map((t) => crear("li", { texto: t }))));
    }
    if (analisis.vacios.length) {
      bloques.push(crear("h4", { texto: `Puestos sin cubrir (${analisis.vacios.length})` }), crear("ul", { class: "lista-analisis" }, analisis.vacios.map((v) => crear("li", { class: v.cubrible ? "cubrible" : "", texto: v.texto }))));
    }
    if (analisis.incidencias.length) {
      bloques.push(crear("h4", { texto: `Incidencias (${analisis.incidencias.length})` }), crear("ul", { class: "lista-analisis incidencias" }, analisis.incidencias.map((t) => crear("li", { texto: t }))));
    }
    const sugerencias = (resultado.sugerencias = M.sugerirReajustes(estado, resultado, { semanasPrevias: semanasVecinas(resultado.anio, resultado.mes) }));
    if (sugerencias.length) {
      bloques.push(
        crear("h4", { texto: "Retoques sugeridos" }),
        crear("p", { class: "help-text", texto: "Cada uno cambia una sola guardia, no crea incidencias y acerca el reparto a los objetivos. Se aplican de uno en uno y se pueden deshacer." }),
        crear(
          "ul",
          { class: "lista-sugerencias" },
          sugerencias.map((s, i) => {
            const texto = s.cubre
              ? `${fechaLarga(s.fecha)} · ${TEXTO_PUESTO[s.puesto]}: cubrir con ${s.a} (lleva ${textoBalance(s.a)}).`
              : `${fechaLarga(s.fecha)} · ${TEXTO_PUESTO[s.puesto]}: ${s.de} (${conSigno(balance(s.de).dif)}) → ${s.a} (${conSigno(balance(s.a).dif)}).`;
            return crear("li", {}, [crear("span", { texto }), crear("button", { type: "button", class: "pequeno", "data-sugerencia": String(i), texto: "Aplicar" })]);
          })
        )
      );
    }
    const sumar = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);
    const total = resultado.totales;
    const totalAvisos = sumar(r.avisos);
    const porTurno = { MAÑANA: 0, TARDE: 0, MIXTO: 0 };
    Object.keys(r.objetivos).forEach((n) => {
      const m = estado.medicos.find((x) => x.nombre === n);
      if (m && m.turno in porTurno) porTurno[m.turno]++;
    });
    const eq = analisis.eq;
    bloques.push(
      crear("div", { class: "stats-grid" }, [
        tarjeta("Puestos del mes", [lineaValor("A cubrir", total.puestos), lineaValor("Cubiertos", total.cubiertos), lineaValor("Sin cubrir", total.descubiertos)], total.descubiertos > 0 ? "alerta" : ""),
        tarjeta("Equidad", [lineaValor("Mayor desviación", eq.peor.medico ? conSigno(eq.peor.desviacion) : "—"), lineaValor(`Fuera de ±${decimal(M.UMBRAL_DESVIACION)}`, eq.fuera), lineaValor("Guardias por médico", `${eq.minimo}–${eq.maximo}`)], eq.correcta ? "" : "alerta"),
        tarjeta("Distribución por tipo", [lineaValor("Avisos", totalAvisos), lineaValor("Urgencias", sumar(r.urgencias)), crear("small", { texto: `Avisos: ${total.cubiertos ? decimal((totalAvisos / total.cubiertos) * 100) : "0,0"} %` })]),
        tarjeta("Lunes y viernes", [lineaValor("Lunes", sumar(r.lunes)), lineaValor("Viernes", sumar(r.viernes))]),
        tarjeta("Médicos en el reparto", [lineaValor("Mañana", porTurno.MAÑANA), lineaValor("Tarde", porTurno.TARDE), lineaValor("Mixto", porTurno.MIXTO)]),
      ])
    );
    $("estadisticasDetalladas").replaceChildren(...bloques);
  };

  const pintarResultado = () => {
    if (!resultado) return;
    $("areaResultado").hidden = false;
    $("tituloResultado").textContent = `Calendario de guardias · ${nombreMes(resultado.anio, resultado.mes)}`;
    pintarAvisosResultado();
    pintarBarraEdicion();
    pintarCalendario();
    pintarResumen();
    pintarEstadisticas(analizar());
  };

  const alternarResaltado = (nombre) => {
    resaltado = resaltado === nombre ? null : nombre;
    pintarCalendario();
    pintarResumen();
  };

  // --- Copiar (Excel, Teams, Outlook) ------------------------------------------------------------------
  //
  // Se construye un HTML sencillo con estilos en línea y atributos clásicos
  // (bgcolor, width), que es lo que conservan Excel, Teams y Outlook al pegar,
  // y una versión en texto con tabuladores para donde no se acepta HTML.

  const copiarExcel = async (soloCalendario) => {
    if (!resultado) {
      avisar("Genera primero un calendario.", { tipo: "error" });
      return;
    }
    const BORDE = "border:1px solid #c7cfdd;";
    const FUENTE = 'font-family:"Segoe UI",Calibri,Arial,sans-serif; font-size:11pt;';
    const COLOR = { cabecera: "#4a6fa5", titulo: "#1e3a8a", finde: "#f1f5f9", vacio: "#fee2e2", ok: "#c8e6c9", medio: "#fff9c4", mal: "#ffcdd2" };
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const td = (texto, { fondo, negrita, centro, color, colspan, cursiva } = {}) =>
      `<td${fondo ? ` bgcolor="${fondo}"` : ""}${colspan ? ` colspan="${colspan}"` : ""} style="${BORDE} padding:4px 10px; vertical-align:top;${fondo ? ` background-color:${fondo};` : ""}${negrita ? " font-weight:bold;" : ""}${centro ? " text-align:center;" : ""}${color ? ` color:${color};` : ""}${cursiva ? " font-style:italic;" : ""}">${negrita ? `<b>${esc(texto)}</b>` : esc(texto)}</td>`;
    const th = (texto) => `<td bgcolor="${COLOR.cabecera}" style="${BORDE} padding:5px 10px; background-color:${COLOR.cabecera}; color:#ffffff; font-weight:bold;"><b>${esc(texto)}</b></td>`;
    const tabla = (titulo, anchos, cabecera, filas) => {
      const cols = anchos.map((a) => `<col width="${a}" style="width:${a}px">`).join("");
      const tituloFila = `<tr><td colspan="${anchos.length}" bgcolor="${COLOR.titulo}" style="${BORDE} padding:6px 10px; background-color:${COLOR.titulo}; color:#ffffff; font-weight:bold; font-size:12pt;"><b>${esc(titulo)}</b></td></tr>`;
      return `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse; ${FUENTE}"><colgroup>${cols}</colgroup>${tituloFila}${cabecera ? `<tr>${cabecera.map(th).join("")}</tr>` : ""}${filas.map((f) => `<tr>${f}</tr>`).join("")}</table>`;
    };
    const etiquetaMes = nombreMes(resultado.anio, resultado.mes);
    const textos = [];

    const cabCal = ["Día", "Fecha", ...M.PUESTOS.map((p) => TEXTO_PUESTO[p.clave])];
    const filasCal = resultado.dias.map((d) => {
      const fecha = `${formatearFecha(d.fecha)} ${diaDeLaSemana(d.fecha).slice(0, 3).toLowerCase()}`;
      if (!d.esLaborable) return td(d.dia, { fondo: COLOR.finde }) + td(fecha, { fondo: COLOR.finde }) + td(d.tipo, { fondo: COLOR.finde, colspan: 4, centro: true, cursiva: true, color: "#64748b" });
      return td(d.dia) + td(fecha) + M.PUESTOS.map((p) => (d[p.clave] === M.SIN_ASIGNAR ? td("---", { fondo: COLOR.vacio, negrita: true, centro: true, color: "#b91c1c" }) : td(d[p.clave]))).join("");
    });
    let html = tabla(`Guardias · ${etiquetaMes}`, [40, 100, 210, 210, 210, 210], cabCal, filasCal);
    textos.push(`Guardias · ${etiquetaMes}`, cabCal.join("\t"), ...resultado.dias.map((d) => [d.dia, formatearFecha(d.fecha), ...(d.esLaborable ? M.PUESTOS.map((p) => d[p.clave]) : [d.tipo])].join("\t")));

    if (!soloCalendario) {
      const r = resultado.resumen;
      const cabRes = ["Médico", "Turno", "Jornada", "Días", "Objetivo", "Asignadas", "Dif.", "Avisos", "Urgencias", "% avisos", "Lunes", "Viernes"];
      const fondoDif = (v) => ({ "valor-ok": COLOR.ok, "valor-medio": COLOR.medio, "valor-mal": COLOR.mal })[clasePorDesviacion(v)];
      const filasRes = [];
      const textoRes = [];
      Object.keys(r.objetivos).forEach((n) => {
        const asignadas = r.asignaciones[n] || 0;
        const dif = asignadas - r.objetivos[n];
        const pAvi = asignadas ? Math.round(((r.avisos[n] || 0) / asignadas) * 100) : 0;
        const turno = estado.medicos.find((m) => m.nombre === n)?.turno || "";
        const valores = [n, turno, `${r.jornadas[n]} %`, r.diasDisponibles[n], decimal(r.objetivos[n]), asignadas, conSigno(dif), r.avisos[n] || 0, r.urgencias[n] || 0, `${pAvi} %`, r.lunes[n] || 0, r.viernes[n] || 0];
        filasRes.push(valores.map((v, i) => (i === 6 ? td(v, { fondo: fondoDif(dif), centro: true }) : td(v, { negrita: i === 5, centro: i > 1 }))).join(""));
        textoRes.push(valores.join("\t"));
      });
      html += `<br>${tabla(`Resumen · ${etiquetaMes}`, [240, 80, 70, 50, 70, 80, 60, 60, 80, 70, 55, 60], cabRes, filasRes)}`;
      textos.push("", `Resumen · ${etiquetaMes}`, cabRes.join("\t"), ...textoRes);

      const a = analizar();
      const lineas = [];
      if (a.veredicto) lineas.push({ texto: a.veredicto.texto, negrita: true, fondo: a.veredicto.clase === "veredicto-ok" ? COLOR.ok : a.veredicto.clase === "veredicto-mal" ? COLOR.mal : COLOR.medio });
      a.claves.forEach((t) => lineas.push({ texto: `• ${t}` }));
      if (a.vacios.length) {
        lineas.push({ texto: `Puestos sin cubrir (${a.vacios.length})`, negrita: true });
        a.vacios.forEach((v) => lineas.push({ texto: `• ${v.texto}` }));
      }
      if (a.incidencias.length) {
        lineas.push({ texto: `Incidencias (${a.incidencias.length})`, negrita: true });
        a.incidencias.forEach((t) => lineas.push({ texto: `• ${t}` }));
      }
      const t = resultado.totales;
      lineas.push({ texto: `Puestos: ${t.puestos} a cubrir · ${t.cubiertos} cubiertos · ${t.descubiertos} sin cubrir. Mayor desviación: ${a.eq.peor.medico ? `${conSigno(a.eq.peor.desviacion)} (${a.eq.peor.medico})` : "—"}.` });
      html += `<br>${tabla("Estadísticas y análisis", [900], null, lineas.map((l) => td(l.texto, { negrita: l.negrita, fondo: l.fondo })))}`;
      textos.push("", "Estadísticas y análisis", ...lineas.map((l) => l.texto));
    }

    const documento = `<html><head><meta charset="utf-8"></head><body style="${FUENTE}">${html}</body></html>`;
    const texto = textos.join("\n");
    const aviso = soloCalendario ? "Calendario copiado: pégalo en Excel, Teams o un correo." : "Calendario, resumen y análisis copiados: pégalos en Excel, Teams o un correo.";
    try {
      if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([documento], { type: "text/html" }), "text/plain": new Blob([texto], { type: "text/plain" }) })]);
        avisar(aviso, { tipo: "ok" });
        return;
      }
    } catch (e) {
      /* se intenta el método clásico */
    }
    const contenedor = document.createElement("div");
    try {
      contenedor.innerHTML = html;
      contenedor.style.position = "absolute";
      contenedor.style.left = "-9999px";
      document.body.append(contenedor);
      const seleccion = window.getSelection();
      const rango = document.createRange();
      rango.selectNodeContents(contenedor);
      seleccion.removeAllRanges();
      seleccion.addRange(rango);
      const hecho = document.execCommand("copy");
      seleccion.removeAllRanges();
      contenedor.remove();
      if (!hecho) throw new Error("copy rechazado");
      avisar(aviso, { tipo: "ok" });
    } catch (e) {
      contenedor.remove();
      avisar("No se ha podido copiar. Selecciona la tabla con el ratón y pulsa Ctrl+C.", { tipo: "error" });
    }
  };

  // --- Copia de seguridad: exportar e importar --------------------------------------------------

  const exportarCopia = () => {
    if (!hayDatos()) {
      avisar("Todavía no hay datos que exportar.");
      return;
    }
    const ahora = new Date();
    estado.ultimaCopia = ahora.toISOString();
    guardar(false);
    cambiosSinExportarEnSesion = false;
    const copia = { tipo: "copia-completa-guardias", fechaExportacion: ahora.toISOString(), ...estado };
    const fecha = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" }));
    const enlace = crear("a", { href: url, download: `guardias_copia_${fecha}.json` });
    document.body.append(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
    avisar("Copia descargada. Guárdala en una carpeta compartida o pásasela a quien vaya a llevar las guardias.", { tipo: "ok", duracion: 6000 });
  };

  const describir = (e) => {
    const meses = Object.keys(e.historico.meses).length;
    return `${plural(e.medicos.length, "médico", "médicos")}, ${plural(e.festivos.length, "festivo", "festivos")}, ${plural(e.ausencias.length, "ausencia", "ausencias")} y ${plural(meses, "mes", "meses")} de histórico`;
  };

  const CAMPOS_CONFIGURACION = ["medicos", "reducciones", "festivos", "ausencias", "exclusionesPuntuales", "planificacionesTurnos", "cambiosTurno"];

  const importarFichero = async (fichero) => {
    let datos;
    try {
      datos = JSON.parse(await fichero.text());
    } catch (e) {
      avisar("Ese fichero no es una copia del gestor de guardias (no es JSON válido).", { tipo: "error" });
      return;
    }
    const tipo = M.detectarFichero(datos);
    if (!tipo.configuracion && !tipo.historico) {
      avisar("El fichero no contiene ni configuración ni histórico de guardias.", { tipo: "error" });
      return;
    }
    const entrante = M.normalizarEstado(datos);
    const hayConfiguracion = estado.medicos.length > 0;
    const hayHistorico = Object.keys(estado.historico.meses).length > 0;
    const actual = describir(estado);

    if (tipo.configuracion && tipo.historico) {
      if (hayDatos()) {
        const ok = await confirmar({
          titulo: "Importar copia completa",
          mensaje: `El fichero trae ${describir(entrante)}. Sustituirá todo lo que hay ahora en este navegador (${actual}).`,
          aceptar: "Sustituir todo",
          peligro: true,
        });
        if (!ok) return;
      }
      estado = entrante;
      // Lo cargado es justo lo que hay en el fichero: no queda nada pendiente de exportar.
      estado.ultimaCopia = new Date().toISOString();
      estado.ultimoCambio = null;
    } else if (tipo.configuracion) {
      if (hayConfiguracion) {
        const ok = await confirmar({
          titulo: "Importar configuración",
          mensaje: `El fichero trae ${plural(entrante.medicos.length, "médico", "médicos")} con sus festivos, ausencias y turnos. Sustituirá la configuración actual; el histórico no se toca.`,
          aceptar: "Sustituir configuración",
          peligro: true,
        });
        if (!ok) return;
      }
      CAMPOS_CONFIGURACION.forEach((campo) => {
        estado[campo] = entrante[campo];
      });
      if (datos.configuracionAlgoritmo) estado.configuracionAlgoritmo = entrante.configuracionAlgoritmo;
    } else {
      let modo = "sustituir";
      if (hayHistorico) {
        modo = await dialogo({
          titulo: "Importar histórico",
          cuerpo: `El fichero trae ${plural(Object.keys(entrante.historico.meses).length, "mes", "meses")} de histórico y ya tienes ${plural(Object.keys(estado.historico.meses).length, "mes guardado", "meses guardados")}. Fusionar conserva los dos (si un mes está en ambos, gana el del fichero). Sustituir deja solo el del fichero.`,
          botones: [
            { texto: "Cancelar", valor: null, clase: "secondary" },
            { texto: "Sustituir", valor: "sustituir", clase: "danger" },
            { texto: "Fusionar", valor: "fusionar", foco: true },
          ],
        });
        if (!modo) return;
      }
      if (modo === "fusionar") Object.assign(estado.historico.meses, entrante.historico.meses);
      else estado.historico = entrante.historico;
    }

    guardar(!(tipo.configuracion && tipo.historico));
    pilaDeshacer = [];
    resaltado = null;
    pintarTodo();

    const nombres = new Set(estado.medicos.map((m) => m.nombre));
    const desconocidos = new Set();
    Object.values(estado.historico.meses).forEach((mes) => Object.keys(mes || {}).forEach((n) => !nombres.has(n) && desconocidos.add(n)));
    const extra = desconocidos.size && estado.medicos.length ? `\nOjo: ${plural(desconocidos.size, "nombre", "nombres")} del histórico no están en la lista de médicos (ver Parámetros Avanzados).` : "";
    avisar(`Importado: ${describir(estado)}.${extra}`, { tipo: "ok", duracion: extra ? 9000 : 5000 });
  };

  // --- Pintado general y eventos ------------------------------------------------------------------

  const pintarTodo = () => {
    pintarMedicos();
    poblarSelects();
    pintarReducciones();
    pintarFestivos();
    pintarAusencias();
    pintarExclusiones();
    pintarPlanes();
    pintarCambios();
    pintarParametros();
    pintarHistorico();
    pintarBienvenida();
    pintarEstadoDatos();
    pintarPista();
    mostrarMes();
  };

  const ACCIONES = {
    "agregar-medico": agregarMedico,
    "importar-medicos": procesarImportacionMasiva,
    "guardar-reduccion": guardarReduccion,
    "agregar-festivo": agregarFestivo,
    "agregar-ausencia": agregarAusencia,
    "agregar-exclusion": agregarExclusionPuntual,
    "guardar-plan": guardarPlanTurno,
    "agregar-cambio": agregarCambioTurno,
    "quitar-cambios": quitarCambiosDeFechas,
    "borrar-cambios-pasados": borrarCambiosPasados,
    "nueva-semilla": nuevaSemilla,
    "detalle-historico": verDetalleHistorico,
    generar: generarGuardias,
    "guardar-historico": guardarEnHistorico,
    "copiar-calendario": () => copiarExcel(true),
    "copiar-todo": () => copiarExcel(false),
    deshacer,
    reajustar: reajustarResto,
    "volver-generado": volverAlGenerado,
    exportar: exportarCopia,
    importar: () => $("importarInput").click(),
    "ir-manual": () => {
      irASeccion("manual");
      window.scrollTo({ top: 0 });
    },
    empezar: empezarDeCero,
  };

  const conIntro = (id, accion) => {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        accion();
      }
    });
  };

  const enlazarEventos = () => {
    document.addEventListener("click", (e) => {
      const seccion = e.target.closest("[data-seccion]");
      if (seccion) {
        irASeccion(seccion.dataset.seccion);
        return;
      }
      const pestana = e.target.closest("[data-tab]");
      if (pestana) {
        abrirPestana(pestana.dataset.tab);
        return;
      }
      const boton = e.target.closest("[data-accion]");
      if (boton && ACCIONES[boton.dataset.accion]) {
        e.preventDefault();
        ACCIONES[boton.dataset.accion]();
        return;
      }
      const celda = e.target.closest("#tablaCalendario td.editable");
      if (celda) {
        editarPuesto(celda.dataset.fecha, celda.dataset.puesto);
        return;
      }
      const nombre = e.target.closest("[data-resaltar]");
      if (nombre) {
        alternarResaltado(nombre.dataset.resaltar);
        return;
      }
      const sugerencia = e.target.closest("[data-sugerencia]");
      if (sugerencia) aplicarSugerencia(Number(sugerencia.dataset.sugerencia));
    });

    $("tablaCalendario").addEventListener("keydown", (e) => {
      const celda = e.target.closest("td.editable");
      if (celda && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        editarPuesto(celda.dataset.fecha, celda.dataset.puesto);
      }
    });

    $("importarInput").addEventListener("change", (e) => {
      const fichero = e.target.files[0];
      e.target.value = "";
      if (fichero) importarFichero(fichero);
    });

    $("nuevoMedicoNombre").addEventListener("input", validarNombreNuevo);
    conIntro("nuevoMedicoNombre", agregarMedico);
    conIntro("nuevoMedicoTurno", agregarMedico);
    conIntro("nuevoFestivo", agregarFestivo);
    conIntro("reduccionPorcentaje", guardarReduccion);
    conIntro("ausenciaInicio", () => $("ausenciaFin").focus());
    conIntro("ausenciaFin", agregarAusencia);
    conIntro("exclPuntFecha", agregarExclusionPuntual);
    $("ausenciaInicio").addEventListener("change", validarRangoAusencia);
    $("ausenciaFin").addEventListener("change", validarRangoAusencia);

    $("reduccionMedico").addEventListener("change", cargarReduccionEnFormulario);
    $("planTurnoMedico").addEventListener("change", cargarPlanEnFormulario);
    ["cambioMedico", "cambioDesde", "cambioHasta", "cambioTurno"].forEach((id) => {
      $(id).addEventListener("change", pintarVistaPreviaCambio);
      $(id).addEventListener("input", pintarVistaPreviaCambio);
    });
    conIntro("cambioHasta", agregarCambioTurno);
    $("verCambiosPasados").addEventListener("change", pintarCambios);

    $("factorCompensacion").addEventListener("input", (e) => {
      $("valorFactor").textContent = `${e.target.value} %`;
    });
    $("factorCompensacion").addEventListener("change", guardarFactor);
    $("ventanaHistorico").addEventListener("change", guardarVentana);
    $("usarAleatoriedad").addEventListener("change", (e) => {
      estado.configuracionAlgoritmo.usarAleatoriedad = e.target.checked;
      $("opcionesAleatoriedad").hidden = !e.target.checked;
      cambioConfiguracion();
    });
    $("semillaAleatoria").addEventListener("change", guardarSemilla);

    $("mes").addEventListener("change", alCambiarMes);
    $("anio").addEventListener("change", alCambiarMes);

    document.addEventListener("keydown", (e) => {
      const enCampoTexto = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z" && !enCampoTexto && !$("dialogo").open && !$("calendario").hidden && resultado) {
        e.preventDefault();
        deshacer();
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const enCampo = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if (enCampo || $("dialogo").open) return;
      const tecla = e.key.toLowerCase();
      if (tecla === "m") {
        irASeccion("configuracion");
        abrirPestana("tabMedicos");
      } else if (tecla === "c") irASeccion("calendario");
      else if (tecla === "g") {
        if (!$("calendario").hidden) generarGuardias();
      } else if (tecla === "s") {
        guardar(false);
        avisar(puedeGuardar ? "Guardado." : "Este navegador no deja guardar: exporta una copia.", { tipo: puedeGuardar ? "ok" : "error" });
      } else if (tecla === "h") irASeccion("manual");
      else return;
      e.preventDefault();
    });

    // Otra pestaña ha cambiado los datos: se recargan para no pisarlos.
    window.addEventListener("storage", (e) => {
      if (e.key !== CLAVE_DATOS) return;
      cargar();
      pilaDeshacer = [];
      pintarTodo();
      avisar("Los datos han cambiado en otra pestaña y se han recargado aquí.");
    });

    // Aviso al salir si el navegador no guarda, o si en esta sesión se ha cambiado
    // un calendario o el histórico y no se ha exportado el fichero compartido.
    window.addEventListener("beforeunload", (e) => {
      if ((!puedeGuardar && hayDatos()) || (cambiosSinExportarEnSesion && hayCambiosSinExportar())) e.preventDefault();
    });
  };

  // --- Arranque -------------------------------------------------------------------------------------

  cargar();
  fijarMesPorDefecto();
  enlazarEventos();
  pintarTodo();
  irASeccion("configuracion");
  abrirPestana("tabMedicos");

  window.GuardiasApp = {
    irASeccion,
    abrirPestana,
    seccionVisible: () => document.querySelector(".seccion:not([hidden])")?.id || "configuracion",
    pestanaActiva: () => document.querySelector(".tab-content.active")?.id || "tabMedicos",
    resumen: () => ({ medicos: estado.medicos.length, meses: Object.keys(estado.historico.meses).length }),
  };
})();
