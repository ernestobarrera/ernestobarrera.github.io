# Documentación de Filtros PubMed

## Estructura del Archivo

### 1. Formato Base

```plaintext
Filtro: [NOMBRE]
Autor revisión: @ernestobarrera
Fecha: DD-MM-YYYY
Descripción: [DESCRIPCIÓN]
Referencia completa: [REFERENCIA]
URL: [URL]

[CONTENIDO DEL FILTRO]

@@@FILTER_METADATA@@@
[JSON METADATA]
```

### 2. Tipos de Metadata

#### 2.1 Filtro Simple

```json
{
  "validation": {
    "metrics": {
      "sensitivity": 00.0,
      "specificity": 00.0,
"precision":
    },
    "reference": "Autor et al. JOURNAL YEAR"
  }
}
```

#### 2.2 Filtro Sensible/Específico

```json
{
  "validation": {
    "metrics": {
      "sensitive": {
        "sensitivity": 00.0,
        "specificity": 00.0,
"precision":
      },
      "specific": {
        "sensitivity": 00.0,
        "specificity": 00.0,
"precision":
      }
    },
    "reference": "Autor et al. JOURNAL YEAR"
  }
}
```

#### 2.3 Filtro Sin Métricas

```json
{
  "validation": {
    "reference": "Autor et al. JOURNAL YEAR"
  }
}
```

## Tooltips

### Configuración Principal

```javascript
tippy(button, {
  content: filterTooltips[id],
  placement: "top",
  arrow: true,
  theme: "custom",
  animation: "shift-away",
  delay: [200, 0],
  maxWidth: 400,
  allowHTML: true,
  trigger: "mouseenter",
  onShow(instance) {
    return infoModeActive;
  },
});
```

### Función de Formateo

```javascript
function formatTooltipContent(metadata) {
  const parts = [];

  if (metadata.validation?.metrics) {
    if ("sensitive" in metadata.validation.metrics) {
      parts.push("<strong>Versión Sensible:</strong>");
      parts.push(
        `<strong>Sens:</strong> ${metadata.validation.metrics.sensitive.sensitivity}% • <strong>Esp:</strong> ${metadata.validation.metrics.sensitive.specificity}%`
      );
      parts.push("<strong>Versión Específica:</strong>");
      parts.push(
        `<strong>Sens:</strong> ${metadata.validation.metrics.specific.sensitivity}% • <strong>Esp:</strong> ${metadata.validation.metrics.specific.specificity}%`
      );
    } else {
      parts.push(
        `<strong>Sens:</strong> ${metadata.validation.metrics.sensitivity}% • <strong>Esp:</strong> ${metadata.validation.metrics.specificity}%`
      );
    }
  }

  if (metadata.validation?.reference) {
    parts.push(`\n<strong>Fuente:</strong> ${metadata.validation.reference}`);
  }

  return parts.join("\n");
}
```

### Estilos CSS

```css
.tippy-box[data-theme~="custom"] {
  background-color: var(--card-bg, #2a3b4d) !important;
  border: 1px solid var(--accent-color, #ffd700) !important;
  color: var(--text-primary, #fff) !important;
  font-size: 0.85rem !important;
  max-width: 400px !important;
  z-index: 9999 !important;
}

.tippy-box[data-theme~="custom"] .tippy-content {
  white-space: pre-line !important;
  line-height: 1.5 !important;
  padding: 0.75rem 1rem !important;
}
```

## Lista de Verificación

### Nuevo Filtro

- [ ] Estructura base completa
- [ ] JSON metadata válido
- [ ] Métricas verificadas con fuente
- [ ] Tooltip formateado correctamente

### Actualización

- [ ] Mantener estructura existente
- [ ] Actualizar solo valores necesarios
- [ ] Verificar tooltip tras cambios
- [ ] Documentar cambios en historial

## Notas Importantes

1. No incluir precisión si no está documentada en la fuente
2. Usar HTML para formateo en tooltips (no markdown)
3. Mantener consistencia en referencias bibliográficas
4. Verificar funcionamiento con el modo info activado
5. Pueden omitirse secciones, como precisión o métricas si no existen
