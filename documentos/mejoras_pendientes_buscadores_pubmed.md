Publicar en Zenodo: https://claude.ai/chat/c0884ca4-eb10-4e4c-a230-55abe9606cc5

A continuación te muestro, paso a paso, las modificaciones concretas que debes realizar en el código original, indicando exactamente qué líneas eliminar, añadir o mover, junto con el código completo de cada cambio:

---

### 1. Extraer el bloque de estilos inline a un archivo CSS externo

**a) En el HTML (dentro del `<head>`)**

**Antes (fragmento a eliminar):**

```html
<style>
  body {
    margin: 0;
    padding: 0;
    font-family: sans-serif;
    background: #1c1e26;
  }
  .main-container {
    max-width: 1400px;
    margin-left: auto;
    margin-right: auto;
    padding: 0rem 0rem;
  }
  .hero-section {
    border-radius: 8px;
    padding: 0;
    margin-bottom: 0.5rem;
  }
  .main-title {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-primary, #fff);
  }
  .search-container {
    max-width: 100%;
    margin: 0 auto;
    padding: 0;
    color: var(--text-primary, #fff);
  }
  .intro-text {
    font-size: 0.95rem;
    line-height: 1.4;
    background: rgba(59, 130, 246, 0.15);
    border-radius: 8px;
    padding: 0.5rem;
    color: var(--text-secondary, #94a3b8);
    margin-bottom: 0.5rem;
  }
  .search-box {
    background: var(--card-bg, #2a3b4d);
    padding: 1rem;
    border-radius: 12px;
    margin-bottom: 1rem;
  }
  /* … (todo el resto de reglas CSS que aparece en este bloque) … */
  .search-tips.expanded .search-tips-icon {
    transform: rotate(180deg);
  }
</style>
```

**Después (elimina completamente el bloque anterior y agrega la línea siguiente):**

```html
<link rel="stylesheet" href="/assets/css/custom-styles.css" />
```

**b) Crear el archivo `/assets/css/custom-styles.css`**  
Copia todo el contenido anterior del bloque `<style>` y pégalo en el nuevo archivo. Por ejemplo:

```css
/* custom-styles.css */

body {
  margin: 0;
  padding: 0;
  font-family: sans-serif;
  background: #1c1e26;
}
.main-container {
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
  padding: 0rem 0rem;
}
.hero-section {
  border-radius: 8px;
  padding: 0;
  margin-bottom: 0.5rem;
}
.main-title {
  margin-bottom: 0.5rem;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-primary, #fff);
}
.search-container {
  max-width: 100%;
  margin: 0 auto;
  padding: 0;
  color: var(--text-primary, #fff);
}
.intro-text {
  font-size: 0.95rem;
  line-height: 1.4;
  background: rgba(59, 130, 246, 0.15);
  border-radius: 8px;
  padding: 0.5rem;
  color: var(--text-secondary, #94a3b8);
  margin-bottom: 0.5rem;
}
.search-box {
  background: var(--card-bg, #2a3b4d);
  padding: 1rem;
  border-radius: 12px;
  margin-bottom: 1rem;
}
/* … (Incluye aquí todo el CSS restante tal y como aparece en el bloque original) … */
.search-tips.expanded .search-tips-icon {
  transform: rotate(180deg);
}
```

---

### 2. Extraer los scripts inline a archivos JavaScript externos

#### 2.1 Extraer el script principal (lógica de filtros, tooltips, diagrama, etc.)

**a) En el HTML (antes de `</body>`)**

**Antes (bloque a eliminar):**

```html
<script>
  document.addEventListener("DOMContentLoaded", function () {
    // 1. Variables globales
    var searchTerm = document.getElementById("searchTerm");
    var searchButton = document.getElementById("searchButton");
    var resetButton = document.getElementById("resetButton");
    var filterCount = document.getElementById("filterCount");
    var finalQueryBox = document.getElementById("finalQuery");
    var dateRange = document.getElementById("dateRange");
    var sortMode = document.getElementById("sortMode");
    var internalOperator = document.getElementById("internalOperator");

    var activeFilters = new Set();
    var filterMap = {};
    var filterTooltips = {};
    // … (resto del código JavaScript inline)
  });
</script>
```

**Después:**  
Elimina ese bloque y agrega la siguiente línea:

```html
<script src="/assets/js/main.js"></script>
```

**b) Crear el archivo `/assets/js/main.js`**  
Copia el contenido completo del script anterior y pégalo en el nuevo archivo. El archivo quedaría de la siguiente forma (incluye todo el código sin los `console.log` de depuración que puedes eliminar para producción):

