/* =======================================================================
 * CONTADORES PUBMED OPTIMIZADOS (v2025-04-26 - Rev. Icon Button)
 * counters-buscar-pubmed.js
 * - Botón toggle movido a #mainIconsContainer, estilo icono + tooltip.
 * - Encapsulado en IIFE, usa AbortController, gestión de dependencias.
 * - Actualización inmediata en cambios de S/E, debounce en input.
 * ======================================================================= */

(function () {
  "use strict";

  /**
   * Formatea un número con separador de miles (punto) al estilo español
   */
  function formatNumber(num) {
    if (typeof num !== 'number' || isNaN(num)) return num;
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // trending[sb] no lleva aviso: el 2026-10-19 la API y la web daban cifras y PMID distintos, pero el
  // 2026-10-20 ya coincidían (diabetes 69/69 PMID en común; primary care 57/57; base 1000/1000).

  /**
   * -----------------------------------------------------------------------
   * Configuración y Estado del Módulo
   * -----------------------------------------------------------------------
   */
  const NCBI_API_KEY = window.ApiKeyManager ? window.ApiKeyManager.getApiKey() : "";
  const PETICIONES_POR_SEGUNDO = NCBI_API_KEY ? 10 : 3;
  const DURACION_CACHE_MS = 5 * 60 * 1000;
  const RETRASO_DEBOUNCE_MS = 1200;

  let filtersLoaded = false;
  let countersVisible = false; // Inicia oculto por defecto
  let currentUpdateCycleId = 0;
  let currentAbortController = null;

  let searchInput = null;
  let dateRange = null;
  // ... (otras variables)
  let toggleCountersBtn = null; // Referencia al botón (ahora icono)
  let persistentSearchCountDisplay = null; // Para el span del texto del contador
  let persistentSearchCountContainer = null; // Para el div contenedor del contador persistente
  let journalsResultCounter = null; // Para el contador comparativo de revistas
  let journalsCounterText = null; // Para el texto del contador de revistas

  let filterMap = null;
  let categories = null;
  let constructQuery = null;
  let mostrarToast = null;
  let formatTooltipContent = null;

  const filterTooltips = {};

  /**
   * -----------------------------------------------------------------------
   * 1. Clase RequestQueue (Sin cambios respecto a la versión anterior)
   * -----------------------------------------------------------------------
   */
  class RequestQueue {
    constructor(apiKey, rps) {
      this.apiKey = apiKey;
      this.interval = Math.max(Math.floor(1000 / rps), 100);
      this.queue = [];
      this.isRunning = false;
      this.cache = new Map();
      console.log(`RequestQueue inicializada con intervalo: ${this.interval}ms`);
    }

    // opciones.prioridad: la petición se atiende antes que las ordinarias (el panel de análisis no
    // espera detrás de una pasada de 100 contadores de botones). Entre prioritarias, por orden.
    // Resuelve { filterId, count, detalle, cycleId }: detalle trae lo que PubMed ejecutó de verdad.
    add(filterId, query, cycleId, signal, opciones = {}) {
      return new Promise((resolve, reject) => {
        const cached = this.getCached(query);
        if (cached !== null) {
          resolve({ filterId, count: cached.count, detalle: cached, cycleId });
          return;
        }
        const item = { filterId, query, resolve, reject, cycleId, signal, prioridad: !!opciones.prioridad };
        if (item.prioridad) {
          const primeraOrdinaria = this.queue.findIndex((q) => !q.prioridad);
          if (primeraOrdinaria === -1) this.queue.push(item);
          else this.queue.splice(primeraOrdinaria, 0, item);
        } else {
          this.queue.push(item);
        }
        if (!this.isRunning) {
          this.run();
        }
      });
    }

    async run() {
      this.isRunning = true;
      while (this.queue.length > 0) {
        const { filterId, query, resolve, reject, cycleId, signal } = this.queue.shift();

        if (signal.aborted) {
          reject({ filterId, error: new DOMException('Aborted', 'AbortError'), cycleId, aborted: true });
          continue;
        }

        const cached = this.getCached(query);
        if (cached !== null) {
          resolve({ filterId, count: cached.count, detalle: cached, cycleId });
          continue;
        }

        try {
          // Un 429 (demasiadas peticiones) se reintenta una vez tras una espera; nunca se da por cero.
          let resultado = await this.fetchCount(query, signal);
          if (resultado === 'Limite' && !signal.aborted) {
            await new Promise((r) => setTimeout(r, 1100));
            resultado = await this.fetchCount(query, signal);
          }
          if (resultado === 'Limite') resultado = 'Error';

          if (signal.aborted) {
            reject({ filterId, error: new DOMException('Aborted', 'AbortError'), cycleId, aborted: true });
          } else if (typeof resultado === 'object') {
            this.setCached(query, resultado);
            resolve({ filterId, count: resultado.count, detalle: resultado, cycleId });
          } else {
            resolve({ filterId, count: resultado, detalle: null, cycleId });
          }
        } catch (error) {
          const isAbortError = error.name === 'AbortError';
          reject({ filterId, error, cycleId, aborted: isAbortError });
        }

        // La pausa va tras CADA petición a la red, también tras un fallo: antes solo se hacía tras un
        // éxito, y una racha de errores disparaba peticiones seguidas contra el límite de NCBI.
        if (!signal.aborted) {
          await new Promise((r) => setTimeout(r, this.interval));
        }
      }
      this.isRunning = false;
    }

    // Devuelve { count, traduccion, avisos[], errores[], hora } o, si falla, "Error" / "Limite" (429).
    // Antes devolvía solo el número y descartaba la traducción y los avisos de PubMed: una cifra podía
    // salir de una consulta que PubMed ejecutó a medias (una frase no encontrada) sin que nadie lo viera.
    async fetchCount(query, signal) {
      const baseUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
      const baseParams = { db: "pubmed", retmode: "json", retmax: "0" };
      // Tope propio de 20 s: sin él, una respuesta colgada bloqueaba la cola entera.
      const control = new AbortController();
      const abortarPorPadre = () => control.abort();
      signal.addEventListener('abort', abortarPorPadre, { once: true });
      const temporizador = setTimeout(() => control.abort(), 20000);
      const fetchOptions = { signal: control.signal };

      try {
        const params = new URLSearchParams(baseParams);
        params.append("term", query);
        if (this.apiKey) params.append("api_key", this.apiKey);
        const urlWithParams = `${baseUrl}?${params.toString()}`;

        let response;
        if (urlWithParams.length < 1800) {
          fetchOptions.method = "GET";
          response = await fetch(urlWithParams, fetchOptions);
        } else {
          fetchOptions.method = "POST";
          fetchOptions.headers = { "Content-Type": "application/x-www-form-urlencoded", };
          fetchOptions.body = params;
          response = await fetch(baseUrl, fetchOptions);
        }

        if (response.status === 429) return 'Limite';
        if (!response.ok) {
          throw new Error(`Error HTTP! Estado: ${response.status} ${response.statusText}`);
        }

        const responseJson = await response.json();
        const r = responseJson?.esearchresult;
        if (r?.count === undefined) {
          console.warn(`Respuesta inesperada de NCBI para query "${query.substring(0, 100)}...":`, responseJson);
          throw new Error("Respuesta de API inválida o sin contador.");
        }
        const lista = (obj, claves) => claves.flatMap((k) =>
          (Array.isArray(obj?.[k]) ? obj[k] : []).filter(Boolean).map((v) => `${k}: ${v}`));
        return {
          count: parseInt(r.count, 10),
          traduccion: r.querytranslation || "",
          errores: lista(r.errorlist, ["phrasesnotfound", "fieldsnotfound"]),
          avisos: lista(r.warninglist, ["phrasesignored", "quotedphrasesnotfound", "outputmessages"]),
          hora: Date.now(),
        };
      } catch (error) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        console.error(`Fallo al obtener contador para query "${query.substring(0, 100)}...":`, error);
        return "Error";
      } finally {
        clearTimeout(temporizador);
        signal.removeEventListener('abort', abortarPorPadre);
      }
    }

    getCached(query) {
      const cachedItem = this.cache.get(query);
      if (cachedItem && Date.now() - cachedItem.timestamp < DURACION_CACHE_MS) {
        return cachedItem.detalle;
      }
      this.cache.delete(query);
      return null;
    }

    setCached(query, detalle) {
      if (detalle && typeof detalle.count === "number" && !isNaN(detalle.count)) {
        this.cache.set(query, { detalle, timestamp: Date.now() });
      }
    }

    clearCache() {
      this.cache.clear();
      console.log("Caché de contadores limpiada.");
    }
  }

  let requestQueue = null;

  // ... (después de la clase RequestQueue o similar)

  /**
   * -----------------------------------------------------------------------
   * NUEVA FUNCIÓN: Actualiza el contador principal persistente
   * -----------------------------------------------------------------------
   */
  async function updatePersistentMainCounter(currentCycleId, signal) {
    if (!persistentSearchCountContainer || !persistentSearchCountDisplay || !searchInput || typeof constructQuery !== 'function') {
      if (persistentSearchCountContainer) persistentSearchCountContainer.style.display = 'none';
      return;
    }

    const searchTermValue = searchInput.value.trim();

    // Construir la query con el término (puede ser vacío) + filtros activos + fecha
    let mainQuery = constructQuery(searchTermValue);

    // Si no hay query, usar all[sb] para mostrar el total de PubMed
    const isShowingTotal = !mainQuery;
    if (isShowingTotal) {
      mainQuery = 'all[sb]';
    }

    persistentSearchCountContainer.style.display = 'block'; // Siempre mostrar contenedor
    persistentSearchCountDisplay.textContent = isShowingTotal ? 'Calculando total PubMed...' : 'Calculando resultados...';



    try {
      const result = await requestQueue.add(`mainSearch_${currentCycleId}`, mainQuery, currentCycleId, signal);

      if (signal.aborted || result.cycleId !== currentUpdateCycleId) {
        // Si fue abortado o el ciclo es obsoleto, no actualizar, pero no limpiar si ya hay un cálculo.
        if (persistentSearchCountDisplay.textContent === 'Calculando resultados...') {
          persistentSearchCountDisplay.textContent = 'Recalculando...';
        }
        return;
      }

      // INICIO DE LA SECCIÓN MODIFICADA
      persistentSearchCountDisplay.title = '';
      if (typeof result.count === 'number' && !isNaN(result.count)) {
        if (isShowingTotal) {
          persistentSearchCountDisplay.textContent = `${formatNumber(result.count)} artículos en PubMed`;
        } else {
          persistentSearchCountDisplay.textContent = `${formatNumber(result.count)} resultados encontrados`;
        }
      } else if (result.count === "Error") {
        persistentSearchCountDisplay.textContent = 'Error al calcular resultados';
      } else {
        persistentSearchCountDisplay.textContent = 'N/A (conteo inválido)';
      }
      // FIN DE LA SECCIÓN MODIFICADA

    } catch (errorData) {
      if (signal.aborted || errorData.aborted || (errorData.cycleId && errorData.cycleId !== currentUpdateCycleId)) {
        if (persistentSearchCountDisplay.textContent === 'Calculando resultados...') {
          persistentSearchCountDisplay.textContent = 'Recalculando...';
        }
        return;
      }
      console.error("Error al obtener contador principal:", errorData.error || errorData);
      persistentSearchCountDisplay.textContent = 'Error al calcular';
    }
  }

  /**
   * -----------------------------------------------------------------------
   * NUEVA FUNCIÓN: Actualiza el contador comparativo de revistas
   * Muestra: total resultados → resultados con filtro de revistas (porcentaje)
   * -----------------------------------------------------------------------
   */
  async function updateJournalsComparativeCounter(currentCycleId, signal) {
    if (!journalsResultCounter || !journalsCounterText || typeof constructQuery !== 'function') {
      if (journalsResultCounter) journalsResultCounter.style.display = 'none';
      return;
    }

    // Obtener los filtros de revistas activos
    const activeJournalButtons = document.querySelectorAll('.filter-button.journals.active');

    if (activeJournalButtons.length === 0) {
      journalsResultCounter.style.display = 'none';
      journalsCounterText.textContent = '';
      return;
    }

    const searchTermValue = searchInput?.value?.trim() ?? '';

    // Query SIN filtros de revistas (solo término + otros filtros + fecha)
    // Si no hay nada, usar all[sb] para comparar contra el total de PubMed
    let baseQueryWithoutJournals = buildQueryWithoutJournals(searchTermValue);
    const isComparingToTotal = !baseQueryWithoutJournals;
    if (isComparingToTotal) {
      baseQueryWithoutJournals = 'all[sb]';
    }

    // Query CON filtros de revistas (query completa incluyendo journals)
    const fullQuery = constructQuery(searchTermValue);

    journalsResultCounter.style.display = 'inline';
    journalsCounterText.innerHTML = '⏳';

    try {
      // Hacer las dos peticiones en paralelo
      const [baseResult, filteredResult] = await Promise.all([
        requestQueue.add(`journalsBase_${currentCycleId}`, baseQueryWithoutJournals, currentCycleId, signal),
        fullQuery
          ? requestQueue.add(`journalsFiltered_${currentCycleId}`, fullQuery, currentCycleId, signal)
          : Promise.resolve({ count: null })
      ]);

      if (signal.aborted || currentCycleId !== currentUpdateCycleId) {
        return;
      }

      const baseCount = typeof baseResult?.count === 'number' ? baseResult.count : null;
      const filteredCount = typeof filteredResult?.count === 'number' ? filteredResult.count : null;

      if (filteredCount !== null) {
        // Formato descriptivo similar al contador principal
        if (baseCount !== null && baseCount > 0) {
          journalsCounterText.textContent = `${formatNumber(filteredCount)} resultados en revistas seleccionadas, de ${formatNumber(baseCount)} en total`;
        } else {
          journalsCounterText.textContent = `${formatNumber(filteredCount)} resultados en revistas seleccionadas`;
        }
      } else {
        journalsCounterText.textContent = '';
      }

    } catch (errorData) {
      if (!signal.aborted) {
        console.error("Error en contador de revistas:", errorData);
        journalsCounterText.textContent = 'Error al calcular';
      }
    }
  }

  /**
   * Construye query excluyendo filtros de journals
   */
  function buildQueryWithoutJournals(term) {
    if (typeof constructQuery !== 'function') return '';
    // La misma constructQuery sin la categoría de revistas. La reconstrucción a mano que había aquí
    // unía siempre con OR y metía los NOT dentro del grupo, así que el «de N en total» no era la
    // consulta real cuando una categoría iba con AND o había una exclusión.
    return constructQuery(term, { sinRevistas: true });
  }
  /**
   * -----------------------------------------------------------------------
   * 2. Carga e Inicialización de Filtros (Sin cambios)
   * -----------------------------------------------------------------------
   */
  async function loadAndAttachFilters() {
    if (!categories || typeof categories !== "object") {
      console.error("Variable global 'categories' no encontrada o inválida.");
      return;
    }
    const categoryKeys = Object.keys(categories);
    const fetchPromises = [];
    console.log("Iniciando carga de filtros...");

    categoryKeys.forEach((category) => {
      if (!Array.isArray(categories[category])) return;
      categories[category].forEach((filterId) => {
        const url = `https://ernestobarrera.github.io/pubmed-filters/filters/${category}/${filterId}.txt`;
        const promise = fetch(url)
          .then((response) => { /* ... manejo fetch ... */
            if (!response.ok) throw new Error(`Fallo al cargar filtro ${filterId}: ${response.statusText}`);
            return response.text();
          })
          .then((text) => { /* ... procesamiento texto, metadata, filterMap ... */
            const [rawQuery = "", metadataStr = ""] = text.split("@@@FILTER_METADATA@@@");
            const cleanedQuery = rawQuery.split("\n").filter((line) => !line.trim().startsWith("#") && line.trim().length > 0).join(" ").trim();
            if (window.filterMap) window.filterMap[filterId] = cleanedQuery;
            filterMap[filterId] = cleanedQuery;
            if (cleanedQuery && window.filtrosFallidos) window.filtrosFallidos.delete(filterId);

            let buttonSelector;
            const baseName = filterId.split("_")[0];
            const isToggleFilter = filterId.includes("_sensible") || filterId.includes("_especifico");
            if (isToggleFilter) { buttonSelector = `.filter-button[data-base="${baseName}"]`; }
            else { buttonSelector = `.filter-button[data-type="${filterId}"]`; }
            const button = document.querySelector(buttonSelector);

            if (button) {
              const isSensibleDefault = filterId.endsWith('_sensible');
              if (!isToggleFilter || isSensibleDefault) { button.dataset.query = cleanedQuery; }
              if (metadataStr.trim() && typeof formatTooltipContent === "function") {
                try { /* ... manejo tooltip ... */
                  const metadata = JSON.parse(metadataStr.trim());
                  const tooltipHtml = formatTooltipContent(metadata);
                  filterTooltips[filterId] = tooltipHtml;
                  if ((!isToggleFilter || isSensibleDefault) && typeof tippy === 'function') {
                    if (button._tippy) button._tippy.setContent(tooltipHtml);
                  }
                } catch (e) { console.warn(`Fallo al parsear metadatos para ${filterId}:`, e); }
              }
            } // else { console.warn(`Botón no encontrado para filtro ${filterId}`); }
          })
          .catch((error) => { /* ... manejo error fetch ... */
            console.error(`Error procesando filtro ${filterId}:`, error);
            // La página descarga el mismo fichero: si ella sí lo obtuvo, no se pisa con vacío.
            if (window.filterMap && !window.filterMap[filterId]) {
              window.filterMap[filterId] = '';
              if (window.filtrosFallidos) window.filtrosFallidos.add(filterId);
            }
          });
        fetchPromises.push(promise);
      });
    });

    await Promise.allSettled(fetchPromises);
    filtersLoaded = true;
    console.log(">> Carga de filtros completa.");

    enableToggleButton(); // Habilitar botón icono
    setupToggleButtonsListeners(); // Configurar listeners S/E
  }


  /**
   * -----------------------------------------------------------------------
   * 3. Configuración de Event Listeners (Ajustado para botón icono)
   * -----------------------------------------------------------------------
   */

  // --- Botones Toggle (S/E) --- (Sin cambios)
  function setupToggleButtonsListeners() {
    document.querySelectorAll(".filter-button.with-toggle").forEach((button) => {
      const baseName = button.dataset.base;
      if (!baseName) return;
      button.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          if (!radio.checked) return;
          const selectedType = radio.value;
          const filterId = `${baseName}_${selectedType}`;
          button.dataset.query = filterMap[filterId] || "";
          if (filterTooltips[filterId] && typeof tippy === 'function' && button._tippy) {
            button._tippy.setContent(filterTooltips[filterId]);
          }
          triggerImmediateUpdate();
        });
      });
      const initialFilterId = `${baseName}_sensible`;
      button.dataset.query = filterMap[initialFilterId] || "";
    });
    console.log("Listeners de botones S/E configurados.");
  }

  // --- Input Principal de Búsqueda --- (Sin cambios)
  const debouncedUpdateCounters = debounce(() => {
    triggerImmediateUpdate();
  }, RETRASO_DEBOUNCE_MS);

  function setupSearchInputListener() {
    if (!searchInput) return;
    searchInput.addEventListener("input", debouncedUpdateCounters);
    console.log("Listener del input de búsqueda configurado.");
  }

  // --- Botón Icono Toggle (Mostrar/Ocultar Contadores) --- (AJUSTADO)
  function setupMainToggleButtonListener() {
    if (!toggleCountersBtn) return;

    toggleCountersBtn.addEventListener('click', () => {
      if (!filtersLoaded) {
        if (mostrarToast) mostrarToast("Esperando carga de filtros...", "warning");
        return;
      }

      countersVisible = !countersVisible; // Cambia el estado
      toggleCountersBtn.classList.toggle("active", countersVisible);
      toggleCountersBtn.innerHTML = countersVisible
        ? '<i class="fas fa-eye"></i>'
        : '<i class="fas fa-eye-slash"></i>';
      toggleCountersBtn.title = countersVisible
        ? 'Ocultar contadores de resultados'
        : 'Mostrar contadores de resultados';

      if (countersVisible) {
        // Si se hacen visibles los contadores de los botones:
        renderCounters(true); // Añade/prepara los displays en los botones.
        triggerImmediateUpdate(); // Lanza una actualización completa para todo.
      } else {
        // Si se ocultan los contadores de los botones:
        renderCounters(false); // Elimina los displays de los contadores de los botones.

        // Aborta el ciclo actual para cancelar peticiones pendientes de contadores de botones.
        if (currentAbortController) {
          currentAbortController.abort();
        }
        // NO llamamos a triggerImmediateUpdate aquí - no tiene sentido hacer peticiones
        // si los contadores están ocultos. El contador persistente mantiene su último valor.
      }
    });
    console.log("Listener del botón Toggle de contadores (icono) configurado.");
  }

  // --- Habilitar botón Icono Toggle --- (AJUSTADO)
  // DENTRO DE counters-buscar-pubmed.js
  function enableToggleButton() {
    if (!toggleCountersBtn) {
      // Si toggleCountersBtn es null/undefined, significa que no se encontró en init().
      console.warn("enableToggleButton: Botón #toggleCountersBtn no encontrado. No se puede habilitar.");
      return; // No hay nada que habilitar si el botón no existe.
    }

    if (filtersLoaded) {
      toggleCountersBtn.disabled = false; // Habilitar el botón

      // Configurar el ícono y el título según el estado ACTUAL de 'countersVisible'
      toggleCountersBtn.innerHTML = countersVisible ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
      toggleCountersBtn.title = countersVisible ? 'Ocultar contadores de resultados en filtros' : 'Mostrar contadores de resultados en filtros';

      toggleCountersBtn.style.cursor = 'pointer'; // Restaurar el cursor
      toggleCountersBtn.style.color = ''; // Restablecer el color por si se cambió para el estado deshabilitado/spinner

      // Si usas una clase 'active' para estilizar el botón cuando los contadores están visibles, ajústala.
      toggleCountersBtn.classList.toggle("active", countersVisible);

      // Añadir el listener para el clic, pero solo si no se ha añadido antes.
      // Usamos un atributo data-* para rastrear esto.
      if (!toggleCountersBtn.dataset.listenerAttached) {
        setupMainToggleButtonListener(); // Esta función es la que realmente añade el 'addEventListener("click", ...)'
        toggleCountersBtn.dataset.listenerAttached = "true"; // Marcar que el listener ha sido añadido
      }
      console.log("Botón Toggle de contadores (icono) HABILITADO y listener configurado/verificado.");
    } else {
      // Este bloque es por si enableToggleButton se llamara cuando filtersLoaded aún es false.
      // El estado de "cargando" ya debería haber sido establecido por init().
      toggleCountersBtn.disabled = true;
      if (toggleCountersBtn.innerHTML !== '<i class="fas fa-spinner fa-spin"></i>') { // Evitar re-escribir si ya está
        toggleCountersBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      }
      if (toggleCountersBtn.title !== "Cargando filtros...") {
        toggleCountersBtn.title = "Cargando filtros...";
      }
      toggleCountersBtn.style.cursor = 'default';
      // toggleCountersBtn.style.color = '#888;'; // Opcional: si quieres un color específico para el spinner
      console.log("Botón Toggle de contadores (icono) aún deshabilitado (esperando carga completa de filtros).");
    }
  }


  /**
   * -----------------------------------------------------------------------
   * 4. Renderizado y Estilos de Contadores (Sin cambios)
   * -----------------------------------------------------------------------
   */
  function injectCounterStyles() {
    if (document.getElementById("pubmed-counter-styles")) return;
    const css = `
      .filter-button { position: relative; overflow: visible !important; }
      .result-counter {
        display: flex !important; justify-content: center; align-items: center;
        min-width: 26px; height: 18px; padding: 0 5px; border-radius: 9px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 11px; font-weight: 700; line-height: 1;
        position: absolute; top: 50%; right: 8px; transform: translateY(-50%); z-index: 90;
        background-color: #e0e0e0; color: #333; border: 1px solid #ccc;
        white-space: nowrap;
        transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        opacity: 0; pointer-events: none;
      }
      .result-counter.visible { opacity: 1; }
      .result-counter.loading { background-color: #e9ecef; color: #495057; border-color: #ced4da; }
      .result-counter.error { background-color: #f8d7da; color: #721c24; border-color: #f5c6cb; font-weight: bold; }
      .result-counter.high { background-color: #d1e7dd; color: #0f5132; border-color: #badbcc; }
      .result-counter.med  { background-color: #fff3cd; color: #664d03; border-color: #ffecb5; }
      .result-counter.low  { background-color: #cfe2ff; color: #052c65; border-color: #b6d4fe; }
      .result-counter.vlow { background-color: #f8d7da; color: #58151c; border-color: #f1aeb5; }
      .result-counter.zero { background-color: #f8f9fa; color: #6c757d; border-color: #dee2e6; font-style: italic; }
      .filter-button.with-toggle .result-counter { right: 50px; }

      /* Estilo opcional para el botón icono toggle cuando está activo */
       #toggleCountersBtn.active {
          /* background-color: var(--accent-color, #007bff); */
          /* color: white; */
          /* O quizás solo un borde o sombra diferente */
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.15);
        }
       #toggleCountersBtn:disabled { opacity: 0.5; cursor: not-allowed; }
       /* Asegurar que los botones icono tengan cursor pointer si no lo heredan */
       #mainIconsContainer button { cursor: pointer; }
    `;
    const styleElement = document.createElement("style");
    styleElement.id = "pubmed-counter-styles";
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  }

  function renderCounters(show) { /* ... sin cambios ... */
    injectCounterStyles();
    const buttons = document.querySelectorAll(".filter-button");
    buttons.forEach((button) => {
      let counter = button.querySelector(".result-counter");
      if (show) {
        if (!counter) {
          counter = document.createElement("div");
          counter.className = "result-counter loading";
          counter.textContent = "…";
          button.appendChild(counter);
        }
        counter.classList.remove('visible');
        counter.classList.add('loading');
        counter.textContent = '…';
      } else {
        if (counter) { counter.remove(); }
      }
    });
  }

  function updateCounterDisplay(button, value) { /* ... sin cambios ... */
    const counter = button.querySelector(".result-counter");
    if (!counter) return;

    counter.classList.remove("loading", "high", "med", "low", "vlow", "zero", "error");
    counter.classList.add("visible");

    if (value === "…" || value === undefined) { counter.classList.add("loading"); counter.textContent = "…"; }
    else if (value === "Error") { counter.classList.add("error"); counter.textContent = "!"; }
    else if (value === "?") { counter.classList.add("error"); counter.textContent = "?"; }
    else if (value === "Aborted") { counter.classList.add("loading"); counter.textContent = "…"; counter.classList.remove("visible"); }
    else if (typeof value === "number" && !isNaN(value)) {
      counter.textContent = formatCount(value);
      if (value === 0) counter.classList.add("zero");
      else if (value >= 10000) counter.classList.add("high");
      else if (value >= 1000) counter.classList.add("med");
      else if (value >= 100) counter.classList.add("low");
      else counter.classList.add("vlow");
    } else {
      console.warn(`Valor inesperado para contador: ${value} en botón:`, button);
      counter.classList.add("error"); counter.textContent = "-";
    }
  }

  function formatCount(n) { /* ... sin cambios ... */
    if (typeof n !== "number" || isNaN(n)) return n;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(".0", "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(".0", "") + "K";
    return n.toString();
  }


  /**
   * -----------------------------------------------------------------------
   * 5. Lógica Principal de Actualización (AJUSTADO: sin update de botón)
   * -----------------------------------------------------------------------
   */
  async function updateAllCounters(cycleId, signal) {
    console.log(`== Iniciando ciclo de actualización ${cycleId} ==`);
    if (!constructQuery || signal.aborted) return; // Salir si falta dep. o ya abortado

    // YA NO modificamos el icono del botón toggle principal aquí a "loading"
    // Su estado (ojo/ojo-tachado) solo cambia por clic del usuario

    const baseQuery = constructQuery(searchInput?.value?.trim() ?? '');
    const buttons = document.querySelectorAll(".filter-button");
    const totalButtons = buttons.length;
    const pendingRequests = [];

    if (totalButtons === 0) { console.log("No hay botones de filtro para actualizar."); return; }

    // Resetear contadores a 'loading' si son visibles
    if (countersVisible) {
      buttons.forEach(button => {
        let counter = button.querySelector('.result-counter');
        if (!counter) { // Crear si no existe
          counter = document.createElement('div');
          counter.className = 'result-counter loading visible';
          counter.textContent = '…';
          button.appendChild(counter);
        } else { // Resetear si existe
          updateCounterDisplay(button, '…');
        }
      });
    } else {
      return; // Salir si no son visibles
    }

    // Lanzar las peticiones
    buttons.forEach((button, index) => {
      const filterQuery = button.dataset.query;
      if (!button.querySelector(".result-counter")) return; // Saltar si no hay contador
      if (!filterQuery || filterQuery.trim() === "") {
        if (cycleId === currentUpdateCycleId) updateCounterDisplay(button, "?");
        return;
      }

      // El contador de un botón dice cuántos resultados habría CON ese filtro activado, y la consulta
      // la compone el mismo constructor de la página. Antes era «consulta actual AND filtro»: con OR
      // dentro de una categoría y otro filtro de ella ya activo, eso estrecha en vez de ampliar, y la
      // cifra no correspondía a lo que pasaba al pulsar. La fecha y Trending ya van dentro.
      const estado = typeof window.estadoBusqueda === 'function' ? window.estadoBusqueda() : null;
      let fullQuery;
      if (estado) {
        const radio = button.querySelector('input[type="radio"]:checked');
        const id = button.dataset.type || (button.dataset.base && radio ? `${button.dataset.base}_${radio.value}` : null);
        // Sin filtro cargado no hay cifra que dar: «?» y no la de la consulta sin él.
        if (!id || !window.filterMap?.[id]) { if (cycleId === currentUpdateCycleId) updateCounterDisplay(button, "?"); return; }
        const activos = new Set(estado.activos);
        if (button.dataset.base) {
          activos.delete(`${button.dataset.base}_sensible`);
          activos.delete(`${button.dataset.base}_especifico`);
        }
        activos.add(id);
        fullQuery = constructQuery(estado.termino, { activos });
      } else {
        const trimmedBase = baseQuery.trim();
        const trimmedFilter = filterQuery.trim();
        fullQuery = trimmedBase ? `(${trimmedBase}) AND (${trimmedFilter})` : trimmedFilter;
      }
      if (!fullQuery) { if (cycleId === currentUpdateCycleId) updateCounterDisplay(button, "?"); return; }

      const requestId = `${button.dataset.type || button.dataset.base || index}-${cycleId}`;
      const requestPromise = requestQueue.add(requestId, fullQuery, cycleId, signal)
        .then(({ count, cycleId: resultCycleId }) => { /* ... manejo resultado ... */
          if (resultCycleId === currentUpdateCycleId && button.querySelector(".result-counter")) {
            updateCounterDisplay(button, count);
          } // else { console.log(`Resultado descartado del ciclo ${resultCycleId}...`); }
        })
        .catch(({ error, cycleId: resultCycleId, aborted }) => { /* ... manejo error ... */
          if (resultCycleId === currentUpdateCycleId && !aborted && button.querySelector(".result-counter")) {
            updateCounterDisplay(button, "Error");
          } else if (aborted && button.querySelector(".result-counter")) {
            updateCounterDisplay(button, "Aborted");
          }
          if (!aborted) { console.error(`Error en promesa para ${requestId}...`, error); }
        });
      pendingRequests.push(requestPromise);
    });

    await Promise.allSettled(pendingRequests);

    // Comprobar si este ciclo sigue siendo el válido
    if (cycleId === currentUpdateCycleId) {
      console.log(`== Ciclo de actualización ${cycleId} COMPLETADO ==`);
      // YA NO cambiamos el icono del botón a "check" aquí.
      if (mostrarToast) mostrarToast("Contadores actualizados.");
    } else {
      console.log(`== Ciclo ${cycleId} terminado, pero obsoleto (actual: ${currentUpdateCycleId}) ==`);
    }
  }


  /**
   * -----------------------------------------------------------------------
   * 6. Funciones Utilitarias y Exposición Global (Sin cambios)
   * -----------------------------------------------------------------------
   */
  function debounce(func, wait) { /* ... sin cambios ... */
    let timeout;
    return function executedFunction(...args) {
      const context = this;
      const later = () => { timeout = null; func.apply(context, args); };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function triggerImmediateUpdate() {
    console.log("%cTriggering PubMed Counter Update...", "color: blue; font-weight: bold;");

    // 1. Verificar dependencia crítica
    if (typeof constructQuery !== "function") {
      console.error("Falta 'constructQuery'. No se pueden actualizar contadores.");
      if (persistentSearchCountContainer) persistentSearchCountContainer.style.display = 'none';
      return;
    }

    // 2. Abortar ciclo anterior y preparar nuevo ciclo
    if (currentAbortController) {
      currentAbortController.abort();
    }
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    currentUpdateCycleId++;
    const cycleToRun = currentUpdateCycleId;

    // 3. Actualizar el contador persistente principal (siempre se intenta)
    // setTimeout para encolar esta tarea, permitiendo que el aborto anterior se procese.
    setTimeout(() => {
      if (!signal.aborted) {
        updatePersistentMainCounter(cycleToRun, signal);
        // Siempre: cualquier filtro cambia las dos cifras que compara. Si no hay revistas activas,
        // la función sale sin consultar. Antes se omitía al cambiar un filtro que no era de revistas
        // y la cifra se quedaba con el valor anterior (o en ⏳, si este ciclo abortaba el suyo).
        updateJournalsComparativeCounter(cycleToRun, signal);
      }
    }, 0);

    // 4. Actualizar contadores individuales de los botones (solo si son visibles y filtros cargados)
    if (filtersLoaded && countersVisible) {
      // Poner los contadores de los botones en estado de carga
      document.querySelectorAll(".filter-button").forEach((button) => {
        let counter = button.querySelector(".result-counter");
        if (counter) { // Solo si el contador ya existe (fue añadido por renderCounters(true))
          updateCounterDisplay(button, '…');
        }
      });

      // Encolar la actualización de los contadores de los botones
      setTimeout(() => {
        if (!signal.aborted) {
          updateAllCounters(cycleToRun, signal); // Actualiza los contadores de los botones
        }
      }, 0);
    } else {
      // Si los contadores individuales no están visibles o los filtros no están cargados,
      // no se hace nada para ellos aquí. El contador persistente ya se está manejando.
      // console.log("Contadores individuales de botones no se actualizarán (no visibles o filtros no cargados).");
    }
  }

  window.triggerPubMedCounterUpdate = triggerImmediateUpdate;

  // Puerta única a ESearch para el panel de análisis: misma cola, misma caché y mismo ritmo que los
  // contadores, con prioridad. Dos colas separadas competirían por el mismo límite de NCBI por IP.
  // contar(consulta, signal) → { count, traduccion, avisos[], errores[], hora } o lanza si falla.
  window.PubMedConsultas = {
    async contar(query, signal) {
      if (!requestQueue) throw new Error("La cola de PubMed aún no está lista.");
      const r = await requestQueue.add('analisis', query, -1, signal, { prioridad: true });
      if (!r.detalle) throw new Error("PubMed no devolvió un recuento.");
      return r.detalle;
    },
    porSegundo() { return requestQueue ? Math.round(1000 / requestQueue.interval) : PETICIONES_POR_SEGUNDO; },
  };


  /**
   * -----------------------------------------------------------------------
   * 7. Inicialización del Módulo (AJUSTADO para botón icono)
   * -----------------------------------------------------------------------
   */
  function checkGlobalDependencies() { /* ... sin cambios ... */
    let allOk = true;
    searchInput = window.searchTerm || document.getElementById('searchTerm');
    constructQuery = window.constructQuery;
    mostrarToast = window.mostrarToast;
    formatTooltipContent = window.formatTooltipContent;
    categories = window.categories;
    filterMap = window.filterMap || {};
    dateRange = document.getElementById('dateRange');

    // INICIO: Obtener elementos del contador persistente
    persistentSearchCountContainer = document.getElementById('persistentSearchCountContainer');
    persistentSearchCountDisplay = document.getElementById('persistentSearchCountText');

    if (!persistentSearchCountContainer || !persistentSearchCountDisplay) {
      console.warn("Elementos DOM para el contador persistente (#persistentSearchCountContainer o #persistentSearchCountText) no encontrados. La funcionalidad del contador principal no operará.");
      // No marcamos allOk = false aquí, ya que los contadores de filtros individuales aún podrían funcionar.
    }
    // FIN: Obtener elementos del contador persistente

    // INICIO: Obtener elementos del contador comparativo de revistas
    journalsResultCounter = document.getElementById('journalsResultCounter');
    journalsCounterText = document.getElementById('journalsCounterText');
    // FIN: Obtener elementos del contador comparativo de revistas


    if (!searchInput) { console.error("Falta: #searchTerm o window.searchTerm."); allOk = false; }
    if (typeof constructQuery !== 'function') { console.error("Falta: Función global 'constructQuery'."); allOk = false; }
    if (typeof categories === 'undefined') { console.error("Falta: Objeto global 'categories'."); allOk = false; }
    if (typeof filterMap === 'undefined') { console.warn("Objeto 'filterMap' no encontrado, creando."); filterMap = {}; }
    // ... (warnings opcionales para toast/format) ...
    return allOk;
  }

  // --- INICIALIZACIÓN --- (AJUSTADO)
  function init() {
    console.log("Inicializando módulo de contadores PubMed (botón icono)...");

    if (!checkGlobalDependencies()) {
      console.error("Faltan dependencias globales críticas. Contadores DESHABILITADOS.");
      // Intentar deshabilitar/marcar error en botón si existe
      const btn = document.getElementById('toggleCountersBtn');
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>'; btn.title = "Error: Dependencias."; }
      if (mostrarToast) mostrarToast("Error: Faltan componentes para contadores.", "error", 5000);
      return;
    }

    // Contenedor de iconos donde irá el botón
    // DENTRO DE init()

    // Obtener el botón toggle de contadores que ya debe existir en el HTML
    toggleCountersBtn = document.getElementById('toggleCountersBtn');

    if (!toggleCountersBtn) {
      console.error("Error crítico: Botón #toggleCountersBtn NO encontrado en el HTML. La funcionalidad de mostrar/ocultar contadores de filtros no estará disponible.");
      // Si el botón no está, no podemos continuar configurándolo para los contadores de filtros.
    } else {
      // El botón existe, configurar su estado inicial (deshabilitado hasta que los filtros carguen)
      toggleCountersBtn.disabled = true; // Deshabilitarlo
      toggleCountersBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; // Poner ícono de carga
      toggleCountersBtn.title = "Cargando filtros..."; // Actualizar título
      toggleCountersBtn.style.cursor = 'default'; // Cambiar cursor para indicar que no es clickeable
    }

    // Instanciar la cola (esta línea y las siguientes ya deberían existir y permanecer igual)
    requestQueue = new RequestQueue(NCBI_API_KEY, PETICIONES_POR_SEGUNDO);

    // Escuchar cambios en la API key
    if (window.ApiKeyManager) {
      window.ApiKeyManager.onApiKeyChange((newApiKey) => {
        const rps = newApiKey ? 10 : 3;
        requestQueue = new RequestQueue(newApiKey, rps);
        requestQueue.clearCache();
        console.log(`API Key ${newApiKey ? 'configurada' : 'eliminada'}. Velocidad: ${rps} req/s`);

        if (typeof window.triggerPubMedCounterUpdate === 'function') {
          window.triggerPubMedCounterUpdate();
        }
      });
    }

    setupSearchInputListener(); // Configurar listener input
    loadAndAttachFilters();     // Cargar filtros (esto llamará a enableToggleButton al final)

    console.log("Módulo de contadores inicializado (esperando carga de filtros).");
    // Fin de la función init()
  }

  document.addEventListener("DOMContentLoaded", init);

})(); // Fin IIFE