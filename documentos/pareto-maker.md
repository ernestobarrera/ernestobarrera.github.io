iniciado, pero la aplicación no funciona. Aquí está la funcionante construida con estas especificaciones:
https://claude.site/artifacts/91ad93e7-65e2-4cc4-9dd9-fc6b1c5936ad

# Especificación Funcional: Aplicación Web para Análisis de Pareto

## Objetivo

Desarrollar una aplicación web que permita a los usuarios realizar análisis de Pareto (regla 80/20) a partir de datos tabulados, visualizando los resultados tanto gráfica como numéricamente.

## Requisitos Funcionales

### Entrada de Datos

1. La aplicación debe aceptar datos en formato tabular con dos columnas:
   - Primera columna: categorías (texto)
   - Segunda columna: valores numéricos
2. Debe soportar:
   - Separación por tabuladores
   - Encabezados opcionales
   - Valores numéricos con punto o coma decimal
   - Valores con o sin separadores de miles
   - Mínimo 2 filas de datos
   - Sin límite máximo de filas

### Procesamiento

1. Ordenación automática de datos por valor (descendente)
2. Cálculos requeridos:
   - Porcentaje individual de cada valor
   - Porcentaje acumulado
   - Identificación de elementos significativos según punto de corte
3. Punto de corte configurable (valor predeterminado: 80%)

### Visualización

1. Gráfico combinado que muestre:

   - Barras para valores individuales
   - Línea para porcentaje acumulado
   - Línea de referencia en el punto de corte
   - Diferenciación visual entre elementos significativos y no significativos
   - Etiquetas legibles en ejes
   - Tooltip informativo al pasar el cursor

2. Tabla de resultados que incluya:
   - Número de orden
   - Categoría
   - Valor absoluto
   - Porcentaje individual
   - Porcentaje acumulado
   - Diferenciación visual según significancia

### Resumen Estadístico

Mostrar:

- Total de elementos analizados
- Número de elementos significativos
- Suma total de valores
- Suma de valores significativos
- Interpretación automática de resultados

## Requisitos No Funcionales

### Usabilidad

- Interfaz intuitiva sin necesidad de manual
- Instrucciones claras y visibles
- Retroalimentación inmediata al procesar datos
- Mensajes de error comprensibles
- Adaptable a diferentes tipos de datos sin configuración

### Rendimiento

- Procesamiento instantáneo hasta 1000 filas
- Respuesta fluida hasta 5000 filas
- Visualización clara independiente del volumen de datos

### Técnicos

- Aplicación web client-side (sin backend)
- Compatible con navegadores modernos
- Responsiva (móvil y escritorio)
- Sin dependencia de servicios externos

## Casos de Uso

### Ejemplo de Datos de Entrada

```
Categoría    Valor
A    9711.5
B    8558.0
C    6412.3
```

### Validaciones Requeridas

- Datos numéricos válidos
- Mínimo de filas necesario
- Formato de entrada correcto
- Manejo de valores faltantes o erróneos

## Consideraciones de Diseño

- Esquema de colores accesible y significativo
- Tipografía legible
- Espaciado adecuado entre elementos
- Controles intuitivos
- Área de visualización maximizada

## Entregables Esperados

1. Aplicación web funcional
2. Código fuente documentado
3. Pruebas unitarias
4. Manual de implementación
5. Guía de mantenimiento

## Criterios de Aceptación

1. Procesa correctamente todos los formatos de entrada especificados
2. Visualización clara y correcta de resultados
3. Funcionamiento fluido con volúmenes grandes de datos
4. Interfaz intuitiva y responsiva
5. Sin errores en cálculos estadísticos
6. Exportación correcta de resultados

## Restricciones

- No requiere autenticación
- No almacena datos del usuario
- Funciona completamente en el navegador
- No requiere instalación

Este documento proporciona las bases para el desarrollo, permitiendo flexibilidad en la implementación mientras asegura la funcionalidad requerida.
