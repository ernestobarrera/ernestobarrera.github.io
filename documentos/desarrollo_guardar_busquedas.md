Aquí tienes una solución integral que reemplaza el uso de window.prompt por dos modales: uno para guardar la búsqueda con un campo de entrada que utiliza un datalist para sugerir nombres ya existentes, y otro para recuperar la búsqueda mediante un select. De esta forma, el usuario puede elegir o escribir el nombre de forma elegante y escalable.

---

**HTML (coloca este bloque en tu body, por ejemplo, justo antes de cerrar la etiqueta </body>):**

```html
<!-- Modal para guardar búsqueda -->
<div id="modal-save" class="modal" style="display:none;">
  <div class="modal-content">
    <span class="modal-close">&times;</span>
    <h3>Guardar búsqueda</h3>
    <p>Ingrese o seleccione un nombre:</p>
    <input
      id="saveNameInput"
      list="savedNames"
      placeholder="Nombre de búsqueda"
    />
    <datalist id="savedNames">
      <!-- Opciones se llenan dinámicamente -->
    </datalist>
    <button id="saveConfirmButton">Guardar</button>
  </div>
</div>

<!-- Modal para recuperar búsqueda -->
<div id="modal-retrieve" class="modal" style="display:none;">
  <div class="modal-content">
    <span class="modal-close">&times;</span>
    <h3>Recuperar búsqueda</h3>
    <p>Seleccione la búsqueda:</p>
    <select id="retrieveSelect">
      <!-- Opciones se llenan dinámicamente -->
    </select>
    <button id="retrieveConfirmButton">Recuperar</button>
  </div>
</div>
```

**CSS (agrega estas reglas, por ejemplo, en tu archivo CSS principal o en un bloque <style>):**

```css
.modal {
  position: fixed;
  z-index: 10000;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  background-color: rgba(0, 0, 0, 0.4);
}
.modal-content {
  background-color: #fefefe;
  margin: 10% auto;
  padding: 20px;
  border: 1px solid #888;
  width: 90%;
  max-width: 400px;
  border-radius: 8px;
}
.modal-close {
  color: #aaa;
  float: right;
  font-size: 24px;
  font-weight: bold;
  cursor: pointer;
}
.modal-close:hover,
.modal-close:focus {
  color: #000;
}
```

**JavaScript (dentro de tu event listener DOMContentLoaded, junto con el resto de tu código):**

