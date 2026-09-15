# scripts/baselines — líneas base de auditoría

**No son datos de la app.** El navegador no descarga nada de aquí: lo leen los scripts de auditoría
(`medcheck-audit-*`) y los bancos de prueba. Estaban en `assets/data/`, que es lo que GitHub Pages
sirve como datos del producto, y esa mezcla hacía pasar por dato público lo que es andamio interno.

| fichero | qué gobierna | quién lo lee |
|---|---|---|
| `substance-identity-baseline.json` | candidatos de identidad de sustancia (no traducciones autorizadas: promoverlas es decisión humana) | `medcheck-compile-identity`, `medcheck-audit-identity`, `medcheck-test-identidad` |
| `reconcile-baseline.json` | memoria de GAPs de reconciliación ya revisados | `medcheck-audit-ontology`, `medcheck-audit-identity`, `medcheck-test-perimetro` |
| `broad-watch-baseline.json` | vigilancia de los prefijos ATC declarados `broad` en la ontología | `medcheck-audit-ontology` |

Se versionan a propósito: un baseline sin historial no distingue «revisado y aceptado» de «nunca
se miró». Cada uno lleva su contrato dentro, en `_doc`.

**Los identificadores SNOMED CT (SCTID) no se publican** en el baseline de identidad: SNOMED tiene
régimen de licencia propio. El compilador los toma de CIMA en cada pasada, así que el método sigue
siendo reproducible sin ellos.
