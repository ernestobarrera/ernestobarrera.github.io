# Manual Definitivo: Gestión de Web con GitHub Pages y VS Code 📚

## 1. Conceptos Básicos y Estructura

### 1.1 ¿Qué son las ramas (branches)?

- Son versiones paralelas de tu proyecto
- `main`: versión pública de la web
- `staging`: versión de desarrollo + documentación privada

### 1.2 Estructura de Archivos

```
En staging (desarrollo):
/
├── index.html
├── calculadora1.html
├── calculadora2.html
├── assets/
│   ├── css/
│   └── js/
└── documentos/        # Solo existe en staging
    ├── guias/
    └── referencias/

En main (público):
/
├── index.html
├── calculadora1.html
├── calculadora2.html
└── assets/
    ├── css/
    └── js/
```

### 1.3 Comportamiento de las Ramas

- Los archivos web se mantienen en ambas ramas
- `documentos/` solo existe en staging
- Al cambiar de rama, los archivos se "transforman" automáticamente
- VS Code muestra los archivos de la rama actual

## 2. Configuración Inicial

### 2.1 Instalación Base

1. VS Code: [code.visualstudio.com](https://code.visualstudio.com)
2. Git: [git-scm.com](https://git-scm.com)
3. Cuenta en GitHub: [github.com](https://github.com)

### 2.2 Extensiones VS Code

1. GitHub Pull Requests and Issues
2. GitLens (recomendado)

### 2.3 Configuración de Aliases

```json
// Settings.json (Ctrl/Cmd + Shift + P → "Settings: Open JSON")
{
  "git.aliases": {
    "publish": "!f() { git checkout main && git checkout staging -- $1 && git commit -m \"Publica: $1\" && git push && git checkout staging && git rm $1 && git commit -m \"Elimina $1 (ya publicado)\" && git push; }; f",
    "save": "!f() { git add . && git commit -m \"backup: $1\" && git push; }; f"
  }
}
```

## 3. Trabajo Diario

### 3.1 Método Visual (GUI)

#### Cambiar de Rama

1. Click en rama actual (abajo izquierda)
2. Seleccionar 'staging' o 'main'
3. Los archivos cambiarán automáticamente

#### Guardar Cambios

1. Ctrl/Cmd + Shift + G (Source Control)
2. Click '+' junto a archivos modificados
3. Escribir mensaje descriptivo
4. Click ✓ (Commit)
5. Click ↻ (Sync)

#### Publicar Calculadora

1. Asegurar estar en staging
2. Probar funcionamiento
3. Click derecho → Copy
4. Cambiar a main
5. Pegar archivo
6. Commit y sync
7. Volver a staging (archivo sigue ahí para desarrollo)

### 3.2 Método Comandos

#### Cambiar de Rama

```bash
git checkout staging  # o main
```

#### Guardar Cambios

```bash
git save "descripción del cambio"
```

#### Publicar Calculadora

```bash
git publish calculadora.html
```

## 4. Situaciones Comunes

### 4.1 Nueva Calculadora

1. Trabajar en staging
2. Desarrollo y pruebas completas
3. Publicar a main cuando esté lista
4. Se mantiene en staging para futuras mejoras

### 4.2 Documentación Privada

1. Trabajar en staging
2. Carpeta `documentos/`
3. Cambios solo en staging
4. Nunca se publica a main

### 4.3 Notificaciones de Pull Request

- Ignorar mensaje "¿Desea crear una solicitud de incorporación de cambios?"
- Click en "No volver a mostrar"
- No necesario para desarrollo personal

## 5. Solución de Problemas

### 5.1 Cambios No Visibles

1. Verificar rama actual
2. Confirmar commit y sync
3. Esperar actualización GitHub Pages

### 5.2 Archivos "Desaparecen"

- Normal al cambiar entre ramas
- Los archivos se ajustan a la versión de la rama
- `documentos/` solo visible en staging

## 6. Mejores Prácticas

### 6.1 Desarrollo

- Trabajar siempre en staging
- Mantener web funcional en staging
- Commits frecuentes
- Sync regular para backup

### 6.2 Publicación

- Verificar funcionamiento completo
- Publicar cuando esté 100% listo
- Comprobar web pública
- Mantener staging actualizado

## 7. Recordatorios Importantes

- Staging contiene todo (web + docs)
- Main solo contiene la web pública
- Los cambios en staging están respaldados
- Verificar rama actual antes de trabajar

¿Necesitas aclaración sobre algún punto específico?
