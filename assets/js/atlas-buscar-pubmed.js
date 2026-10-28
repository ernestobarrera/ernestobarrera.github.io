/* Atlas de resultados. Presentación y exploración sobre la sesión/cola del panel.
 * Sin proveedores, dependencias ni cola propios. Los cruces son cuatro consultas directas.
 */
(function () {
  "use strict";
  const contextos = new WeakMap();
  const seguro = (n) => Number.isSafeInteger(n) && n >= 0;
  const and = (a, b) => "(" + a + ") AND (" + b + ")";
  const not = (a, b) => "(" + a + ") NOT (" + b + ")";
  const limpio = (t) => String(t).replace(/^[^\p{L}\p{N}]+/u, "").trim();

  function conjunto(universo, expresion) {
    return /^NOT\b\s*/i.test(expresion.trim())
      ? not(universo, expresion.trim().replace(/^NOT\b\s*/i, ""))
      : and(universo, expresion);
  }
  function consultasCruce(universo, expresionA, expresionB) {
    const a = conjunto(universo, expresionA), b = conjunto(universo, expresionB);
    return [and(a, b), not(a, b), not(b, a), not(universo, "(" + a + ") OR (" + b + ")")];
  }
  function evaluarCruce(valores, universo) {
    if (!seguro(universo) || valores.length !== 4 || !valores.every(seguro)) return { valido: false };
    const suma = valores.reduce((a, b) => a + b, 0);
    if (!Number.isSafeInteger(suma) || suma !== universo) return { valido: false };
    const union = valores[0] + valores[1] + valores[2];
    return { valido: true, suma, union, jaccard: union ? valores[0] / union : null };
  }
  function catalogo(s) {
    const rutas = s.rutas.filter((t) => t.q).map((t) => ({ id: "ruta:" + t.id, nombre: t.nombre, q: t.q, grupo: "Rutas documentales" }));
    const filtros = Object.entries(window.filterMap || {}).filter(([, q]) => typeof q === "string" && q.trim())
      .map(([id, q]) => ({ id: "filtro:" + id, nombre: limpio(window.etiquetaFiltro(id)), q, grupo: "Catálogo de filtros" }));
    return [...rutas, ...filtros];
  }
  function registro(s, cruce = null) {
    return {
      formato: "buscar-pubmed-atlas/1", generado_utc: new Date().toISOString(),
      fuente: "PubMed · NCBI ESearch", base: s.base, consulta_efectiva: s.final,
      filtros: [...s.estado.activos].map((id) => ({ id, nombre: limpio(window.etiquetaFiltro(id)), expresion: (window.filterMap || {})[id] || null })), operadores: s.estado.operadores,
      fecha: s.estado.fecha || null, trending: !!s.estado.trending,
      rutas: s.rutas.map((t) => ({ id: t.id, nombre: t.nombre, expresion: t.q || null, criterio: t.criterio })),
      recorrido: s.pasos.map((p) => ({ etiqueta: p.etiqueta, consulta: p.q })),
      cruce_seleccionado: cruce ? { universo: cruce.universo, lente_a: cruce.a, lente_b: cruce.b, consultas: cruce.qs, solicitado: cruce.solicitado } : null,
      recuentos: [...s.resultados].map(([consulta, dato]) => ({ consulta, estado: !dato ? "fallo" : window.__analisisPubMed.utilizable(dato) ? "utilizable" : "revisar", dato })),
      derivaciones: { fuera_por_ruta: "Disponibles menos conservados, solo con inclusión y cifras verificadas.",
        cruces: "Cuatro regiones contadas directamente; Jaccard derivado solo si la partición suma el universo." },
      limites: ["Recuentos independientes, no una instantánea atómica.", "Rutas solapadas, no evaluaciones de calidad.", "Este registro no certifica el cumplimiento de PRISMA-S."]
    };
  }

  function montar(panel, s, api) {
    const c = { panel, s, api, modo: "volumen", temporal: "conservados", catalogo: catalogo(s), cruce: null };
    contextos.set(panel, c);
    panel.classList.add("an-atlas");
    const { esc, celda } = api, comparar = s.base !== s.final;
    const cabecera = panel.querySelector(".an-cabecera");
    cabecera.querySelector("h3").textContent = "Atlas de resultados";
    cabecera.querySelector("h3").insertAdjacentHTML("beforebegin", '<p class="an-eyebrow">PUBMED / EXPLORACIÓN DOCUMENTAL</p>');
    panel.querySelector("#an-panorama-titulo").textContent = "Atlas de tu búsqueda";
    panel.querySelector(".an-intro").textContent = "Volumen, cobertura y caminos de lectura. Cada cifra abre sus artículos en PubMed.";
    cabecera.append(panel.querySelector(".an-intro"));
    panel.querySelector(".an-panorama > .an-titulo-fila").classList.add("an-oculto");
    const resumen = panel.querySelector(".an-resumen");
    if (comparar) resumen.insertAdjacentHTML("beforeend", '<div><span class="an-sub">Porcentaje conservado</span><a class="an-indicador" data-conservacion-total href="' + esc(api.urlPubMed(s.final)) + '" target="_blank" rel="noopener">…</a></div>');
    const mesa = panel.querySelector(".an-rutas"), panorama = panel.querySelector(".an-panorama");
    const grid = document.createElement("div"); grid.className = "an-atlas-grid";
    mesa.before(grid);
    const carta = document.createElement("section"); carta.className = "an-carta an-carta-rutas";
    carta.setAttribute("aria-label", "Mapa de rutas documentales");
    carta.innerHTML = '<div class="an-carta-titulo"><div><p class="an-eyebrow">01 / MAPA DOCUMENTAL</p><h4>Qué literatura hay</h4></div><div class="an-selector" role="group" aria-label="Lectura de las barras"><button type="button" data-atlas-modo="volumen" aria-pressed="true">Volumen</button>' + (comparar ? '<button type="button" data-atlas-modo="conservacion" aria-pressed="false">Conservación</button>' : '') + '</div></div>';
    const leyenda = panel.querySelector(".an-leyenda");
    leyenda.innerHTML = '<span><i class="an-marca ' + (comparar ? "an-marca-base" : "an-marca-conserva") + '" aria-hidden="true"></i>Disponibles</span>' + (comparar ? '<span><i class="an-marca an-marca-conserva" aria-hidden="true"></i>Conservados</span>' : '') + '<span data-escala>Escala común · registros por ruta</span>';
    carta.append(leyenda, mesa);
    carta.insertAdjacentHTML("beforeend", '<p class="an-nota">Las rutas se solapan y combinan etiquetas de publicación, MeSH y filtros. No sumes sus recuentos.</p>');
    grid.append(carta);
    s.rutas.forEach((t) => {
      const fila = mesa.querySelector('[data-ruta="' + t.id + '"]');
      const pista = fila.querySelector(".an-ruta-barra");
      pista.insertAdjacentHTML("afterbegin", '<span class="an-base-barra an-sin-dato" aria-hidden="true"><span data-barra-base="' + t.id + '"></span></span>');
      if (!comparar) pista.querySelector(".an-base-barra").hidden = true;
      const tipo = t.filtro ? "Filtro" : t.id === "cohortes" ? "MeSH" : "Publicación";
      fila.querySelector("strong").insertAdjacentHTML("afterend", '<span class="an-origen">' + tipo + '</span>');
      if (t.id !== "cohortes") {
        const uso = fila.querySelector(".an-ruta-nombre > .an-sub");
        const criterio = fila.querySelector(".an-criterio p");
        if (uso && criterio) { criterio.prepend(uso); }
      }
    });

    const flujo = document.createElement("aside"); flujo.className = "an-carta an-flujo";
    flujo.innerHTML = '<p class="an-eyebrow">02 / CONSULTA EFECTIVA</p><h4>Cómo llegas al resultado</h4><p class="an-nota">Secuencia real de tu estrategia. El orden condiciona los cambios.</p><ol class="an-pasos">' +
      s.pasos.map((p, i) => '<li><span class="an-paso-indice" aria-hidden="true">' + String(i + 1).padStart(2, "0") + '</span><div><strong class="an-paso-nombre">' + esc(p.etiqueta) + '</strong>' + (p.detalle ? '<span class="an-sub">' + esc(p.detalle) + '</span>' : '') + '<div class="an-paso-datos">' + celda(p.q, "", "Registros tras el paso " + p.etiqueta) + '<span class="an-delta" data-delta="' + i + '"></span></div><span class="an-barra an-sin-dato" aria-hidden="true"><span class="an-relleno" data-barra="paso' + i + '"></span></span></div></li>').join("") +
      '</ol><button type="button" class="an-accion" data-completar-flujo>Completar recorrido</button><p class="an-nota">Un filtro OR puede ampliar el conjunto. Esta secuencia no atribuye el efecto a cada filtro por separado.</p>';
    grid.append(flujo);
    const detalleFiltros = panel.querySelector('[data-seccion="filtros"]');
    detalleFiltros.querySelector(".an-cascada")?.remove();
    detalleFiltros.querySelector("h4")?.remove();
    detalleFiltros.querySelector("summary > span").textContent = "Lógica y último cambio";
    flujo.append(detalleFiltros);
    const frase = panel.querySelector("[data-frase]");
    grid.after(frase);
    const definicion = panel.querySelector(".an-definicion");
    const contexto = document.createElement("div"); contexto.className = "an-busqueda-contexto";
    const filtrosActuales = panel.querySelector(".an-filtros-actuales"); filtrosActuales.before(contexto);
    contexto.append(panel.querySelector(".an-contexto"), filtrosActuales, definicion);
    definicion.insertAdjacentHTML("beforebegin", '<p class="an-nota an-conjuntos">Disponibles: tus términos sin los filtros añadidos aquí.' + (comparar ? ' Conservados: tu consulta efectiva con esos filtros.' : '') + '</p>');
    const notaOriginal = panorama.querySelector(":scope > .an-nota");
    if (notaOriginal) definicion.append(notaOriginal);
    const nota = document.createElement("p"); nota.className = "an-nota an-procedencia";
    nota.textContent = "Fuente: NCBI ESearch. Disponibles y conservados: recuentos directos. Fuera: diferencia comprobada. No mide calidad ni aplicabilidad.";
    panorama.append(nota);

    const cruces = document.createElement("details"); cruces.className = "an-detalle"; cruces.dataset.seccion = "cruces";
    cruces.innerHTML = '<summary><span>Cruces y complementariedad</span><span class="an-coste" data-coste data-coste-propio>Elegir dos lentes · hasta 4 recuentos</span></summary><div class="an-detalle-contenido"><p class="an-eyebrow">03 / CARRILES ALTERNATIVOS</p><h4>Qué coincide y qué aporta cada lente</h4><p class="an-nota">Compara dos filtros o rutas dentro del mismo universo. Explorar aquí no cambia tu búsqueda.</p><div class="an-cruce-controles"><label>Universo<select data-cruce-universo><option value="base">Disponibles</option>' + (comparar ? '<option value="final">Conservados</option>' : '') + '</select></label><label>Lente A<select data-lente="a"></select></label><label>Lente B<select data-lente="b"></select></label><button type="button" class="an-accion" data-calcular-cruce>Calcular cruce · hasta 4 recuentos</button></div><p class="an-nota" data-cruce-definicion></p><div data-cruce-grafico></div><p class="an-nota" data-cruce-estado role="status" aria-live="polite">Elige las lentes. No se consulta hasta que pulses Calcular.</p><div class="an-inspector"><strong data-region-titulo>Consulta de la región seleccionada</strong><pre data-region-consulta></pre><a data-region-enlace target="_blank" rel="noopener">Abrir región en PubMed</a></div></div>';
    const detalles = panel.querySelector(".an-detalles");
    detalles.querySelector("h4").textContent = "Profundizar";
    detalles.querySelector(".an-nota").textContent = "Elige una tarea. Las consultas adicionales se indican antes de calcular.";
    detalles.querySelector('[data-seccion="alcance"]').before(cruces);
    const opciones = c.catalogo.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.grupo + " · " + t.nombre) + '</option>').join("");
    cruces.querySelectorAll("[data-lente]").forEach((e) => { e.innerHTML = opciones; });
    cruces.querySelector('[data-lente="b"]').value = c.catalogo.find((t) => t.id === "ruta:sistematica")?.id || c.catalogo[1]?.id || c.catalogo[0]?.id;
    prepararCruce(c);

    const consulta = panel.querySelector('[data-seccion="consulta"]');
    consulta.querySelector("summary > span").textContent = "Método y registro exportable";
    consulta.querySelector(".an-detalle-contenido").insertAdjacentHTML("afterbegin", '<div class="an-exporta"><div><p class="an-eyebrow">REGISTRO REPRODUCIBLE</p><p class="an-nota">Guarda expresiones, traducciones, recuentos, avisos y hora. Incluye solo lo consultado.</p></div><button type="button" class="an-accion" data-copiar-estrategia>Copiar estrategia</button><button type="button" class="an-accion" data-exportar-registro>Descargar JSON</button><span data-exporta-estado role="status" class="an-nota"></span></div>');
    cabecera.insertAdjacentHTML("afterend", '<nav class="an-navega" aria-label="Tareas del atlas"><button type="button" data-ir-atlas="rutas">Panorama</button><button type="button" data-ir-atlas="anios">Evolución</button><button type="button" data-ir-atlas="cruces">Cruces</button><button type="button" data-ir-atlas="consulta">Documentar</button></nav>');
    panel.addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b || !api.vigente()) return;
      if (b.dataset.atlasModo) { c.modo = b.dataset.atlasModo; actualizar(panel, s); }
      if (b.dataset.temporalModo) { c.temporal = b.dataset.temporalModo; dibujarTemporal(c); }
      if (b.hasAttribute("data-completar-flujo")) await api.solicitar(s.pasos.map((p) => p.q));
      if (b.dataset.irAtlas) {
        const el = b.dataset.irAtlas === "rutas" ? carta : panel.querySelector('[data-seccion="' + b.dataset.irAtlas + '"]');
        if (el) { if (el.tagName === "DETAILS") el.open = true; el.scrollIntoView({ block: "start", behavior: "auto" }); const foco = el.querySelector("summary, button"); foco?.focus({ preventScroll: true }); }
      }
      if (b.hasAttribute("data-calcular-cruce") && c.cruce) { c.cruce.solicitado = true; await api.solicitar(c.cruce.qs); actualizar(panel, s); }
      if (b.dataset.region !== undefined && c.cruce) { c.cruce.seleccion = Number(b.dataset.region); actualizarCruce(c); }
      if (b.hasAttribute("data-exportar-registro")) {
        const blob = new Blob([JSON.stringify(registro(s, c.cruce), null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob), a = document.createElement("a");
        a.href = url; a.download = "pubmed-registro-" + new Date().toISOString().slice(0, 10) + ".json"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        panel.querySelector("[data-exporta-estado]").textContent = "Registro preparado con las consultas de esta sesión.";
      }
      if (b.hasAttribute("data-copiar-estrategia")) {
        const texto = "PubMed · " + new Date().toISOString() + (comparar ? "\n\nConservados (consulta efectiva):\n" + s.final : "") + "\n\nDisponibles (sin filtros añadidos):\n" + s.base + "\n\nFiltros: " + [...s.estado.activos].join(", ") + "\nNo certifica una revisión exhaustiva ni PRISMA-S.";
        try { await navigator.clipboard.writeText(texto); panel.querySelector("[data-exporta-estado]").textContent = "Estrategia copiada."; }
        catch { panel.querySelector("[data-exporta-estado]").textContent = "El navegador no permite copiar. Puedes seleccionar la consulta o descargar el registro."; }
      }
    }, { signal: s.control.signal });
    panel.addEventListener("change", (e) => { if (e.target.matches("[data-lente], [data-cruce-universo]") && api.vigente()) prepararCruce(c); }, { signal: s.control.signal });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (api.vigente()) dibujarTemporal(c); else ro.disconnect(); }) : null;
    if (ro) ro.observe(panel);
    s.control.signal.addEventListener("abort", () => ro?.disconnect(), { once: true });
  }

  function prepararCruce(c) {
    const { panel, s, api } = c;
    const a = c.catalogo.find((t) => t.id === panel.querySelector('[data-lente="a"]').value);
    const b = c.catalogo.find((t) => t.id === panel.querySelector('[data-lente="b"]').value);
    if (!a || !b) return;
    const universo = panel.querySelector("[data-cruce-universo]").value === "final" ? s.final : s.base;
    c.cruce = { a, b, universo, qs: consultasCruce(universo, a.q, b.q), seleccion: 0, solicitado: false };
    const nombres = ["Ambas lentes", "Solo A", "Solo B", "Ninguna"];
    panel.querySelector("[data-cruce-grafico]").innerHTML = '<div class="an-particion" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="an-regiones">' + nombres.map((n, i) => '<div class="an-region"><button type="button" data-region="' + i + '" aria-pressed="' + (i === 0) + '">' + n + '</button>' + api.celda(c.cruce.qs[i], "", n + " dentro del universo elegido") + '<span class="an-sub">Recuento directo</span></div>').join("") + '</div><p class="an-jaccard" data-jaccard></p>';
    panel.querySelector("[data-cruce-definicion]").textContent = "A: " + a.nombre + " · B: " + b.nombre + ". Las exclusiones se conservan con su sentido original.";
    c.cruce.qs.forEach((q) => { if (s.resultados.has(q)) api.pintar(q, s.resultados.get(q)); });
    actualizarCruce(c);
  }
  function actualizarCruce(c) {
    if (!c.cruce) return;
    const { panel, s, api } = c, t = c.cruce, valores = t.qs.map(api.numero);
    const r = evaluarCruce(valores, api.numero(t.universo));
    const pendientes = [...new Set(t.qs)].filter((q) => !s.solicitadas.has(q)).length;
    const b = panel.querySelector("[data-calcular-cruce]");
    const completo = t.qs.every((q) => s.resultados.has(q));
    b.disabled = !pendientes; b.textContent = pendientes ? "Calcular cruce · " + pendientes + " recuentos" : completo ? "Cruce calculado" : "Calculando…";
    panel.querySelector('[data-seccion="cruces"] [data-coste]').textContent = pendientes ? "Bajo demanda · " + pendientes + " recuentos" : completo ? "Sin consultas adicionales" : "Consultando PubMed…";
    panel.querySelectorAll(".an-particion > span").forEach((el, i) => { el.style.flex = r.valido ? String(valores[i]) : "1"; el.classList.toggle("an-sin-dato", !r.valido); });
    panel.querySelector("[data-cruce-estado]").textContent = r.valido
      ? "Los cuatro grupos suman el universo. Cifras directas de consultas independientes; pueden cambiar con el índice."
      : completo ? "No se puede comprobar la partición: hay un fallo, aviso o recuentos que no encajan. No se dibujan proporciones."
        : t.solicitado ? "Consultando los cuatro grupos…" : "Previsualización de consultas. Pulsa Calcular para obtener cifras.";
    const j = panel.querySelector("[data-jaccard]");
    j.textContent = r.valido ? r.jaccard === null ? "Coincidencia (Jaccard): no definida, ambas lentes están vacías."
      : "Coincidencia (Jaccard, derivada): " + api.pct(valores[0], r.union) + ". Mide registros compartidos, no calidad ni sensibilidad." : "Coincidencia (Jaccard): pendiente de una partición coherente.";
    panel.querySelectorAll("[data-region]").forEach((el) => el.setAttribute("aria-pressed", String(Number(el.dataset.region) === t.seleccion)));
    const titulo = ["Ambas lentes", "Solo lente A", "Solo lente B", "Ninguna de las dos"][t.seleccion];
    panel.querySelector("[data-region-titulo]").textContent = titulo + " · consulta exacta";
    panel.querySelector("[data-region-consulta]").textContent = t.qs[t.seleccion];
    panel.querySelector("[data-region-enlace]").href = api.urlPubMed(t.qs[t.seleccion]);
  }

  function dibujarTemporal(c) {
    const { panel, s, api } = c, destino = panel.querySelector("[data-grafica-anios]");
    if (!destino || !destino.getBoundingClientRect().width) return;
    const anios = [...panel.querySelectorAll(".an-anios tbody tr")].map((tr) => Number(tr.querySelector("th").childNodes[0].textContent));
    if (!anios.length) return;
    const w = Math.max(260, Math.round(destino.getBoundingClientRect().width)), h = 215, l = 48, r = 24, t = 28, b = 30;
    const filtrado = s.base !== s.final, comparar = filtrado && c.temporal === "comparar";
    panel.querySelectorAll("[data-temporal-modo]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.temporalModo === c.temporal)));
    panel.querySelector("[data-temporal-base]").hidden = !comparar;
    panel.querySelector("[data-temporal-escala]").textContent = comparar
      ? "Disponibles y conservados · escala común desde cero para comparar volúmenes."
      : (filtrado ? "Conservados" : "Disponibles") + " · escala propia desde cero para ver su evolución.";
    const campo = panel.querySelector("[data-campo-anios]")?.value === "crdt" ? "crdt" : "dp";
    const series = (comparar ? [s.base, s.final] : [s.final]).map((q) => anios.slice().reverse().map((a) => api.numero(and(q, a + "[" + campo + "]"))));
    const max = Math.max(0, ...series.flat().filter(seguro));
    if (!series.some((serie) => serie.some(seguro))) { destino.innerHTML = '<p class="an-nota">La gráfica aparecerá con los recuentos. Un dato ausente nunca se dibuja como cero.</p>'; return; }
    const x = (i) => l + i * (w - l - r) / Math.max(1, anios.length - 1), y = (n) => h - b - (max ? n / max : 0) * (h - t - b);
    const orden = anios.slice().reverse(), enCurso = orden.indexOf(new Date().getFullYear());
    let svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">';
    if (enCurso >= 0) {
      const inicio = enCurso ? (x(enCurso - 1) + x(enCurso)) / 2 : l;
      svg += '<rect x="' + inicio + '" y="' + t + '" width="' + (w - 8 - inicio) + '" height="' + (h - t - b) + '" class="an-anio-incompleto"/><text x="' + (w - 8) + '" y="17" text-anchor="end">en curso</text>';
    }
    [0, 0.5, 1].forEach((p) => { const yy = y(max * p); svg += '<line x1="' + l + '" y1="' + yy + '" x2="' + (w - r) + '" y2="' + yy + '" class="an-rejilla"/><text x="' + (l - 7) + '" y="' + (yy + 4) + '" text-anchor="end">' + api.num(Math.round(max * p)) + '</text>'; });
    const indices = [...new Set([0, Math.floor((anios.length - 1) / 2), anios.length - 1])];
    indices.forEach((i) => { svg += '<text x="' + x(i) + '" y="' + (h - 7) + '" text-anchor="middle">' + orden[i] + '</text>'; });
    series.forEach((serie, k) => {
      let path = "", previo = false;
      // El año incompleto conserva su cifra, pero no prolonga la tendencia de años completos.
      serie.forEach((n, i) => { if (!seguro(n) || i === enCurso) { previo = false; return; } path += (previo ? " L" : " M") + x(i) + " " + y(n); previo = true; });
      svg += '<path d="' + path + '" class="an-linea ' + (comparar && !k ? "an-linea-base" : "an-linea-final") + '"/>';
      serie.forEach((n, i) => { if (seguro(n)) svg += '<circle cx="' + x(i) + '" cy="' + y(n) + '" r="' + (i === enCurso ? "4" : "3") + '" class="' + (comparar && !k ? "an-punto-base" : "an-punto-final") + (i === enCurso ? " an-punto-incompleto" : "") + '"/>'; });
    });
    destino.innerHTML = svg + '</svg>';
  }
  function actualizar(panel, s) {
    const c = contextos.get(panel); if (!c || c.s !== s) return;
    const { api } = c;
    const max = Math.max(0, ...s.rutas.flatMap((t) => [api.numero(t.base), api.numero(t.final)]).filter(seguro));
    panel.querySelectorAll("[data-atlas-modo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.atlasModo === c.modo)));
    const pendientesTemporales = [...new Set([...panel.querySelectorAll('[data-seccion="anios"] .an-num[data-q]')].map((el) => el.dataset.q))].filter((q) => !s.solicitadas.has(q)).length;
    panel.querySelector('[data-ir-atlas="anios"]').textContent = "Evolución" + (pendientesTemporales ? " · +" + pendientesTemporales : "");
    panel.querySelector("[data-escala]").textContent = c.modo === "volumen" ? "Escala común · registros por ruta" : "Cada fila = 100 % de sus registros sin filtros";
    panel.querySelector('.an-rutas-cabecera > :nth-child(2)').textContent = c.modo === "volumen" ? "Registros por ruta" : "Conservación de la fila";
    s.rutas.forEach((t) => {
      const a = api.numero(t.base), b = api.numero(t.final), el = panel.querySelector('[data-ruta="' + t.id + '"]');
      const base = el.querySelector("[data-barra-base]"), actual = el.querySelector('[data-barra="ruta-' + t.id + '"]');
      base.style.width = seguro(a) && max ? 100 * a / (c.modo === "volumen" ? max : a) + "%" : "0%";
      base.parentElement.classList.toggle("an-sin-dato", !seguro(a) || !a);
      if (c.modo === "volumen") {
        actual.style.width = seguro(b) && max ? 100 * b / max + "%" : "0%";
        actual.parentElement.classList.toggle("an-sin-dato", !seguro(b));
      } else {
        const valido = (!s.controlInclusion || api.numero(s.controlInclusion) === 0) && seguro(a) && a > 0 && seguro(b) && b <= a;
        actual.style.width = valido ? 100 * b / a + "%" : "0%";
        actual.parentElement.classList.toggle("an-sin-dato", !valido);
      }
    });
    const total = panel.querySelector("[data-conservacion-total]"), a = api.numero(s.base), b = api.numero(s.final);
    const inclusion = !s.controlInclusion || api.numero(s.controlInclusion) === 0;
    if (total) total.textContent = inclusion && seguro(a) && seguro(b) && b <= a ? api.pct(b, a) : "—";
    const completar = panel.querySelector("[data-completar-flujo]");
    const coste = [...new Set(s.pasos.map((p) => p.q))].filter((q) => !s.solicitadas.has(q)).length;
    completar.hidden = !coste; completar.textContent = "Completar recorrido · " + coste + " recuentos";
    actualizarCruce(c);
    dibujarTemporal(c);
  }
  window.PubMedAtlas = { montar, actualizar, consultasCruce, conjunto, evaluarCruce, registro };
})();
