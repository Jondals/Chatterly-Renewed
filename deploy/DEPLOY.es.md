# Poner Chatterly-Renewed en un servidor de Oracle Cloud (paso a paso)

Versión en inglés, más técnica: [DEPLOY.md](DEPLOY.md).

Esta guía te lleva desde cero hasta tener Chatterly funcionando con HTTPS, llamadas privadas y actualizaciones automáticas. Cada paso dice **qué haces**, **el comando** y **cómo saber que salió bien**.

<!-- ! CRÍTICO: lee el cuadro siguiente antes de tocar el servidor. En el editor (Better Comments) las líneas con "!" salen en rojo. -->

> [!CAUTION]
> **Lo que NO puedes saltarte**
>
> 1. **`RELAY_ONLY=1` tiene que estar en el `.env` del servidor.** Ya no existe el interruptor "Ocultar mi dirección IP": decide solo el servidor. Sin esa variable, las llamadas pueden conectarse directamente y enseñar las IP. Se pone con `bash deploy/turn-setup.sh --private`.
> 2. **Tiene que existir `deploy/turnserver.generated.conf`** (lo crea `turn-setup.sh`). Sin él no arranca el servicio `turn`. Debe ser **modo 640 y grupo 65534**: con modo 600 coturn (que corre como `nobody`) no puede leerlo y arranca **sin ninguna configuración**.
> 3. **Nunca añadas `-n` al comando de coturn** (significa "no leer el fichero de configuración"). Si usas `cap_drop: ALL`, deja `NET_BIND_SERVICE`.
> 4. **Los secretos** (`.env`, `TURN_SECRET`, `JWT_SECRET`, `SERVER_SECRET`) viven solo en el servidor, nunca en Git. Si el secreto TURN se mostró alguna vez, cámbialo: `bash deploy/turn-setup.sh --rotate-secret`.
> 5. **Puertos públicos:** solo TCP 22, 80, 443, UDP 443 y TCP+UDP 3478. Con `RELAY_ONLY=1` **no** hace falta abrir UDP 49152-49252.

## Antes de empezar

Necesitas:

| Qué                                                          | Para qué                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Una cuenta de Oracle Cloud                                   | La máquina donde corre todo                                                                              |
| Un nombre en [duckdns.org](https://www.duckdns.org) (gratis) | Los navegadores solo dejan usar micrófono, cámara y cifrado con HTTPS, y para HTTPS hace falta un nombre |
| Un repositorio en GitHub con el proyecto                     | Para actualizar solo con cada `push`                                                                     |
| Unos 30-45 minutos                                           | La primera construcción de la app tarda unos minutos                                                     |

> [!WARNING]
> **Cuidado con lo que es gratis.** Según [Oracle](https://docs.oracle.com/es-ww/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), lo gratuito para siempre es: **Arm `VM.Standard.A1.Flex`** (hoy 2 OCPU y 12 GB en total), **AMD `VM.Standard.E2.1.Micro`** (1/8 de OCPU y 1 GB, hasta 2), **200 GB de almacenamiento en bloque en total** (el disco de arranque cuenta) y **10 TB de tráfico de salida al mes**.
> **Cualquier otro shape se cobra** (por ejemplo `VM.Standard.E5.Flex`, aunque tenga 1 OCPU y 12 GB). Mira el shape en la consola antes de crear la máquina.
> Además Oracle puede reclamar una instancia gratuita si en 7 días la CPU, la red y (en Arm) la memoria se quedan por debajo del 20 %.

## Paso 1. Crear la máquina

1. En Oracle Cloud: **Compute > Instances > Create instance**.
2. Imagen: **Ubuntu 24.04**. Shape: **VM.Standard.A1.Flex** con 2 OCPU y 12 GB. Disco de arranque: 100-150 GB (el total gratis es 200 GB).
3. Descarga o sube tu clave SSH. **Guárdala bien y no la compartas nunca.**
4. Anota la **IP pública**.

✔ Sabrás que fue bien cuando la instancia esté en estado _Running_ y puedas entrar:

```bash
ssh -i /ruta/a/tu-clave.key ubuntu@TU_IP
```

## Paso 2. Abrir los puertos (dos sitios: Oracle y el sistema)

Los paquetes tienen que pasar **dos** puertas. Si una está cerrada, no llegan.

**a) En Oracle** (Networking > tu VCN > Security Lists > Ingress Rules, origen `0.0.0.0/0`):

| Protocolo | Puerto   | Para qué                        |
| --------- | -------- | ------------------------------- |
| TCP       | 22       | SSH (mejor limitado a tu IP)    |
| TCP       | 80 y 443 | Web y certificados              |
| UDP       | 443      | HTTP/3 (opcional)               |
| TCP y UDP | 3478     | El relay de las llamadas (TURN) |

No abras 3000, 3001, 4200, 8000 ni 49152-49252.

**b) En el sistema.** Las imágenes de Oracle ya bloquean todo salvo lo que se permita. Para empezar:

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## Paso 3. El nombre (DuckDNS)

