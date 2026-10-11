# Contribuir a Chatterly-Renewed

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
