A continuación te muestro cómo modificar el código para agregar dos iconos (uno para guardar y otro para recuperar) en la esquina superior derecha del área de búsqueda, y cómo implementar la funcionalidad de almacenar varias búsquedas (cada una con su nombre) usando localStorage.

---

## 1. Modificar el HTML

Dentro del contenedor de la búsqueda (por ejemplo, en la parte superior del bloque principal de búsqueda), añade un bloque para los iconos. Por ejemplo, justo después de abrir el `<main class="main-container">` o dentro de él, coloca:

```html
<div class="search-header-icons">
  <button id="btn_guardar" title="Guardar búsqueda">
    <i class="fas fa-save"></i>
  </button>
  <button id="btn_recuperar" title="Recuperar búsqueda">
    <i class="fas fa-folder-open"></i>
  </button>
</div>
```

Luego, en tu CSS (por ejemplo, en `/assets/css/custom-styles.css` o en un archivo específico) añade las siguientes reglas para posicionar los iconos de forma elegante:

```css
.search-header-icons {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 0.5rem;
}

.search-header-icons button {
  background: transparent;
  border: none;
  color: #ffd700; /* O el color que prefieras para resaltar */
  font-size: 1.5rem;
  cursor: pointer;
}

.search-header-icons button:hover {
  color: #fff;
}
```

Asegúrate de que el contenedor de búsqueda tenga posición relativa para que los iconos se posicionen respecto a él. Por ejemplo, si tu área de búsqueda está dentro de un contenedor, agrega:

```css
.search-container {
  position: relative;
}
```

---

## 2. Modificar el JavaScript para guardar y recuperar búsquedas

### 2.1. Almacenar las búsquedas en localStorage

Utilizaremos la clave `"saved_searches"` en localStorage para almacenar un objeto JSON donde cada propiedad es el nombre de una búsqueda y su valor es el estado de la misma. El estado incluirá: el término de búsqueda, los filtros activos, el valor del selector de fecha y el de orden.

Inserta el siguiente código al final de tu archivo `/assets/js/main.js` (después de las funciones existentes):

```js
// Función para obtener el objeto de búsquedas guardadas
function obtenerBúsquedasGuardadas() {
  const almacenado = localStorage.getItem("saved_searches");
  return almacenado ? JSON.parse(almacenado) : {};
}

// Función para guardar el objeto de búsquedas en localStorage
function guardarBúsquedasGuardadas(búsquedas) {
  localStorage.setItem("saved_searches", JSON.stringify(búsquedas));
}

// Guardar búsqueda: se solicita un nombre y se almacena el estado actual
document.getElementById("btn_guardar").addEventListener("click", function () {
  // Solicitar nombre para la búsqueda
  const nombre = window.prompt("Ingrese un nombre para guardar la búsqueda:");
  if (!nombre || !nombre.trim()) {
    alert("Debe ingresar un nombre válido.");
    return;
  }

  // Crear objeto con el estado actual
  const búsquedaActual = {
    termino: searchTerm.value.trim(),
    filtros: Array.from(activeFilters), // array de identificadores de filtros activos
    fecha: dateRange.value,
    orden: sortMode.value,
  };

  // Obtener búsquedas guardadas, agregar o actualizar la actual y almacenar
  const búsquedas = obtenerBúsquedasGuardadas();
  búsquedas[nombre.trim()] = búsquedaActual;
  guardarBúsquedasGuardadas(búsquedas);
  alert(`Búsqueda "${nombre.trim()}" guardada correctamente.`);
});

// Recuperar búsqueda: si hay varias, se le muestra al usuario una lista y se solicita el nombre
document.getElementById("btn_recuperar").addEventListener("click", function () {
  const búsquedas = obtenerBúsquedasGuardadas();
  const nombres = Object.keys(búsquedas);
  if (nombres.length === 0) {
    alert("No hay búsquedas guardadas.");
    return;
  }

  // Mostrar las búsquedas guardadas en un mensaje
  const mensaje =
    "Búsquedas guardadas:\n" +
    nombres.join("\n") +
    "\n\nIngrese el nombre de la búsqueda a recuperar:";
  const nombreRecuperar = window.prompt(mensaje);
  if (!nombreRecuperar || !búsquedas[nombreRecuperar.trim()]) {
    alert("No se encontró la búsqueda con ese nombre.");
    return;
  }

  // Recuperar el estado y restaurar los valores
  const estado = búsquedas[nombreRecuperar.trim()];
  searchTerm.value = estado.termino || "";
  dateRange.value = estado.fecha || "";
  sortMode.value = estado.orden || "date";

  // Reiniciar filtros visuales y el conjunto de filtros activos
  document.querySelectorAll(".filter-button").forEach(function (btn) {
    btn.classList.remove("active");
  });
  activeFilters.clear();

  // Activar cada filtro guardado
  estado.filtros.forEach(function (filtro) {
    activeFilters.add(filtro);
    // Buscar el botón que coincida; para botones con toggle se puede buscar por data-type o data-base
    // Primero buscamos por data-type:
    let btn = document.querySelector(
      '.filter-button[data-type="' + filtro + '"]'
    );
    // Si no se encuentra, se asume que es un botón con toggle y se busca por el valor base
    if (!btn) {
      const base = filtro.split("_")[0];
      btn = document.querySelector('.filter-button[data-base="' + base + '"]');
    }
    if (btn) {
      btn.classList.add("active");
    }
  });

  mostrarQueryFinal(); // Actualizar la consulta generada y demás UI
  alert(`Búsqueda "${nombreRecuperar.trim()}" recuperada correctamente.`);
});
```

### 2.2. Explicación

- **Guardar búsqueda:**  
  Al pulsar el icono de guardar se solicita mediante `prompt` el nombre de la búsqueda. Luego se crea un objeto que recoge el término de búsqueda, el array de filtros activos (como strings), y los valores de fecha y orden. Se obtiene el objeto de búsquedas guardadas (si no existe, se crea uno vacío), se añade la búsqueda con el nombre proporcionado y se almacena de nuevo en localStorage.

- **Recuperar búsqueda:**  
  Al pulsar el icono de recuperar se leen las búsquedas guardadas. Si hay varias, se muestra una lista (en un mensaje de prompt) y se pide al usuario el nombre de la búsqueda que quiere cargar. Si se encuentra, se restauran el input de búsqueda, los selectores y se reinician y activan los botones correspondientes. Finalmente, se llama a `mostrarQueryFinal()` para actualizar la consulta y la interfaz (por ejemplo, el diagrama de Venn).

---

## 3. Notas adicionales

- Asegúrate de que las variables globales `searchTerm`, `activeFilters`, `dateRange`, `sortMode` y la función `mostrarQueryFinal()` estén definidas en el mismo ámbito que estas funciones (en este caso, dentro del `DOMContentLoaded` de `main.js`) para que sean accesibles.
- Los botones usan iconos de Font Awesome, por lo que la librería ya debe estar incluida (como aparece en tu `<head>`).
- Puedes ajustar los estilos CSS para que la posición y apariencia de los iconos se integren de forma elegante con el resto del diseño.

Con estas modificaciones tendrás una solución más elegante y funcional para guardar y recuperar búsquedas localmente, pidiendo el nombre de cada búsqueda y permitiendo recuperar entre varias guardadas.
