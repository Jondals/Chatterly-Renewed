# Política de seguridad

Chatterly-Renewed está hecho para que el servidor no pueda leer los mensajes ni escuchar las llamadas. Si encuentras una forma de saltarte eso, o cualquier otra vulnerabilidad, cuéntanoslo en privado.

## Lo que la app garantiza (y lo que no)

- Los mensajes, las reacciones y los adjuntos se cifran en el navegador; el servidor guarda solo texto cifrado. El audio y el vídeo de las llamadas se cifran fotograma a fotograma en el navegador, y la señalización que prepara las llamadas va cifrada y firmada entre las dos personas.
- Con `RELAY_ONLY=1` las llamadas usan solo tu relay TURN y fallan en lugar de conectar directamente. El relay y la máquina que lo aloja pueden ver direcciones de red y volumen de tráfico.
- Las fotos de perfil y los banners están cifrados de extremo a extremo: el servidor guarda texto cifrado y la clave de cada imagen se sella para las personas que pueden verla (amigos, gente que comparte un servidor, conversaciones directas). El servidor sigue sabiendo quién tiene una imagen y cuánto pesa, quien vio una imagen conserva lo que vio, y un contacto nuevo recibe la clave la próxima vez que su dueño esté en línea. Los iconos de grupo también van cifrados (desde la 2.23.0): la clave del icono viaja con el grupo, sellada con la clave del grupo, y el servidor entrega el icono solo a los miembros del grupo. Las fotografías privadas conviene enviarlas como adjuntos.
- **Los nombres de los grupos, de sus canales y de las etiquetas de miembro van sellados con la clave del grupo (desde la 2.24.0):** el servidor no los puede leer, y cada texto está atado al grupo, a lo que nombra y a la versión de la clave. (La etiqueta que una persona elige mostrar en su perfil es pública, porque se enseña a gente de fuera del grupo.) Los grupos creados antes los sella su dueño la próxima vez que abre la app.
- **La biblioteca personal (fondos de cámara) está cifrada de extremo a extremo (desde 2.30.0):** cada archivo tiene su propia clave aleatoria AES-256-GCM; esa clave y la descripción del archivo (nombre, tipo, miniatura) se sellan con una clave derivada de la identidad de la persona, y el identificador del elemento forma parte de lo que ata cada cifrado, así que el servidor no puede intercambiar las partes de dos elementos. El servidor guarda texto cifrado y solo conoce el tamaño y la hora; está limitada por persona (40 elementos, 12 MB cada uno, 160 MB en total) y se borra con la cuenta. El recorte del fondo se hace en el dispositivo con archivos de la app (sin red, sin CDN); la página permite WebAssembly para ello (`wasm-unsafe-eval`), no la evaluación de texto como código.
- Las claves de los contactos se fijan la primera vez que se ven; las llamadas con una clave cambiada se rechazan hasta revisarlas. Compara el número de seguridad en las conversaciones importantes.
- Una cuenta que escribe demasiado en una hora (mensajes del tamaño máximo, uno tras otro) se frena, para que una sola cuenta no pueda llenar el disco.
- Un servidor que sirva JavaScript malicioso puede anular todo esto: las garantías suponen que el código que cargas es el de este repositorio.
- **La app de Windows (`desktop/`) lleva ese código dentro de su instalador**, así que un servidor no puede cambiarlo. Es una ventana en sandbox sin acceso a Node, se niega a arrancar con interruptores que la debilitan y sigue una versión de Electron (Chromium) con soporte. Sus actualizaciones vienen de las Releases de GitHub de este repositorio y se comprueban con el hash de `latest.yml`; mientras el instalador no esté firmado (o publicado por la Microsoft Store), quien pueda publicar una release en el repositorio puede publicar una actualización, y la persona aún tiene que descargarla y aplicarla. Detalles: [desktop/README.es.md](desktop/README.es.md#seguridad).

## Cómo avisar

Usa el aviso privado de vulnerabilidades del repositorio (pestaña Security) o escribe a quien mantiene el proyecto por el contacto del perfil del repositorio. Incluye los pasos para reproducirlo, la versión (Ajustes > Acerca de) y qué gana un atacante.

Por favor, no abras una incidencia pública para una vulnerabilidad y no pruebes contra servidores que no sean tuyos.

## Qué esperar

Respondemos a los avisos en cuanto podemos, corregimos los problemas confirmados en la siguiente versión y te nombramos en el registro de cambios si quieres.

## Versiones con soporte

Solo la última versión recibe correcciones de seguridad.
