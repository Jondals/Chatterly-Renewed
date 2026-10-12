# Overlay dentro del juego: ¿es posible?

[English](README.md)

La pregunta: como Discord, mostrar las cámaras (y quién habla) de tus amigos **encima del juego al que estás jugando**, fijadas donde quieras, movibles y redimensionables. Solo para la app de escritorio.

**Respuesta corta: sí, para juegos en ventana o en pantalla completa sin bordes (la mayoría hoy); no para la "pantalla completa exclusiva"; y sin tocar el juego, así que no parece trampa.** Un experimento de esta carpeta demuestra la parte técnica más difícil.

## Dos formas de hacer un overlay

| | Qué es | En qué juegos funciona | Riesgo |
|---|---|---|---|
| **Inyección** (lo que hace Discord) | Se carga una DLL dentro del juego y engancha su API gráfica (DirectX, OpenGL, Vulkan) para dibujar en cada fotograma | También en pantalla completa exclusiva | Los sistemas anti-trampas detectan los enganches y las DLL inyectadas y pueden banear; Discord necesita que los fabricantes lo permitan. Código nativo, firmado, por API. **No es realista para este proyecto** |
| **Una ventana encima** (lo que hace este experimento) | Una ventana transparente, sin marco, siempre encima, que nunca coge el foco y deja pasar el ratón. Es otra ventana de la app: no lee ni cambia el juego | Ventana y pantalla completa sin bordes (las "optimizaciones de pantalla completa" de Windows 10/11 hacen que muchos juegos "a pantalla completa" sean también sin bordes) | Un juego en pantalla completa exclusiva se apodera del monitor y ninguna otra ventana se puede dibujar encima. No hay inyección, así que no hay nada que un anti-trampas marque (no se puede garantizar en todos los juegos: prueba los que importen) |

## Qué demuestra el experimento

`node desktop/experiments/overlay/run.mjs` (añade `OVERLAY_VISIBLE=1` para ver las dos ventanas unos segundos; sin eso se quedan fuera de la pantalla, y una ventana fuera de la pantalla no se dibuja, así que la tasa de fotogramas solo significa algo con el overlay visible).

Hace un vídeo en directo en una ventana de "llamada" y lo muestra en una ventana de overlay a través de un **bucle local de WebRTC** (los dos extremos en el mismo ordenador, sin STUN, sin TURN, nada por la red). En la máquina de desarrollo (Electron 44):

- la primera imagen llega al overlay en **unos 0,45 s**;
- **30 fotogramas por segundo**, estables, a 320x180 (la llamada envía la imagen al overlay a mitad de tamaño: un mosaico no necesita más);
- toda la app (5 procesos, las dos ventanas) usa **alrededor del 2 % de un núcleo**;
- la ventana del overlay se crea como debe: `alwaysOnTop` al nivel `screen-saver`, `focusable: false`, transparente, sin marco, fuera de la barra de tareas, `setIgnoreMouseEvents(true, { forward: true })`.

Por qué un bucle local: un `MediaStream` no se puede pasar a otra ventana (cada ventana es su propio proceso), y la API Document Picture-in-Picture, que dejaría a la página dibujar en una ventana propia, es una función del propio navegador Chrome que Electron no tiene. El bucle local es la forma habitual, y mantiene intacto el modelo de cifrado de extremo a extremo: los fotogramas ya están descifrados en la ventana de la llamada, viajan dentro del ordenador y no salen de él.

## Cómo funcionaría en Chatterly

