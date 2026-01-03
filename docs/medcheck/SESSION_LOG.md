# MedCheck - Log de Desarrollo

> Registro persistente de sesiones de desarrollo con IA

---

## 2026-01-03 - Motor de Equivalencias Mejorado

### Problema Detectado
El campo `dosis` de la API CIMA tiene valores heterogéneos que causaban un listado enorme en filtros:
- `"37,5 mg/325 mg"`, `"325/37.5 mg"`, `"37.5 MG TRAMADOL + 325 MG PARACETAMOL"`

### Solución Implementada

#### 1. Normalización de Dosis
```javascript
normalizeDosis("37,5 mg/325 mg") → "37.5/325 mg"
normalizeDosis("325 MG PARACETAMOL") → "325 mg"
```
- Extrae solo números con regex `/[\d]+[,.]?[\d]*/g`
- Normaliza separador decimal `,` → `.`
- Detecta unidad (mg, g, ml, mcg, ui)

#### 2. Agrupación por Dosis
- Resultados agrupados en `doseGroups{}`
- Ordenados numéricamente ascendente
- Header visual por grupo con contador de opciones

#### 3. Filtros Dinámicos
| Filtro | Fuente | Aplicación |
|--------|--------|------------|
| Dosis | `doseGroups` keys | Oculta/muestra grupos |
| Forma | `formaFarmaceuticaSimplificada` | Filtra cards dentro de grupo |
| Solo EFG | `generico` | Checkbox toggle |

#### 4. Nueva Función `renderAlternativeCard()`
```javascript
renderAlternativeCard(med, isAvailable) → HTML
// data-nregistro, data-forma, data-generico para filtrado
```

### Campos API Útiles Descubiertos
- `formaFarmaceuticaSimplificada.nombre` - "CAPSULA", "COMPRIMIDO"
- `labtitular` / `labcomercializador` - Laboratorio
- `vtm.nombre` - Principio activo normalizado
- `dosis` - Requiere normalización

### Archivos Modificados
- `assets/js/cima-app.js` - Líneas ~4265-4485

---

## 2026-01-02 - Sesión de Análisis y Mejoras

### Análisis Realizado
- Revisión de `CIMA_Proyecto_Especificacion_Completa.md` (877 líneas, 63 funcionalidades propuestas)
- Comparación con código actual (~7000 líneas entre cima-api.js y cima-app.js)
- **Resultado**: ~45% de funcionalidades sin IA ya implementadas, 0% de funcionalidades con IA

### Mejoras Identificadas (Quick Wins)

#### 1. Notas de Seguridad (ID 2.1.1-2.1.2) ✅ Completado
- **Qué**: Mostrar alertas oficiales de la AEMPS cuando existen para un medicamento
- **Endpoints**: `GET /notas/{nregistro}`, `GET /materiales/{nregistro}`
- **UI**: Badge en tarjeta + Tab "Alertas AEMPS" en modal
- **Impacto**: 🔴 CRÍTICO - alertas de seguridad que hoy sí se muestran
- **Verificado**: Talidomida, Isotretinoína, Ácido Valproico (hasta 4 notas)

#### 2. Alternativas a Desabastecimiento (ID 4.1.1-4.1.2) ✅ Completado
- **Qué**: Cuando hay `psum=true`, ofrecer alternativas comercializadas con mismo ATC
- **Lógica**: `searchByATC(atcCode, { comerc: 1 })` + filtrar `psum=false`
- **UI**: Badge clickable → modal con lista de alternativas
- **Impacto**: 🔴 CRÍTICO - resuelve problema diario en consulta
- **Verificado**: Trankimazin (65 disponibles, 3 sin stock)

### Backlog IA (Próximas Sesiones)
1. **Extractor Estructurado** (1.2.2) - HTML FT → JSON con Gemini
2. **Verificador Prescripción** (3.2.1) - Contexto paciente + semáforo
3. **Detector RAM Inverso** (2.2.1) - Síntoma → medicamento causante

### Bugs Pendientes
- Daflon sin posología (sección 4.2 vacía/formato inesperado)
- Clozapina-todacitan sin interacción
- Salbutamol sin alerta embarazo
- Memantina sin alerta IR

---

*Este log se actualiza en cada sesión de desarrollo*