```js
document.addEventListener("DOMContentLoaded", function () {
  // 1. Variables globales
  var searchTerm = document.getElementById("searchTerm");
  var searchButton = document.getElementById("searchButton");
  var resetButton = document.getElementById("resetButton");
  var filterCount = document.getElementById("filterCount");
  var finalQueryBox = document.getElementById("finalQuery");
  var dateRange = document.getElementById("dateRange");
  var sortMode = document.getElementById("sortMode");
  var internalOperator = document.getElementById("internalOperator");

  var activeFilters = new Set();
  var filterMap = {};
  var filterTooltips = {};

  // Manejo del toggle del diagrama de Venn
  const toggleVennButton = document.getElementById("toggleVennButton");
  const vennContainer = document.querySelector(".venn-container");

  toggleVennButton.addEventListener("click", () => {
    vennContainer.classList.toggle("visible");
    toggleVennButton.classList.toggle("active");
    toggleVennButton.innerHTML = vennContainer.classList.contains("visible")
      ? '<i class="fas fa-project-diagram"></i> Ocultar Diagrama'
      : '<i class="fas fa-project-diagram"></i> Ver Diagrama';
    if (vennContainer.classList.contains("visible")) {
      updateVennDiagram();
    }
  });

  // 2. Configuración de categorías
  var categories = {
    methodology: [
      "mbe",
      "gpc",
      "metaanalysis",
      "qualitative",
      "clinical_rules_sensible",
      "clinical_rules_especifico",
      "horizon",
      "clinical_rules_ap",
      "indirect_comparison",
    ],
    clinical: [
      "diagnosis_sensible",
      "diagnosis_especifico",
      "etiology_sensible",
      "etiology_especifico",
      "prognosis_sensible",
      "prognosis_especifico",
      "treatment_sensible",
      "treatment_especifico",
      "predictors_sensible",
      "predictors_especifico",
      "surgery_ae",
      "devices_ae",
      "drugs_ae",
      "car_t",
      "deprescription",
      "simulation_clinical",
      "clinical_examination",
      "NNT_NNH",
    ],
    scope: [
      "ai_sensible",
      "ai_especifico",
      "palliative_sensible",
      "palliative_especifico",
      "primary_sensible",
      "primary_especifico",
      "safety_sensible",
      "safety_especifico",
      "pearls",
      "perspective",
      "nursing",
      "humans",
      "geriatrics_sensible",
      "geriatrics_especifico",
      "pediatrics",
      "adults",
      "ocde",
      "spanish",
      "economic_sensible",
      "economic_especifico",
    ],
  };

  // 3. Funciones de manejo de metadata y tooltips
  function formatTooltipContent(metadata) {
    const parts = [];
    const isValidMetric = (value) => {
      return (
        value !== undefined &&
        value !== null &&
        value !== 0 &&
        !isNaN(value) &&
        value.toString().trim() !== ""
      );
    };

    const formatMetricSection = (metrics, prefix = "") => {
      const formattedMetrics = [];
      if (isValidMetric(metrics.sensitivity)) {
        formattedMetrics.push(
          `${prefix}<strong>Sensibilidad:</strong> ${metrics.sensitivity}%`
        );
      }
      if (isValidMetric(metrics.specificity)) {
        formattedMetrics.push(
          `${prefix}<strong>Especificidad:</strong> ${metrics.specificity}%`
        );
      }
      if (isValidMetric(metrics.precision)) {
        formattedMetrics.push(
          `${prefix}<strong>Precisión:</strong> ${metrics.precision}%`
        );
      }
      if (isValidMetric(metrics.NNR)) {
        formattedMetrics.push(`${prefix}<strong>NNR:</strong> ${metrics.NNR}`);
      }
      return formattedMetrics;
    };

    if (metadata.validation?.metrics) {
      if ("sensitivity" in metadata.validation.metrics) {
        parts.push(...formatMetricSection(metadata.validation.metrics));
      } else if ("sensitive" in metadata.validation.metrics) {
        const sensitiveParts = formatMetricSection(
          metadata.validation.metrics.sensitive
        );
        const specificParts = formatMetricSection(
          metadata.validation.metrics.specific
        );
        if (sensitiveParts.length > 0) {
          parts.push("<u>Versión Sensible:</u>");
          parts.push(...sensitiveParts);
        }
        if (specificParts.length > 0) {
          if (parts.length > 0) parts.push("");
          parts.push("<u>Versión Específica:</u>");
          parts.push(...specificParts);
        }
      }
    }
    if (metadata.validation?.reference?.trim()) {
      if (parts.length > 0) parts.push("");
      parts.push(
        `<strong>Fuente:</strong> ${metadata.validation.reference.trim()}`
      );
    }
    return parts.join("\n");
  }

  function cargarFiltros() {
    var promises = [];
    Object.keys(categories).forEach(function (cat) {
      categories[cat].forEach(function (id) {
        var url =
          "https://ernestobarrera.github.io/pubmed-filters/filters/" +
          cat +
          "/" +
          id +
          ".txt";
        var prom = fetch(url)
          .then(function (r) {
            return r.ok ? r.text() : "";
          })
          .then(function (txt) {
            const [filter, metadataStr] = txt.split("@@@FILTER_METADATA@@@");
            const cleanedFilter = filter
              .split("\n")
              .filter((line) => !line.trim().startsWith("#"))
              .join("\n");
            filterMap[id] = cleanedFilter.trim();
            if (metadataStr) {
              try {
                const metadata = JSON.parse(metadataStr.trim());
                const tooltipContent = formatTooltipContent(metadata);
                filterTooltips[id] = tooltipContent;
              } catch (e) {
                // Se elimina console.warn en producción
              }
            }
          })
          .catch(function (error) {
            filterMap[id] = "";
          });
        promises.push(prom);
      });
    });
    return Promise.all(promises);
  }

  cargarFiltros().then(() => {
    document.querySelectorAll(".filter-button").forEach(function (button) {
      let id;
      if (button.classList.contains("with-toggle")) {
        id = button.dataset.base + "_sensible";
      } else {
        id = button.dataset.type;
      }
      if (filterTooltips[id]) {
        button.setAttribute("data-tippy-content", filterTooltips[id]);
        tippy(button, {
          content: filterTooltips[id],
          placement: "top",
          arrow: true,
          theme: "custom",
          animation: "shift-away",
          delay: [200, 0],
          maxWidth: 400,
          allowHTML: true,
          trigger: "mouseenter",
          onShow(instance) {
            return infoModeActive;
          },
        });
      }
    });
    const infoModeToggle = document.getElementById("infoModeToggle");
    let infoModeActive = false;
    function showTooltip(event) {
      const tippyInstance = event.currentTarget._tippy;
      if (tippyInstance) {
        tippyInstance.show();
      }
    }
    function hideTooltip(event) {
      const tippyInstance = event.currentTarget._tippy;
      if (tippyInstance) {
        tippyInstance.hide();
      }
    }
    infoModeToggle.addEventListener("click", () => {
      infoModeActive = !infoModeActive;
      infoModeToggle.style.background = infoModeActive
        ? "var(--accent-color)"
        : "var(--card-bg)";
      infoModeToggle.style.color = infoModeActive
        ? "var(--primary-bg)"
        : "var(--text-primary)";
      document.querySelectorAll(".filter-button").forEach((button) => {
        const tippyInstance = button._tippy;
        if (tippyInstance) {
          if (infoModeActive) {
            button.addEventListener("mouseenter", showTooltip);
            button.addEventListener("mouseleave", hideTooltip);
          } else {
            button.removeEventListener("mouseenter", showTooltip);
            button.removeEventListener("mouseleave", hideTooltip);
            tippyInstance.hide();
          }
        }
      });
    });
  });

  ["input", "change"].forEach((event) => {
    searchTerm.addEventListener(event, mostrarQueryFinal);
    dateRange.addEventListener(event, mostrarQueryFinal);
    sortMode.addEventListener(event, mostrarQueryFinal);
  });

  document
    .querySelectorAll(".filter-button:not(.with-toggle)")
    .forEach(function (button) {
      button.addEventListener("click", function () {
        button.classList.toggle("active");
        var filterType = button.dataset.type;
        if (filterType) {
          if (button.classList.contains("active")) {
            activeFilters.add(filterType);
          } else {
            activeFilters.delete(filterType);
          }
          filterCount.textContent = activeFilters.size;
          mostrarQueryFinal();
        }
      });
    });

  document
    .querySelectorAll(".filter-button.with-toggle")
    .forEach(function (btn) {
      var baseId = btn.dataset.base;
      btn.addEventListener("click", function (e) {
        if (
          e.target.tagName === "INPUT" ||
          e.target.closest(".versions-toggle")
        ) {
          return;
        }
        btn.classList.toggle("active");
        var selectedRadio = btn.querySelector('input[type="radio"]:checked');
        var filterType = baseId + "_" + selectedRadio.value;
        if (btn.classList.contains("active")) {
          activeFilters.add(filterType);
        } else {
          activeFilters.delete(filterType);
        }
        filterCount.textContent = activeFilters.size;
        mostrarQueryFinal();
      });
      var radios = btn.querySelectorAll('input[type="radio"]');
      radios.forEach(function (radio) {
        radio.addEventListener("change", function () {
          if (!btn.classList.contains("active")) return;
          var oldType =
            baseId +
            "_" +
            (radio.value === "sensible" ? "especifico" : "sensible");
          var newType = baseId + "_" + radio.value;
          activeFilters.delete(oldType);
          activeFilters.add(newType);
          filterCount.textContent = activeFilters.size;
          mostrarQueryFinal();
        });
      });
    });

  const categoryOperators = {
    methodology: "OR",
    clinical: "OR",
    scope: "OR",
  };

  function constructQuery(term) {
    if (!term && activeFilters.size === 0) return "";
    let query = term;
    Object.keys(categories).forEach(function (cat) {
      const operator = categoryOperators[cat];
      const activeInCat = categories[cat]
        .filter((f) => activeFilters.has(f))
        .map((f) => filterMap[f] || "")
        .filter((q) => q !== "");
      if (activeInCat.length > 0) {
        const notFilters = activeInCat.filter((f) => /^NOT/.test(f));
        const regularFilters = activeInCat.filter((f) => !/^NOT/.test(f));
        if (regularFilters.length > 0) {
          const categoryQuery = `(${regularFilters.join(` ${operator} `)})`;
          query = query ? `(${query}) AND ${categoryQuery}` : categoryQuery;
        }
        notFilters.forEach((filter) => {
          query = query ? `(${query}) ${filter}` : filter;
        });
      }
    });
    if (dateRange.value) {
      const dateFilter = `("last ${dateRange.value} days"[dp])`;
      query = query ? `(${query}) AND ${dateFilter}` : dateFilter;
    }
    return query.trim();
  }

  function mostrarQueryFinal() {
    var built = constructQuery(searchTerm.value.trim());
    finalQueryBox.textContent = built;
    updateVennDiagram();
  }

  function hacerBusqueda() {
    var term = searchTerm.value.trim();
    var finalQ = constructQuery(term);
    if (!finalQ) {
      alert("Por favor, introduce un término o selecciona algún filtro.");
      return;
    }
    var url =
      "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(finalQ);
    if (sortMode.value === "date") {
      url += "&sort=date";
    }
    url += "&size=50";
    window.open(url, "_blank");
  }

  searchButton.addEventListener("click", hacerBusqueda);
  searchTerm.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      hacerBusqueda();
    }
  });

  resetButton.addEventListener("click", function () {
    activeFilters.clear();
    filterCount.textContent = 0;
    searchTerm.value = "";
    dateRange.value = "";
    sortMode.value = "date";
    document.querySelectorAll(".category-operator").forEach((select) => {
      select.value = "OR";
      categoryOperators[select.dataset.category] = "OR";
    });
    document.querySelectorAll(".filter-button").forEach(function (b) {
      b.classList.remove("active");
    });
    document
      .querySelectorAll('.versions-toggle input[type="radio"]')
      .forEach(function (r) {
        if (r.value === "sensible") {
          r.checked = true;
        }
      });
    finalQueryBox.textContent = "";
    updateVennDiagram();
  });

  document.querySelectorAll(".category-operator").forEach((select) => {
    select.addEventListener("change", function () {
      categoryOperators[this.dataset.category] = this.value;
      mostrarQueryFinal();
    });
  });

  function updateVennDiagram() {
    const methodologyFilters = Array.from(
      document.querySelectorAll(".filter-button.methodological.active")
    ).map((btn) => ({
      text: btn.textContent.trim(),
      type:
        btn.dataset.type ||
        `${btn.dataset.base}_${
          btn.querySelector('input[type="radio"]:checked')?.value
        }`,
    }));
    const clinicalFilters = Array.from(
      document.querySelectorAll(".filter-button.clinical.active")
    ).map((btn) => ({
      text: btn.textContent.trim(),
      type:
        btn.dataset.type ||
        `${btn.dataset.base}_${
          btn.querySelector('input[type="radio"]:checked')?.value
        }`,
    }));
    const scopeFilters = Array.from(
      document.querySelectorAll(".filter-button.scope.active")
    ).map((btn) => ({
      text: btn.textContent.trim(),
      type:
        btn.dataset.type ||
        `${btn.dataset.base}_${
          btn.querySelector('input[type="radio"]:checked')?.value
        }`,
    }));
    const sets = [];
    if (methodologyFilters.length > 0) {
      sets.push({
        sets: ["Metodología"],
        size: methodologyFilters.length,
        items: methodologyFilters.map((f) => f.text),
      });
    }
    if (clinicalFilters.length > 0) {
      sets.push({
        sets: ["Clínico"],
        size: clinicalFilters.length,
        items: clinicalFilters.map((f) => f.text),
      });
    }
    if (scopeFilters.length > 0) {
      sets.push({
        sets: ["Ámbito"],
        size: scopeFilters.length,
        items: scopeFilters.map((f) => f.text),
      });
    }
    if (sets.length > 1) {
      const categories = sets.map((s) => s.sets[0]);
      for (let i = 0; i < categories.length; i++) {
        for (let j = i + 1; j < categories.length; j++) {
          let size =
            Math.min(
              sets.find((s) => s.sets[0] === categories[i]).size,
              sets.find((s) => s.sets[0] === categories[j]).size
            ) / 3;
          sets.push({
            sets: [categories[i], categories[j]],
            size: size,
          });
        }
      }
      if (categories.length === 3) {
        let size = Math.min(sets[0].size, sets[1].size, sets[2].size) / 4;
        sets.push({
          sets: categories,
          size: size,
        });
      }
    }
    const vennDiv = d3.select("#venn-diagram").html("");
    const methodologyList = document.getElementById("methodology-filters");
    const clinicalList = document.getElementById("clinical-filters");
    const scopeList = document.getElementById("scope-filters");
    methodologyList.innerHTML =
      sets
        .find((s) => s.sets[0] === "Metodología")
        ?.items.map((item) => `<li>${item}</li>`)
        .join("") || "";
    clinicalList.innerHTML =
      sets
        .find((s) => s.sets[0] === "Clínico")
        ?.items.map((item) => `<li>${item}</li>`)
        .join("") || "";
    scopeList.innerHTML =
      sets
        .find((s) => s.sets[0] === "Ámbito")
        ?.items.map((item) => `<li>${item}</li>`)
        .join("") || "";
    if (sets.length > 0) {
      const chart = venn.VennDiagram().width(500).height(400);
      const div = vennDiv.datum(sets).call(chart);
      div
        .selectAll(".venn-circle path")
        .style("fill-opacity", 0.2)
        .style("stroke-width", 2);
      div
        .selectAll("g")
        .filter((d) => d.sets.length === 1)
        .each(function (d) {
          const set = sets.find((s) => s.sets[0] === d.sets[0]);
          const g = d3.select(this);
          g.select("text")
            .style("font-weight", "bold")
            .style("font-size", "16px")
            .style("fill", "#ffd700")
            .text(`${d.sets[0]} (${set.items.length})`);
        })
        .select("path")
        .style("fill", (d) => {
          const colors = {
            Metodología: "#3b82f6",
            Clínico: "#10b981",
            Ámbito: "#8b5cf6",
          };
          return colors[d.sets[0]];
        });
      const tooltip = d3.select("#venn-tooltip");
      div
        .selectAll("g")
        .on("mouseover", function (event, d) {
          venn.sortAreas(div, d);
          tooltip.transition().duration(200).style("opacity", 0.9);
          let content = "";
          if (d.sets.length === 1) {
            const set = sets.find((s) => s.sets[0] === d.sets[0]);
            if (set) {
              content = `<strong>${d.sets[0]}</strong><br>`;
              content += set.items.map((item) => `• ${item}`).join("<br>");
            }
          } else {
            content = `<strong>Intersección</strong><br>${d.sets.join(" + ")}`;
          }
          tooltip
            .html(content)
            .style("left", event.pageX + 10 + "px")
            .style("top", event.pageY - 10 + "px");
        })
        .on("mousemove", function (event) {
          tooltip
            .style("left", event.pageX + 10 + "px")
            .style("top", event.pageY - 10 + "px");
        })
        .on("mouseout", function () {
          tooltip.transition().duration(200).style("opacity", 0);
        });
    }
  }

  function iniciarTutorial() {
    var intro = introJs();
    intro.setOptions({
      steps: [
        {
          element: document.querySelector("#searchTerm"),
          intro:
            'Escribe tus términos de búsqueda. Para mayor precisión, usa descriptores MeSH que puedes consultar en <a href="https://www.ncbi.nlm.nih.gov/mesh" target="_blank" style="color: #0e04c8; text-decoration: underline;">MeSH Database</a>.',
          position: "top",
        },
        {
          element: document.querySelector(".filters-section"),
          intro:
            "Aquí encontrarás tres categorías de filtros: Metodología, Enfoque Clínico y Ámbito/Población. Cada categoría tiene su propio operador booleano para combinar los filtros dentro de ella.",
          position: "right",
        },
        {
          element: document.querySelector("#infoModeToggle"),
          intro:
            "Activa este botón para ver información detallada sobre cada filtro al pasar el cursor sobre ellos. Incluye la fuente del filtro y sus características específicas.",
          position: "bottom",
        },
        {
          element: document.querySelector(".operator-selector"),
          intro:
            "Cada categoría tiene su propio operador booleano: OR amplía resultados (más sensible), AND los restringe (más específico). Puedes combinar diferentes operadores en diferentes categorías.",
          position: "left",
        },
        {
          element: document.querySelector(".versions-toggle"),
          intro:
            "Algunos filtros tienen versiones Sensible (S) o Específica (E). Sensible encuentra más resultados pero menos precisos, Específica encuentra menos pero más relevantes.",
          position: "left",
        },
        {
          element: document.querySelector("#dateRange"),
          intro:
            "Filtra resultados por fecha: 7 días (muy reciente), 30 días (último mes), 6 meses, 1 año o 5 años.",
          position: "top",
        },
        {
          element: document.querySelector("#sortMode"),
          intro:
            "'Por fecha' muestra los más recientes primero, 'Best match' ordena por relevancia según el algoritmo de PubMed.",
          position: "bottom",
        },
        {
          element: document.querySelector("#searchButton"),
          intro:
            "Lanza la búsqueda en PubMed con todos los filtros seleccionados. Se abrirá en una nueva pestaña.",
          position: "left",
        },
        {
          element: document.querySelector("#toggleVennButton"),
          intro:
            "Visualiza la relación entre los filtros activos mediante un diagrama de Venn interactivo. Al activar el diagrama podrás ver cómo se agrupan los filtros por categoría y sus intersecciones.",
          position: "bottom",
          scrollTo: "tooltip",
        },
        {
          element: document.querySelector("#finalQuery"),
          intro:
            "Aquí verás la estrategia de búsqueda completa que combina tus términos con los filtros seleccionados usando los operadores booleanos específicos de cada categoría.",
          position: "top",
        },
        {
          element: document.querySelector(".search-tips"),
          intro:
            "Encuentra consejos útiles para mejorar tus búsquedas, como el uso de operadores booleanos y términos MeSH. Haz clic en el encabezado para expandir y ver todos los tips.",
          position: "top",
        },
      ],
      overlayOpacity: 0.9,
      highlightClass: "myHighlight",
      disableInteraction: true,
      skipLabel: "Saltar",
      nextLabel: "Siguiente",
      prevLabel: "Anterior",
      doneLabel: "Hecho",
      showStepNumbers: false,
      scrollToElement: true,
      scrollPadding: 1,
    });
    intro.oncomplete(function () {
      localStorage.setItem("tutorial_visto", "true");
    });
    intro.onexit(function () {
      localStorage.setItem("tutorial_visto", "true");
    });
    intro.start();
  }

  var tutorialVisto = localStorage.getItem("tutorial_visto");
  if (!tutorialVisto) {
    iniciarTutorial();
  }
  var startTutorialBtn = document.getElementById("startTutorialBtn");
  if (startTutorialBtn) {
    startTutorialBtn.addEventListener("click", iniciarTutorial);
  }
});
```

