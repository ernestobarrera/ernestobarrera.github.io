/*==
banner cookies  
==*/

document.addEventListener('DOMContentLoaded', function () {
  const CONSENT_KEY = 'cookie_consent';
  const banner = document.getElementById('banner_cookies');

  if (!banner) return;

  function cargar_analytics() {
    const script = document.createElement('script');
    script.src = 'https://www.googletagmanager.com/gtag/js?id=G-YFKR6RB1ZC';
    document.head.appendChild(script);
    script.onload = function () {
      window.dataLayer = window.dataLayer || [];
      function gtag() { dataLayer.push(arguments); }
      gtag('js', new Date());
      gtag('config', 'G-YFKR6RB1ZC');
    };
  }

  const guardado = localStorage.getItem(CONSENT_KEY);

  if (guardado === 'aceptado') {
    banner.remove();
    cargar_analytics();
    return;
  }
  if (guardado === 'rechazado') {
    banner.remove();
    return;
  }

  // Si llegamos aquí, mostrar el banner suavemente
  setTimeout(() => {
    banner.classList.add('show');
  }, 100);



  document.getElementById('btn_cookies_aceptar')
    .addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'aceptado');
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 300);
      cargar_analytics();
    });

  document.getElementById('btn_cookies_rechazar')
    .addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'rechazado');
      banner.classList.remove('show');
      setTimeout(() => banner.remove(), 300);
    });
});