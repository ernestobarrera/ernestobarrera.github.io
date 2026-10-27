/* =======================================================================
 * PANEL DE ANÁLISIS DE RESULTADOS — analisis-buscar-pubmed.js
 *
 * Sustituye al diagrama de Venn, cuyas áreas contaban filtros y no artículos.
 * Responde a una pregunta: ¿qué devuelve cuantitativamente mi búsqueda y qué le hacen mis filtros?
 *
 *  1. Qué hacen tus filtros: de N sin filtros a M con ellos, paso a paso, y el último cambio
 *     (cuántos salen y cuántos entran).
 *  2. Tipo de estudio: con tus filtros frente a sin ellos, y cuánto cambia la proporción.
 *  3. Evolución por año: sin filtros, con filtros y % que conservan cada año.
 *  4. Acceso y alcance: texto completo gratis, humanos, MEDLINE, idioma.
 *  5. Composición: la lógica de la consulta (AND, OR, NOT) sin áreas que finjan cantidades.
 *
 * REGLAS QUE NO SE NEGOCIAN
 *  - Todas las cifras son recuentos EXACTOS de ESearch, nunca muestras ni estimaciones.
 *  - Cada cifra enlaza a PubMed con la consulta literal que la produce.
 *  - Un fallo se muestra como fallo, nunca como 0.
 *  - Las consultas las compone constructQuery (el de la página), no una copia.
 *  - Una sola cola con los contadores (window.PubMedConsultas): mismo límite de NCBI.
 *  - Solo se calcula con el panel abierto.
 * ======================================================================= */