---

#### 2.2 Extraer el script de autoajuste del textarea

**a) En el HTML**

**Antes (bloque a eliminar):**

```html
<script>
  const searchTextarea = document.getElementById("searchTerm");

  function autoResizeTextarea() {
    this.style.height = "auto";
    this.style.height = this.scrollHeight + "px";
  }

  searchTextarea.addEventListener("input", autoResizeTextarea);
  searchTextarea.addEventListener("focus", autoResizeTextarea);
</script>
```

**Después:**  
Elimina el bloque y agrega la siguiente línea antes de `</body>` (después de cargar main.js, por ejemplo):

```html
<script src="/assets/js/auto-resize.js"></script>
```

**b) Crear el archivo `/assets/js/auto-resize.js`** con el siguiente contenido:

```js
const searchTextarea = document.getElementById("searchTerm");

function autoResizeTextarea() {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
}

if (searchTextarea) {
  searchTextarea.addEventListener("input", autoResizeTextarea);
  searchTextarea.addEventListener("focus", autoResizeTextarea);
}
```

---

### 3. Eliminar líneas de depuración

Dentro del archivo `/assets/js/main.js` elimina (o comenta) todas las líneas con `console.log(...)` y `console.warn(...)`. Por ejemplo, elimina líneas como:

```js
// console.log("Cargando filtro:", url);
// console.warn(`Error parseando metadata para ${id}:`, e);
```

