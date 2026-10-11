# Contribuir a Chatterly-Renewed

[English](CONTRIBUTING.md)

Gracias por querer ayudar. Esta guía es corta a propósito.

## Preparar el entorno

1. Instala Node.js 20 o más nuevo y pnpm.
2. `pnpm install:all` instala los paquetes de la raíz, del backend y del frontend.
3. `pnpm dev` arranca a la vez el backend (puerto 3000) y el frontend (puerto 4200).

## Antes de abrir una pull request

- `pnpm typecheck` debe pasar en los dos proyectos.
- `pnpm test` lanza el único test de extremo a extremo (dos navegadores reales, una llamada real). Debe acabar con `ALL CORRECT`. En Windows también puedes lanzar `test/chatterly-test.exe`.
- Mantén los cambios pequeños y centrados: una idea por pull request.

## Estilo del código

- Todo el código, los identificadores y los comentarios van en inglés. El texto que ve la persona pasa por el pipe de traducción, y cada cadena nueva necesita su entrada en `frontend/src/app/core/i18n/es.ts` (`node frontend/scripts/i18n.mjs --check` lista lo que falta).
- Cada archivo empieza con un comentario que dice qué hace, y cada función tiene un comentario corto.
- Sin funciones lambda (flecha): usa funciones con nombre o `bind`.
- Formatea con Prettier (`pnpm --dir frontend exec prettier --write .`).
- Mantén el cursor, las animaciones y los estados al pasar el ratón coherentes con el resto de la interfaz.
- Para entender cómo encaja todo y por qué, lee [ARCHITECTURE.es.md](../ARCHITECTURE.es.md).

## Seguridad

No registres, guardes ni envíes nunca el texto de los mensajes, las contraseñas ni las claves. Si encuentras una vulnerabilidad no abras una incidencia pública: lee [SECURITY.es.md](../SECURITY.es.md).

## Añadir un idioma

Las traducciones viven en un diccionario por idioma en `frontend/src/app/core/i18n/`. Copia `es.ts`, traduce los valores y registra el idioma en `i18n.service.ts`.

## App de escritorio (Windows)

La app de Windows vive en `desktop/` (Electron) y lleva la web compilada dentro.

```
pnpm --dir desktop install
pnpm --dir desktop start      # ejecutarla desde el código
pnpm --dir desktop test       # unas 230 comprobaciones de la app (también forma parte de pnpm test)
pnpm build && pnpm --dir desktop dist   # genera el instalador en desktop/dist
```

Cómo ejecutarla, probarla, generar el instalador, actualizarla y publicarla en la Microsoft Store está en [desktop/README.es.md](../desktop/README.es.md) (inglés: [desktop/README.md](../desktop/README.md)). Dos reglas para esta carpeta:

- La página solo puede hablar con la app de escritorio a través de los comandos fijos de `desktop/src/preload.cjs`. Un comando o canal nuevo necesita una revisión de seguridad y su entrada en la lista que comprueba `desktop/test/desktop.mjs`.
- Vale el mismo estilo de código: inglés, un comentario de cabecera por archivo, sin funciones flecha, Prettier.

## Publicar versiones

Hay una sola versión para todo el proyecto (web, servidor y app de escritorio). Para publicar:

1. Sube la versión, al mismo número, en `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/src/app/version.ts` y `desktop/package.json`, y añade la entrada en `CHANGELOG.md`.
2. Haz commit y push.

El servidor se actualiza con ese push (`deploy.yml`) y el instalador de Windows lo publica el flujo `desktop.yml` como la release `v<versión>`. Nadie tiene que crear etiquetas a mano. Quien use la app de escritorio ve "Hay una versión nueva" en las notificaciones de la campana, la descarga y reinicia cuando quiera.