(function () {
  "use strict";

  const NOMBRE_CATEGORIA = { methodology: "Metodología", clinical: "Clínico", scope: "Ámbito", journals: "Revistas" };

  // Tipos de publicación de PubMed ([pt]). Se solapan: un artículo puede tener varios.
  const TIPOS = [
    { nombre: "Metaanálisis", plural: "los metaanálisis", q: "meta-analysis[pt]" },
    { nombre: "Revisión sistemática", plural: "las revisiones sistemáticas", q: "systematic review[pt]" },
    { nombre: "Ensayo controlado aleatorizado", plural: "los ensayos controlados aleatorizados", q: "randomized controlled trial[pt]" },
    { nombre: "Estudio observacional", plural: "los estudios observacionales", q: "observational study[pt]" },
    { nombre: "Guía de práctica clínica", plural: "las guías de práctica clínica", q: "(guideline[pt] OR practice guideline[pt])" },
    { nombre: "Revisión (cualquier tipo)", plural: "las revisiones (de cualquier tipo)", q: "review[pt]" },
    { nombre: "Caso clínico", plural: "los casos clínicos", q: "case reports[pt]" },
  ];

  const ALCANCE = [
    { nombre: "Texto completo gratis", q: "free full text[sb]" },
    { nombre: "Indexado en MEDLINE", q: "medline[sb]" },
    { nombre: "Humanos", q: "humans[mh]" },
    { nombre: "En inglés", q: "english[la]" },
    { nombre: "En español", q: "spanish[la]" },
  ];

  const UNIVERSO = "all[sb]"; // Sin términos ni filtros: todo PubMed
  const ESPERA_ESTABLE_MS = 1200; // una consulta que dura esto sin cambiar cuenta como «estado»
  const ESPERA_RECALCULO_MS = 900;

  let panel = null;
  let boton = null;
  let abierto = false;
  let anios = 10;
  let control = null;
  let temporizadorRecalculo = null;
  let temporizadorEstable = null;
  let estable = null; // última consulta que se mantuvo
  let anterior = null; // la estable previa: el «antes» del último cambio
  let pendiente = null;

  // ---------------------------------------------------------------- utilidades

  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Punto de miles siempre, como el resto de la página (es-ES no agrupa los números de cuatro cifras).
  const num = (n) => (typeof n === "number" ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "—");
  const pct = (a, b) => {
    if (typeof a !== "number" || typeof b !== "number" || b === 0) return "—";
    const p = (100 * a) / b;
    return (p > 0 && p < 10 ? p.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : Math.round(p).toLocaleString("es-ES")) + " %";
  };
  const urlPubMed = (q) => "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(q);
  const y = (a, b) => `(${a}) AND (${b})`;
  const salvo = (a, b) => `(${a}) NOT (${b})`;

  // ---------------------------------------------------------------- composición de consultas

  // Pasos acumulados en el orden en que constructQuery compone la consulta. Entre grupos todo es
  // AND o NOT, así que cada paso solo puede quitar artículos: la cascada es honesta EN ESTE orden,
  // que no es una atribución del efecto de cada grupo (en otro orden los saltos serían distintos).
  function planificarPasos(estado) {
    const cq = window.constructQuery;
    const pasos = [];
    const base = cq(estado.termino, { activos: new Set(), sinTrending: true, sinFecha: true }) || UNIVERSO;
    pasos.push({ etiqueta: estado.termino ? "Solo tus términos" : "Todo PubMed", detalle: "", q: base });

    const acumulados = new Set();
    Object.keys(estado.categorias).forEach((cat) => {
      const enCat = estado.categorias[cat].filter((f) => estado.activos.has(f));
      if (!enCat.length) return;
      enCat.forEach((f) => acumulados.add(f));
      const q = cq(estado.termino, { activos: new Set(acumulados), sinTrending: true, sinFecha: true });
      if (!q) return;
      const op = estado.operadores[cat] === "AND" ? " Y " : " O ";
      const nombres = enCat.map(window.etiquetaFiltro);
      pasos.push({ etiqueta: "+ " + (NOMBRE_CATEGORIA[cat] || cat), detalle: nombres.join(op), q });
    });
    if (estado.trending) {
      pasos.push({ etiqueta: "+ Trending", detalle: "trending[sb]", q: cq(estado.termino, { sinFecha: true }) });
    }
    if (estado.fecha) {
      pasos.push({ etiqueta: "+ Fecha", detalle: `últimos ${estado.fecha} días`, q: cq(estado.termino) });
    }
    // Dos pasos con la misma consulta (un filtro que no se cargó, Trending ya escrito) se funden.
    return pasos.filter((p, i) => i === 0 || p.q !== pasos[i - 1].q);
  }

  function composicion(estado) {
    const lineas = [];
    lineas.push({ op: "", texto: estado.termino ? estado.termino : "(sin términos: todo PubMed)", literal: true });
    Object.keys(estado.categorias).forEach((cat) => {
      const enCat = estado.categorias[cat].filter((f) => estado.activos.has(f));
      if (!enCat.length) return;
      const excl = enCat.filter((f) => /^NOT/.test((window.filterMap || {})[f] || ""));
      const pos = enCat.filter((f) => !excl.includes(f));
      if (pos.length) {
        const op = estado.operadores[cat] === "AND" ? " Y " : " O ";
        lineas.push({ op: "Y", texto: "(" + pos.map(window.etiquetaFiltro).join(op) + ")", grupo: NOMBRE_CATEGORIA[cat] || cat });
      }
      excl.forEach((f) => lineas.push({ op: "EXCEPTO", texto: window.etiquetaFiltro(f).replace(/^\s*No\s+/i, ""), grupo: NOMBRE_CATEGORIA[cat] || cat }));
    });
    if (estado.trending) lineas.push({ op: "Y", texto: "Trending · PubMed", grupo: "Modificador" });
    if (estado.fecha) lineas.push({ op: "Y", texto: `publicado en los últimos ${estado.fecha} días`, grupo: "Fecha" });
    return lineas;
  }

  // ---------------------------------------------------------------- celdas

  // Cada cifra vive en una celda con data-q. Se pinta «…» y se rellena al llegar su recuento.
  const celda = (q, clase = "") => `<a class="an-num ${clase}" data-q="${esc(q)}" href="${esc(urlPubMed(q))}" target="_blank" rel="noopener" title="Ver en PubMed">…</a>`;

  function barra(id, extra = "") {
    return `<span class="an-barra ${extra}" aria-hidden="true"><span class="an-relleno" data-barra="${esc(id)}"></span></span>`;
  }

  // ---------------------------------------------------------------- render del esqueleto

  function esqueleto(estado, pasos, final, base) {
    // «Antes» es la última consulta que se mantuvo; si la actual ya es esa, la anterior a ella.
    const antes = final !== estable ? estable : anterior;
    const comparar = !!antes && antes !== final;
    const anioActual = new Date().getFullYear();
    const listaAnios = Array.from({ length: anios }, (_, i) => anioActual - i);
    const noAplicados = typeof window.filtrosNoAplicados === "function" ? window.filtrosNoAplicados() : [];

    let h = "";
    h += `<header class="an-cabecera">
      <h3><i class="fas fa-chart-column" aria-hidden="true"></i> Análisis de resultados</h3>
      <p class="an-estado" role="status" aria-live="polite" data-estado>Consultando PubMed…</p>
    </header>`;

    if (noAplicados.length) {
      h += `<p class="an-alerta">⚠ ${noAplicados.length === 1 ? "Un filtro seleccionado no se pudo cargar" : noAplicados.length + " filtros seleccionados no se pudieron cargar"} y no está en estas cifras: ${esc(noAplicados.map(window.etiquetaFiltro).join(", "))}.</p>`;
    }

    // 1. Qué hacen tus filtros
    h += `<section class="an-bloque"><h4>Qué hacen tus filtros</h4>
      <p class="an-titular">${pasos.length > 1 ? "De" : "Tu búsqueda:"} ${celda(base, "an-grande")}${pasos.length > 1 ? ` a ${celda(final, "an-grande")} con tus filtros · conservan <span data-conserva>…</span>` : " artículos"}</p>${pasos.length > 1 ? `<p class="an-frase" data-frase hidden></p>` : ""}`;
    if (pasos.length > 1) {
      h += `<table class="an-tabla an-cascada"><caption class="an-oculto">Artículos tras cada paso de la consulta</caption>
        <thead><tr><th scope="col">Paso</th><th scope="col" class="an-col-barra"><span class="an-oculto">Proporción</span></th><th scope="col">Artículos</th><th scope="col">Cambio</th></tr></thead><tbody>`;
      pasos.forEach((p, i) => {
        h += `<tr><th scope="row">${esc(p.etiqueta)}${p.detalle ? `<span class="an-sub">${esc(p.detalle)}</span>` : ""}</th>
          <td class="an-col-barra">${barra("paso" + i)}</td><td>${celda(p.q)}</td><td class="an-delta" data-delta="${i}">${i === 0 ? "" : "…"}</td></tr>`;
      });
      h += `</tbody></table>
        <p class="an-nota">Pasos en el orden en que se compone la consulta. Entre grupos se combina con Y/EXCEPTO, así que cada paso solo puede quitar artículos; el tamaño de cada salto depende de ese orden y no es «la aportación» de un filtro.</p>`;
    }
    if (comparar) {
      h += `<div class="an-cambio"><h5>Último cambio</h5>
        <p>Antes ${celda(antes)} · ahora ${celda(final)} · <strong>salen</strong> ${celda(salvo(antes, final), "an-sale")} · <strong>entran</strong> ${celda(salvo(final, antes), "an-entra")}</p>
        <p class="an-nota">«Salen»: estaban antes y ya no. «Entran»: no estaban antes. Pulsa la cifra para verlos en PubMed.</p></div>`;
    }
    h += `<details class="an-traduccion"><summary>Lo que ejecutó PubMed</summary><p class="an-sub">Consulta enviada:</p><pre>${esc(final)}</pre><p class="an-sub">Cómo la interpretó PubMed (querytranslation):</p><pre data-traduccion>…</pre><ul class="an-avisos" data-avisos></ul></details>`;
    h += `</section>`;

    // 2. Tipo de estudio
    h += `<section class="an-bloque"><h4>Tipo de estudio</h4>
      <table class="an-tabla"><caption class="an-oculto">Artículos por tipo de publicación, con y sin tus filtros</caption>
      <thead><tr><th scope="col">Tipo</th><th scope="col" class="an-col-barra"><span class="an-oculto">Proporción</span></th><th scope="col">Con tus filtros</th>${pasos.length > 1 ? `<th scope="col">Sin filtros</th><th scope="col" title="Cuántas veces cambia la proporción de este tipo al aplicar tus filtros">Cambio de proporción</th>` : ""}</tr></thead><tbody>`;
    TIPOS.forEach((t, i) => {
      h += `<tr><th scope="row">${esc(t.nombre)}</th><td class="an-col-barra">${barra("tipo" + i)}</td>
        <td>${celda(y(final, t.q))} <span class="an-pct" data-pct="tipoF${i}"></span></td>
        ${pasos.length > 1 ? `<td>${celda(y(base, t.q))} <span class="an-pct" data-pct="tipoB${i}"></span></td><td class="an-ratio" data-ratio="${i}">…</td>` : ""}</tr>`;
    });
    h += `</tbody></table><p class="an-nota">Etiquetas de tipo de publicación de PubMed: un artículo puede tener varias (no suman 100 %) y los registros más recientes pueden no tenerlas todavía. Más ensayos o revisiones no significa mejor evidencia: es descripción, no valoración.</p></section>`;

    // 3. Evolución por año
    h += `<section class="an-bloque"><div class="an-titulo-fila"><h4>Evolución por año</h4>
      <div class="an-selector" role="group" aria-label="Años mostrados">
        <button type="button" data-anios="10" aria-pressed="${anios === 10}">10 años</button>
        <button type="button" data-anios="20" aria-pressed="${anios === 20}">20 años</button></div></div>
      <table class="an-tabla an-anios"><caption class="an-oculto">Artículos por año de publicación</caption>
      <thead><tr><th scope="col">Año</th>${pasos.length > 1 ? `<th scope="col">Sin filtros</th>` : ""}<th scope="col">${pasos.length > 1 ? "Con tus filtros" : "Artículos"}</th>${pasos.length > 1 ? `<th scope="col">Conservan</th>` : ""}</tr></thead><tbody>`;
    listaAnios.forEach((a) => {
      const qa = `${a}[dp]`;
      h += `<tr><th scope="row">${a}${a === anioActual ? '<span class="an-sub">en curso</span>' : ""}</th>
        ${pasos.length > 1 ? `<td>${barra("aB" + a, "an-gris")}${celda(y(base, qa))}</td>` : ""}
        <td>${barra("aF" + a)}${celda(y(final, qa))}</td>
        ${pasos.length > 1 ? `<td class="an-pct" data-pct="anio${a}">…</td>` : ""}</tr>`;
    });
    h += `</tbody></table><p class="an-nota">Por fecha de publicación ([dp]). Cada columna de barras tiene su propia escala. Un artículo con fecha electrónica e impresa en años distintos puede contar en los dos, y el año en curso está incompleto.</p></section>`;

    // 4. Acceso y alcance
    h += `<section class="an-bloque"><h4>Acceso y alcance</h4>
      <table class="an-tabla"><caption class="an-oculto">Acceso, indexación, población e idioma</caption>
      <thead><tr><th scope="col">Característica</th><th scope="col" class="an-col-barra"><span class="an-oculto">Proporción</span></th><th scope="col">Con tus filtros</th>${pasos.length > 1 ? `<th scope="col">Sin filtros</th>` : ""}</tr></thead><tbody>`;
    ALCANCE.forEach((c, i) => {
      h += `<tr><th scope="row">${esc(c.nombre)}</th><td class="an-col-barra">${barra("alc" + i)}</td>
        <td>${celda(y(final, c.q))} <span class="an-pct" data-pct="alcF${i}"></span></td>
        ${pasos.length > 1 ? `<td>${celda(y(base, c.q))} <span class="an-pct" data-pct="alcB${i}"></span></td>` : ""}</tr>`;
    });
    h += `</tbody></table><p class="an-nota">«Humanos» depende de la indexación MeSH: los registros sin indexar (recientes o fuera de MEDLINE) no cuentan aunque traten de personas.</p></section>`;

    // 5. Composición
    h += `<section class="an-bloque"><h4>Composición de la búsqueda</h4><ol class="an-composicion">`;
    composicion(estado).forEach((l) => {
      h += `<li>${l.op ? `<span class="an-op">${esc(l.op)}</span>` : ""}<span class="${l.literal ? "an-literal" : ""}">${esc(l.texto)}</span>${l.grupo ? `<span class="an-sub">${esc(l.grupo)}</span>` : ""}</li>`;
    });
    h += `</ol><p class="an-nota">Dentro de cada grupo se usa el operador que elegiste (O / Y); entre grupos, siempre Y.</p></section>`;

    h += `<footer class="an-pie">Recuentos exactos de PubMed (E-utilities) en el momento de la consulta, no muestras. Bibliometría descriptiva: no valora la calidad ni la relevancia clínica de los artículos.</footer>`;
    return h;
  }

  // ---------------------------------------------------------------- cálculo

  function programar() {
    clearTimeout(temporizadorRecalculo);
    temporizadorRecalculo = setTimeout(analizar, ESPERA_RECALCULO_MS);
  }

  async function analizar() {
    if (!abierto || !panel) return;
    if (control) control.abort();
    control = new AbortController();
    const signal = control.signal;

    if (typeof window.estadoBusqueda !== "function" || typeof window.constructQuery !== "function") {
      panel.innerHTML = `<p class="an-alerta">El panel no puede leer la búsqueda de la página.</p>`;
      return;
    }
    const estado = window.estadoBusqueda();
    const final = window.constructQuery(estado.termino);
    if (!final) {
      panel.innerHTML = `<header class="an-cabecera"><h3><i class="fas fa-chart-column" aria-hidden="true"></i> Análisis de resultados</h3></header>
        <p class="an-vacio">Escribe un término o activa un filtro y aquí verás qué devuelve tu búsqueda: cuántos artículos, de qué tipo, de qué años y qué le hacen tus filtros.</p>`;
      return;
    }
    if (!window.PubMedConsultas) {
      panel.innerHTML = `<p class="an-alerta">Los recuentos de PubMed no están disponibles en esta página.</p>`;
      return;
    }

    const pasos = planificarPasos(estado);
    const base = pasos[0].q;
    panel.innerHTML = esqueleto(estado, pasos, final, base);
    enlazarSelector();

    // Orden de llegada: lo que responde a «qué hacen mis filtros» primero.
    const celdas = [...panel.querySelectorAll(".an-num[data-q]")];
    const consultas = [...new Set(celdas.map((c) => c.dataset.q))];
    const resultados = new Map();
    let hechas = 0;
    let fallos = 0;
    const estadoTexto = panel.querySelector("[data-estado]");
    const porSeg = window.PubMedConsultas.porSegundo();
    const actualizarEstado = () => {
      if (!estadoTexto) return;
      estadoTexto.textContent = hechas < consultas.length
        ? `Consultando PubMed: ${hechas} de ${consultas.length}${porSeg <= 3 ? " (sin clave NCBI: 3 por segundo)" : ""}…`
        : `${consultas.length} recuentos, ${new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}${fallos ? ` · ${fallos} fallaron` : ""}.`;
    };
    actualizarEstado();

    await Promise.all(consultas.map(async (q) => {
      try {
        const d = await window.PubMedConsultas.contar(q, signal);
        if (signal.aborted) return;
        resultados.set(q, d);
        pintar(q, d);
      } catch (e) {
        if (signal.aborted || e?.aborted || e?.name === "AbortError") return;
        fallos++;
        resultados.set(q, null);
        pintar(q, null);
      } finally {
        if (!signal.aborted) { hechas++; actualizarEstado(); derivar(pasos, final, base, resultados); }
      }
    }));
  }

  // «No items found» acompaña a todo recuento cero: no es un problema de la consulta, es el cero.
  // Marcarlo con ⚠ haría que el aviso saliera siempre y se aprendiera a ignorar.
  const avisosReales = (d) => [...d.errores, ...d.avisos.filter((a) => !/^outputmessages: No items found\.?$/i.test(a))];

  function pintar(q, d) {
    panel.querySelectorAll(".an-num[data-q]").forEach((el) => {
      if (el.dataset.q !== q) return;
      if (!d) {
        el.textContent = "fallo";
        el.classList.add("an-fallo");
        el.title = "PubMed no respondió a esta consulta: no es un cero. Pulsa para abrirla en PubMed.";
        return;
      }
      el.textContent = num(d.count);
      const problemas = avisosReales(d);
      if (problemas.length) {
        el.classList.add("an-aviso");
        el.title = "PubMed avisó al ejecutar esta consulta:\n" + problemas.join("\n");
        el.textContent += " ⚠";
      }
    });
  }

  // Cifras que dependen de otras: porcentajes, saltos, barras y proporciones.
  function derivar(pasos, final, base, R) {
    const c = (q) => (R.get(q) ? R.get(q).count : undefined);
    const fijar = (sel, texto) => panel.querySelectorAll(sel).forEach((el) => { el.textContent = texto; });
    const ancho = (id, frac) => {
      const el = panel.querySelector(`[data-barra="${id}"]`);
      if (el && typeof frac === "number" && isFinite(frac)) el.style.width = Math.max(0, Math.min(1, frac)) * 100 + "%";
    };
    const nF = c(final);
    const nB = c(base);

    if (nF !== undefined && nB !== undefined) fijar("[data-conserva]", pct(nF, nB));

    pasos.forEach((p, i) => {
      const n = c(p.q);
      if (nB) ancho("paso" + i, n / nB);
      if (i > 0) {
        const prev = c(pasos[i - 1].q);
        if (typeof n === "number" && typeof prev === "number") {
          const dlt = n - prev;
          fijar(`[data-delta="${i}"]`, dlt === 0 ? "sin cambio" : `${dlt < 0 ? "−" : "+"}${num(Math.abs(dlt))} (${pct(Math.abs(dlt), prev)})`);
        }
      }
    });

    TIPOS.forEach((t, i) => {
      const f = c(y(final, t.q));
      const b = c(y(base, t.q));
      if (nF) { ancho("tipo" + i, f / nF); fijar(`[data-pct="tipoF${i}"]`, typeof f === "number" ? pct(f, nF) : ""); }
      if (nB) fijar(`[data-pct="tipoB${i}"]`, typeof b === "number" ? pct(b, nB) : "");
      if (typeof f === "number" && typeof b === "number" && nF && nB) {
        const pf = f / nF, pb = b / nB;
        fijar(`[data-ratio="${i}"]`, pb === 0 ? (pf === 0 ? "—" : "nuevo") : "×" + (pf / pb).toLocaleString("es-ES", { maximumFractionDigits: pf / pb < 10 ? 1 : 0 }));
      }
    });

    frase(final, base, R);

    ALCANCE.forEach((a, i) => {
      const f = c(y(final, a.q));
      const b = c(y(base, a.q));
      if (nF) { ancho("alc" + i, f / nF); fijar(`[data-pct="alcF${i}"]`, typeof f === "number" ? pct(f, nF) : ""); }
      if (nB) fijar(`[data-pct="alcB${i}"]`, typeof b === "number" ? pct(b, nB) : "");
    });

    const anioActual = new Date().getFullYear();
    const lista = Array.from({ length: anios }, (_, i) => anioActual - i);
    const maxF = Math.max(0, ...lista.map((a) => c(y(final, `${a}[dp]`)) || 0));
    const maxB = Math.max(0, ...lista.map((a) => c(y(base, `${a}[dp]`)) || 0));
    lista.forEach((a) => {
      const f = c(y(final, `${a}[dp]`));
      const b = c(y(base, `${a}[dp]`));
      if (maxF) ancho("aF" + a, f / maxF);
      if (maxB) ancho("aB" + a, b / maxB);
      if (typeof f === "number" && typeof b === "number") fijar(`[data-pct="anio${a}"]`, pct(f, b));
    });

    const dFinal = R.get(final);
    if (dFinal) {
      fijar("[data-traduccion]", dFinal.traduccion || "(PubMed no devolvió traducción)");
      const avisos = panel.querySelector("[data-avisos]");
      if (avisos) {
        const problemas = avisosReales(dFinal);
        avisos.innerHTML = problemas.length
          ? problemas.map((p) => `<li>⚠ ${esc(p)}</li>`).join("")
          : "<li>Sin avisos de PubMed para la consulta final.</li>";
      }
    }
  }

  // Una frase calculada antes que otro gráfico: el cambio de composición más marcado que producen los
  // filtros. Solo con todos los tipos medidos y solo con cifras que lo sostengan (≥ 5 artículos con
  // filtros para una subida, ≥ 5 % del total sin filtros para una bajada); si no, no se dice nada.
  function frase(final, base, R) {
    const el = panel.querySelector("[data-frase]");
    if (!el) return;
    const c = (q) => (R.get(q) ? R.get(q).count : undefined);
    const nF = c(final), nB = c(base);
    const filas = TIPOS.map((t) => ({ t, f: c(y(final, t.q)), b: c(y(base, t.q)) }));
    if (!nF || !nB || filas.some((r) => typeof r.f !== "number" || typeof r.b !== "number")) return;
    filas.forEach((r) => { r.pf = r.f / nF; r.pb = r.b / nB; r.x = r.pb ? r.pf / r.pb : Infinity; });
    const sube = filas.filter((r) => r.f >= 5 && r.b > 0 && r.x >= 1.5).sort((a, b) => b.x - a.x)[0];
    const baja = filas.filter((r) => r.pb >= 0.05 && r.x <= 0.5 && r !== sube).sort((a, b) => a.x - b.x)[0];
    if (!sube && !baja) return;
    const tramo = (r) => `${r.t.plural} pasan del ${pct(r.b, nB)} al ${pct(r.f, nF)}`;
    let texto = "Con tus filtros, ";
    if (sube) texto += tramo(sube) + ` de los artículos (×${sube.x.toLocaleString("es-ES", { maximumFractionDigits: sube.x < 10 ? 1 : 0 })})`;
    if (baja) texto += (sube ? "; " : "") + tramo(baja);
    el.textContent = texto + ".";
    el.hidden = false;
  }

  // ---------------------------------------------------------------- interacción

  function enlazarSelector() {
    panel.querySelectorAll("[data-anios]").forEach((b) => {
      b.addEventListener("click", () => {
        const n = parseInt(b.dataset.anios, 10);
        if (n === anios) return;
        anios = n;
        analizar(); // lo ya consultado sale de la caché
      });
    });
  }

  function alternar() {
    abierto = !abierto;
    panel.hidden = !abierto;
    boton.classList.toggle("active", abierto);
    boton.setAttribute("aria-expanded", String(abierto));
    const rotulo = boton.querySelector("span");
    if (rotulo) rotulo.textContent = abierto ? "Ocultar análisis" : "Análisis de resultados";
    if (abierto) {
      analizar();
      panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } else if (control) {
      control.abort();
    }
  }

  // Historial para «último cambio»: solo cuentan las consultas que se mantienen un momento, para que
  // escribir letra a letra no convierta cada pulsación en un «antes».
  function alCambiar(e) {
    pendiente = e.detail ? e.detail.consulta : null;
    clearTimeout(temporizadorEstable);
    temporizadorEstable = setTimeout(() => {
      if (pendiente && pendiente !== estable) {
        anterior = estable;
        estable = pendiente;
      }
    }, ESPERA_ESTABLE_MS);
    if (abierto) programar();
  }

  function init() {
    panel = document.getElementById("analisisPanel");
    boton = document.getElementById("toggleAnalisisButton");
    if (!panel || !boton) return;
    boton.addEventListener("click", alternar);
    document.addEventListener("consulta-cambiada", alCambiar);
  }

  document.addEventListener("DOMContentLoaded", init);

  // Para las pruebas: piezas puras, sin red.
  window.__analisisPubMed = { planificarPasos, composicion, TIPOS, ALCANCE };
})();
