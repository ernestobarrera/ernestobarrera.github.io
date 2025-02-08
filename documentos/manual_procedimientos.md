# Manual Definitivo: Gestión de Web con GitHub Pages y VS Code 📚

## 1. Conceptos Básicos y Organización

### 1.1 Estructura del Sistema

- **Ramas (Branches)**

  - `main`: Versión pública de la web
  - `staging`: Versión de desarrollo + documentación

- **Workspaces (Áreas de Trabajo)**
  ```
  .vscode/
  ├── main-workspace.code-workspace     # Área para producción
  └── staging-workspace.code-workspace  # Área para desarrollo
  ```

### 1.2 Estructura de Archivos

```
En staging (desarrollo):
/
├── index.html
├── calculadora1.html
├── assets/
│   ├── css/
│   └── js/
├── .vscode/
│   ├── main-workspace.code-workspace
│   └── staging-workspace.code-workspace
└── documentos/        # Solo existe en staging
    ├── guias/
    └── referencias/

En main (público):
/
├── index.html
├── calculadora1.html
└── assets/
    ├── css/
    └── js/
```

## 2. Configuración del Entorno

### 2.1 Configuración de Workspaces

#### Main Workspace (.vscode/main-workspace.code-workspace):

```json
{
  "folders": [
    {
      "name": "🌐 Web Principal",
      "path": ".."
    }
  ],
  "settings": {
    "liveServer.settings.port": 5501,
    "workbench.colorCustomizations": {
      "titleBar.activeBackground": "#8B2E2E", // Rojo para main
      "titleBar.activeForeground": "#ffffff",
      "activityBar.background": "#471e1e",
      "titleBar.inactiveBackground": "#471e1e"
    }
  }
}
```

#### Staging Workspace (.vscode/staging-workspace.code-workspace):

```json
{
  "folders": [
    {
      "name": "📚 Documentación",
      "path": "../documentos"
    },
    {
      "name": "🌐 Web Principal",
      "path": ".."
    }
  ],
  "settings": {
    "liveServer.settings.port": 5501,
    "workbench.colorCustomizations": {
      "titleBar.activeBackground": "#2E8B57", // Verde para staging
      "titleBar.activeForeground": "#ffffff",
      "activityBar.background": "#1e472e",
      "titleBar.inactiveBackground": "#1e472e"
    }
  }
}
```

### 2.2 Configuración de Git Aliases

```json
// Settings.json
{
  "git.aliases": {
    "publish": "!f() { git checkout main && git checkout staging -- $1 && git commit -m \"Publica: $1\" && git push && git checkout staging && git rm $1 && git commit -m \"Elimina $1 (ya publicado)\" && git push; }; f",
    "save": "!f() { git add . && git commit -m \"backup: $1\" && git push; }; f"
  }
}
```

## 3. Flujos de Trabajo (Workflows)

### 3.1 Método con Dos Ventanas (Recomendado)

1. **Configuración Inicial**

   - Abrir dos ventanas de VS Code (Ctrl+Shift+N)
   - Ventana 1: Abrir main-workspace
   - Ventana 2: Abrir staging-workspace

2. **Ventajas**
   - Ver ambas ramas simultáneamente
   - Comparar cambios fácilmente
   - Identificación visual por colores
   - Sin necesidad de cambiar workspaces

### 3.2 Ejemplos Prácticos

#### Ejemplo 1: Modificar Header

```
1. En ventana STAGING (verde):
   - Modificar header en index.html
   - Probar en localhost
   - Commit y push

2. Cuando esté listo:
   - En ventana MAIN (roja):
   - git publish index.html
   - Verificar en web pública
```

#### Ejemplo 2: Nueva Calculadora

```
1. En ventana STAGING:
   - Crear calculadora-nueva.html
   - Desarrollar y probar
   - Commits frecuentes

2. Al finalizar:
   - En ventana MAIN:
   - git publish calculadora-nueva.html
```

## 4. Gestión de Documentación

### 4.1 Estructura Recomendada

```
documentos/
├── guias/
│   └── manual_procedimientos.md
├── referencias/
└── proyectos/
```

### 4.2 Notas Importantes

- Solo existe en staging
- Hacer commits frecuentes
- No se publica a main

## 5. Solución de Problemas Comunes

### 5.1 Problemas de Workspace

- **Workspace no abre**: Verificar rutas en archivo .code-workspace
- **Colors no cambian**: Recargar VS Code
- **Error de carpeta**: Verificar que estás en la rama correcta

### 5.2 Problemas de Git

- **Error al publicar**: Verificar que archivo existe en staging
- **Cambios no visibles**: Esperar actualización de GitHub Pages
- **Conflictos**: Resolver en staging antes de publicar

## 6. Mejores Prácticas

### 6.1 Organización

- Mantener dos ventanas VS Code abiertas
- Usar colores para identificar ramas
- Documentar en staging
- Probar todo antes de publicar

### 6.2 Desarrollo

- Commits descriptivos
- Backup frecuente
- Pruebas en staging
- Publicar solo cuando esté listo

### 6.3 Seguridad

- Verificar rama antes de cambios
- No forzar push a main
- Mantener respaldos de documentación
- Revisar cambios antes de publicar

## 7. Recordatorios Finales

- Los colores ayudan a identificar el entorno
- Staging es para desarrollo y pruebas
- Main es solo para contenido público
- Usar dos ventanas facilita el trabajo
- Mantener respaldos frecuentes
