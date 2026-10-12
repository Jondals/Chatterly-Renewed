# Chatterly de escritorio (Electron)

[English](README.md)

La web de Chatterly en su propia ventana de Windows. El instalador lleva la web dentro, así que el código que maneja tus claves es el que se instaló, no lo que un servidor envíe en cada arranque. La app no añade ninguna forma de leer mensajes y no envía nada a ningún sitio: el cifrado, las llamadas y la política de solo relay se ejecutan en el código web, igual que en un navegador.

macOS y Linux usan el mismo código (solo cambia el empaquetado; mira el final).

## Qué hace

- **Web empaquetada.** La web vive en `web/` dentro del instalador y se sirve como `app://chatterly`. La ventana solo habla con el servidor para la API (`https://…/api`, `wss://…/ws`).
- **Ventana endurecida.** Renderizador en sandbox, aislamiento de contexto, sin Node en la página, herramientas de desarrollo apagadas al instalar. La página solo ve `window.chatterlyDesktop` (`isDesktop`, `platform`) y `window.CHATTERLY_API`.
- **Los enlaces no sacan la app de su sitio.** Otras webs se abren en tu navegador; las ventanas emergentes se deniegan.
- **Permisos.** Cámara, micrófono, notificaciones y captura de pantalla se conceden solo a la propia app, nunca a un marco incrustado (YouTube y similares).
- **Compartir pantalla** sigue el menú de compartir de la llamada: lo que elijas ahí (una pantalla o una ventana) decide lo que ofrece el selector propio de la app, y con una sola pantalla y "una pantalla" elegido se comparte al momento. (Es su propio selector.) El audio del sistema no se comparte a propósito: en Windows capturaría también las voces de la llamada y las devolvería como eco.
- **Cerrar la ventana cierra la app.** No queda nada en segundo plano (no hay bandeja).
- **Se abre maximizada** la primera vez y se queda así hasta que restaures la ventana; entonces se abre como la dejaste (`window-state.json` en la carpeta del perfil).
- **Los sonidos suenan al momento**, sin clic previo (la intro, los tonos de llamada).
- **Spinly** se muestra dentro de la app. Spinly tiene que permitir el origen `app://chatterly` (en su `frame-ancestors` y en su puente con Chatterly): el proyecto Spinly ya lo hace, pero hay que desplegarlo.
- **Página sin conexión** (solo en modo remoto): si no llega al servidor muestra una página y reintenta cada 5 segundos.
- **Se actualiza desde la propia app** (un aviso en la campana; descargas y reinicias cuando quieras; mira [Actualizaciones](#actualizaciones)).
- **Fusibles de Electron** fijados al compilar: sin `ELECTRON_RUN_AS_NODE`, sin `NODE_OPTIONS`, sin `--inspect`, integridad del asar comprobada, solo carga desde el asar, sin privilegios extra para `file://`.

## Qué necesitas

| Para                               | Necesitas                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Todo                               | Git, Node.js 22 o superior (se prueba con 24), pnpm 12.9.1 (`corepack enable`)                                |
| Generar el instalador de Windows   | Windows 10/11 (el instalador se genera en Windows)                                                            |
| Ejecutarla desde el código         | El repositorio instalado (abajo)                                                                              |
| El paquete de la Microsoft Store   | Una cuenta gratuita de Partner Center (mira [Microsoft Store](#microsoft-store-gratis-firmada-por-microsoft)) |
| Compilar para macOS (más adelante) | Un Mac y una cuenta de Apple Developer (99 USD/año)                                                           |

## Instalar el proyecto (una vez)

Desde la raíz del repositorio:

```
pnpm install
pnpm --dir backend install
pnpm --dir frontend install
pnpm --dir desktop install
```

## Ejecutarla mientras desarrollas

```
pnpm --dir desktop start
```

Sin nada más abre el **sitio público** en una ventana (modo remoto). Para trabajar con tu propio servidor:

```
# PowerShell
$env:CHATTERLY_URL = "http://localhost:3000"; $env:CHATTERLY_MODE = "remote"; pnpm --dir desktop start
```

O el modo **empaquetado** con una web recién compilada (lo que hace el instalador):

```
pnpm build                                   # en la raíz: compila backend y frontend
$env:CHATTERLY_URL = "http://localhost:3000" # la API
$env:CHATTERLY_WEB_DIR = "..\frontend\dist\frontend\browser"
pnpm --dir desktop start
```

El servidor debe aceptar el origen `app://chatterly` (mira [Lado del servidor](#lado-del-servidor)).

### Variables de entorno

| Variable                    | Qué hace                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHATTERLY_URL`             | El servidor (API). Por defecto, el sitio público. Una app instalada solo acepta `https`; `http` solo para `localhost` mientras desarrollas              |
| `CHATTERLY_MODE=remote`     | Solo desarrollo: carga el propio servidor en vez de la web empaquetada                                                                                  |
| `CHATTERLY_WEB_DIR`         | Solo desarrollo: usa esta web compilada en vez de `desktop/web`                                                                                         |
| `CHATTERLY_NO_UPDATE=1`     | Apaga la actualización automática                                                                                                                       |
| `CHATTERLY_TRACE=<archivo>` | Escribe los tiempos de arranque (milisegundos desde que empezó el proceso) en ese archivo, una línea por paso. Para medir, mira [Velocidad](#velocidad) |
| `CHATTERLY_UPDATE_URL`      | Solo desarrollo: una carpeta con `latest.yml` de la que comprobar y descargar (nunca instala). La usan las pruebas                                      |

Una app instalada ignora `CHATTERLY_MODE`, `CHATTERLY_WEB_DIR` y `CHATTERLY_UPDATE_URL`, así que una variable de entorno no puede cambiar el código que guarda las claves.

## Probarla

```
pnpm --dir desktop test
```

Unas 230 comprobaciones de la app: ajustes peligrosos en el código, la regla de la dirección del servidor, la app en marcha (sin Node en la página, navegación, permisos, micrófono y cámara, selector de pantalla, una sola copia, cerrar la ventana cierra la app), el servidor `app://` (qué sirve y qué rechaza, recorrido de rutas), el actualizador (avisa, descarga si se lo pides, rechaza un hash falso) y, si has generado uno, la app instalada (fusibles, arranca desde su asar).

También forma parte del `pnpm test` de la raíz, que añade un paso donde esta app se registra contra el backend real desde `app://chatterly`.

## Generar el instalador

```
pnpm build                    # en la raíz: la web que llevará el instalador
pnpm --dir desktop dist
```

1. `pnpm build` deja la web en `frontend/dist/frontend/browser`.
2. `pnpm --dir desktop dist` la copia a `desktop/web` (se niega si las versiones de la web y de escritorio no coinciden) y ejecuta electron-builder.

Lo que sale en `desktop/dist/`:

| Archivo                         | Qué es                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Chatterly Setup <versión>.exe` | **El instalador** que das a la gente (unos 100 MB). Un clic, por usuario, sin permisos de administrador; se instala en `%LOCALAPPDATA%\Programs\Chatterly` |
| `latest.yml` y `*.blockmap`     | Lo que lee la actualización automática. Súbelos junto al instalador (la publicación lo hace sola)                                                          |
| `win-unpacked/`                 | La misma app sin instalador, para probarla (`Chatterly.exe`)                                                                                               |

El instalador **no está firmado**. Windows SmartScreen muestra "Windows protegió su PC" la primera vez: _Más información_ y luego _Ejecutar de todos modos_. Para evitarlo sin pagar una suscripción, publícala en la Microsoft Store.

Tus datos (las claves de tu cuenta y los ajustes) viven en `%APPDATA%\Chatterly` (`Chatterly-dev` si la ejecutas desde el código). Al desinstalar desde los ajustes de Windows se conservan; borra la carpeta para borrar todo.

## Actualizaciones

La app instalada busca una versión nueva **unos segundos después de arrancar y luego con la frecuencia que elijas**, y solo **te avisa**. Nada se descarga, se instala ni se reinicia a tus espaldas:

1. Aparece el aviso "Hay una versión nueva" y las **notificaciones de la campana** (Inicio) muestran una tarjeta con la versión nueva.
2. Pulsas **Descargar**. Una barra de progreso te dice cómo va.
3. Cuando está lista pulsas **Reiniciar y actualizar**. Chatterly se cierra, instala en silencio y se abre otra vez.

**Ajustes > Actualizaciones** (solo en la app de escritorio) tiene lo necesario para controlarlo:

- El estado, la versión, cuándo miró por última vez y los botones **Buscar actualizaciones**, **Descargar** y **Reiniciar y actualizar**.
- **Buscar actualizaciones automáticamente**: cada hora, cada 6 horas (por defecto), cada 12 horas, cada día, solo al arrancar o solo cuando tú lo pidas.
- **Avisarme de las versiones nuevas**: activado muestra el aviso y la tarjeta en la campana; desactivado no muestra nada en la campana (la versión nueva sigue en Ajustes > Actualizaciones).

Con **Actualizar sola** (apagada por defecto) la versión nueva se descarga en cuanto se encuentra y se instala en silencio al cerrar la app; nunca la reinicia por su cuenta, así que una llamada no se corta.

En la campana, la tarjeta tiene además **Más tarde** (la oculta para esa versión) y un enlace a estos ajustes. Las elecciones se guardan en `update-settings.json` en la carpeta del perfil (`%APPDATA%\Chatterly`). Si no pulsas nada y "Actualizar sola" está apagada, la app se queda como está.

Lee las **Releases de GitHub** del repositorio y comprueba el sha512 de la descarga contra `latest.yml`; un archivo cuyo hash no coincide se rechaza y la tarjeta lo dice. Mientras el instalador no esté firmado no hay comprobación del editor encima de eso, que es el motivo para firmarlo o usar la Store. La versión de la Microsoft Store la actualiza la Store y no muestra tarjeta.

La página habla con la app mediante comandos fijos (`getState`, `check`, `download`, `install`, `setSettings`) y un evento, todo en `src/preload.cjs`. Solo la página principal de la app puede usarlos, nunca un marco incrustado, y `setSettings` solo acepta las dos claves de arriba con valores de una lista fija.

### Publicar una versión (para que las apps instaladas la vean)

Hay **una sola publicación para todo el proyecto**, no una por plataforma:

1. Sube la versión **en todos los sitios, al mismo número**: `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/src/app/version.ts` y `desktop/package.json`. Añade la entrada en `CHANGELOG.md`.
2. Haz commit y push.

Ya está. Ese mismo push actualiza el servidor (`deploy.yml`) y el flujo [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) compila la web, pasa las pruebas de escritorio, genera el instalador y lo publica como la release `v<versión>` con `Chatterly-Setup-<versión>.exe`, `latest.yml` y el blockmap; las notas de la release son la sección de esa versión en `CHANGELOG.md`. Si esa versión ya tiene su release completa (un push que no la subió), no compila nada; una release que se quedó sin `latest.yml` (una fallida) la termina el siguiente push. Las apps instaladas la encuentran en unas horas y la muestran en la campana.

El repositorio (o al menos sus Releases) debe ser **público**, o las apps no pueden descargar actualizaciones.

A mano en vez del flujo (con la [CLI de GitHub](https://cli.github.com), con sesión iniciada):

```
pnpm build
pnpm --dir desktop dist
node desktop/scripts/release-notes.mjs 2.27.0 > notas.md
gh release create v2.27.0 --target master --title "Chatterly 2.27.0" --notes-file notas.md
gh release upload v2.27.0 "desktop/dist/Chatterly-Setup-2.27.0.exe" "desktop/dist/Chatterly-Setup-2.27.0.exe.blockmap" desktop/dist/latest.yml
```

## Seguridad

Qué protege a la app y qué queda por saber:

- **El código que maneja tus claves es el del instalador.** No se descarga en cada arranque. La página no puede llegar a Node ni al sistema, otras webs no pueden usar los comandos de actualización, y los permisos van solo a la app.
- **Electron se mantiene en una versión con soporte.** Electron trae su propio Chromium, así que un Electron viejo es un navegador viejo con fallos conocidos. El proyecto sigue la última versión mayor estable (la 44 ahora); las mayores antiguas dejan de recibir arreglos de seguridad. Antes de cada publicación ejecuta `pnpm --dir desktop audit`: el único aviso que queda es `sprintf-js` (moderado), una dependencia de las herramientas de empaquetado, que no forma parte de la app y aún no tiene arreglo.
- **Una app instalada se niega a arrancar con interruptores que la abren** (`--remote-debugging-port`, `--ignore-certificate-errors`, `--disable-web-security`, `--no-sandbox`, `--proxy-server`, `--host-resolver-rules` y parecidos). Nada de la app registra un protocolo ni un tipo de archivo, así que una web no puede arrancarla con argumentos; es un segundo cerrojo. `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` y `--inspect` se apagan en la propia compilación (fusibles).
- **El flujo de publicación** compila sin ningún token (solo el último paso, la CLI de GitHub, lo tiene), fija cada acción a su commit exacto, solo se ejecuta con pushes a este repositorio y nunca deja el token en la carpeta.

**Lo que aún no está cubierto: quién puede publicar una actualización.** Una actualización se confía porque viene de las Releases de GitHub de este repositorio por https y coincide con el sha512 de `latest.yml`. Quien pueda escribir releases en el repositorio (o robe un token que pueda) podría publicar una actualización que todas las apps instaladas ofrecerían a su dueño (que aún tiene que pulsar Descargar y Reiniciar). El único arreglo completo es firmar el instalador y que la app compruebe la firma (`publisherName`, mira _Firmar el instalador directo_ más abajo), o publicar por la Microsoft Store. Mientras tanto: protege la cuenta de GitHub con verificación en dos pasos y una llave física, mantén al mínimo las personas que pueden escribir en el repositorio y deja `contents: write` solo en el trabajo del flujo que lo necesita.

Comunica una vulnerabilidad como se explica en [SECURITY.es.md](../SECURITY.es.md).

## Velocidad

Lo que hace la app para arrancar y funcionar rápido:

- La web se lee del instalador, no se descarga, y sus scripts se **compilan una vez y se guardan** (caché de código de V8 para `app://chatterly`), así que el segundo arranque se salta casi todo ese trabajo.
- La página que lo arranca todo se lee y se prepara una vez, no en cada ruta.
- El código de actualizaciones se carga **5 segundos después de abrirse la ventana**, para que no compita con el arranque.
- La detección de ventanas tapadas de Windows está desactivada, así que una llamada en una ventana que está detrás de otra no se ralentiza.
- La ventana se abre en cuanto su primer fotograma está listo, con el fondo oscuro ya puesto.

No mueve el trabajo de la propia página: las animaciones y efectos de la web son los mismos que en un navegador (y su modo de bajo consumo, `data-perf="low"`, se activa solo en equipos flojos).

Para medir en tu equipo:

```
$env:CHATTERLY_TRACE = "$env:TEMP\chatterly-trace.txt"
& "$env:LOCALAPPDATA\Programs\Chatterly\Chatterly.exe"
Get-Content $env:CHATTERLY_TRACE
```

Imprime líneas como `273 ready-to-show`: los milisegundos desde que empezó el proceso. En la máquina de desarrollo la ventana está lista en unos 0,27 s y el primer pintado en unos 0,35 s, sin tareas largas y con una tasa de fotogramas estable. Si la tuya es mucho más lenta, envía ese archivo.

## Lado del servidor

El origen de la ventana es `app://chatterly`, así que el servidor debe listarlo en `CORS_ORIGINS` (también se comprueba en el WebSocket). `docker-compose.yml` ya lo hace:

```
CORS_ORIGINS: https://tu.dominio,app://chatterly
```

Sin Docker, añade `app://chatterly` a la lista y reinicia el servidor. Si el inicio de sesión falla con un error de CORS, o el WebSocket se cierra al instante (código 1008), esta es la causa.

## Microsoft Store (gratis, firmada por Microsoft)

Sin certificado y sin suscripción: la Store firma el paquete.

1. Crea una cuenta de Microsoft Partner Center (gratis para particulares y empresas).
2. Reserva el nombre de la app. En _Product identity_ copia los tres valores: **Package/Identity/Name**, **Package/Identity/Publisher** y **PublisherDisplayName**.
3. Genera el paquete:

   ```
   pnpm build
   $env:STORE_IDENTITY_NAME = "<Identity/Name>"
   $env:STORE_PUBLISHER = "CN=<Identity/Publisher>"
   $env:STORE_PUBLISHER_DISPLAY_NAME = "<PublisherDisplayName>"
   pnpm --dir desktop dist:store
   ```

   Sale `desktop/dist/Chatterly <versión>.appx`. (En GitHub: _Actions_, _Build the desktop app_, _Run workflow_, tras guardar esos tres valores como secretos del repositorio con los mismos nombres.)

4. Súbelo en Partner Center, rellena la ficha de la tienda, una política de privacidad y la clasificación por edades, y envíalo a revisión.
5. Antes de enviarlo, sustituye las imágenes de mosaico por defecto por las tuyas en `desktop/build/appx/` (`StoreLogo.png` 50x50, `Square44x44Logo.png`, `Square150x150Logo.png`, `Wide310x150Logo.png`).

La versión de la Store no usa la actualización automática: la actualiza la Store.

## Firmar el instalador directo (opcional)

Solo si no quieres el aviso de SmartScreen en las descargas directas y no usas la Store:

- **Azure Artifact Signing** (9,99 USD/mes, firma archivos de Windows; comprueba que te acepte).
- Un **certificado de firma de código** de una autoridad (de pago anual; desde 2026 la clave debe estar en un token físico o un servicio de firma en la nube). electron-builder lee `CSC_LINK` y `CSC_KEY_PASSWORD`.

Una vez firmado, añade `publisherName` en `build.win` de `package.json` para que el actualizador compruebe también quién firmó cada actualización.

## macOS y Linux (aún sin generar)

El código es el mismo. Para macOS añade un objetivo `mac` (dmg) en `build` de `package.json`, compila en un Mac (o un runner de macOS) y firma y notariza con una cuenta de Apple Developer. Para Linux añade `AppImage` o `deb`. El selector y el menú ya sirven para ambos.

## Si algo falla

| Síntoma                                                                                                       | Causa y solución                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron arranca como Node normal y falla con `Cannot read properties of undefined (reading 'enableSandbox')` | `ELECTRON_RUN_AS_NODE` está puesto en tu terminal (algunos editores lo hacen). `pnpm --dir desktop start` y las pruebas lo quitan; si ejecutas `electron .` tú, quítalo |
| `pnpm dist` dice que no hay web compilada                                                                     | Ejecuta antes `pnpm build` en la raíz                                                                                                                                   |
| `pnpm dist` dice que las versiones difieren                                                                   | `desktop/package.json` debe tener la misma versión que `frontend/package.json`                                                                                          |
| electron-builder imprime `Cannot create symbolic link` al extraer `winCodeSign`                               | Es un aviso en Windows sin modo desarrollador; la compilación termina igual. Activa el _Modo desarrollador_ en los ajustes de Windows para que desaparezca              |
| La app instalada no puede iniciar sesión                                                                      | El servidor no lista `app://chatterly` en `CORS_ORIGINS` (mira Lado del servidor)                                                                                       |
| Windows SmartScreen bloquea el instalador                                                                     | No está firmado: _Más información_, _Ejecutar de todos modos_, o usa la Store                                                                                           |
| La actualización nunca llega                                                                                  | La release no es pública, le falta `latest.yml` o su versión no es mayor que la instalada                                                                               |

## Qué hay en esta carpeta

```
desktop/
  src/main.cjs           la app: ventana, permisos, selector de pantalla, bloqueo de navegación
  src/preload.cjs        lo único que ve la página (isDesktop, platform, la dirección de la API)
  src/bundle.cjs         sirve la web empaquetada como app://chatterly
  src/updater.cjs        la actualización automática
  src/server-url.cjs     qué servidor, y la regla de https
  src/trace.cjs          tiempos de arranque opcionales (CHATTERLY_TRACE)
  src/picker.html        la ventana de "compartir pantalla" (+ picker-preload.cjs)
  src/offline.html       la página cuando no se llega al servidor
  scripts/start.mjs      la arranca para desarrollar
  scripts/copy-web.mjs   copia la web compilada a desktop/web
  scripts/dist-store.mjs genera el paquete de la Microsoft Store
  test/desktop.mjs       las comprobaciones
  build/icon.png         el icono (instalador y ventana)
  web/  dist/            los crea la compilación; nunca se suben a Git
```
