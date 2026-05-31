# assets/data — datos derivados de MedCheck

Datos estáticos versionados que enriquecen la app. Patrón ETL: **fuente cruda → script determinista → JSON generado**. Los JSON no se editan a mano; se regeneran.

## eml.json — WHO Essential Medicines List

Capa de enriquecimiento de favoritos: marca si un fármaco está en la Lista Modelo de Medicamentos Esenciales de la OMS y con qué indicación/sección.

| Pieza | Rol | ¿Editar a mano? |
|---|---|---|
| `eml_export.csv` | Fuente cruda oficial (entrada inmutable) | No. Se reemplaza entero por una edición nueva. |
| `../../scripts/build-eml-essentials.js` | Transformación (parser, filtra `Added`, dedup, índice `byAtc`, centinelas) | Sí (es código versionado) |
| `eml.json` | Artefacto generado que consume la app | **No.** Se regenera. |

### Regenerar

```bash
node scripts/build-eml-essentials.js
```

El script **aborta sin escribir** (exit 1) si fallan los centinelas de integridad (esenciales conocidos con su ATC esperado, o <400 fármacos → CSV truncado). Así un CSV corrupto nunca degrada el `eml.json` bueno.

### Refresco (mantenimiento)

La eEML se actualiza ~cada 2 años. Para subir a una edición nueva:

1. Descargar el export de <https://list.essentialmeds.org/> (Excel → Guardar como → CSV UTF-8, separador `;`).
2. Reemplazar `eml_export.csv`.
3. `node scripts/build-eml-essentials.js` → revisar que los contadores y centinelas son razonables.
4. Actualizar `source`/`generated` en `_meta` (lo hace el script salvo la edición, que está hardcodeada en el script: ajustarla).
5. Commit de CSV + JSON juntos.

### Integridad — limitaciones conocidas del dato fuente

- **135 fármacos sin ATC** en la EML (combos y algunos como atorvastatina, metoprolol). El cruce por ATC **no los marca**: el badge sub-reclama, nunca inventa. Aceptado a propósito (mejor omitir que un falso positivo). Si se quisieran rescatar, haría falta una tabla de alias INN→PA curada.
- **23 códigos ATC compartidos por >1 fármaco** (p. ej. isoxazolil-penicilinas bajo `J01CF02`): `byAtc` se queda con uno. Irrelevante para un badge booleano "es esencial".
- Indicaciones y nombres en **inglés** (INN). Mostrar como referencia, no como texto clínico en español.
- `primaryCare` es **heurístico** (por sección EML), orientativo.

### Licencia y atribución (obligatorio)

WHO Model List of Essential Medicines, CC BY-NC-SA 3.0 IGO. Registrada en `eml.json` → `_meta.license`. Obligaciones al usarla en la UI:

- **Atribución** visible a la OMS donde se muestre el dato.
- **NonCommercial**: MedCheck debe seguir sin uso comercial.
- **ShareAlike**: cualquier derivado mantiene la misma licencia.

## materiales-catalog.json

Catálogo curado de materiales docentes. (Sin pipeline ETL; edición manual.)
