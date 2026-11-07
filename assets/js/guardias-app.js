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
  let resultadoDesactualizado = false;
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

  const guardar = () => {
    // Por compatibilidad con la v1, que lee este campo.
    estado.historico.saldoAcumulado = M.saldoVigente(estado.historico);
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
    if (resultado) {
      resultadoDesactualizado = true;
      pintarAvisosResultado();
    }
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
    if (!estado.ultimaCopia) {
      copia.textContent = "⚠ Sin copia de seguridad";
      copia.className = "copia-pendiente";
      return;
    }
    const dias = diasDesde(estado.ultimaCopia);
    const texto = dias <= 0 ? "Última copia: hoy" : `Última copia: hace ${plural(dias, "día", "días")}`;
    copia.textContent = dias > DIAS_AVISO_COPIA ? `⚠ ${texto}` : texto;
    copia.className = dias > DIAS_AVISO_COPIA ? "copia-pendiente" : "";
  };

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
    opciones.forEach((o) => select.append(crear("option", { value: o, texto: o })));
    if (opciones.includes(anterior)) select.value = anterior;
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
    cargarReduccionEnFormulario();
    cargarPlanEnFormulario();
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
      mensaje: `Se borrarán también su jornada, ausencias, exclusiones y planificación. Su histórico se conserva. Si solo va a dejar de hacer guardias un tiempo, mejor desmárcalo como activo.`,
      aceptar: "Eliminar",
      peligro: true,
    });
    if (!ok) return;
    estado.medicos = estado.medicos.filter((m) => m.nombre !== nombre);
    estado.reducciones = estado.reducciones.filter((r) => r.medico !== nombre);
    estado.ausencias = estado.ausencias.filter((a) => a.medico !== nombre);
    estado.exclusionesPuntuales = estado.exclusionesPuntuales.filter((e) => e.medico !== nombre);
    estado.planificacionesTurnos = estado.planificacionesTurnos.filter((p) => p.medico !== nombre);
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

  const fijarMesPorDefecto = () => {
    const hoy = new Date();
    const siguiente = M.desplazarMes(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    $("mes").value = String(siguiente.mes);
    $("anio").value = String(siguiente.anio);
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
    const cuentan = M.mesesQueCuentan(estado.historico, anio, mes);
    if (estado.historico.factorCompensacion === 0) partes.push("Compensación histórica desactivada (factor 0 %).");
    else if (cuentan.length) partes.push(`Se compensará con ${plural(cuentan.length, "mes", "meses")} del histórico (${cuentan.map(nombreClaveMes).join(", ")}).`);
    else partes.push("Sin meses anteriores en el histórico: el reparto será solo por disponibilidad.");
    if (estado.historico.meses[M.claveMes(anio, mes)]) partes.push(`${nombreMes(anio, mes)} ya está guardado en el histórico.`);
    pista.textContent = partes.join(" ");
  };

  const alCambiarMes = () => {
    if (resultado) {
      const { anio, mes } = mesObjetivo();
      if (resultado.anio !== anio || resultado.mes !== mes) {
        resultado = null;
        $("areaResultado").hidden = true;
      }
    }
    pintarPista();
    pintarHistorico();
  };

  const generarGuardias = () => {
    if (!mesObjetivoValido()) {
      avisar("Elige un mes y un año válidos (2020-2100).", { tipo: "error" });
      return;
    }
    if (activos().length === 0) {
      avisar("Añade al menos un médico activo antes de generar.", { tipo: "error" });
      return;
    }
    const { anio, mes } = mesObjetivo();
    resultado = M.generarCalendario(estado, anio, mes);
    resultadoDesactualizado = false;
    pintarResultado();
    $("areaResultado").scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pintarAvisosResultado = () => {
    if (!resultado) return;
    const lista = $("avisosResultado");
    const items = [];
    const aviso = (clase, texto) => items.push(crear("li", { class: clase, texto }));
    if (resultadoDesactualizado) aviso("aviso-critico", "Has cambiado la configuración después de generar este calendario. Vuelve a generarlo antes de guardarlo o copiarlo.");
    if (resultado.totales.descubiertos > 0) aviso("aviso-critico", `${plural(resultado.totales.descubiertos, "puesto sin cubrir", "puestos sin cubrir")} (celdas --- en rojo): ese día no quedaba nadie disponible en esa franja. Revisa ausencias y turnos.`);
    if (resultado.mixtosSinPlan.length) aviso("aviso-atencion", `Turno MIXTO sin planificar: ${resultado.mixtosSinPlan.join(", ")}. Se ha usado L/X/V tarde y M/J mañana; puedes fijarlo en «Plan. Turnos».`);
    if (estado.historico.meses[resultado.clave]) aviso("aviso-info", "Este mes ya está guardado en el histórico. Si lo guardas otra vez, se sustituirá.");
    const comp = resultado.compensacion;
    if (comp.factor === 0) aviso("aviso-info", "Compensación histórica desactivada (factor 0 %).");
    else if (comp.meses.length) aviso("aviso-info", `Compensado con ${plural(comp.meses.length, "mes", "meses")} del histórico (${comp.meses.map(nombreClaveMes).join(", ")}) al ${Math.round(comp.factor * 100)} %.`);
    else aviso("aviso-info", "Sin meses anteriores en el histórico: reparto solo por disponibilidad.");
    lista.replaceChildren(...items);

    const yaGuardado = Boolean(estado.historico.meses[resultado.clave]);
    $("btnGuardarHistorico").textContent = `💾 ${yaGuardado ? "Sustituir" : "Guardar"} ${nombreMes(resultado.anio, resultado.mes)} en el histórico`;
  };

  const clasePorDesviacion = (valor) => {
    const abs = Math.abs(valor);
    if (abs <= 0.5) return "valor-ok";
    if (abs <= M.UMBRAL_DESVIACION) return "valor-medio";
    return "valor-mal";
  };

  const tarjeta = (titulo, lineas, clase = "") =>
    crear("div", { class: `stat-card ${clase}`.trim() }, [crear("h4", { texto: titulo }), ...lineas]);
  const lineaValor = (etiqueta, valor) => crear("div", {}, [document.createTextNode(`${etiqueta}: `), crear("span", { class: "stat-value", texto: String(valor) })]);

  const pintarResultado = () => {
    $("areaResultado").hidden = false;
    $("tituloResultado").textContent = `Calendario de guardias · ${nombreMes(resultado.anio, resultado.mes)}`;
    pintarAvisosResultado();

    const cal = cuerpo("tablaCalendario");
    resultado.dias.forEach((d) => {
      const fila = cal.insertRow();
      fila.insertCell().textContent = d.dia;
      fila.insertCell().textContent = `${formatearFecha(d.fecha)} ${diaDeLaSemana(d.fecha).slice(0, 3).toLowerCase()}`;
      if (!d.esLaborable) {
        const celda = fila.insertCell();
        celda.colSpan = 4;
        celda.className = "finde-festivo";
        celda.textContent = d.tipo;
        return;
      }
      M.PUESTOS.forEach((p) => {
        const celda = fila.insertCell();
        celda.textContent = d[p.clave];
        if (d[p.clave] === M.SIN_ASIGNAR) {
          celda.className = "alerta-descubierto";
          celda.title = "Puesto sin cubrir";
        }
      });
    });

    const r = resultado.resumen;
    const res = cuerpo("tablaResumen");
    Object.keys(r.objetivos).forEach((nombre) => {
      const medico = estado.medicos.find((m) => m.nombre === nombre);
      const reduccion = estado.reducciones.find((x) => x.medico === nombre);
      const asignadas = r.asignaciones[nombre] || 0;
      const avisos = r.avisos[nombre] || 0;
      const diferencia = asignadas - r.objetivos[nombre];
      const porcentajeAvisos = asignadas > 0 ? Math.round((avisos / asignadas) * 100) : 0;
      const jornada = reduccion ? reduccion.porcentaje : 100;
      const fila = res.insertRow();
      fila.insertCell().textContent = nombre;
      fila.insertCell().textContent = medico ? medico.turno : "";
      const celdaJornada = fila.insertCell();
      celdaJornada.textContent = `${jornada} %`;
      if (jornada < 100) celdaJornada.className = "negrita";
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

    const equidad = M.evaluarEquidad(resultado);
    const parrafo = crear("p");
    if (equidad.peor.medico) {
      parrafo.append(`Mayor desviación respecto al objetivo: ${conSigno(equidad.peor.desviacion)} (${equidad.peor.medico}). `);
      parrafo.append(
        equidad.correcta
          ? crear("span", { class: "equidad-ok", texto: "✓ Todos a menos de 1,5 guardias de su objetivo" })
          : crear("span", { class: "equidad-ko", texto: "⚠ Revisa: hay médicos a más de 1,5 guardias de su objetivo" })
      );
    }
    const nota = crear("p", {
      class: "help-text",
      texto: `Entre quien más y quien menos guardias tiene hay ${equidad.rango}. Es normal si hay jornadas reducidas o ausencias. En equipos pequeños, el tope de dos guardias por semana obliga a repartir a partes iguales.`,
    });

    const sumar = (obj) => Object.values(obj).reduce((s, v) => s + v, 0);
    const total = resultado.totales;
    const totalAvisos = sumar(r.avisos);
    const porTurno = { MAÑANA: 0, TARDE: 0, MIXTO: 0 };
    Object.keys(r.objetivos).forEach((n) => {
      const m = estado.medicos.find((x) => x.nombre === n);
      if (m && m.turno in porTurno) porTurno[m.turno]++;
    });
    const rejilla = crear("div", { class: "stats-grid" }, [
      tarjeta(
        "Puestos del mes",
        [lineaValor("A cubrir", total.puestos), lineaValor("Cubiertos", total.cubiertos), lineaValor("Sin cubrir", total.descubiertos)],
        total.descubiertos > 0 ? "alerta" : ""
      ),
      tarjeta("Distribución por tipo", [
        lineaValor("Avisos", totalAvisos),
        lineaValor("Urgencias", sumar(r.urgencias)),
        crear("small", { texto: `Avisos: ${total.cubiertos ? decimal((totalAvisos / total.cubiertos) * 100) : "0,0"} %` }),
      ]),
      tarjeta("Lunes y viernes", [lineaValor("Lunes", sumar(r.lunes)), lineaValor("Viernes", sumar(r.viernes))]),
      tarjeta("Médicos en el reparto", [lineaValor("Mañana", porTurno.MAÑANA), lineaValor("Tarde", porTurno.TARDE), lineaValor("Mixto", porTurno.MIXTO)]),
    ]);
    $("estadisticasDetalladas").replaceChildren(parrafo, nota, rejilla);
  };

  const guardarEnHistorico = async () => {
    if (!resultado) return;
    const etiqueta = nombreMes(resultado.anio, resultado.mes);
    const yaGuardado = Boolean(estado.historico.meses[resultado.clave]);
    const partes = [
      yaGuardado
        ? `${etiqueta} ya está en el histórico. Se sustituirá por este calendario.`
        : `Se guardará, para cada médico, la diferencia entre sus guardias y su objetivo de ${etiqueta}. Con eso se compensarán los meses siguientes.`,
    ];
    if (resultadoDesactualizado) partes.push("Ojo: la configuración ha cambiado desde que generaste este calendario.");
    const ok = await confirmar({
      titulo: `${yaGuardado ? "Sustituir" : "Guardar"} ${etiqueta} en el histórico`,
      mensaje: partes.join(" "),
      aceptar: yaGuardado ? "Sustituir" : "Guardar",
      clase: "success",
    });
    if (!ok) return;
    estado.historico.meses[resultado.clave] = M.diferenciasDelMes(resultado);
    guardar();
    pintarAvisosResultado();
    pintarHistorico();
    pintarPista();
    avisar(`${etiqueta} guardado en el histórico.\nEs buen momento para ⬇ Exportar copia.`, { tipo: "ok", duracion: 6000 });
  };

  // --- Copiar a Excel ---------------------------------------------------------------------------

  const copiarExcel = async (soloCalendario) => {
    if (!resultado) {
      avisar("Genera primero un calendario.", { tipo: "error" });
      return;
    }
    const estiloTabla = 'border-collapse:collapse; font-family:"Segoe UI",Calibri,sans-serif; font-size:11pt; border:1px solid #d0d7e5;';
    const estiloTitulo = "background-color:#1e3a8a; color:white; border:1px solid #d0d7e5; padding:8px 12px; font-weight:bold; font-size:12pt; text-align:left;";
    const estiloTH = "background-color:#4a6fa5; color:white; border:1px solid #d0d7e5; padding:6px 12px; font-weight:bold; text-align:left; white-space:nowrap;";
    const estiloTD = 'border:1px solid #d0d7e5; padding:6px 12px; white-space:nowrap; mso-number-format:"\\@";';
    const estiloFinde = "border:1px solid #d0d7e5; padding:6px 12px; background-color:#f8f9fa; color:#6c757d; font-style:italic; text-align:center;";
    const estiloAlerta = "border:1px solid #d0d7e5; padding:6px 12px; background-color:#fee2e2; color:#b91c1c; font-weight:bold; text-align:center;";
    const etiquetaMes = nombreMes(resultado.anio, resultado.mes);

    const clonar = (id, titulo) => {
      const tabla = $(id).cloneNode(true);
      tabla.removeAttribute("id");
      tabla.setAttribute("style", estiloTabla);
      tabla.querySelectorAll("th").forEach((th) => th.setAttribute("style", estiloTH));
      tabla.querySelectorAll("td").forEach((td) => {
        if (td.classList.contains("finde-festivo")) td.setAttribute("style", estiloFinde);
        else if (td.classList.contains("alerta-descubierto")) td.setAttribute("style", estiloAlerta);
        else {
          const color = Object.keys(COLORES_EXCEL).find((c) => td.classList.contains(c));
          td.setAttribute("style", estiloTD + (color ? ` background-color:${COLORES_EXCEL[color]};` : ""));
        }
      });
      const thead = tabla.tHead;
      const columnas = thead.rows[0].cells.length;
      const fila = document.createElement("tr");
      [titulo, etiquetaMes].forEach((t) => fila.append(crear("th", { style: estiloTitulo, texto: t })));
      if (columnas > 2) fila.append(crear("th", { style: estiloTitulo, colspan: String(columnas - 2) }));
      thead.insertBefore(fila, thead.firstChild);
      return tabla;
    };

    const contenedor = document.createElement("div");
    contenedor.append(clonar("tablaCalendario", "Guardias"));
    if (!soloCalendario) {
      contenedor.append(document.createElement("br"), clonar("tablaResumen", "Resumen"));
      const estadisticas = crear("table", { style: estiloTabla }, [
        crear("thead", {}, [crear("tr", {}, [crear("th", { style: estiloTitulo, texto: "Estadísticas y análisis" })])]),
        crear("tbody", {}, [crear("tr", {}, [crear("td", { style: "padding:12px; border:1px solid #d0d7e5;" }, [$("estadisticasDetalladas").cloneNode(true)])])]),
      ]);
      contenedor.append(document.createElement("br"), estadisticas);
    }

    const html = contenedor.outerHTML;
    const texto = resultado.dias
      .map((d) => [formatearFecha(d.fecha), ...(d.esLaborable ? M.PUESTOS.map((p) => d[p.clave]) : [d.tipo])].join("\t"))
      .join("\n");
    const aviso = soloCalendario ? "Calendario copiado: pégalo en Excel." : "Calendario, resumen y estadísticas copiados: pégalos en Excel.";

    try {
      if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([texto], { type: "text/plain" }) }),
        ]);
        avisar(aviso, { tipo: "ok" });
        return;
      }
    } catch (e) {
      /* se intenta el método clásico */
    }
    try {
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
    guardar();
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

  const CAMPOS_CONFIGURACION = ["medicos", "reducciones", "festivos", "ausencias", "exclusionesPuntuales", "planificacionesTurnos"];

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
      estado.ultimaCopia = new Date().toISOString();
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

    guardar();
    resultado = null;
    $("areaResultado").hidden = true;
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
    pintarParametros();
    pintarHistorico();
    pintarBienvenida();
    pintarEstadoDatos();
    pintarPista();
  };

  const ACCIONES = {
    "agregar-medico": agregarMedico,
    "importar-medicos": procesarImportacionMasiva,
    "guardar-reduccion": guardarReduccion,
    "agregar-festivo": agregarFestivo,
    "agregar-ausencia": agregarAusencia,
    "agregar-exclusion": agregarExclusionPuntual,
    "guardar-plan": guardarPlanTurno,
    "nueva-semilla": nuevaSemilla,
    "detalle-historico": verDetalleHistorico,
    generar: generarGuardias,
    "guardar-historico": guardarEnHistorico,
    "copiar-calendario": () => copiarExcel(true),
    "copiar-todo": () => copiarExcel(false),
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
        guardar();
        avisar(puedeGuardar ? "Guardado." : "Este navegador no deja guardar: exporta una copia.", { tipo: puedeGuardar ? "ok" : "error" });
      } else if (tecla === "h") irASeccion("manual");
      else return;
      e.preventDefault();
    });

    // Otra pestaña ha cambiado los datos: se recargan para no pisarlos.
    window.addEventListener("storage", (e) => {
      if (e.key !== CLAVE_DATOS) return;
      cargar();
      resultado = null;
      $("areaResultado").hidden = true;
      pintarTodo();
      avisar("Los datos han cambiado en otra pestaña y se han recargado aquí.");
    });

    window.addEventListener("beforeunload", (e) => {
      if (!puedeGuardar && hayDatos()) e.preventDefault();
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
