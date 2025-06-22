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
      const links = document.querySelectorAll(".nav-link, .dropdown-menu a");
      let activeDropdown = null;

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
          const cleanHref = href.replace(/^\.\/|^\.\.\//g, "").split("#")[0];
          const cleanPath = path.split("/").pop();

          if (cleanPath === cleanHref) {
            link.classList.add("active");

            // Si el enlace activo está en un submenú, activar también el padre
            const dropdownMenu = link.closest('.dropdown-menu');
            if (dropdownMenu) {
              activeDropdown = dropdownMenu.closest('.dropdown');
              const parentLink = activeDropdown.querySelector('.nav-link');
              if (parentLink) {
                parentLink.classList.add("active");
              }
            }
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
    function initDropdowns() {
      const dropdowns = document.querySelectorAll('.dropdown');
      const isMobile = window.innerWidth <= 768;

      dropdowns.forEach(dropdown => {
        const toggle = dropdown.querySelector('.dropdown-toggle');
        const menu = dropdown.querySelector('.dropdown-menu');

        if (toggle && menu) {
          // Manejador de click para móvil
          toggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Cerrar otros dropdowns abiertos en móvil
            if (isMobile) {
              dropdowns.forEach(otherDropdown => {
                if (otherDropdown !== dropdown) {
                  otherDropdown.querySelector('.dropdown-menu')?.classList.remove('show');
                  otherDropdown.classList.remove('active');
                }
              });
            }

            menu.classList.toggle('show');
            dropdown.classList.toggle('active');
          });

          // Soporte para teclado
          toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              menu.classList.toggle('show');
              dropdown.classList.toggle('active');
            }
          });
        }
      });

      // Cerrar dropdowns al hacer click fuera
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown')) {
          dropdowns.forEach(dropdown => {
            dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
            dropdown.classList.remove('active');
          });
        }
      });

      // Manejar cambios de tamaño de ventana
      window.addEventListener('resize', () => {
        const isNowMobile = window.innerWidth <= 768;
        if (isNowMobile !== isMobile) {
          dropdowns.forEach(dropdown => {
            dropdown.querySelector('.dropdown-menu')?.classList.remove('show');
            dropdown.classList.remove('active');
          });
        }
      });
    }

    setActiveLink();
    initMobileMenu();
    initDropdowns();
  }

  async function includeHTML() {
    try {
      const includes = document.getElementsByTagName('include');
      console.log('Número total de includes encontrados:', includes.length);
      const includesArray = Array.from(includes);
      console.log('Includes encontrados:', includesArray.map(inc => ({
        src: inc.getAttribute('src'),
        html: inc.outerHTML,
        position: inc.getBoundingClientRect()
      })));

      if (!includes || includes.length === 0) {
        console.log('No se encontraron elementos include');
        return;
      }

      const getBasePath = () => {
        const path = window.location.pathname;
        console.log('Pathname actual:', path);
        return path.includes('/pages/') ? '../assets/components/' : 'assets/components/';
      };

      // Procesamos todos los includes antes de empezar a modificar el DOM
      const includesData = includesArray.map(include => ({
        element: include,
        file: include.getAttribute('src')?.trim(),
        position: document.body.contains(include) ? 'en el DOM' : 'fuera del DOM'
      }));
      console.log('Datos de todos los includes:', includesData);

      for (let i = 0; i < includesData.length; i++) {
        const { element: include, file } = includesData[i];
        console.log(`Procesando include ${i + 1} de ${includesData.length}:`, file);

        if (!include || !file) {
          console.log(`Include ${i + 1} no válido:`, { include, file });
          continue;
        }

        const basePath = getBasePath();
        const fullPath = `${basePath}${file}`.replace(/\s+/g, '').replace(/\/+/g, '/');

        try {
          console.log(`Iniciando fetch para ${file}`);
          const response = await fetch(fullPath);
          console.log(`Respuesta de fetch para ${file}:`, response.status);

          if (response.ok) {
            const text = await response.text();
            console.log(`Contenido cargado para ${file}`, {
              primeros100: text.substring(0, 100),
              longitud: text.length
            });

            // Verificamos el estado del include antes de insertar
            console.log(`Estado del include ${file} antes de insertar:`, {
              enDOM: document.body.contains(include),
              padre: include.parentNode?.tagName,
              siguiente: include.nextSibling?.tagName
            });

            include.insertAdjacentHTML('beforebegin', text);
            console.log(`✅ Contenido insertado para ${file}`);

            if (file === 'header.html') {
              console.log('Ejecutando scripts del header');
              executeHeaderScripts();
            } else if (file === 'footer.html') {
              console.log('Footer procesado correctamente');
              // Añadir esta función para actualizar el año
              setTimeout(() => {
                const yearElement = document.querySelector('.current-year');
                if (yearElement) {
                  yearElement.textContent = new Date().getFullYear();
                  console.log('Año actualizado correctamente');
                } else {
                  console.log('No se encontró el elemento del año');
                }
              }, 0);
            }

            // Verificamos nuevamente antes de eliminar
            if (include.parentNode) {
              console.log(`Eliminando include ${file}`);
              include.parentNode.removeChild(include);
              console.log(`Include ${file} eliminado`);
            } else {
              console.log(`No se puede eliminar ${file}, no tiene padre`);
            }
          } else {
            console.error(`Error ${response.status} al cargar ${file}`);
          }
        } catch (error) {
          console.error(`Error procesando ${file}:`, error);
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


// Cargar banner de cookies automáticamente
(function cargarBannerCookies() {
  // Usar la misma lógica de rutas que el sistema de includes
  const getBasePath = () => {
    const path = window.location.pathname;
    console.log('Pathname para cookies:', path);
    return path.includes('/pages/') ? '../assets/components/' : 'assets/components/';
  };

  const basePath = getBasePath();
  const banner_url = `${basePath}cookie-banner.html`;

  console.log('Intentando cargar banner desde:', banner_url);

  fetch(banner_url)
    .then(r => {
      console.log('Respuesta banner cookies:', r.status);
      return r.text();
    })
    .then(html => {
      console.log('Banner HTML cargado:', html.substring(0, 50) + '...');
      const temp = document.createElement('div');
      temp.innerHTML = html;
      document.body.appendChild(temp.firstElementChild);

      // Cargar script de consentimiento
      const s = document.createElement('script');
      s.src = './assets/js/cookie-consent.js';
      s.onload = () => console.log('Script cookie-consent cargado');
      document.body.appendChild(s);
    })
    .catch(err => console.error('Error cargando banner cookies:', err));
})();