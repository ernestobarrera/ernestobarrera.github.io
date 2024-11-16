// Función para incluir HTML
async function includeHTML() {
  const includes = document.getElementsByTagName('include');
  for (const include of includes) {
    const file = include.getAttribute('src');
    console.log(`Intentando cargar archivo: ${file}`); // Log para depuración
    try {
      const response = await fetch(file);
      if (response.ok) {
        const text = await response.text();
        include.insertAdjacentHTML('afterend', text); // Inserta el contenido después del <include>
        console.log(`Archivo cargado correctamente: ${file}`); // Log cuando se carga correctamente
      } else {
        console.error(`Error al cargar ${file}: ${response.status} ${response.statusText}`); // Log de error HTTP
      }
      include.remove(); // Elimina el <include> después de cargar el contenido
    } catch (error) {
      console.error(`Error al intentar cargar ${file}: ${error}`); // Log de errores de red u otros
    }
  }
}

// Ejecutar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(includeHTML, 0); // Asegura que todo esté cargado
});