Esto hará que el código final sea más limpio para producción.

---

### 4. Verificar el sistema de inclusión de componentes

Si usas etiquetas como:

```html
<include src="header.html"></include> <include src="footer.html"></include>
```

Asegúrate de que el script `/assets/js/include.js` (ya incluido en el HTML) procese correctamente estas etiquetas. Si presentas problemas, considera migrar a una solución de plantillas o inclusiones del lado del servidor.

---

### 5. Revisar y ajustar la semántica del HTML

Aunque la mayor parte de la estructura ya es semántica (por ejemplo, usas `<main>` para el contenedor principal), verifica que todos los bloques sean los adecuados. Por ejemplo, si en algún lugar encuentras:

```html
<div class="main-container">...</div>
```

confirma que esté contenido dentro de una etiqueta semántica como `<main>` (en tu caso ya lo tienes).

---

Con estos cambios estarás:

- Centralizando y limpiando los estilos (todo el CSS inline se moverá a `/assets/css/custom-styles.css`).
- Modularizando la lógica JavaScript en dos archivos externos (`/assets/js/main.js` y `/assets/js/auto-resize.js`).
- Eliminando mensajes de depuración para mejorar el rendimiento y la limpieza del código.
- Asegurándote de que las inclusiones (header, footer) y la semántica HTML sean consistentes y adecuados.

