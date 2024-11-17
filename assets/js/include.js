// Función para determinar la ruta base según la ubicación de la página
function getBasePath() {
  const path = window.location.pathname;
  const depth = path.split('/').filter(Boolean).length;

  // Si estamos en un subdirectorio o repo separado (/t/, /ia/, etc.)
  if (path.includes('/t/') || path.includes('/ia/')) {
    return '../'.repeat(depth) + 'assets/components/';
  }

  // Si estamos en la raíz
  return './assets/components/';
}

// Función principal para incluir HTML
async function includeHTML() {
  const includes = document.getElementsByTagName('include');

  // Debug info
  console.log('URL actual:', window.location.href);
  console.log('Pathname:', window.location.pathname);

  const basePath = getBasePath();
  console.log('Ruta base calculada:', basePath);

  for (const include of includes) {
    let file = include.getAttribute('src');
    const fullPath = `${basePath}${file}`;

    console.log('Intentando cargar:', fullPath);

    try {
      const response = await fetch(fullPath);
      if (response.ok) {
        const text = await response.text();
        include.insertAdjacentHTML('afterend', text);
        console.log(`✅ Archivo cargado correctamente:`, fullPath);
      } else {
        console.error(`❌ Error HTTP ${response.status} al cargar ${fullPath}`);
        include.insertAdjacentHTML('afterend', `
          <div style="color: #ff6b6b; padding: 10px; margin: 10px 0; background: #2a3b4d; border-radius: 4px;">
            No se pudo cargar el contenido (${response.status})
            <br>
            <small>Ruta intentada: ${fullPath}</small>
          </div>
        `);
      }
    } catch (error) {
      console.error(`❌ Error de red al cargar ${fullPath}:`, error);
      include.insertAdjacentHTML('afterend', `
        <div style="color: #ff6b6b; padding: 10px; margin: 10px 0; background: #2a3b4d; border-radius: 4px;">
          Error al cargar el contenido: ${error.message}
          <br>
          <small>Ruta intentada: ${fullPath}</small>
        </div>
      `);
    }
    include.remove();
  }
}

// Ejecutar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 DOM Cargado - Iniciando includeHTML');
  setTimeout(includeHTML, 0);
});