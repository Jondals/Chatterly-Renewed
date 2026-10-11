# Arquitectura

Esta página explica cómo está montado Chatterly-Renewed y, sobre todo, **por qué** cada pieza es como es. Versión en inglés: [ARCHITECTURE.md](ARCHITECTURE.md).

## La idea en un párrafo

El servidor es una oficina de correos que no puede abrir las cartas. Todo lo privado (el texto de los mensajes, las reacciones, los adjuntos, el audio y el vídeo de las llamadas, los nombres de grupos y canales, las fotos de perfil) se cifra **en el navegador** con claves que nunca salen de él sin cifrar. El servidor guarda texto cifrado, comprueba **quién puede pedir qué** y reparte los eventos en tiempo real. Por eso casi toda la lógica interesante está en el frontend, y el backend es deliberadamente pequeño y estricto.

## Mapa del repositorio

```
backend/    Fastify 5 + SQLite (better-sqlite3) + WebSocket        la oficina de correos
frontend/   Angular 21 (signals, standalone) + Tailwind 4          donde viven las claves y se dibuja todo
deploy/     Caddy, coturn, systemd, script de actualización        cómo funciona en un servidor
scripts/    servidor de producción (archivos estáticos), copias    herramientas pequeñas, sin dependencias
test/       UN solo test: `pnpm test`                              ver «Tests»
```

## Backend (`backend/src`)

| Pieza            | Qué hace                                                                                       | Por qué es así                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `app.ts`         | Construye el servidor: cabeceras, CORS, límites, JWT, manejo de errores                        | Una sola función lo construye todo, así que los tests levantan el servidor _real_ en memoria (sin mocks que se alejen de producción) |
| `db.ts`          | Esquema y migraciones de SQLite                                                                | SQLite es un archivo, fácil de copiar y suficiente para un chat propio; las migraciones solo añaden y rechazan una base más nueva    |
| `routes/*.ts`    | Un archivo por área: auth, social, grupos, mensajes, imágenes, ajustes, gifs, previsualización | Cada ruta comprueba **quién pregunta** antes de tocar nada. Un id que falta o es ajeno responde 404 (no se pueden sondear ids)       |
| `validation.ts`  | Formas de los campos (base64, textos sellados, ids)                                            | Todo cuerpo se valida con esquema; el servidor nunca se fía del formato del cliente                                                  |
| `security/`      | Hash de contraseñas, freno de inicios de sesión, sesiones                                      | Un token vale solo mientras su sesión esté abierta: cerrar sesión, cambiar la contraseña o borrar la cuenta lo mata al instante      |
| `ws/`            | El socket en tiempo real: presencia, «escribiendo», llamadas                                   | El servidor solo reenvía señalización opaca y cifrada entre personas que están en la misma sala                                      |
| `maintenance.ts` | Limpieza cada hora de lo que ya nadie puede alcanzar                                           | Sin ella, las subidas abandonadas y las sesiones muertas se quedarían para siempre                                                   |

### Qué guarda el servidor (y qué no puede leer)

- **Sellado con una clave que el servidor nunca tiene:** el texto de los mensajes, las reacciones, el contenido de los archivos, los nombres de grupos, canales y etiquetas de miembro (desde la 2.24.0), las fotos de perfil, los banners, los iconos de grupo y el bloque de ajustes de la persona.
- **En claro, porque el servidor lo necesita para funcionar:** los nombres de usuario, quién es amigo de quién, quién pertenece a qué grupo, las horas, los tamaños (agrupados) y quién está en línea. Está dicho con honestidad en el README («Lo que el servidor sigue viendo»).

## Frontend (`frontend/src/app`)

| Carpeta          | Qué hay                                                                                                     | Por qué                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `core/crypto/`   | Código WebCrypto: derivación de claves, identidad, claves de pareja y de grupo, archivos, cifrado de medios | Funciones puras sin Angular: el mismo código lo usan la app y el test de seguridad             |
| `core/services/` | Sesión, socket, llamadas WebRTC, sonido, ajustes, cursor, preajustes, imágenes                              | Un servicio por tema; el estado está en signals                                                |
| `store/`         | Amigos, grupos, mensajes (la tubería de descifrado)                                                         | El único sitio que convierte lo que manda el servidor en algo que las pantallas pueden mostrar |
| `features/`      | Una carpeta por pantalla: auth, chat, direct, guild, settings, spinly, voice                                | Las pantallas se cargan bajo demanda: el inicio de sesión no paga la pantalla de llamadas      |
| `layout/`        | Barra lateral, panel, dock, diálogos                                                                        | El marco que se queda mientras cambia la página                                                |
| `shared/`        | Componentes, pipes, directivas, utilidades                                                                  | Piezas reutilizables que no conocen las pantallas                                              |
| `styles/`        | CSS global por áreas                                                                                        | Tailwind para la maquetación y CSS normal donde un efecto lo necesita                          |