Realiza estos cambios de forma progresiva y prueba en cada paso para confirmar que la funcionalidad (filtros, tooltips, diagrama, tutorial, autoajuste del textarea) continúa operando correctamente.

API PUBMED

# Documento Técnico: Desarrollo de Contadores de Resultados para Buscador PubMed

## Estado del Proyecto - [24/04/2025]

### Descripción General

Estamos desarrollando una funcionalidad de contadores de resultados para un buscador avanzado de PubMed. Esta funcionalidad permite mostrar numéricamente la cantidad de resultados que tendría cada filtro al aplicarse, sin necesidad de realizar la búsqueda completa.

### Componentes Principales

- **Buscador PubMed con Filtros Estructurados**: Aplicación base ya funcional
- **Sistema de Contadores**: Módulo en desarrollo para mostrar recuentos de resultados en tiempo real
- **API Integration**: Conexión con NCBI E-utilities API para consultar conteos

### Estado Actual

El sistema de contadores está parcialmente implementado. Al activar la funcionalidad, se muestran indicadores visuales (círculos amarillos) para cada filtro, pero no se visualizan correctamente los valores numéricos de los recuentos.

## Problema Pendiente

**Descripción del error**: Los contadores aparecen como círculos amarillos sin mostrar los números de resultados, aunque la lógica de consulta a la API y obtención de datos funciona correctamente.

