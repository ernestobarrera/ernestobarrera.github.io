# ernestobarrera.github.io — Contexto para Claude Code

## Proyecto principal: MedCheck

Herramienta clínica web para médicos de familia. Verifica seguridad, equivalencias y alertas de medicamentos consultando la **API REST de CIMA (AEMPS)** en tiempo real.

- **URL pública**: `https://ernestobarrera.github.io/medcheck.html`
- **Página analytics**: `analytics.html`
- **Proxy Cloudflare Worker**: `https://medcheck-proxy.medtools.workers.dev`

## Arquitectura

| Archivo | Clase | Responsabilidad |
|---|---|---|
| `medcheck.html` | — | Shell HTML de la app |
| `assets/js/cima-api.js` | `CimaAPI` | Cliente API, ontología ATC, caché, búsqueda |
| `assets/js/cima-app.js` | `MedCheckApp` | Controlador UI, renderizado, navegación |
| `assets/js/utils.js` | — | Utilidades compartidas |
| `workers/` | — | Código Cloudflare Workers (proxy CORS) |

## Sistema de búsqueda ATC (crítico)

- Búsqueda híbrida: diccionario clínico (~25 síndromes multi-ATC) + caché ATC de CIMA
- Caché en `localStorage` con TTL 24h (`medcheck_atc_cache`)
- Fallback estático: ~60 grupos terapéuticos en `CimaAPI.STATIC_ATC_FALLBACK`
- Mínimo **4 caracteres** para matching parcial (regla antifalsos positivos — no bajar de 4)
- Normalización obligatoria: lowercase + quitar acentos en toda la cadena de búsqueda
- Autocomplete UI: `showIndicationAutocomplete()` en `cima-app.js` (~línea 1611)

## Convenciones de código

- Vanilla JS ES6+, sin jQuery, sin frameworks
- `const`/`let`, nunca `var`
- Manipulación DOM con `querySelector`/`querySelectorAll`
- Sin TypeScript — JS puro con JSDoc donde sea necesario
- Indentación: 2 espacios
- No inline styles; usar clases CSS

## Contexto clínico (importante para decisiones de diseño)

- Usuario final: médico de familia en España
- Fuente de datos: AEMPS/CIMA (oficial, normativa española)
- Estado: BETA — disclaimer legal visible obligatorio
- Principio de seguridad: "Siempre Revisar, Nunca Asumir" (implementado en sesión 13)
- Las interacciones solo detectan menciones textuales en ficha técnica (limitación conocida)

## Documentación de referencia

- API completa: @docs/MEDCHECK_API.md
- Historial de cambios por sesión: @docs/medcheck/CHANGELOG.md
- Log de sesión actual: @docs/medcheck/SESSION_LOG.md

## Sesiones de desarrollo

El proyecto se desarrolla por sesiones numeradas. Cada sesión tiene entradas en CHANGELOG.md.
Sesión más reciente: **Sesión 15** (2026-01-04) — layout móvil de tarjetas.

## Despliegue del Worker

El Worker (`workers/cima-proxy/index.js`) se despliega manualmente desde el dashboard:
Cloudflare → Workers & Pages → cima-proxy → **Edit Code** → pegar contenido → **Deploy**
No hay wrangler.toml ni CLI configurado.

## Lo que NO tocar sin confirmar

- Lógica del proxy Cloudflare (rompe CORS en producción)
- Umbral de 4 caracteres en matching parcial (bug conocido si se baja)
- Motor de seguridad clínica (`review`/`warning`/`danger`) — cambios requieren validación clínica
