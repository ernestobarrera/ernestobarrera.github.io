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