### La criptografía en cuatro líneas

1. **Identidad:** cada persona tiene un par de claves ECDH y otro ECDSA hechos en el navegador y envueltos con una clave derivada de la contraseña (la contraseña nunca llega al servidor).
2. **Chats directos:** ECDH entre las dos identidades, expandido con HKDF a una clave AES-256-GCM atada a la conversación; además, cada mensaje va firmado.
3. **Grupos:** una clave AES-256-GCM por grupo y versión. Cada miembro la guarda envuelta para su propio par de claves. Cuando alguien se va, el dueño crea una versión nueva y **vuelve a sellar todo lo que depende de ella** (los mensajes usan la clave nueva desde entonces; la clave del icono y los nombres se vuelven a sellar en la misma petición).
4. **Llamadas:** el medio se cifra fotograma a fotograma con claves que se renuevan solas; la señalización va cifrada y firmada.

Cada texto sellado está **atado a su contexto** (grupo, tipo de texto, id de lo que nombra, versión de la clave). Por eso el servidor no puede darle el nombre de un canal a otro canal ni mover un texto sellado entre grupos.

### Decisiones que conviene conocer

- **Signals, no estado con RxJS.** El estado de la interfaz son `signal`/`computed`; RxJS solo se usa donde un flujo es la forma natural (eventos del socket y del router).
- **Sin funciones flecha.** El proyecto usa `function` + `.bind` en todas partes (una decisión de estilo tomada pronto y mantenida para que todo el código se lea igual).
- **Una ruta por pantalla, con partes opcionales.** `groups`, `groups/:grupo` y `groups/:grupo/:canal` son una sola ruta (`app.routes.ts`, `optionalParams`). Con una ruta por cada forma de dirección, Angular destruía y volvía a construir la pantalla al añadir el canal a la dirección, y la página daba un tirón.
- **Las animaciones solo mueven `transform` y `opacity`.** Esas dos las hace el chip gráfico; cualquier otra cosa (filtros, clip-path, posición del fondo) la página la vuelve a dibujar en cada fotograma. Los nombres animados, las pegatinas y el dock siguen esta regla; las pocas excepciones se dibujan una vez y solo se mueve su opacidad.
- **Un «modo ligero» para dispositivos flojos.** `main.ts` marca los móviles y las máquinas flojas (`data-perf="low"`): sin desenfoque tras los paneles, una animación de llegada más tranquila y movimiento rápido. Un monitor de fotogramas puede activarlo más tarde si la página se entrecorta.
- **El trabajo pesado, fuera de la página.** El espectáculo de luces de la llegada corre en un worker con un `OffscreenCanvas`; el cifrado de medios de las llamadas también corre en un worker.
- **Todo está alojado por nosotros.** Sin scripts, fuentes ni rastreadores de terceros; la CSP lista solo con lo que la página habla de verdad (los reproductores que se pueden incrustar en un mensaje son opcionales).
- **Los textos pasan por un solo diccionario.** Cada cadena visible está en `core/i18n/es.ts` y un script (`scripts/i18n.mjs --check`) falla cuando falta una.

## Tests

Hay **un solo comando**, `pnpm test`, y no deja nada atrás. Está dividido por temas para que cada archivo se pueda leer:

```
test/run.mjs          el ejecutor: lanza los pasos en orden
test/e2e/             el test del navegador: un archivo por paso (registro, amigos, chat, llamadas, grupos, ajustes...)
test/e2e/support.mjs  lo que comparten los pasos (carpeta temporal, puertos, limpieza)
test/security.mts     el ejecutor de las comprobaciones de seguridad (sin navegador)
test/security/        un archivo por tema: sesiones, autorización, imágenes, sockets, borrado, cabeceras...
```

Las comprobaciones de seguridad levantan el backend real en memoria y **lo atacan como lo haría una cuenta hostil**; el test del navegador maneja dos ventanas reales de Chromium (y, con `CHATTERLY_BROWSER=firefox`, Firefox).

## Dónde _no_ es perfecto

Está sabido y escrito, no escondido: las claves de los mensajes directos son estáticas (todavía sin secreto hacia delante por mensaje); un servidor que sirva JavaScript malicioso anula cualquier promesa de extremo a extremo; el servidor sigue viendo el grafo social y las horas. Ver [SECURITY.es.md](SECURITY.es.md).
