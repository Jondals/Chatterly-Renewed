# Chatterly de escritorio (Electron)

[English](README.md)

La web de Chatterly en su propia ventana de Windows. El instalador lleva la web dentro, así que el código que maneja tus claves es el que se instaló, no lo que un servidor envíe en cada arranque. La app no añade ninguna forma de leer mensajes y no envía nada a ningún sitio: el cifrado, las llamadas y la política de solo relay se ejecutan en el código web, igual que en un navegador.

macOS y Linux usan el mismo código (solo cambia el empaquetado; mira el final).

## Qué hace

- **Web empaquetada.** La web vive en `web/` dentro del instalador y se sirve como `app://chatterly`. La ventana solo habla con el servidor para la API (`https://…/api`, `wss://…/ws`).
- **Ventana endurecida.** Renderizador en sandbox, aislamiento de contexto, sin Node en la página, herramientas de desarrollo apagadas al instalar. La página solo ve `window.chatterlyDesktop` (`isDesktop`, `platform`) y `window.CHATTERLY_API`.
- **Los enlaces no sacan la app de su sitio.** Otras webs se abren en tu navegador; las ventanas emergentes se deniegan.
- **Permisos.** Cámara, micrófono, notificaciones y captura de pantalla se conceden solo a la propia app, nunca a un marco incrustado (YouTube y similares).
- **Compartir pantalla** tiene su propio selector. El audio del sistema no se comparte a propósito: en Windows capturaría también las voces de la llamada y las devolvería como eco.
- **Bandeja.** Al cerrar la ventana se esconde y una llamada sigue; el menú de la bandeja cierra de verdad.
- **Página sin conexión** (solo en modo remoto): si no llega al servidor muestra una página y reintenta cada 5 segundos.
- **Se actualiza sola** (mira [Actualizaciones](#actualizaciones-se-instalan-solas)).
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

| Variable                | Qué hace                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CHATTERLY_URL`         | El servidor (API). Por defecto, el sitio público. Una app instalada solo acepta `https`; `http` solo para `localhost` mientras desarrollas |
| `CHATTERLY_MODE=remote` | Solo desarrollo: carga el propio servidor en vez de la web empaquetada                                                                     |
| `CHATTERLY_WEB_DIR`     | Solo desarrollo: usa esta web compilada en vez de `desktop/web`                                                                            |
| `CHATTERLY_NO_UPDATE=1` | Apaga la actualización automática                                                                                                          |
| `CHATTERLY_UPDATE_URL`  | Solo desarrollo: una carpeta con `latest.yml` de la que comprobar y descargar (nunca instala). La usan las pruebas                         |

Una app instalada ignora `CHATTERLY_MODE`, `CHATTERLY_WEB_DIR` y `CHATTERLY_UPDATE_URL`, así que una variable de entorno no puede cambiar el código que guarda las claves.

## Probarla

```
pnpm --dir desktop test
```

Unas 200 comprobaciones de la app: ajustes peligrosos en el código, la regla de la dirección del servidor, la app en marcha (sin Node en la página, navegación, permisos, micrófono y cámara, selector de pantalla, una sola copia, bandeja), el servidor `app://` (qué sirve y qué rechaza, recorrido de rutas), el actualizador (encuentra, descarga, rechaza un hash falso) y, si has generado uno, la app instalada (fusibles, arranca desde su asar).

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

## Actualizaciones (se instalan solas)

La app instalada busca una versión nueva **al arrancar y cada 6 horas**, la descarga en segundo plano y la instala **sin preguntar nada**:

1. Si llega en los primeros 3 minutos tras arrancar (nadie puede estar en una llamada todavía), la app se reinicia en el acto.
2. Si no, se instala al cerrar la app.
3. Si la ventana está escondida en la bandeja y no ha sonado nada en 10 minutos, se reinicia entonces. Nunca se reinicia con la ventana visible ni con algo sonando, así que una llamada no se corta.

Lee las **Releases de GitHub** del repositorio y comprueba el sha512 de la descarga contra `latest.yml`. Mientras el instalador no esté firmado no hay comprobación del editor encima de eso, que es el motivo para firmarlo o usar la Store. La versión de la Microsoft Store la actualiza la Store, no esto.

### Publicar una versión (para que las apps instaladas se actualicen)

1. Sube la versión **en todos los sitios, al mismo número**: `package.json`, `backend/package.json`, `frontend/package.json`, `frontend/src/app/version.ts` y `desktop/package.json`. Añade la entrada en `CHANGELOG.md`.
2. Haz commit y push.
3. Sube una etiqueta con ese número:

   ```
   git tag v2.25.0
   git push origin v2.25.0
   ```

4. El flujo [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml) compila la web, pasa las pruebas de escritorio, genera el instalador y adjunta `Chatterly Setup …exe`, `latest.yml` y el blockmap a la release de esa etiqueta. Las apps instaladas la encuentran en unas horas.

El repositorio (o al menos sus Releases) debe ser **público**, o las apps no pueden descargar actualizaciones. Subir la etiqueta no despliega el servidor (`deploy.yml` ignora `desktop/` y las etiquetas).

A mano en vez del flujo (necesita un token de GitHub con permiso de escritura en el repositorio):

```
$env:GH_TOKEN = "<token>"
pnpm build
pnpm --dir desktop release
```

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

El código es el mismo. Para macOS añade un objetivo `mac` (dmg) en `build` de `package.json`, compila en un Mac (o un runner de macOS) y firma y notariza con una cuenta de Apple Developer. Para Linux añade `AppImage` o `deb`. La bandeja, el selector y el menú ya sirven para ambos.

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
  src/main.cjs           la app: ventana, bandeja, permisos, selector de pantalla, bloqueo de navegación
  src/preload.cjs        lo único que ve la página (isDesktop, platform, la dirección de la API)
  src/bundle.cjs         sirve la web empaquetada como app://chatterly
  src/updater.cjs        la actualización automática
  src/server-url.cjs     qué servidor, y la regla de https
  src/picker.html        la ventana de "compartir pantalla" (+ picker-preload.cjs)
  src/offline.html       la página cuando no se llega al servidor
  scripts/start.mjs      la arranca para desarrollar
  scripts/copy-web.mjs   copia la web compilada a desktop/web
  scripts/dist-store.mjs genera el paquete de la Microsoft Store
  test/desktop.mjs       las comprobaciones
  build/icon.png         el icono (instalador y bandeja)
  web/  dist/            los crea la compilación; nunca se suben a Git
```
