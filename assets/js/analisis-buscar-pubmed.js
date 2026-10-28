/* =======================================================================
 * Análisis de resultados: panorama documental con y sin filtros.
 * Las cifras vienen de la cola compartida; los detalles se consultan al abrirlos.
 * No se atribuye relevancia ni calidad clínica a una etiqueta o un recuento.
 * ======================================================================= */
(function () {
  "use strict";

  const NOMBRE_CATEGORIA = { methodology: "Metodología", clinical: "Clínico", scope: "Ámbito", journals: "Revistas" };
  const TIPOS = [
    { id: "guia", nombre: "Guías de práctica clínica", uso: "Orientarte en recomendaciones", q: "(guideline[pt] OR practice guideline[pt])", criterio: "Etiquetas de guía de PubMed. Un cero no descarta guías sin esta etiqueta ni recomendaciones de otras fuentes." },
    { id: "sistematica", nombre: "Revisiones sistemáticas", uso: "Leer una síntesis de estudios", q: "systematic review[pt]", criterio: "Etiqueta de revisión sistemática. Puede solaparse con metaanálisis y otras etiquetas." },
    { id: "metaanalisis", nombre: "Metaanálisis", uso: "Explorar resultados combinados", q: "meta-analysis[pt]", criterio: "Etiqueta de metaanálisis. No acredita por sí sola calidad metodológica ni aplicabilidad." },
    { id: "aleatorizado", nombre: "Ensayos aleatorizados", uso: "Explorar comparaciones de intervenciones", q: "randomized controlled trial[pt]", criterio: "Etiqueta de ensayo controlado aleatorizado. Un registro puede ser un análisis secundario; no equivale a un ensayo único." },
    { id: "otros-ensayos", nombre: "Otros ensayos clínicos", uso: "Ampliar los estudios de intervención", q: "(clinical trial[pt] NOT randomized controlled trial[pt])", criterio: "Etiqueta de ensayo clínico sin la etiqueta de aleatorizado. Su ausencia no demuestra que el estudio no sea aleatorizado." },
    { id: "observacional", nombre: "Estudios observacionales", uso: "Explorar asociaciones y seguimiento", q: "observational study[pt]", criterio: "Solo la etiqueta de estudio observacional: no incluye todos los diseños observacionales. Compárala con la fila de cohortes y casos-controles." },
    { id: "cohortes", nombre: "Cohortes y casos-controles", uso: "Seguimiento; puede incluir ensayos", q: '("cohort studies"[mh] OR "case-control studies"[mh])', criterio: "Encabezamientos MeSH de cohortes o casos-controles y su expansión a estudios prospectivos y de seguimiento. También incluye ensayos aleatorizados con estas etiquetas y análisis de cohortes derivados de ensayos. Depende de la indexación; esta ruta no identifica exclusivamente estudios observacionales." },
    { id: "cualitativo", nombre: "Estudios cualitativos", uso: "Explorar experiencias y significados", filtro: "qualitative", criterio: "Coincidencias del filtro cualitativo del catálogo. Pueden incluir documentos que no sean estudios cualitativos; hace falta leerlos." },
    { id: "revision", nombre: "Revisiones generales", uso: "Obtener una visión de conjunto", q: "review[pt]", criterio: "Etiqueta Review de PubMed y su expansión: puede incluir revisiones sistemáticas. No es una categoría exclusiva de revisión narrativa." },
    { id: "caso", nombre: "Casos clínicos", uso: "Explorar casos y señales", q: "case reports[pt]", criterio: "Etiqueta de caso clínico. Un caso no permite estimar frecuencia ni efecto de una intervención." },
  ];
  const ALCANCE = [
    { nombre: "Texto completo gratis", q: "free full text[sb]" },
    { nombre: "Indexado en MEDLINE", q: "medline[sb]" },
    { nombre: "Indexado como humanos", q: "humans[mh]" },
    { nombre: "En inglés", q: "english[la]" },
    { nombre: "En español", q: "spanish[la]" },
  ];
  const UNIVERSO = "all[sb]";
  const ESPERA_ESTABLE_MS = 1200;
  const ESPERA_RECALCULO_MS = 900;
  let panel, boton, abierto = false, anios = 10, campoAnio = "dp", actual = null;
  let temporizadorRecalculo, temporizadorEstable, estable = null, anterior = null, pendiente = null;

  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const esNumero = (n) => Number.isSafeInteger(n) && n >= 0;
  const num = (n) => esNumero(n) ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "—";
  const pct = (a, b) => esNumero(a) && esNumero(b) && b > 0
    ? (100 * a / b).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " %" : "—";
  const urlPubMed = (q) => "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(q);
  const y = (a, b) => "(" + a + ") AND (" + b + ")";
  const salvo = (a, b) => "(" + a + ") NOT (" + b + ")";
  const avisosReales = (d) => [
    ...(d?.errores || []),
    ...(d?.avisos || []).filter((a) => !/^outputmessages: No items found\.?$/i.test(a)),
  ];
  // No se usan datos avisados o sin traducción para deducir pérdidas ni dibujar barras.
  const utilizable = (d) => !!d && esNumero(d.count) && typeof d.traduccion === "string"
    && d.traduccion.trim() !== "" && avisosReales(d).length === 0;
  const celda = (q, clase = "", etiqueta = "Ver artículos en PubMed") =>
    '<a class="an-num ' + clase + '" data-q="' + esc(q) + '" data-etiqueta="' + esc(etiqueta)
    + '" href="' + esc(urlPubMed(q)) + '" target="_blank" rel="noopener" aria-label="' + esc(etiqueta) + '">…</a>';
  const enlaceValor = (q, n, etiqueta) => '<a class="an-num" href="' + esc(urlPubMed(q))
    + '" target="_blank" rel="noopener" aria-label="' + esc(etiqueta + ": " + num(n) + " registros") + '">' + num(n) + "</a>";
  const barra = (id, extra = "") => '<span class="an-barra an-sin-dato ' + extra + '" aria-hidden="true"><span class="an-relleno" data-barra="' + esc(id) + '"></span></span>';

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


  function rutas(estado, base, final) {
    return TIPOS.map((t) => {
      const q = t.q || (window.filterMap || {})[t.filtro];
      return { ...t, q, base: q ? y(base, q) : null, final: q ? y(final, q) : null };
    });
  }

  function panorama(s) {
    const comparar = s.base !== s.final;
    let h = '<section class="an-panorama" aria-labelledby="an-panorama-titulo">'
      + '<div class="an-titulo-fila"><h4 id="an-panorama-titulo">Qué puedes explorar</h4>'
      + '<span class="an-etiqueta">Sin valorar calidad clínica</span></div>'
      + '<p class="an-intro">Abre las cifras para explorar los artículos. Las rutas se solapan; no sumes sus recuentos.</p>'
      + '<div class="an-contexto"><span class="an-contexto-etiqueta">Tus términos</span><span class="an-tema">' + esc(s.estado.termino || "Sin términos: todo PubMed") + '</span></div>'
      + '<div class="an-resumen">';
    h += '<div><span class="an-sub">Disponibles</span>' + celda(s.base, "an-grande", "Disponibles: artículos sin los filtros añadidos") + '</div>';
    if (comparar) {
      h += '<div><span class="an-sub">Conservados</span>' + celda(s.final, "an-grande", "Conservados: artículos con tus filtros") + '</div>'
        + '<div><span class="an-sub">Fuera</span><span data-fuera-total>…</span></div>';
    }
    h += '</div><details class="an-definicion"><summary>Qué se compara</summary><p class="an-nota">' + (comparar
      ? "«Disponibles» mantiene los mismos términos y omite los filtros, Trending y la fecha añadidos en esta página. «Conservados» aplica tu consulta efectiva. «Fuera» resta disponibles menos conservados solo tras comprobar que la búsqueda filtrada no añade registros a la inicial. Las consultas se ejecutan por separado, no en una instantánea del índice."
      : "Al activar un filtro, verás también cuántos conserva y qué queda fuera en cada fila.") + '</p></details>'
      + '<p class="an-frase" data-frase hidden></p><p class="an-alerta" data-comparacion-aviso hidden></p>'
      + '<div class="an-leyenda">' + (comparar
        ? '<span><i class="an-marca an-marca-conserva" aria-hidden="true"></i>Conservados</span><span><i class="an-marca an-marca-fuera" aria-hidden="true"></i>Fuera</span><span>Cada barra = el 100 % de su fila sin filtros</span>'
        : '<span><i class="an-marca an-marca-conserva" aria-hidden="true"></i>Proporción de tu búsqueda en esta ruta</span>') + '</div>'
      + '<div class="an-rutas' + (comparar ? " an-compara" : "") + '" role="table" aria-label="Rutas documentales y conservación por tipo">'
      + '<div class="an-rutas-cabecera" role="row"><span role="columnheader">Ruta documental</span><span role="columnheader">' + (comparar ? "Qué conservan tus filtros" : "Proporción") + '</span>'
      + '<span role="columnheader">Disponibles</span>' + (comparar ? '<span role="columnheader">Conservados</span><span role="columnheader">Fuera</span>' : "") + '</div>';
    s.rutas.forEach((t) => {
      h += '<div class="an-ruta" role="row" data-ruta="' + t.id + '"><div class="an-ruta-nombre" role="rowheader"><strong>' + esc(t.nombre) + '</strong>'
        + '<span class="an-sub">' + esc(t.uso) + '</span><details class="an-criterio"><summary>Qué cuenta</summary><p>' + esc(t.criterio) + '</p></details></div>'
        + '<div class="an-ruta-barra" role="cell">' + barra("ruta-" + t.id) + '<span class="an-sub" data-retencion="' + t.id + '">Pendiente de recuento</span></div>'
        + '<div class="an-ruta-numero" role="cell"><span class="an-label-movil">Disponibles</span>' + (t.base ? celda(t.base, "", t.nombre + ", disponibles sin filtros") : '<span class="an-fallo">Filtro no disponible</span>') + '</div>';
      if (comparar) {
        h += '<div class="an-ruta-numero" role="cell"><span class="an-label-movil">Conservados</span>' + (t.final ? celda(t.final, "an-conserva", t.nombre + ", conservados con tus filtros") : '<span class="an-fallo">No calculado</span>') + '</div>'
          + '<div class="an-ruta-numero" role="cell"><span class="an-label-movil">Fuera</span>' + (t.base
            ? '<a class="an-num an-fuera" data-fuera="' + t.id + '" href="' + esc(urlPubMed(salvo(t.base, s.final))) + '" target="_blank" rel="noopener" aria-label="' + esc(t.nombre + ", fuera de tu búsqueda filtrada") + '">…</a><button type="button" class="an-medir" data-medir-fuera="' + t.id + '" hidden>Calcular (+1)</button>'
            : '<span class="an-fallo">No calculado</span>') + '</div>';
      }
      h += '</div>';
    });
    return h + '</div><p class="an-nota">Los registros recientes pueden carecer de etiquetas. Cada ruta explica sus límites en «Qué cuenta». Más artículos no significa mejor evidencia.</p></section>';
  }

  function filtrosHTML(s) {
    const { pasos, base, final } = s;
    let h = '<h4>Qué hacen tus filtros</h4>';
    if (pasos.length > 1) {
      h += '<table class="an-tabla an-cascada"><caption class="an-oculto">Artículos tras cada paso de la consulta</caption><thead><tr><th scope="col">Paso</th><th scope="col" class="an-col-barra">Proporción</th><th scope="col">Artículos</th><th scope="col">Cambio</th></tr></thead><tbody>';
      pasos.forEach((p, i) => {
        h += '<tr><th scope="row">' + esc(p.etiqueta) + (p.detalle ? '<span class="an-sub">' + esc(p.detalle) + '</span>' : "")
          + '</th><td>' + barra("paso" + i) + '</td><td>' + celda(p.q) + '</td><td class="an-delta" data-delta="' + i + '">' + (i ? "…" : "") + '</td></tr>';
      });
      h += '</tbody></table><p class="an-nota">Orden del constructor, no aportaciones independientes. Los saltos dependen de ese orden; no deben sumarse como efecto de cada filtro.</p>';
    } else h += '<p class="an-nota">No hay filtros añadidos que cambien esta consulta.</p>';
    if (s.antes && s.antes !== final) {
      h += '<div class="an-cambio"><h5>Último cambio</h5><p>Antes ' + celda(s.antes) + ' · ahora ' + celda(final)
        + ' · <strong>salen</strong> ' + celda(salvo(s.antes, final), "an-sale") + ' · <strong>entran</strong> ' + celda(salvo(final, s.antes), "an-entra")
        + '</p><p class="an-nota">Salen: estaban antes y ya no. Entran: no estaban antes. Cada cifra abre su conjunto en PubMed.</p></div>';
    }
    return h;
  }

  function aniosHTML(s) {
    const comparar = s.base !== s.final;
    let h = '<div class="an-titulo-fila"><h4>Evolución por año</h4><div class="an-selector" role="group" aria-label="Años mostrados">'
      + [10, 20].map((n) => '<button type="button" data-anios="' + n + '" aria-pressed="' + (anios === n) + '">' + n + ' años</button>').join("") + '</div></div>'
      + '<label class="an-fecha-serie">Calendario de la gráfica<select data-campo-anios><option value="dp"' + (campoAnio === "dp" ? " selected" : "") + '>Publicación [dp]</option><option value="crdt"' + (campoAnio === "crdt" ? " selected" : "") + '>Creación del registro [crdt]</option></select></label>'
      + (comparar ? '<div class="an-selector an-temporal-selector" role="group" aria-label="Vista de la evolución"><button type="button" data-temporal-modo="conservados" aria-pressed="true">Conservados</button><button type="button" data-temporal-modo="comparar" aria-pressed="false">Comparar volúmenes</button></div>' : '')
      + '<p class="an-nota" data-temporal-escala></p><div class="an-temporal-leyenda"><span>── ' + (comparar ? "Conservados" : "Disponibles") + '</span><span data-temporal-base hidden>┄┄ Disponibles</span></div><div data-grafica-anios class="an-grafica-anios"></div>'
      + '<p class="an-nota">' + new Date().getFullYear() + ': año en curso, incompleto. Se muestra con puntos huecos y separado de la línea de los años completos.</p>'
      + '<table class="an-tabla an-anios"><caption>Datos y consultas de la gráfica · ' + (campoAnio === "dp" ? "publicación" : "creación del registro en PubMed") + '</caption><thead><tr><th scope="col">Año</th>'
      + (comparar ? '<th scope="col">Disponibles</th>' : "") + '<th scope="col">' + (comparar ? "Conservados" : "Disponibles") + '</th>'
      + (comparar ? '<th scope="col">% conservado</th>' : "") + '</tr></thead><tbody>';
    for (let a = new Date().getFullYear(); a > new Date().getFullYear() - anios; a--) {
      h += '<tr><th scope="row">' + a + (a === new Date().getFullYear() ? '<span class="an-sub">en curso · incompleto</span>' : "") + '</th>'
        + (comparar ? '<td>' + barra("aB" + a, "an-gris") + celda(y(s.base, a + "[" + campoAnio + "]")) + '</td>' : "")
        + '<td>' + barra("aF" + a) + celda(y(s.final, a + "[" + campoAnio + "]")) + '</td>'
        + (comparar ? '<td class="an-pct" data-pct="anio' + a + '">…</td>' : "") + '</tr>';
    }
    return h + '</tbody></table><p class="an-nota">' + (campoAnio === "dp"
      ? "Fecha de publicación; un artículo puede contar en dos años por sus fechas electrónica e impresa."
      : "Fecha de creación del registro en PubMed; no equivale a publicación ni a indexación MeSH.") + ' Las barras de la tabla comparten escala.</p>';
  }

  function alcanceHTML(s) {
    const comparar = s.base !== s.final;
    let h = '<h4>Acceso y alcance</h4><table class="an-tabla"><caption class="an-oculto">Acceso, indexación, población e idioma</caption><thead><tr><th scope="col">Característica</th><th scope="col">' + (comparar ? "Conservados" : "Disponibles") + '</th>'
      + (comparar ? '<th scope="col">Disponibles</th>' : "") + '</tr></thead><tbody>';
    ALCANCE.forEach((t, i) => {
      h += '<tr><th scope="row">' + esc(t.nombre) + '</th><td>' + celda(y(s.final, t.q)) + ' <span class="an-pct" data-pct="alcF' + i + '"></span></td>'
        + (comparar ? '<td>' + celda(y(s.base, t.q)) + ' <span class="an-pct" data-pct="alcB' + i + '"></span></td>' : "") + '</tr>';
    });
    return h + '</tbody></table><p class="an-nota">MeSH «humanos» depende de la indexación; su ausencia no significa estudios en animales. Texto gratuito, idioma y MEDLINE no indican calidad clínica.</p>';
  }

  function consultaHTML(s) {
    let h = '<h4>Composición de la búsqueda</h4><ol class="an-composicion">';
    composicion(s.estado).forEach((l) => {
      h += '<li>' + (l.op ? '<span class="an-op">' + esc(l.op) + '</span>' : "") + '<span class="' + (l.literal ? "an-literal" : "") + '">' + esc(l.texto) + '</span>'
        + (l.grupo ? '<span class="an-sub">' + esc(l.grupo) + '</span>' : "") + '</li>';
    });
    return h + '</ol><div class="an-traduccion"><h5>Lo que ejecutó PubMed</h5><p>Consulta enviada:</p><pre>' + esc(s.final)
      + '</pre><p>Cómo la interpretó PubMed:</p><pre data-traduccion>…</pre><ul class="an-avisos" data-avisos></ul>'
      + (s.controlInclusion ? '<p>Artículos conservados que no están entre los disponibles: ' + celda(s.controlInclusion) + '. Este control no certifica una instantánea del índice.</p>' : "")
      + '</div>';
  }

  const seccion = (id, titulo, contenido) => '<details class="an-detalle" data-seccion="' + id + '"><summary><span>' + titulo
    + '</span><span class="an-coste" data-coste>Sin consultas adicionales</span></summary><div class="an-detalle-contenido">' + contenido + '</div></details>';

  function esqueleto(s) {
    const noAplicados = typeof window.filtrosNoAplicados === "function" ? window.filtrosNoAplicados() : [];
    const filtros = [...s.estado.activos].map(window.etiquetaFiltro);
    let h = '<header class="an-cabecera"><h3>Análisis de resultados</h3>'
      + '<p class="an-estado" role="status" aria-live="polite" data-estado>Preparando recuentos…</p></header>';
    if (noAplicados.length) h += '<p class="an-alerta">No se pudieron cargar estos filtros seleccionados y no forman parte de las cifras: ' + esc(noAplicados.map(window.etiquetaFiltro).join(", ")) + '.</p>';
    h += '<p class="an-filtros-actuales"><strong>Filtros activos:</strong> ' + esc(filtros.join(" · ") || "Ninguno")
      + (s.estado.trending ? " · Trending" : "") + (s.estado.fecha ? " · Últimos " + esc(s.estado.fecha) + " días" : "") + '</p>'
      + panorama(s) + '<div class="an-detalles"><h4>Explorar más, cuando lo necesites</h4><p class="an-nota">Abrir una sección calcula solo sus recuentos pendientes. La consulta de arriba no cambia.</p>'
      + seccion("filtros", "Tus filtros y el último cambio", filtrosHTML(s))
      + seccion("anios", "Evolución por año", aniosHTML(s))
      + seccion("alcance", "Acceso e indexación", alcanceHTML(s))
      + seccion("consulta", "Composición y consulta ejecutada", consultaHTML(s))
      + '</div><footer class="an-pie">Recuentos de PubMed en el momento de cada consulta, no muestras. Bibliometría descriptiva: no valora calidad, relevancia ni aplicabilidad clínica.</footer>';
    return h;
  }

  function programar() {
    // Invalidar YA: la respuesta anterior no puede pintar durante el debounce.
    if (actual) actual.control.abort();
    clearTimeout(temporizadorRecalculo);
    temporizadorRecalculo = setTimeout(analizar, ESPERA_RECALCULO_MS);
  }

  function consultasEn(raiz) {
    return [...new Set([...raiz.querySelectorAll(".an-num[data-q]")].map((el) => el.dataset.q))];
  }

  function vigente(s) { return s === actual && !s.control.signal.aborted && abierto; }

  function estadoCarga(s, forzar = false) {
    if (!vigente(s)) return;
    const el = panel.querySelector("[data-estado]");
    const hechas = s.resultados.size, total = s.solicitadas.size;
    if (el && (forzar || hechas === total || hechas % 5 === 0)) {
      el.textContent = hechas < total ? "Consultando PubMed: " + hechas + " de " + total + "…"
        : total + " recuentos · " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
          + (s.fallos ? " · " + s.fallos + " con fallo" : "") + (s.revisar ? " · " + s.revisar + " por revisar" : "");
    }
    panel.querySelector(".an-panorama")?.setAttribute("aria-busy", String([...s.iniciales].some((q) => !s.resultados.has(q))));
  }

  function costes(s) {
    panel.querySelectorAll("[data-campo-anios] option").forEach((op) => {
      const consultas = Array.from({ length: anios }, (_, i) => new Date().getFullYear() - i)
        .flatMap((a) => [y(s.base, a + "[" + op.value + "]"), y(s.final, a + "[" + op.value + "]")]);
      const n = [...new Set(consultas)].filter((q) => !s.solicitadas.has(q)).length;
      op.textContent = (op.value === "dp" ? "Publicación [dp]" : "Creación del registro [crdt]")
        + (op.value === campoAnio ? "" : n ? " · +" + n + " recuentos" : " · sin consultas adicionales");
    });
    panel.querySelectorAll("[data-seccion]").forEach((el) => {
      if (el.querySelector("[data-coste-propio]")) return;
      const n = consultasEn(el).filter((q) => !s.solicitadas.has(q)).length;
      el.querySelector("[data-coste]").textContent = n ? "Calcular " + n + " recuentos" : "Sin consultas adicionales";
    });
  }

  async function solicitar(consultas, s) {
    // Una sección recién dibujada también necesita las cifras que ya estaban resueltas.
    consultas.forEach((q) => { if (s.resultados.has(q)) pintar(q, s.resultados.get(q)); });
    const nuevas = [...new Set(consultas)].filter((q) => !s.solicitadas.has(q));
    nuevas.forEach((q) => s.solicitadas.add(q));
    costes(s); estadoCarga(s, true);
    await Promise.all(nuevas.map(async (q) => {
      try {
        const d = await window.PubMedConsultas.contar(q, s.control.signal);
        if (!vigente(s)) return;
        if (!d || !esNumero(d.count)) throw new Error("Recuento inválido");
        s.resultados.set(q, d);
        if (!utilizable(d)) s.revisar++;
        pintar(q, d);
      } catch (e) {
        if (!vigente(s)) return;
        s.resultados.set(q, null); s.fallos++; pintar(q, null);
      } finally {
        if (vigente(s)) { derivar(s); estadoCarga(s); }
      }
    }));
  }

  function pintar(q, d) {
    panel.querySelectorAll(".an-num[data-q]").forEach((el) => {
      if (el.dataset.q !== q) return;
      el.classList.toggle("an-fallo", !d);
      el.classList.toggle("an-aviso", !!d && !utilizable(d));
      el.textContent = d ? num(d.count) + (utilizable(d) ? "" : " ⚠") : "fallo";
      const etiqueta = el.dataset.etiqueta || "Ver artículos en PubMed";
      el.setAttribute("aria-label", etiqueta + ": " + (d ? num(d.count) + " registros" : "recuento fallido") + ", abre una pestaña");
      el.title = !d ? "No se pudo calcular. No es un cero; puedes abrir la consulta."
        : !utilizable(d) ? "Revisar antes de interpretar: " + (avisosReales(d).join("; ") || "PubMed no devolvió traducción")
          : "Ver esta consulta en PubMed";
    });
  }

  function numero(s, q) {
    const d = s.resultados.get(q);
    return utilizable(d) ? d.count : undefined;
  }

  function ancho(id, fraccion) {
    const el = panel.querySelector('[data-barra="' + id + '"]');
    const valido = Number.isFinite(fraccion) && fraccion >= 0 && fraccion <= 1;
    if (el) {
      el.style.width = valido ? fraccion * 100 + "%" : "0%";
      el.parentElement.classList.toggle("an-sin-dato", !valido);
    }
  }

  function ponerFuera(el, q, valor, etiqueta) {
    el.textContent = num(valor);
    el.setAttribute("aria-label", etiqueta + ": " + num(valor) + " registros, abre una pestaña");
    el.href = urlPubMed(q);
  }

  function derivar(s) {
    if (!vigente(s)) return;
    const a = numero(s, s.base), b = numero(s, s.final);
    const comparar = s.base !== s.final;
    const inclusion = !comparar || numero(s, s.controlInclusion) === 0;
    const aviso = panel.querySelector("[data-comparacion-aviso]");
    const controlTerminado = !comparar || s.resultados.has(s.controlInclusion);
    if (aviso) {
      aviso.hidden = !comparar || !controlTerminado || inclusion;
      aviso.textContent = "No se pudo confirmar que la búsqueda filtrada esté contenida en la inicial. «Fuera» se mide por separado cuando lo solicites.";
    }
    const totalFuera = panel.querySelector("[data-fuera-total]");
    if (totalFuera) totalFuera.innerHTML = inclusion && esNumero(a) && esNumero(b) && b <= a
      ? enlaceValor(salvo(s.base, s.final), a - b, "Artículos fuera de tu búsqueda filtrada") : '<span class="an-sub">Sin verificar</span>';

    s.rutas.forEach((t) => {
      const disponible = t.base ? numero(s, t.base) : undefined;
      const conservado = t.final ? numero(s, t.final) : undefined;
      const texto = panel.querySelector('[data-retencion="' + t.id + '"]');
      const fuera = panel.querySelector('[data-fuera="' + t.id + '"]');
      const medir = panel.querySelector('[data-medir-fuera="' + t.id + '"]');
      const qFuera = t.base ? salvo(t.base, s.final) : null;
      const medido = qFuera ? numero(s, qFuera) : undefined;
      const restaValida = inclusion && esNumero(disponible) && esNumero(conservado) && conservado <= disponible;
      if (comparar && fuera) {
        if (esNumero(medido)) ponerFuera(fuera, qFuera, medido, t.nombre + ", fuera");
        else if (restaValida) ponerFuera(fuera, qFuera, disponible - conservado, t.nombre + ", fuera");
        else {
          fuera.textContent = qFuera && s.resultados.has(qFuera) ? "fallo" : "Ver fuera";
          fuera.classList.toggle("an-fallo", !!qFuera && s.resultados.has(qFuera));
        }
        medir.hidden = esNumero(medido) || restaValida || !controlTerminado || s.solicitadas.has(qFuera);
      }
      if (!t.q) { texto.textContent = "No calculado: falta el filtro"; return; }
      if (comparar && restaValida) {
        ancho("ruta-" + t.id, disponible ? conservado / disponible : undefined);
        texto.textContent = disponible ? pct(conservado, disponible) + " conservado" : "Sin registros en esta fila";
      } else if (!comparar && esNumero(disponible) && esNumero(a) && disponible <= a) {
        ancho("ruta-" + t.id, a ? disponible / a : undefined);
        texto.textContent = a ? pct(disponible, a) + " de tu búsqueda" : "Sin registros en esta búsqueda";
      } else {
        ancho("ruta-" + t.id, undefined);
        texto.textContent = esNumero(disponible) && esNumero(conservado) ? "Conservación sin verificar"
          : s.resultados.has(t.base) && s.resultados.has(t.final) ? "Sin recuento verificable" : "Pendiente de recuento";
      }
    });

    const elFrase = panel.querySelector("[data-frase]");
    const verificadas = s.rutas.map((t) => ({ ...t, disponibles: numero(s, t.base), conservados: numero(s, t.final) }))
      .filter((t) => esNumero(t.disponibles) && t.disponibles >= 5 && esNumero(t.conservados) && t.conservados <= t.disponibles);
    // Esperar a toda la primera vista evita destacar la primera respuesta que llega.
    const resumenCompleto = [...s.iniciales].every((q) => s.resultados.has(q));
    elFrase.hidden = !comparar || !inclusion || !resumenCompleto || !verificadas.length;
    if (!elFrase.hidden) {
      const proporcion = (t) => t.conservados / t.disponibles;
      const mejor = verificadas.reduce((m, t) => proporcion(t) > proporcion(m)
        || (proporcion(t) === proporcion(m) && t.disponibles > m.disponibles) ? t : m);
      // En pérdidas empatadas se mantiene el orden visible de las rutas, sin un veredicto clínico.
      const perdida = verificadas.reduce((m, t) => proporcion(t) < proporcion(m) ? t : m);
      const fuera = perdida.disponibles - perdida.conservados;
      elFrase.innerHTML = "Entre rutas verificadas con al menos cinco registros: "
        + (mejor.conservados ? "mayor conservación en «" + esc(mejor.nombre) + "», "
          + enlaceValor(mejor.final, mejor.conservados, mejor.nombre + ", conservados") + " de "
          + enlaceValor(mejor.base, mejor.disponibles, mejor.nombre + ", disponibles") + " (" + pct(mejor.conservados, mejor.disponibles) + ")."
          : "ninguna conserva registros.")
        + (fuera ? " Mayor pérdida proporcional en «" + esc(perdida.nombre) + "»: quedan fuera "
          + enlaceValor(salvo(perdida.base, s.final), fuera, perdida.nombre + ", fuera") + " de "
          + enlaceValor(perdida.base, perdida.disponibles, perdida.nombre + ", disponibles") + " (" + pct(fuera, perdida.disponibles) + ")."
          : " No quedan registros fuera en estas rutas.");
    }

    s.pasos.forEach((p, i) => {
      const n = numero(s, p.q), previo = i ? numero(s, s.pasos[i - 1].q) : undefined;
      ancho("paso" + i, a ? n / a : undefined);
      const el = panel.querySelector('[data-delta="' + i + '"]');
      if (el && i && esNumero(n) && esNumero(previo)) {
        const delta = n - previo;
        el.textContent = delta === 0 ? "sin cambio" : (delta < 0 ? "−" : "+") + num(Math.abs(delta)) + " (" + pct(Math.abs(delta), previo) + ")";
      }
    });
    ALCANCE.forEach((t, i) => {
      [["F", s.final, b], ["B", s.base, a]].forEach(([lado, q, total]) => {
        const el = panel.querySelector('[data-pct="alc' + lado + i + '"]'), n = numero(s, y(q, t.q));
        if (el) el.textContent = esNumero(n) && esNumero(total) && n <= total ? pct(n, total) : "";
      });
    });
    const lista = Array.from({ length: anios }, (_, i) => new Date().getFullYear() - i);
    const maximo = Math.max(0, ...lista.flatMap((a) => [numero(s, y(s.base, a + "[" + campoAnio + "]")) || 0, numero(s, y(s.final, a + "[" + campoAnio + "]")) || 0]));
    lista.forEach((anio) => {
      const na = numero(s, y(s.base, anio + "[" + campoAnio + "]")), nb = numero(s, y(s.final, anio + "[" + campoAnio + "]"));
      ancho("aB" + anio, maximo ? na / maximo : undefined); ancho("aF" + anio, maximo ? nb / maximo : undefined);
      const el = panel.querySelector('[data-pct="anio' + anio + '"]');
      if (el) el.textContent = inclusion && esNumero(na) && esNumero(nb) && nb <= na ? pct(nb, na) : "—";
    });
    const final = s.resultados.get(s.final);
    const traduccion = panel.querySelector("[data-traduccion]");
    if (traduccion && s.resultados.has(s.final)) traduccion.textContent = final?.traduccion || "No disponible: revisa el estado de esta consulta.";
    const avisos = panel.querySelector("[data-avisos]");
    if (avisos && final) avisos.innerHTML = avisosReales(final).map((a) => "<li>" + esc(a) + "</li>").join("")
      || (utilizable(final) ? "<li>Sin avisos de PubMed para esta consulta.</li>" : "<li>No se pudo verificar la traducción.</li>");
    window.PubMedAtlas?.actualizar(panel, s);
  }

  function analizar() {
    if (!abierto || !panel) return;
    if (actual) actual.control.abort();
    if (typeof window.estadoBusqueda !== "function" || typeof window.constructQuery !== "function") {
      panel.innerHTML = '<p class="an-alerta">No se puede leer la búsqueda de la página.</p>'; return;
    }
    const estado = window.estadoBusqueda(), final = window.constructQuery(estado.termino);
    if (!final) {
      actual = null;
      panel.innerHTML = '<header class="an-cabecera"><h3>Análisis de resultados</h3></header><p class="an-vacio">Escribe un término o activa un filtro. Podrás explorar los documentos, sus tipos y qué conservan tus filtros.</p>'; return;
    }
    if (!window.PubMedConsultas) { panel.innerHTML = '<p class="an-alerta">Los recuentos de PubMed no están disponibles.</p>'; return; }
    const pasos = planificarPasos(estado), base = pasos[0].q;
    const s = { estado, final, base, pasos, antes: final !== estable ? estable : anterior, control: new AbortController(),
      controlInclusion: base !== final ? salvo(final, base) : null, resultados: new Map(), solicitadas: new Set(), fallos: 0, revisar: 0 };
    s.rutas = rutas(estado, base, final); actual = s;
    panel.innerHTML = esqueleto(s);
    window.PubMedAtlas?.montar(panel, s, { esc, celda, num, pct, urlPubMed, pintar,
      numero: (q) => numero(s, q), solicitar: (qs) => solicitar(qs, s), vigente: () => vigente(s) });
    panel.querySelectorAll("[data-seccion]").forEach((el) => el.addEventListener("toggle", () => {
      if (el.open && el.dataset.seccion !== "cruces" && vigente(s)) solicitar(consultasEn(el), s);
    }));
    // El recorrido y los cruces muestran consultas, pero su cálculo sigue siendo bajo demanda.
    const iniciales = [...new Set([base, final, ...s.rutas.flatMap((t) => [t.base, t.final]).filter(Boolean)])];
    if (s.controlInclusion) iniciales.push(s.controlInclusion);
    s.iniciales = new Set(iniciales);
    solicitar(iniciales, s);
    window.PubMedAtlas?.actualizar(panel, s);
  }

  function alternar() {
    abierto = !abierto; panel.hidden = !abierto;
    boton.classList.toggle("active", abierto); boton.setAttribute("aria-expanded", String(abierto));
    const rotulo = boton.querySelector("span");
    if (rotulo) rotulo.textContent = abierto ? "Ocultar análisis" : "Análisis de resultados";
    if (abierto) {
      analizar();
      panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    } else if (actual) actual.control.abort();
  }

  function alCambiar(e) {
    pendiente = e.detail ? e.detail.consulta : null;
    clearTimeout(temporizadorEstable);
    temporizadorEstable = setTimeout(() => {
      if (pendiente && pendiente !== estable) { anterior = estable; estable = pendiente; }
    }, ESPERA_ESTABLE_MS);
    if (abierto) programar();
  }

  function init() {
    panel = document.getElementById("analisisPanel"); boton = document.getElementById("toggleAnalisisButton");
    if (!panel || !boton) return;
    boton.addEventListener("click", alternar); document.addEventListener("consulta-cambiada", alCambiar);
    const refrescarAnios = (foco) => {
      const detalle = panel.querySelector('[data-seccion="anios"]');
      detalle.querySelector(".an-detalle-contenido").innerHTML = aniosHTML(actual);
      detalle.querySelector(foco)?.focus();
      solicitar(consultasEn(detalle), actual); derivar(actual);
    };
    panel.addEventListener("change", (e) => {
      if (!e.target.matches("[data-campo-anios]") || !actual || !vigente(actual)) return;
      if (!["dp", "crdt"].includes(e.target.value)) return;
      campoAnio = e.target.value; refrescarAnios("[data-campo-anios]");
    });
    panel.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-anios], button[data-medir-fuera]");
      if (!b || !actual || !vigente(actual)) return;
      if (b.dataset.anios) {
        const n = Number(b.dataset.anios); if (n === anios) return;
        anios = n;
        refrescarAnios('[data-anios="' + n + '"]');
      } else {
        const t = actual.rutas.find((t) => t.id === b.dataset.medirFuera);
        if (t?.base) {
          b.disabled = true; b.textContent = "Calculando…";
          solicitar([salvo(t.base, actual.final)], actual);
        }
      }
    });
  }
  document.addEventListener("DOMContentLoaded", init);
  window.__analisisPubMed = { planificarPasos, composicion, TIPOS, ALCANCE, utilizable };
})();
