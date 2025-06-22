/*==
cookie-consent.js
Script con timing arreglado para funcionar con include.js
==*/

console.log('🍪 Cookie Consent: Iniciando script');

const CONSENT_KEY = 'cookie_consent';
let bannerYaInicializado = false;

// Función para cargar analytics de forma segura
function cargarAnalyticsSeguro() {
  try {
    if (window.gtag) {
      console.log('🍪 Analytics ya está cargado');
      return;
    }

    console.log('🍪 Cargando Google Analytics...');
    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-YFKR6RB1ZC';
    script.async = true;
    document.head.appendChild(script);

    script.onload = function () {
      console.log('🍪 Script GA cargado, inicializando...');
      window.dataLayer = window.dataLayer || [];
      function gtag() { dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('config', 'G-YFKR6RB1ZC');
      console.log('🍪 Analytics configurado correctamente');
    };
  } catch (error) {
    console.error('🍪 Error en cargarAnalyticsSeguro:', error);
  }
}

// Función principal para inicializar el banner
function inicializarBanner() {
  if (bannerYaInicializado) {
    console.log('🍪 Banner ya inicializado, saltando...');
    return;
  }

  const banner = document.getElementById('banner_cookies');
  if (!banner) {
    console.log('🍪 Banner aún no está en el DOM, reintentando...');
    return false;
  }

  console.log('🍪 ✅ Banner encontrado, inicializando...');
  bannerYaInicializado = true;

  const guardado = localStorage.getItem(CONSENT_KEY);
  console.log('🍪 Estado localStorage:', guardado);

  if (guardado === 'aceptado') {
    console.log('🍪 Consentimiento ya aceptado, cargando analytics');
    cargarAnalyticsSeguro();
    return true;
  }

  if (guardado === 'rechazado') {
    console.log('🍪 Consentimiento ya rechazado');
    return true;
  }

  // No hay consentimiento previo, mostrar banner
  console.log('🍪 Mostrando banner...');
  banner.classList.add('show');

  // Buscar botones
  const btnAceptar = document.getElementById('btn_cookies_aceptar');
  const btnRechazar = document.getElementById('btn_cookies_rechazar');

  if (!btnAceptar || !btnRechazar) {
    console.error('🍪 ❌ Botones del banner no encontrados');
    return false;
  }

  console.log('🍪 Agregando event listeners a botones');

  // Event listener para aceptar
  btnAceptar.addEventListener('click', () => {
    console.log('🍪 Usuario aceptó cookies');
    localStorage.setItem(CONSENT_KEY, 'aceptado');
    banner.classList.remove('show');
    banner.addEventListener('transitionend', () => {
      console.log('🍪 Banner eliminado tras aceptar');
      banner.remove();
    }, { once: true });
    cargarAnalyticsSeguro();
  });

  // Event listener para rechazar
  btnRechazar.addEventListener('click', () => {
    console.log('🍪 Usuario rechazó cookies');
    localStorage.setItem(CONSENT_KEY, 'rechazado');
    banner.classList.remove('show');
    banner.addEventListener('transitionend', () => {
      console.log('🍪 Banner eliminado tras rechazar');
      banner.remove();
    }, { once: true });
  });

  return true;
}

// Función para intentar inicializar con reintentos
function intentarInicializar() {
  console.log('🍪 Intentando inicializar banner...');

  if (inicializarBanner()) {
    console.log('🍪 ✅ Banner inicializado exitosamente');
    return;
  }

  // Si no funcionó, reintentar varias veces
  let intentos = 0;
  const maxIntentos = 10;
  const intervalo = setInterval(() => {
    intentos++;
    console.log(`🍪 Reintento ${intentos}/${maxIntentos}`);

    if (inicializarBanner()) {
      console.log('🍪 ✅ Banner inicializado en reintento', intentos);
      clearInterval(intervalo);
    } else if (intentos >= maxIntentos) {
      console.error('🍪 ❌ No se pudo inicializar el banner después de', maxIntentos, 'intentos');
      clearInterval(intervalo);
    }
  }, 100); // Reintentar cada 100ms
}

// Verificar estado inmediatamente para casos donde ya hay consentimiento
const guardadoInicial = localStorage.getItem(CONSENT_KEY);
console.log('🍪 Estado inicial:', guardadoInicial);

if (guardadoInicial === 'aceptado') {
  console.log('🍪 Consentimiento previo aceptado, cargando analytics inmediatamente');
  cargarAnalyticsSeguro();

  // Agregar CSS para ocultar banner por si aparece
  const style = document.createElement('style');
  style.textContent = '.cookie-banner { display: none !important; }';
  style.id = 'cookie-consent-hide';
  document.head.appendChild(style);
} else if (guardadoInicial === 'rechazado') {
  console.log('🍪 Consentimiento previo rechazado, ocultando banner');

  // Agregar CSS para ocultar banner
  const style = document.createElement('style');
  style.textContent = '.cookie-banner { display: none !important; }';
  style.id = 'cookie-consent-hide';
  document.head.appendChild(style);
}

// Estrategia múltiple para capturar cuando el DOM esté listo
if (document.readyState === 'loading') {
  console.log('🍪 DOM aún cargando, esperando DOMContentLoaded...');
  document.addEventListener('DOMContentLoaded', intentarInicializar);
} else {
  console.log('🍪 DOM ya está listo, inicializando inmediatamente...');
  // Pequeña pausa para que include.js termine de insertar contenido
  setTimeout(intentarInicializar, 50);
}