En duckdns.org crea un nombre (por ejemplo `chatterly-tuyo`) y apúntalo a la IP pública del paso 1.

✔ Comprueba: `nslookup chatterly-tuyo.duckdns.org` debe devolver tu IP.

## Paso 4. Instalar Docker y bajar el proyecto

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # sal y vuelve a entrar por SSH
sudo apt update && sudo apt install -y git docker-compose-v2 caddy
git clone <tu repositorio> ~/ChatterlyRenewed
cd ~/ChatterlyRenewed
cp deploy/.env.docker.example .env
```

Edita `.env` (`nano .env`) y escribe, como mínimo, `DOMAIN=chatterly-tuyo.duckdns.org` y los secretos largos y aleatorios (`openssl rand -hex 32` te da uno). `JWT_SECRET` y `SERVER_SECRET` deben ser distintos.

```bash
chmod 600 .env        # solo tu usuario puede leerlo
```

## Paso 5. Arrancar la app

```bash
docker compose up -d --build app
```

La primera vez tarda unos minutos.

✔ Comprueba:

```bash
docker compose ps                                 # app: Up (healthy)
curl -s http://127.0.0.1:3000/api/health          # {"status":"ok", ...}
```

## Paso 6. HTTPS con Caddy

Caddy pide y renueva solo el certificado.

- **Si la máquina ya tiene un Caddy** (es nuestro caso): añade el bloque de `deploy/Caddyfile.host` a `/etc/caddy/Caddyfile` cambiando el dominio, y `sudo systemctl reload caddy`.
  Importante: el bloque envía `/api/*` y `/ws` al puerto **3000** y todo lo demás al **3001**. Si solo pones el 3001, el inicio de sesión falla con _"JSON.parse: unexpected character"_.
- **Si no tiene Caddy:** `docker compose --profile caddy up -d --build` lo ejecuta dentro de Docker.

✔ Comprueba: abre `https://chatterly-tuyo.duckdns.org` (candado verde) y `curl -I` muestra la cabecera `strict-transport-security`.

## Paso 7. Llamadas privadas (relay TURN)

TURN hace de intermediario: los dos móviles/PC se conectan a **tu servidor** y no entre ellos, así que **nadie ve la IP del otro**. El audio y el vídeo ya van cifrados de extremo a extremo por la propia app, y el relay no puede leerlos.

```bash
cd ~/ChatterlyRenewed
bash deploy/turn-setup.sh --private
```

Qué hace: genera un secreto, escribe `deploy/turnserver.generated.conf` (modo 640, grupo 65534), pone `RELAY_ONLY=1` y arranca coturn y la app.

> [!NOTE]
> **Qué ve el relay:** las direcciones de red de quien lo usa y cuánto tráfico mueve. **No** puede leer el audio ni el vídeo. TURN oculta tu IP **a la otra persona**, no al dueño del servidor.

> [!NOTE]
> Con `--private`, **si el relay está caído las llamadas fallan** ("Llamada privada no disponible"). Es a propósito: nunca se cae a una conexión directa que enseñaría las IP.

### Máxima privacidad: relay por TLS y sin registros (recomendado)

```bash
bash deploy/turn-setup.sh --private --tls --no-logs
```

- `--tls`: el relay solo contesta por **TLS** (`turns:`, TCP 5349), con el certificado que Caddy ya pidió para tu dominio. Quien mire la red (tu operadora, el wifi) ya no puede leer el nombre de usuario ni los mensajes de control del relay. Sigue viendo que te conectas a tu servidor y cuánto tráfico mueves. Abre en Oracle y en el sistema **TCP 5349** y **no abras el 3478**.
- `--no-logs`: el relay no escribe ningún registro, así que no se guarda ninguna dirección.
- Abre `https://tu-dominio` una vez antes (para que Caddy tenga el certificado). El certificado se renueva solo cada ~60 días: ejecuta `bash deploy/turn-cert-sync.sh` tras cada renovación, o déjalo en un temporizador diario.

> [!NOTE]
> El relay (tú) sigue viendo las IP mientras dura la llamada: es imprescindible para reenviar los paquetes. Con estas opciones simplemente no se guardan. Por TLS el audio y el vídeo viajan por TCP: en redes con muchas pérdidas pueden notar algo más de retardo que por UDP.

✔ Comprueba:

```bash
docker compose ps                         # turn: Up (no "Restarting")
docker compose logs --tail 20 turn        # debe decir "Default realm: tu-dominio" y escuchar solo en la IP privada
grep RELAY_ONLY .env                      # RELAY_ONLY=1
ls -l deploy/turnserver.generated.conf    # -rw-r----- ... nogroup
```

## Paso 8. Actualizaciones automáticas (GitHub)

Cada `push` a la rama `main` (o `master`) actualiza el servidor. En GitHub: **Settings > Secrets and variables > Actions**, crea:

| Secreto    | Valor                                                    |
| ---------- | -------------------------------------------------------- |
| `SSH_HOST` | IP pública o dominio                                     |
| `SSH_USER` | `ubuntu`                                                 |
| `SSH_KEY`  | La clave **privada** entera (con las líneas BEGIN y END) |
| `SSH_PORT` | `22` (solo si no es 22)                                  |

> [!WARNING]
> Crea una clave **solo para esto** (`ssh-keygen -t ed25519`) y añade la parte pública a `~/.ssh/authorized_keys` del servidor. No uses tu clave personal.

> [!NOTE]
> Cada actualización deja el servidor **idéntico a GitHub** (`git reset --hard`). Los cambios hechos a mano en archivos del repo se pierden. Los archivos que no están en Git (`.env`, `docker-compose.override.yml`) se conservan.

## Paso 9. Después de cada despliegue

- ✔ `docker compose ps` → `app` healthy, `turn` en marcha (no reiniciándose).
- ✔ `curl -s http://127.0.0.1:3000/api/health` responde `ok`.
- **Primeras sesiones:** los tokens de acceso antiguos dejan de valer. Los clientes se renuevan solos con el _refresh token_ o piden volver a iniciar sesión. Es normal.
- **Si la API está en un dominio distinto al de la web**, añade ese origen al `connect-src` de `frontend/src/index.html`. Con Caddy en el mismo dominio no hace falta.
- **Haz una llamada de prueba** y comprueba que usa el relay (siguiente apartado).

## Comprobar que una llamada usa de verdad el relay

Necesitas dos cuentas y dos navegadores.

1. En el navegador que **llama**, abre `chrome://webrtc-internals` (Chrome/Edge) **antes** de llamar.
2. Haz la llamada. En el `RTCPeerConnection` abre _ICE candidate pair_: el par elegido debe tener un candidato local de tipo **`relay`** y ninguno `host` ni `srflx`.
3. En Firefox: `about:webrtc`, el par elegido debe mostrar `relay`.
4. Para el relay (`docker compose stop turn`) e intenta llamar: debe salir **"Llamada privada no disponible"** y no empezar. Vuélvelo a arrancar: `docker compose up -d turn`.
5. No copies direcciones de esas páginas en chats ni tickets.

## Copias de seguridad

La base de datos, los uploads y los secretos del servidor están en el volumen `chatterly-data`. Haz copias con frecuencia y **guárdalas también fuera del servidor**.

```bash
docker run --rm -v chatterlyrenewed_chatterly-data:/d -v $PWD:/b alpine tar czf /b/chatterly-data.tgz -C /d .
```

(El nombre real del volumen empieza por el de la carpeta: mira `docker volume ls`.)

## Si algo falla

| Síntoma                                                                | Causa y solución                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La página carga pero nada funciona; la consola dice _CORS_             | `CORS_ORIGINS` debe ser exactamente la dirección del navegador, con `https://` y sin barra final. Varias, separadas por comas. Reinicia la app tras cambiarla                                                                                                                                                                             |
| El WebSocket se cierra al instante (código 1008, "origin not allowed") | Lo mismo: el origen no está en `CORS_ORIGINS`                                                                                                                                                                                                                                                                                             |
| "La sesión caducó" todo el rato, o todos parecen tener la misma IP     | Falta `TRUST_PROXY=1`: el backend ve a Caddy como único cliente y los límites afectan a todos                                                                                                                                                                                                                                             |
| El micrófono o la cámara nunca preguntan                               | La página no está en HTTPS (o entraste por IP). Usa el dominio                                                                                                                                                                                                                                                                            |
| "Llamada privada no disponible"                                        | El relay está caído o no leyó su configuración. `docker compose logs --tail 50 turn`: un arranque sano dice `Default realm: tu-dominio` y escucha solo en la IP privada. Si escucha en todas o el realm sale vacío: comprueba que `deploy/turnserver.generated.conf` es modo 640 grupo 65534 y que el comando de coturn **no** lleva `-n` |
| El relay se reinicia sin parar con "Operation not permitted"           | Con `cap_drop: ALL` falta `cap_add: NET_BIND_SERVICE` en el servicio `turn`                                                                                                                                                                                                                                                               |
| Las llamadas solo conectan entre personas de la misma red              | Los puertos 3478 (UDP y TCP) están cerrados en Oracle o en el sistema                                                                                                                                                                                                                                                                     |
| _Frames rejected_ o "Securing…" para siempre                           | Los dos navegadores no se pusieron de acuerdo con las claves: recarga los dos. Si se repite, mira la consola de ambos y `docker compose logs app`                                                                                                                                                                                         |
| `502` de Caddy                                                         | La app está caída: `docker compose ps` y `docker compose logs --tail 80 app`                                                                                                                                                                                                                                                              |
| Tras actualizar no cambia nada                                         | El navegador guarda los archivos viejos: recarga forzada (Ctrl+Shift+R)                                                                                                                                                                                                                                                                   |

## Lista de comprobación de seguridad

Esto no se puede comprobar desde el código; revísalo en la consola de Oracle y en la máquina.

- [ ] **Oracle (Security List / NSG):** solo TCP 22 (mejor limitado a tu IP), TCP 80, TCP 443, UDP 443, TCP 3478 y UDP 3478. Nada para 3000, 3001, 4200 ni 49152-49252.
- [ ] **Firewall del sistema** (`sudo iptables -S INPUT`): los mismos puertos, política `DROP`.
- [ ] **Puertos en escucha** (`sudo ss -tulpn`): 3000 y 3001 solo en `127.0.0.1`; ningún otro servicio accesible desde fuera (bases de datos, API de Docker en 2375, paneles).
- [ ] **SSH:** solo clave (`PasswordAuthentication no`, `PermitRootLogin no`).
- [ ] **Secretos:** `.env` en modo 600 y fuera de Git; secretos largos y aleatorios.
- [ ] **TURN:** `turnserver.generated.conf` modo 640 grupo 65534; desde fuera, una petición sin credencial válida se rechaza.
- [ ] **TLS:** `curl -I https://tu.dominio` muestra HSTS; el certificado se renueva; HTTP redirige a HTTPS.
- [ ] **Parches:** `unattended-upgrades` activo; las imágenes de Docker están fijadas a una versión y se cambian a propósito.
- [ ] **Copias:** una copia reciente **fuera** del servidor y una restauración probada.
- [ ] **Coste:** el shape de la máquina es de los gratuitos (ver el aviso del principio) y el tráfico de salida está por debajo de 10 TB al mes.

## Glosario rápido

- **STUN:** le dice a un navegador cuál es su dirección pública.
- **TURN / relay:** servidor intermediario por el que pasa el audio y el vídeo; así los dos extremos solo conocen la IP del servidor.
- **WebSocket (`/ws`):** la conexión permanente por la que viajan los mensajes y las señales de las llamadas. Va cifrada de extremo a extremo; el servidor solo la reenvía.
- **Caddy:** el programa que da HTTPS y reparte el tráfico entre la API y la web.
- **OCPU:** la unidad de CPU de Oracle.
