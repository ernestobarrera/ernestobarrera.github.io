# Buscador PubMed con Filtros Estructurados

## Descripción General

Esta herramienta optimiza las búsquedas bibliográficas en PubMed mediante filtros predefinidos, construyendo automáticamente estrategias con términos MeSH y operadores booleanos para obtener resultados precisos y reproducibles.

## Instrucciones Rápidas

1. **Escriba su búsqueda**

   - Use términos MeSH para mayor precisión
   - Consulte el [Buscador MeSH](https://www.ncbi.nlm.nih.gov/mesh) para encontrar términos adecuados

2. **Seleccione filtros**

   - Metodológicos: Tipo de estudio (Meta-análisis, GPC)
   - Clínicos: Enfoque médico (Diagnóstico, Tratamiento)
   - Ámbito: Contexto/población (AP, Geriatría)

3. **Configure búsqueda**

   - **Operador entre filtros:**
     - OR: Amplía (encuentra cualquiera)
     - AND: Restringe (encuentra todos)
   - **Modo S/E en filtros aplicables:**
     - S (Sensible): Más resultados
     - E (Específico): Más precisión
   - **Temporalidad:** 7 días, 30 días, 6 meses, 1 año, 5 años
   - **Ordenación:** Por fecha o Relevancia

4. **Revise y ejecute**
   - Verifique la query generada
   - Pulse "Buscar en PubMed"

## Ejemplo Práctico

Búsqueda "diabetes treatment":

- Con Meta-análisis + GPC:
  - OR → encuentra ambos tipos por separado
  - AND → solo documentos que cumplan ambas condiciones

## Ventajas

- Filtros predefinidos validados
- Construcción automática de estrategias
- Visualización en tiempo real
- Modos sensible/específico
- Integración PubMed
