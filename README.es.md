<div align="center">

<img src="frontend/public/favicon.svg" width="84" alt="Logo de Chatterly-Renewed" />

# Chatterly-Renewed

**Chat, grupos y llamadas WebRTC entre personas, todo cifrado de extremo a extremo, con una interfaz que se siente viva.**

[English](README.md) · **Español**

![versión](https://img.shields.io/badge/versi%C3%B3n-2.23.1-2ef2b0?style=flat-square)
![cifrado](https://img.shields.io/badge/E2EE-AES--256--GCM%20%C2%B7%20ECDH%20P--256%20%C2%B7%20ECDSA-8b5cf6?style=flat-square)
![llamadas](https://img.shields.io/badge/llamadas-WebRTC%20malla%20%C2%B7%20DTLS--SRTP-38e8ff?style=flat-square)

</div>

Chatterly-Renewed es una aplicación al estilo Discord (mensajes directos, amigos, grupos con canales de texto y de voz, archivos, notas de voz, reacciones, llamadas de voz y vídeo y compartir pantalla) hecha para que **el servidor no pueda leer tus conversaciones ni escuchar tus llamadas**. Las claves se generan en tu navegador y nunca salen de él sin cifrar.

## Características

- 🔐 **Cuentas de conocimiento cero**: tu contraseña nunca llega al servidor.
- 💬 **Mensajes directos y canales de grupo con cifrado de extremo a extremo**, firmados uno a uno.
- 📞 **Voz, vídeo y pantalla entre personas** (malla completa, hasta 8), con audio espacial y telemetría real. Con `RELAY_ONLY=1` todas las llamadas pasan por tu relay TURN y **fallan** en lugar de conectar directamente: nadie ve la dirección IP de nadie.
- 👥 **Amigos** con verificación de claves (confianza en el primer uso y números de seguridad).
- 🛰️ **Grupos** con canales, invitaciones, expulsión de miembros y **rotación automática de la clave del grupo**.
- 📎 **Adjuntos cifrados** (clave propia por archivo, verificados con SHA-256), 🎙️ notas de voz, 😀 emojis (con una pestaña "Todos" que se carga poco a poco), reacciones cifradas, respuestas, edición y borrado.
- 🔒 **Privacidad de verdad**: quién te ve en línea (todos, solo amigos o nadie), quién puede enviarte solicitudes, aparecer o no en las búsquedas, confirmaciones de lectura e indicador de escritura. El servidor hace cumplir estas opciones.
- 🎡 **Ruedas y torneos de Spinly**, escuchar YouTube/Spotify juntos, ver vídeos juntos, atajos de teclado y panel de sonidos.
- 🧩 **Preajustes y etiquetas de servidor**: guarda el aspecto de la app o de tu perfil (con fondo, fuentes e imágenes) con un nombre y compártelo en un chat; un amigo lo importa con un botón (todo lo que llega de otra persona se comprueba antes). El dueño de un grupo crea una etiqueta que los miembros pueden mostrar junto a su nombre. Al quitar a un amigo se borra el chat y sale de tus grupos.
- 🎨 **Interfaz viva**: más de 20 fondos animados, anillos de aura, 10 temas, selector de color propio con cuentagotas, degradados de hasta cinco colores, cursores animados, sonidos de interfaz en archivos de audio que puedes sustituir (carpeta `frontend/public/sounds`), fotos de perfil y banners cifrados de extremo a extremo y tamaño de texto ajustable que escala toda la interfaz.

## Inicio rápido

Necesitas **Node.js 20+** y **pnpm**.

```bash
pnpm run install:all   # raíz + backend + frontend
pnpm dev               # backend en :3000, frontend en :4200
```

Abre <http://localhost:4200>, crea dos identidades en dos navegadores (o uno normal y uno privado), añádelas como amigas y llama. Funciona en Chromium, Edge y Firefox; el micrófono necesita `localhost` o HTTPS.

```bash
pnpm test        # el único test: tipos, idiomas, seguridad, navegador real, E2EE y API
pnpm build       # compilación de producción
pnpm typecheck
pnpm app         # compila y sirve la versión de producción (:4200 + :3000)
```

`pnpm test` ejecuta [`test/run.mjs`](test/run.mjs) y, dentro, [`test/security.mts`](test/security.mts) (autorización, sesiones, subidas, SSRF, borrado de cuenta, política de relay y cifrado de frames). Necesita Chromium una vez: `pnpm exec playwright install chromium`.

La búsqueda de GIFs necesita una clave gratuita de GIPHY en `backend/.env` (`GIPHY_API_KEY=...`).

## Configuración

Todo se configura con variables de entorno (ver [`backend/.env.example`](backend/.env.example)):

| Variable                            | Por defecto                                   | Para qué sirve                                                                      |
| ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `PORT` / `HOST`                     | `3000` / `0.0.0.0`                            | Dirección de escucha                                                                |
| `CORS_ORIGINS`                      | `http://localhost:4200,http://127.0.0.1:4200` | Orígenes web permitidos (también se comprueban en el WebSocket)                     |
| `JWT_SECRET`, `SERVER_SECRET`       | se generan en `data/secrets.json`             | **Defínelos en producción** (mínimo 32 caracteres y distintos entre sí)             |
| `DATA_DIR`, `DB_PATH`, `UPLOAD_DIR` | `./data`                                      | Base de datos SQLite y archivos cifrados                                            |
| `STUN_URLS`                         | STUN de Google (ninguno si hay relay)         | Servidores ICE para las llamadas                                                    |
| `TURN_URLS`, `TURN_SECRET`          | –                                             | coturn (`use-auth-secret`): credenciales de una hora por usuario                    |
| `RELAY_ONLY`                        | –                                             | `1` = toda llamada debe usar el relay; si el relay falla, la llamada **no empieza** |
| `TRUST_PROXY`                       | –                                             | Número de proxies inversos delante (`1` para Caddy)                                 |
| `TLS_KEY`, `TLS_CERT`               | –                                             | HTTPS directo (si no, termínalo en un proxy inverso)                                |

> **Lista para producción:** todo por HTTPS/WSS, define `JWT_SECRET` y `SERVER_SECRET`, restringe `CORS_ORIGINS`, monta un relay TURN con `RELAY_ONLY=1`, haz copias de seguridad (`scripts/backup.mjs`, con cifrado opcional) y revisa la lista de [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

## Cómo funciona la seguridad

- **Contraseña:** el navegador la estira con PBKDF2 (600 000 vueltas) y solo envía una mitad derivada; el servidor guarda `scrypt` de eso con un pepper que no está en la base de datos.
- **Claves:** identidades **ECDH P-256** (cifrado) y **ECDSA P-256** (firmas) generadas en el navegador. En el servidor solo hay copias cifradas con `AES-256-GCM`.
- **Mensajes:** `AES-256-GCM` con IV nuevo, relleno a bloques de 64 bytes y datos autenticados (canal, remitente, versión de clave), además de una firma ECDSA.
- **Llamadas:** los frames de audio y vídeo se cifran en el navegador con claves efímeras que rotan cada 30 segundos, encima de DTLS-SRTP. La señalización va cifrada y firmada entre las dos personas.
- **Sesiones:** el token de acceso (15 minutos) nombra su sesión, así que cerrar sesión, cambiar la contraseña o borrar la cuenta lo invalida al instante; los tokens de renovación son de un solo uso.
- **Contactos:** la primera clave que se ve de un contacto se fija; si cambia, no se llama hasta que la revises. Compara el **número de seguridad** en conversaciones importantes.

### Lo que el servidor sí ve (modelo de amenazas honesto)

Nombres de usuario, campos del perfil, grafo de amigos, nombres y miembros de grupos y canales, horas y tamaños aproximados de los mensajes, tamaños de archivo, quién está en línea (según tu opción de privacidad) y quién está en qué llamada. **No** ve el texto de los mensajes, el contenido de los adjuntos, las reacciones, el audio/vídeo de las llamadas ni el contenido de la señalización.

- **Las fotos de perfil y los banners están cifrados de extremo a extremo** (desde la 2.18.0): el navegador cifra cada uno con su propia clave aleatoria, el servidor guarda solo texto cifrado y la clave se sella para cada persona que puede verlo (amistades, gente que comparte un servidor, conversaciones directas) con la clave de par entre quien lo sube y esa persona. Quien no está en ese círculo no recibe nada y el servidor no puede abrirlos. Límites: quien vio una foto conserva lo que vio, una amistad nueva ve la foto la próxima vez que su dueño esté conectado (su navegador sella la clave entonces) y el servidor sigue sabiendo quién tiene foto y cuánto pesa. **Los iconos de grupo también se cifran** (desde la 2.23.0): el navegador del dueño cifra el icono, la clave viaja con el grupo sellada con la clave del grupo y el servidor solo entrega el icono a los miembros del grupo. Las fotos privadas deben enviarse como adjuntos.
- El relay TURN (y la máquina que lo aloja) ve las direcciones de red y el volumen de tráfico, pero no el contenido.
- Un servidor que sirva JavaScript malicioso puede anular cualquier garantía de extremo a extremo: despliega el frontend desde una fuente en la que confíes.
- Las claves de mensajes directos son claves estáticas entre pares (todavía sin secreto hacia delante por mensaje) y quien pierde su contraseña no puede recuperar su identidad.

## Estructura del proyecto

```
backend/     Fastify 5 + SQLite (better-sqlite3) + WebSocket
frontend/    Angular 21 (signals) + Tailwind 4
scripts/     servidor de producción, copias de seguridad
test/        el único test (run.mjs) y las comprobaciones de seguridad (security.mts)
deploy/      guía para un servidor gratuito (Oracle Cloud), Caddy, coturn y comprobaciones
```

## Despliegue

La guía completa está en [`deploy/DEPLOY.md`](deploy/DEPLOY.md): Docker, Caddy con HTTPS automático, relay TURN con `deploy/turn-setup.sh --private`, lista de comprobación de seguridad para Oracle Cloud, copias de seguridad y cómo verificar que una llamada usa de verdad el relay.

## Contribuir

Lee primero [CONTRIBUTING.md](.github/CONTRIBUTING.md). Los problemas de seguridad se comunican según [SECURITY.md](SECURITY.md) y se espera que todo el mundo siga el [código de conducta](.github/CODE_OF_CONDUCT.md).

## Sonidos y licencias

Los sonidos grabados de la interfaz son de [Kenney](https://www.kenney.nl) (CC0, sin atribución obligatoria): [`frontend/public/sounds/LICENSE.txt`](frontend/public/sounds/LICENSE.txt).

## Licencia

ISC © colaboradores de Chatterly-Renewed. Consulta el [CHANGELOG](CHANGELOG.md) para ver las novedades de cada versión.