**Comportamiento esperado**: Los contadores deberían mostrar números (ej: "123", "1.5K", "2.1M") en vez de solo puntos amarillos.

## Código Funcional Actual

<script>
document.addEventListener('DOMContentLoaded', function() {
  
  // Clase para gestionar solicitudes a la API
  class RequestQueue {
    constructor(apiKey, requestsPerSecond = 5) {
      this.apiKey = apiKey;
      this.queue = [];
      this.running = false;
      this.interval = Math.ceil(1000 / requestsPerSecond);
    }
    
    add(filterID, query) {
      return new Promise((resolve, reject) => {
        this.queue.push({ filterID, query, resolve, reject });
        if (!this.running) this.process();
      });
    }
    
    async process() {
      this.running = true;
      while (this.queue.length > 0) {
        const { filterID, query, resolve, reject } = this.queue.shift();
        try {
          const count = await this.fetchCount(query);
          resolve({ filterID, count });
        } catch (error) {
          console.error(`Error procesando filtro ${filterID}:`, error);
          reject({ filterID, error });
        }
        await new Promise(r => setTimeout(r, this.interval));
      }
      this.running = false;
    }
    
    async fetchCount(query) {
      try {
        console.log(`Consultando API para: ${query}`);
        const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&retmax=0&api_key=${this.apiKey}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Error HTTP: ${response.status}`);
        }
        const data = await response.json();
        console.log(`Respuesta recibida:`, data);
        return parseInt(data.esearchresult?.count || 0, 10);
      } catch (error) {
        console.error('Error en fetchCount:', error);
        throw error;
      }
    }
  }
  
  // Sistema de caché
  const resultsCache = {
    store: {},
    
    set(term, filterID, count) {
      const key = `${term}|${filterID}`;
      this.store[key] = {
        count, 
        timestamp: Date.now()
      };
    },
    
    get(term, filterID) {
      const key = `${term}|${filterID}`;
      const entry = this.store[key];
      
      if (entry && (Date.now() - entry.timestamp < 300000)) {
        return entry.count;
      }
      
      return null;
    }
  };
  
  // Formatear números
  function formatNumber(num) {
    if (num >= 1000000) return (num/1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num/1000).toFixed(1) + 'K';
    return num.toString();
  }
  
  // SOLUCIÓN: Reemplazo completo de estilos para garantizar visibilidad
  function addStyles() {
    // Primero eliminamos estilos anteriores si existen
    const oldStyle = document.getElementById('counter-styles');
    if (oldStyle) oldStyle.remove();
    
    const style = document.createElement('style');
    style.id = 'counter-styles';
    style.textContent = `
      /* Estilos completamente nuevos para los contadores */
      .result-counter {
        display: flex !important;
        justify-content: center !important;
        align-items: center !important;
        min-width: 28px !important;
        height: 20px !important;
        padding: 0 4px !important;
        border-radius: 10px !important;
        background-color: #ffd700 !important;
        color: black !important;
        font-size: 12px !important;
        font-weight: bold !important;
        line-height: 1 !important;
        text-align: center !important;
        position: absolute !important;
        right: 8px !important;
        top: 50% !important;
        transform: translateY(-50%) !important;
        z-index: 100 !important;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3) !important;
        border: 1px solid #e5c100 !important;
        overflow: visible !important;
      }
      
      /* Estilos específicos para diferentes estados de contador */
      .result-counter.high {
        background-color: #28a745 !important;
        color: white !important;
      }
      
      .result-counter.medium {
        background-color: #ffd700 !important;
        color: black !important;
      }
      
      .result-counter.low {
        background-color: #fd7e14 !important;
        color: white !important;
      }
      
      .result-counter.very-low {
        background-color: #dc3545 !important;
        color: white !important;
      }
      
      /* Ajuste específico para botones con radio buttons */
      .filter-button:has(input[type="radio"]) .result-counter {
        right: 60px !important;
      }
      
      /* Garantizar que los botones de filtro tengan posición relativa */
      .filter-button {
        position: relative !important;
      }
      
      /* Especificidad CSS aumentada para superar cualquier otro estilo */
      body .filter-button .result-counter {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
    
    console.log("Estilos para contadores añadidos/actualizados");
  }
  
  // SOLUCIÓN: Reescritura de la función de mostrar contadores
  function showCounters() {
    // Primero añadimos los estilos actualizados
    addStyles();
    
    console.log("Inicializando contadores...");
    
    // Seleccionar todos los botones de filtro
    const filterButtons = document.querySelectorAll('.filter-button');
    console.log(`Encontrados ${filterButtons.length} botones de filtro`);
    
    filterButtons.forEach((button, index) => {
      // Eliminar contador existente si hay alguno
      const existingCounter = button.querySelector('.result-counter');
      if (existingCounter) {
        existingCounter.remove();
      }
      
      // Crear nuevo contador con estilos mejorados
      const counter = document.createElement('div');  // Cambiado a div para mejor soporte
      counter.className = 'result-counter medium';
      counter.textContent = '...';
      counter.id = `counter-${index}`;  // Añadir ID único para debugging
      
      // Aplicar estilos inline críticos para garantizar visibilidad
      counter.style.display = 'flex';
      counter.style.justifyContent = 'center';
      counter.style.alignItems = 'center';
      counter.style.visibility = 'visible';
      counter.style.color = 'black';
      counter.style.backgroundColor = '#ffd700';
      
      // Añadir al botón
      button.appendChild(counter);
      
      console.log(`Contador ${index} añadido a "${button.textContent.trim()}"`);
    });
  }
  
  // Ocultar contadores
  function hideCounters() {
    document.querySelectorAll('.result-counter').forEach(counter => {
      counter.remove();
    });
    console.log("Contadores eliminados");
  }
  
  // SOLUCIÓN: Mejorar la actualización visual de los contadores
  function updateCounterColor(element, count) {
    // Primero eliminar todas las clases de estado
    element.classList.remove('high', 'medium', 'low', 'very-low');
    
    if (count >= 10000) {
      element.classList.add('high');
      element.style.backgroundColor = '#28a745';
      element.style.color = 'white';
    } else if (count >= 1000) {
      element.classList.add('high');
      element.style.backgroundColor = '#20c997';
      element.style.color = 'white';
    } else if (count >= 100) {
      element.classList.add('medium');
      element.style.backgroundColor = '#ffd700';
      element.style.color = 'black';
    } else if (count > 10) {
      element.classList.add('low');
      element.style.backgroundColor = '#fd7e14';
      element.style.color = 'white';
    } else {
      element.classList.add('very-low');
      element.style.backgroundColor = '#dc3545';
      element.style.color = 'white';
    }
  }
  
  // SOLUCIÓN: Mejorar la función de actualización de contadores
  function updateFilterCounts(searchTerm) {
    if (!searchTerm) return;
    
    console.log(`Actualizando contadores para: "${searchTerm}"`);
    
    // Mostrar indicador de proceso
    if (typeof mostrarToast === 'function') {
      mostrarToast('Calculando contadores de resultados...');
    }
    
    // ⚠️ IMPORTANTE: Reemplaza con tu API key real
    const apiKey = 'TU_API_KEY';
    const queue = new RequestQueue(apiKey, 5);
    let completedRequests = 0;
    
    // Para el prototipo inicial, limitamos a 10 filtros
    const buttons = Array.from(document.querySelectorAll('.filter-button')).slice(0, 10);
    
    buttons.forEach((button, index) => {
      // Obtener el elemento contador
      const counter = button.querySelector('.result-counter');
      if (!counter) {
        console.warn(`No se encontró contador para el botón ${index}`);
        return;
      }
      
      // Indicador de carga
      counter.textContent = '...';
      
      // Identificar el filtro
      let filterId;
      
      // Primero intentamos obtener el filtro desde data-type
      if (button.dataset.type) {
        filterId = button.dataset.type;
      } 
      // Si no, intentamos con data-base y el radio button seleccionado
      else if (button.dataset.base) {
        const selectedRadio = button.querySelector('input[type="radio"]:checked');
        if (selectedRadio) {
          filterId = `${button.dataset.base}_${selectedRadio.value}`;
        } else {
          filterId = `${button.dataset.base}_sensible`; // valor por defecto
        }
      }
      
      if (!filterId || !filterMap || !filterMap[filterId]) {
        counter.textContent = '?';
        counter.style.backgroundColor = '#dc3545';
        counter.style.color = 'white';
        completedRequests++;
        console.warn(`No se pudo identificar el filtro para el botón: ${button.textContent}`);
        return;
      }
      
      console.log(`Procesando filtro ${filterId} para el botón "${button.textContent.trim()}"`);
      
      // Verificar caché
      const cachedCount = resultsCache.get(searchTerm, filterId);
      if (cachedCount !== null) {
        console.log(`Usando valor en caché para ${filterId}: ${cachedCount}`);
        counter.textContent = formatNumber(cachedCount);
        counter.title = `${cachedCount.toLocaleString()} resultados`;
        updateCounterColor(counter, cachedCount);
        completedRequests++;
        
        if (completedRequests >= buttons.length && typeof mostrarToast === 'function') {
          mostrarToast('Contadores actualizados (desde caché)');
        }
        return;
      }
      
      // Construir consulta
      const filterQuery = filterMap[filterId];
      const combinedQuery = searchTerm ? `(${searchTerm}) AND (${filterQuery})` : filterQuery;
      
      // Enviar solicitud
      queue.add(filterId, combinedQuery)
        .then(({ filterID, count }) => {
          console.log(`Resultado para ${filterID}: ${count} resultados`);
          
          // Actualizar contador con resultado - ASEGURANDO que el texto sea visible
          counter.textContent = formatNumber(count);
          counter.title = `${count.toLocaleString()} resultados`;
          
          // Forzar mayor visibilidad
          counter.style.fontSize = '12px';
          counter.style.display = 'flex';
          counter.style.justifyContent = 'center';
          counter.style.alignItems = 'center';
          
          updateCounterColor(counter, count);
          
          // Guardar en caché
          resultsCache.set(searchTerm, filterID, count);
        })
        .catch(({ filterID, error }) => {
          console.error(`Error para ${filterID}:`, error);
          counter.textContent = '?';
          counter.style.backgroundColor = '#dc3545';
          counter.style.color = 'white';
        })
        .finally(() => {
          completedRequests++;
          if (completedRequests >= buttons.length && typeof mostrarToast === 'function') {
            mostrarToast('Contadores actualizados');
          }
        });
    });
  }
  
  // Debounce para evitar muchas llamadas
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
  
  // Implementar botón de toggle (adaptado a la nueva interfaz)
  const toggleBtn = document.createElement('button');
  toggleBtn.innerHTML = '🔢 Contadores';
  toggleBtn.className = 'info-button';
  toggleBtn.id = 'toggleCountersBtn';
  toggleBtn.style.backgroundColor = '#333';
  toggleBtn.style.color = '#ffd700';
  toggleBtn.style.border = '1px solid #ffd700';
  toggleBtn.style.borderRadius = '8px';
  toggleBtn.style.padding = '0.5rem 1rem';
  toggleBtn.style.margin = '0 0.5rem';
  toggleBtn.style.cursor = 'pointer';
  
  // Buscar la ubicación adecuada para el botón en la nueva interfaz
  const controlesDiv = document.querySelector('.centered-controls');
  if (controlesDiv) {
    controlesDiv.appendChild(toggleBtn);
  }
  
  // Estado inicial
  let countersActive = false;
  
  // Función actualización con debounce
  const debouncedUpdate = debounce((term) => {
    if (countersActive && term) {
      updateFilterCounts(term);
    }
  }, 700);
  
  // Evento para toggle
  toggleBtn.addEventListener('click', function() {
    countersActive = !countersActive;
    
    if (countersActive) {
      this.innerHTML = '🔢 Ocultar';
      this.style.background = '#ffd700';
      this.style.color = '#333';
      
      // Mostrar contadores
      showCounters();
      
      // Actualizar con datos
      const term = document.getElementById('searchTerm').value.trim();
      if (term) {
        try {
          const queryTerm = constructQuery(term);
          if (queryTerm) {
            updateFilterCounts(queryTerm);
          } else if (typeof mostrarToast === 'function') {
            mostrarToast('La consulta está vacía');
          }
        } catch (e) {
          console.error('Error al construir consulta:', e);
        }
      } else if (typeof mostrarToast === 'function') {
        mostrarToast('Ingresa un término de búsqueda para ver contadores');
      }
    } else {
      this.innerHTML = '🔢 Contadores';
      this.style.background = '#333';
      this.style.color = '#ffd700';
      
      // Ocultar contadores
      hideCounters();
    }
  });
  
  // Actualizar cuando cambie texto
  const searchTerm = document.getElementById('searchTerm');
  if (searchTerm) {
    searchTerm.addEventListener('input', function() {
      try {
        const term = this.value.trim();
        if (typeof constructQuery === 'function') {
          const queryTerm = constructQuery(term);
          debouncedUpdate(queryTerm);
        } else {
          console.error('La función constructQuery no está disponible');
        }
      } catch (e) {
        console.error('Error en evento input:', e);
      }
    });
  }
  
  // SOLUCIÓN: Añadir verificación inicial
  console.log('Script de contadores cargado correctamente');
});
</script>

## Análisis del Error

1. **Causa probable**: El problema parece estar en la visualización de los contadores. Aunque los datos se obtienen correctamente de la API, el estilo CSS no permite que los números sean visibles dentro de los círculos amarillos.

2. **Hipótesis**:

   - Conflicto de estilos CSS que oculta o no muestra correctamente el texto
   - Posible problema con el elemento `span` que no visualiza correctamente los números
   - Posible sobreescritura de los estilos por CSS del framework principal

3. **Logs para diagnóstico**: Se han añadido varios `console.log` que confirman que:
   - La API responde correctamente con los conteos
   - Los contadores se crean y se agregan al DOM
   - Los valores numéricos se asignan correctamente a `counter.textContent`

## Pasos para Continuar el Desarrollo

1. **Configurar el entorno**:

   - Clonar el repositorio del buscador PubMed
   - Instalar las dependencias necesarias
   - Configurar una API key válida de NCBI E-utilities

2. **Verificar la integración**:

   - Asegurarse de que el script se incluya correctamente antes del cierre del `</body>`
   - Verificar que las funciones `constructQuery` y `filterMap` estén disponibles globalmente

3. **Solucionar el problema de visualización**:

   - Enfocar la solución en mejorar los estilos CSS para garantizar que los números sean visibles
   - Probar con diferentes enfoques:
     a. Cambiar de `span` a `div` para el contenedor del contador
     b. Reforzar los estilos con `!important` para evitar sobreescrituras
     c. Implementar un enfoque basado en observador de mutaciones para aplicar estilos dinámicamente

4. **Estrategias alternativas**:
   - Si persiste el problema, considerar un rediseño completo del componente de contador
   - Evaluar usar un framework de componentes más robusto para esta funcionalidad

## Recursos y Referencias

1. **API de NCBI E-utilities**:

   - Documentación: https://www.ncbi.nlm.nih.gov/books/NBK25500/
   - Límites: 3 peticiones/segundo sin API key, 10 peticiones/segundo con API key

2. **Contactos**:

   - Contactar a @ernestob para aclaraciones sobre la estructura del proyecto

3. **Herramientas de debugging recomendadas**:
   - Chrome DevTools > Elements para inspeccionar estilos aplicados
   - React DevTools si se migra a un enfoque basado en componentes

---

**Notas adicionales**:

- La API key actual es de prueba y debe reemplazarse con una válida
- La mayoría de los errores ocurren en navegadores basados en WebKit (Safari)
- El código está listo para testing una vez implementada la corrección de visualización

---

Documento preparado por Claude | Fecha: 24/04/2025