```js
document.addEventListener("DOMContentLoaded", function () {
  // Variables globales ya existentes
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

  // Toggle del diagrama de Venn
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

  // --- (Aquí va el resto de tu código: categorías, tooltips, eventos de filtros, etc.) ---

  // Función para obtener búsquedas guardadas de localStorage
  function obtenerBúsquedasGuardadas() {
    const almacenado = localStorage.getItem("saved_searches");
    console.log("Búsquedas almacenadas:", almacenado);
    return almacenado ? JSON.parse(almacenado) : {};
  }

  // Función para guardar búsquedas en localStorage
  function guardarBúsquedasGuardadas(búsquedas) {
    localStorage.setItem("saved_searches", JSON.stringify(búsquedas));
    console.log("Guardando búsquedas:", búsquedas);
  }

  // --- Modales para guardar y recuperar búsquedas ---

  // Abre el modal de guardar y llena el datalist con nombres existentes
  function openSaveModal() {
    const modal = document.getElementById("modal-save");
    const datalist = document.getElementById("savedNames");
    datalist.innerHTML = "";
    const búsquedas = obtenerBúsquedasGuardadas();
    Object.keys(búsquedas).forEach(function (nombre) {
      const option = document.createElement("option");
      option.value = nombre;
      datalist.appendChild(option);
    });
    modal.style.display = "block";
  }

  // Abre el modal de recuperar y llena el select con nombres existentes
  function openRetrieveModal() {
    const modal = document.getElementById("modal-retrieve");
    const select = document.getElementById("retrieveSelect");
    select.innerHTML = "";
    const búsquedas = obtenerBúsquedasGuardadas();
    Object.keys(búsquedas).forEach(function (nombre) {
      const option = document.createElement("option");
      option.value = nombre;
      option.textContent = nombre;
      select.appendChild(option);
    });
    if (select.options.length === 0) {
      alert("No hay búsquedas guardadas.");
      return;
    }
    modal.style.display = "block";
  }

  // Cierra los modales al hacer clic en el botón de cierre
  document.querySelectorAll(".modal-close").forEach(function (span) {
    span.addEventListener("click", function () {
      span.parentElement.parentElement.style.display = "none";
    });
  });

  // Evento para abrir modal de guardar búsqueda
  document
    .getElementById("btn_guardar")
    .addEventListener("click", openSaveModal);

  // Evento para abrir modal de recuperar búsqueda
  document
    .getElementById("btn_recuperar")
    .addEventListener("click", openRetrieveModal);

  // Confirmar guardado: usa el valor del input (con datalist)
  document
    .getElementById("saveConfirmButton")
    .addEventListener("click", function () {
      const input = document.getElementById("saveNameInput");
      const nombre = input.value;
      if (!nombre || !nombre.trim()) {
        alert("Debe ingresar un nombre válido.");
        return;
      }
      const búsquedaActual = {
        termino: searchTerm.value.trim(),
        filtros: Array.from(activeFilters),
        fecha: dateRange.value,
        orden: sortMode.value,
      };
      const búsquedas = obtenerBúsquedasGuardadas();
      búsquedas[nombre.trim()] = búsquedaActual;
      guardarBúsquedasGuardadas(búsquedas);
      alert(`Búsqueda "${nombre.trim()}" guardada correctamente.`);
      document.getElementById("modal-save").style.display = "none";
    });

  // Confirmar recuperación: usa el valor seleccionado del select
  document
    .getElementById("retrieveConfirmButton")
    .addEventListener("click", function () {
      const select = document.getElementById("retrieveSelect");
      const nombre = select.value;
      const búsquedas = obtenerBúsquedasGuardadas();
      if (!nombre || !búsquedas[nombre]) {
        alert("No se encontró la búsqueda con ese nombre.");
        return;
      }
      const estado = búsquedas[nombre];
      searchTerm.value = estado.termino || "";
      dateRange.value = estado.fecha || "";
      sortMode.value = estado.orden || "date";
      document.querySelectorAll(".filter-button").forEach(function (btn) {
        btn.classList.remove("active");
      });
      activeFilters.clear();
      estado.filtros.forEach(function (filtro) {
        activeFilters.add(filtro);
        let btn = document.querySelector(
          '.filter-button[data-type="' + filtro + '"]'
        );
        if (!btn) {
          const base = filtro.split("_")[0];
          btn = document.querySelector(
            '.filter-button[data-base="' + base + '"]'
          );
        }
        if (btn) {
          btn.classList.add("active");
        }
      });
      mostrarQueryFinal();
      alert(`Búsqueda "${nombre}" recuperada correctamente.`);
      document.getElementById("modal-retrieve").style.display = "none";
    });

  // --- Fin del componente de modales para guardar/recuperar ---

  // (Resto de tu código, por ejemplo, funciones de reset, búsqueda, diagrama, tutorial, etc.)
});
```

---

**Breve explicación para el usuario:**

- Al hacer clic en el botón de guardar, se abrirá un modal con un campo de entrada que ofrece sugerencias de nombres ya guardados (gracias al datalist). Así, el usuario puede elegir uno existente o escribir uno nuevo sin tener que teclearlo manualmente cada vez.
- Al hacer clic en el botón de recuperar, se mostrará un modal con un menú desplegable que lista todas las búsquedas guardadas, facilitando la selección, incluso si hay muchas.

---

**Resumen comparativo:**

- **localStorage con JSON:** Fácil de implementar para datos pequeños; sin sincronización entre dispositivos y se pierden si se borra la caché.
- **IndexedDB:** Mayor capacidad y robustez para grandes volúmenes o consultas complejas, pero su API es más compleja.  
  Para guardar búsquedas simples, localStorage con JSON es la opción más adecuada.

---

Con este componente, tu aplicación gestionará de forma elegante el guardado, la recuperación y la exportación/importación de búsquedas, facilitando la tarea al usuario y siendo escalable cuando haya muchos registros.