1. **La ventana del overlay**: una por pantalla, tan grande como la pantalla, transparente y que deja pasar el ratón. Dibuja los mosaicos (cámara o avatar, nombre, estado del micrófono) de la gente de la llamada.
2. **Un atajo de teclado** (por ejemplo Ctrl+Mayús+O, que elige la persona) activa el *modo edición*: la ventana deja de dejar pasar el ratón y los mosaicos se pueden arrastrar, redimensionar, fijar y ocultar. Al terminar la edición, la ventana vuelve a dejar pasar el ratón y el foco vuelve al juego.
3. **Disposición por pantalla**, recordada (la misma idea que `window-state.json`).
4. **El vídeo** llega al overlay por el bucle local del experimento, solo para los mosaicos que se muestran y a baja resolución.
5. **Cuándo mostrarlo**: primero a mano (atajo y un ajuste), luego automáticamente cuando hay un juego en marcha. Detectar el juego necesita la lista de procesos o la ventana en primer plano; Electron no tiene API para eso, así que hace falta o una consulta periódica al sistema (PowerShell, pesada y lenta) o un pequeño módulo nativo (por ejemplo `electron-overlay-window`, que además mantiene el overlay pegado a la ventana del juego: hay que compilarlo para la versión de Electron, que es una cosa más que mantener y una dependencia más que revisar).
6. **Privacidad**: el overlay es una ventana más de la app, con el mismo sandbox y las mismas reglas; se puede dejar fuera de las grabaciones de pantalla (`setContentProtection(true)`, para que las cámaras de tus amigos no salgan en tu directo) con un ajuste.

## Límites y riesgos, con honestidad

- **Pantalla completa exclusiva**: imposible con este enfoque. La persona tiene que jugar en modo sin bordes (la mayoría de juegos lo tiene).
- **Otra ventana sobre el juego** puede impedir que Windows presente el juego directamente en pantalla (un pequeño coste de tiempo de fotograma en algunos equipos) y algunos juegos reclaman su propio estado de "siempre encima": el overlay tiene que reclamar su nivel de vez en cuando.
- **Anti-trampas**: sin inyección ni lectura de memoria, así que nada de este diseño es lo que buscan los anti-trampas. Pero cada uno tiene sus reglas sobre otras ventanas y a algunos no les gustan los overlays; no se puede prometer para todos los juegos.
- **El modo edición** necesita que la ventana coja el ratón un momento, y eso hace que el juego pierda el foco: el foco debe volver al terminar.
- **Primero Windows**: macOS necesita `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` (las apps a pantalla completa son sus propios Spaces) y Linux con Wayland no puede prometer ni siempre encima ni dejar pasar el ratón.

## Esfuerzo

Unas **1,5 a 2,5 semanas** para una primera versión (la ventana del overlay, el atajo y el modo edición, los mosaicos, la disposición por pantalla, el bucle con baja resolución, un ajuste, pruebas). La detección automática del juego, con un módulo nativo, es **una semana más**.

## Fuentes

- [electron-overlay-window](https://github.com/SnosMe/electron-overlay-window): la biblioteca habitual para pegar un overlay a la ventana de un juego (la busca por título y sigue su sitio; Windows y Linux X11).
- Incidencias de Electron sobre overlays encima de aplicaciones a pantalla completa: [#5994](https://github.com/electron/electron/issues/5994) y [#10078](https://github.com/electron/electron/issues/10078).
- [Daily: un overlay de videollamada con Electron](https://www.daily.co/blog/building-a-video-call-overlay-app-with-electron-and-daily-part-1/).
- Sobre inyección y anti-trampas: un [hilo de soporte de Discord](https://support.discord.com/hc/da/community/posts/360049720374-CS-GO-Overlay-not-working-after-update) sobre una actualización de un anti-trampas que bloqueó la DLL del overlay, el aviso de [HydraHook](https://github.com/nefarius/HydraHook) (un framework de enganche a DirectX) de que los enganches y las DLL inyectadas se pueden detectar y llevar a baneos, y [un hilo del foro de Blizzard](https://us.forums.blizzard.com/en/overwatch/t/integrity-question-will-this-overlay-get-players-banned/670648) donde nadie puede confirmar una lista blanca general.
- Sobre pantalla completa exclusiva y sin bordes: [incidencia 717 de winit](https://github.com/rust-windowing/winit/issues/717) (en pantalla completa exclusiva la ventana se apodera del dibujo en el monitor y ninguna otra puede dibujar en él).
