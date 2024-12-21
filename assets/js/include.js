/*--
=====================
  include.js
  javascript para la web
=====================
*/

(function () {
  // Función para ejecutar los scripts del header
  function executeHeaderScripts() {
    function setActiveLink() {
      const path = window.location.pathname;
      const links = document.querySelectorAll(".nav-link");

      links.forEach((link) => {
        link.classList.remove("active");
        const href = link.getAttribute("href");

        if (path === "/" || path === "/index.html" || path.endsWith("/")) {
          if (link.id === "inicio") {
            link.classList.add("active");
          }
          return;
        }

        if (href) {
          // Modificar para que ignore el # y cualquier cosa después
          const cleanHref = href.replace(/^\.\/|^\.\.\//g, "").split("#")[0];
          const cleanPath = path.split("/").pop();
          if (cleanPath === cleanHref) {
            link.classList.add("active");
          }
        }
      });
    }

    function initMobileMenu() {
      const button = document.querySelector(".mobile-menu-button");
      const menu = document.querySelector(".nav-menu");
      const spans = button.querySelectorAll("span");

      if (!button || !menu) return;

      button.addEventListener("click", () => {
        menu.classList.toggle("active");
        spans[0].style.transform = menu.classList.contains("active")
          ? "rotate(45deg)"
          : "rotate(0)";
        spans[1].style.opacity = menu.classList.contains("active") ? "0" : "1";
        spans[2].style.transform = menu.classList.contains("active")
          ? "rotate(-45deg)"
          : "rotate(0)";
      });

      menu.querySelectorAll(".nav-link").forEach((link) => {
        link.addEventListener("click", () => {
          menu.classList.remove("active");
          spans[0].style.transform = "rotate(0)";
          spans[1].style.opacity = "1";
          spans[2].style.transform = "rotate(0)";
        });
      });
    }

    setActiveLink();
    initMobileMenu();
  }

  async function includeHTML() {
    try {
      const includes = document.getElementsByTagName('include');

      if (!includes || includes.length === 0) {
        console.log('No se encontraron elementos include');
        return;
      }

      const getBasePath = () => {
        const path = window.location.pathname;
        console.log('Pathname actual:', path);
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

            // Ejecutar los scripts después de insertar el contenido
            if (file === 'header.html') {
              executeHeaderScripts();
            }
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

  // Función de inicialización
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