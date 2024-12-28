// assets/js/utils.js

/**
* ==============================================
* Módulo: Secciones Expandibles
* ==============================================
* Permite crear secciones expandibles/colapsables que responden a:
* 1. Clics en el título de la sección
* 2. Enlaces con hash (#) en la URL
* 
* CAMBIOS NECESARIOS EN TU HTML:
* 
* 1. Cambiar esto:
*    <section class="category-section">
* 
* 2. Por esto:
*    <section id="nombre-seccion" class="resources-section">
* 
* 3. Ejemplos de IDs según la sección:
*    - id="busqueda-section"
*    - id="calculadoras-section"
* 
* La estructura completa debe ser:
*    <section id="nombre-section" class="resources-section">
*      <h2 class="section-title">Título</h2>
*      <div class="resources-list">
*        <!-- Contenido -->
*      </div>
*    </section>
* 
* USO:
* 1. Añadir el script:
*    <script src="./assets/js/utils.js"></script>
* 
* 2. Los estilos ya están en components.css
* 
* 3. Para enlazar a una sección específica:
*    <a href="pagina.html#busqueda-section">Enlace a búsqueda</a>
* 
* FUNCIONAMIENTO:
* - Al hacer clic en el título, la sección se expande/colapsa
* - Al usar un enlace con hash, la sección se expande automáticamente
* - Las demás secciones se contraen automáticamente
* 
* El módulo se inicializa automáticamente si encuentra
* elementos con la clase .resources-section
*/
const expandableSections = {
  init: function () {
    this.bindEvents();
    this.handleInitialState();
  },

  toggleSection: function (section, expand = false) {
    if (expand) {
      section.classList.remove('collapsed');
    } else {
      section.classList.add('collapsed');
    }
  },

  handleHash: function () {
    const sections = document.querySelectorAll('.resources-section');
    const hash = window.location.hash;

    if (hash) {  // Si hay un hash en la URL
      sections.forEach(section => {
        if (section.id === hash.substring(1)) {  // Si el ID coincide con el hash (quitando el #)
          this.toggleSection(section, true);
          setTimeout(() => {
            section.scrollIntoView({ behavior: 'smooth' });
          }, 100);
        } else {
          this.toggleSection(section);  // Colapsar las demás secciones
        }
      });
    }
  },

  bindEvents: function () {
    window.addEventListener('hashchange', () => this.handleHash());

    document.querySelectorAll('.section-title').forEach(header => {
      header.addEventListener('click', (e) => {
        e.preventDefault();
        const section = header.closest('.resources-section');
        section.classList.toggle('collapsed');
      });
    });
  },

  handleInitialState: function () {
    this.handleHash();
  }
};

// Inicialización de módulos cuando el DOM está listo
document.addEventListener('DOMContentLoaded', () => {
  // Módulos existentes...

  // Inicializar secciones expandibles si existen en la página
  if (document.querySelector('.resources-section')) {
    expandableSections.init();
  }
});