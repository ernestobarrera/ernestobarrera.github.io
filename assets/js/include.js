// Primero, aseguramos que el script se carga correctamente
(function () {
  async function includeHTML() {
    try {
      const includes = document.getElementsByTagName('include');

      // Si no hay elementos include, salimos silenciosamente
      if (!includes || includes.length === 0) {
        console.log('No se encontraron elementos include');
        return;
      }

      const getBasePath = () => {
        const path = window.location.pathname;
        console.log('Pathname actual:', path);

        // Versión anterior (comentada por si hay que revertir)
        // return 'assets/components/'.replace(/\/+/g, '/').trim();

        // Nueva versión: si estamos en /pages/, subimos un nivel
        // Si no, usamos la ruta desde la raíz
        return path.includes('/pages/') ? '../assets/components/' : 'assets/components/';
      };

      for (const include of includes) {
        if (!include) continue;

        const file = (include.getAttribute('src') || '').trim();
        if (!file) {
          console.error('Atributo src vacío o no encontrado');
          continue;
        }

        const basePath = getBasePath();
        const fullPath = `${basePath}${file}`.replace(/\s+/g, '').replace(/\/+/g, '/');

        console.log('Intentando cargar:', fullPath);

        try {
          const response = await fetch(fullPath);
          if (response.ok) {
            const text = await response.text();
            include.insertAdjacentHTML('afterend', text);
            console.log('✅ Cargado correctamente:', fullPath);
          } else {
            console.error(`❌ Error ${response.status}:`, fullPath);
            include.insertAdjacentHTML('afterend', `
              <div style="color: #ff6b6b; padding: 10px; margin: 10px 0; background: #2a3b4d; border-radius: 4px;">
                No se pudo cargar el contenido (${response.status})
                <br>
                <small>Ruta intentada: ${fullPath}</small>
              </div>
            `);
          }
        } catch (error) {
          console.error('❌ Error al cargar:', fullPath, error);
          include.insertAdjacentHTML('afterend', `
            <div style="color: #ff6b6b; padding: 10px; margin: 10px 0; background: #2a3b4d; border-radius: 4px;">
              Error al cargar el contenido: ${error.message}
              <br>
              <small>Ruta intentada: ${fullPath}</small>
            </div>
          `);
        }

        // Limpiamos el include original
        if (include && include.parentNode) {
          include.parentNode.removeChild(include);
        }
      }
    } catch (error) {
      console.error('Error general en includeHTML:', error);
    }
  }

  // Función de inicialización con retry
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', includeHTML);
    } else {
      includeHTML();
    }
  }

  // Ejecutamos la inicialización
  init();
})();