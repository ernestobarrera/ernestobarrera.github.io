# MedCheck - Changelog

Historial de cambios por sesión de desarrollo.

---

## [Sesión 14] - 2026-01-03

### Añadido
- **Sistema de autocompletado híbrido** - combina diccionario clínico (~25 síndromes multi-ATC) + nombres ATC del catálogo
- **Catálogo ATC estático de emergencia** (~60 grupos terapéuticos) como fallback cuando la API falla
- **Cache ATC en localStorage** - persistencia 24h para evitar recargas
- **Agrupación por ATC** en resultados de indicaciones (nueva opción "Agrupar ATC")
- Nuevas categorías: Dermatología (D10 antiacneicos), Ginecología (G01A vaginales), Oftalmología (S01), Urología (G04)
- Badges diferenciadores en autocomplete: azul (ATC) vs verde (Clínico)

### Corregido
- **Bug crítico**: chip "Ansiolíticos" devolvía resultados de IC porque "ansioliticos".includes("ic") era true
- Matching de sinónimos cortos (<4 chars) ahora requiere coincidencia exacta
- Dropdown de autocompletado no aparecía (movido dentro del wrapper con position:relative)
- Normalización de acentos consistente en toda la cadena de búsqueda

### Cambiado
- Quick chips actualizados: solo términos que funcionan con el sistema híbrido
- ATC como groupBy por defecto para resultados de indicación (antes era activeIngredient)

---


## [Sesión 13] - 2025-12-29

### Añadido
- **Nuevo estado de seguridad `review`** - cuando un contexto clínico está activo y no se detectan keywords específicos, el sistema ahora muestra "Revisar sección completa" en lugar de ocultar la alerta
- Estilos CSS para estados `review` (azul primario) y `unknown` (gris)

### Cambiado  
- **Motor de seguridad rediseñado** con principio "Siempre Revisar, Nunca Asumir"
  - Cuando toggle activo (Embarazo, Renal, etc.), SIEMPRE se muestra la sección correspondiente
  - Keywords solo determinan severidad (warning/danger), nunca si mostrar o no
  - Elimina falsos negativos clínicos
- Preview de secciones ampliado a 400 caracteres para más contexto

### Documentado
- Limitación conocida: interacciones solo detectan menciones textuales en FT (ej: clozapina-todacitan no aparece porque FT no lo menciona)

---


## [Sesión 12] - 2025-12-29

### Añadido
- Estructura canónica de documentación en `docs/medcheck/`
- `QUICKSTART.md` con prompt diario y plantilla para nuevos proyectos
- `ARCHITECTURE.md` con referencia técnica para el agente
- `ROADMAP.md` con backlog de tareas
- Subcategorías ATC N07: N07A, N07B (N07BA/BB/BC), N07C, N07X
- Indicaciones: tabaquismo, adicciones, alcoholismo, dependencia opioides
- `tamanioPagina: 100` en `searchByATC()` para más resultados
- **Derivación dinámica de subcategorías ATC** - extrae subcódigos de los resultados de búsqueda cuando no hay datos estáticos
- Version busting (`?v=20241229a`) para evitar problemas de caché

### Cambiado
- Migrado contenido de `docs/cima/` a `docs/medcheck/`
- Actualizado `medcheck-session.md` para leer docs automáticamente

---

## [Sesión 11] - 2024-12-22

### Añadido
- Pestaña Posología (sección 4.2) con highlights
  - Amarillo: palabras relacionadas con alimentos
  - Azul: palabras relacionadas con horarios
- Exploración documentada de integración IA (Gemini, OpenAI)

---

## [Sesión 10] - 2025-12-19

### Añadido
- Cloudflare Worker propio: `medcheck-proxy.medtools.workers.dev`
- Límite: 100,000 peticiones/día (plan gratuito)

---

## [Sesión 8] - 2025-12-18

### Añadido
- Detective de Síntomas (sección 4.8)
- Aviso Legal modal bloqueante
- Insignias: Vigilancia, Huérfano, preparadas Biológico/Estupefaciente/Económico

---

## [Sesión 7] - 2025-12-17

### Añadido
- Verificador de Interacciones (sección 4.5)
- Multi-drug input con chips removibles
- I.Renal como toggle (reemplaza input numérico FG)

---

## [Sesión 6] - 2025-12-16

### Añadido
- Layout dos columnas en Indicaciones
- Diccionario multi-ATC (100+ términos)
- Paginación "Cargar más" (50 resultados)

### Corregido
- Equivalencias reescritas (sin "undefined")
- Botón Volver en navegación ATC

---

## [Sesión 5] - 2025-12-16

### Añadido
- Subcategorías nivel 5 (+30 códigos en M, R, D, G, S)
- Footer con versión ATC y estado API

---

## [Sesión 4] - 2025-12-16

### Añadido
- Navegación ATC granular hasta nivel 5
- Búsqueda recursiva en `findStaticATCCategory()`
- Parada automática en subgrupo químico

---

## [Sesiones 1-3]

### Implementado
- Panel de contexto del paciente
- Búsqueda inteligente con detección de tipo
- Modal de detalles con pestañas
- Verificador de Seguridad
- Buscador de Equivalencias
- Dashboard de Suministro
