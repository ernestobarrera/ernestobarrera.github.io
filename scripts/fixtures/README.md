# Fixture de menciones de ficha técnica

`medcheck-menciones-ft.json` contiene 48 respuestas públicas de secciones CIMA, capturadas el 22/09/2026, y el resultado esperado para 72 combinaciones de medicamento y contexto. Las respuestas proceden del corpus congelado en `en-construccion/medcheck-comparativa-menciones/fuentes/`; el generador local `_scripts/preparar_fixture_ci.mjs` comprueba antes sus tamaños y SHA-256 contra `manifest.json`. Las expectativas proceden de `comparar.py`, auditado por separado con 748/748 comprobaciones. No se generan ejecutando `cima-api.js`.

El banco `scripts/medcheck-test-menciones-ft.mjs` carga esta fixture sin red ni paquetes npm y ejecuta el `analyzeSafety` real con un `DOMParser` mínimo inyectado. Así prueba el camino de navegador que los bancos antiguos de `excerpt` no ejercitan.
