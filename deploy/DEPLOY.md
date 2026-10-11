# Putting Chatterly-Renewed on a free server (Oracle Cloud)

Spanish version, step by step and easier to follow: [DEPLOY.es.md](DEPLOY.es.md).

<!-- ! CRITICAL: read this block before touching the server. In the editor (Better Comments) the "!" lines show in red. -->

> [!CAUTION]
> **Critical points of this deployment**
>
> 1. **`RELAY_ONLY=1` must be in the server `.env`.** The switch "Hide my IP address" no longer exists: the server alone decides. Without that variable calls can connect directly and show the addresses. Set it with `bash deploy/turn-setup.sh --private`.
> 2. **`deploy/turnserver.generated.conf` must exist** (it is made by `turn-setup.sh`). Without it the `turn` service does not start. Its mode must be `640` with group `65534`: with `600` coturn (user `nobody`) cannot read it and starts **without any configuration**.
> 3. **Never add `-n` to the coturn command** (it means "do not read the config file") and keep `NET_BIND_SERVICE` if `cap_drop: ALL` is used.
> 4. **Secrets** (`.env`, `TURN_SECRET`, `JWT_SECRET`, `SERVER_SECRET`) live only on the server, never in Git. Rotate `TURN_SECRET` with `bash deploy/turn-setup.sh --rotate-secret` if it was ever shown.
> 5. **Firewall and Oracle:** only TCP 22, 80, 443, UDP 443 and TCP+UDP 3478 are public. With `RELAY_ONLY=1` the range UDP 49152-49252 is **not** needed.

<!-- * After EVERY deploy of a version that changes the sessions (2.16.0 and later), do the checks below. -->

### After a deploy

- **First sessions:** the old access tokens carry no session and stop working. The clients renew them by themselves with the refresh token, or ask the person to sign in again. This is expected.
- **API on another origin than the web:** add that origin to `connect-src` in `frontend/src/index.html`. With Caddy on the same domain (our case) it is not needed.
- **Health:** `curl -s http://127.0.0.1:3000/api/health` answers `{"status":"ok"}` and `docker compose ps` shows `app` healthy and `turn` running (not restarting).
- **Relay check:** make a test call and follow "Check that a call really uses the relay" below (`chrome://webrtc-internals`: the selected pair must be `relay`).
- **If calls say "Private call unavailable":** the relay is down or its configuration was not read: `docker compose logs --tail 50 turn` (a healthy start shows `Default realm: <your domain>` and listens only on the private IP).

1. **The machine.** In Oracle Cloud create an _Always Free_ instance: shape `VM.Standard.A1.Flex` (ARM; Oracle's page currently says 2 OCPU and 12 GB in total, 200 GB of block storage in total, 10 TB of outbound traffic per month), image Ubuntu 24.04, and download the SSH key. <!-- ! Only A1.Flex (Arm) and E2.1.Micro (1 GB) are Always Free. A shape such as VM.Standard.E5.Flex is billed per OCPU-hour and GB-hour. -->
   > [!WARNING]
   > Check the shape in the Oracle console before you create it: **only `VM.Standard.A1.Flex` (up to the limits above) and `VM.Standard.E2.1.Micro` are free**. Any other shape (for example `VM.Standard.E5.Flex`) is charged. See [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).
2. **Open the ports.** In the VCN of the instance (Networking > Security List) add _ingress_ rules for TCP 80 and 443. Ubuntu images of Oracle also block them with iptables:
   `sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT && sudo netfilter-persistent save`
3. **A domain.** The browser only allows microphone, camera and encryption on HTTPS, so you need a name: a free one from [duckdns.org](https://www.duckdns.org) pointing to the public IP of the instance.
4. **Software.**
   `sudo apt update && sudo apt install -y git caddy` · Node 22 (`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`) · `sudo corepack enable`.
5. **The app.** `git clone <your repository> ~/ChatterlyRenewed && cd ~/ChatterlyRenewed && pnpm run install:all && pnpm build`.
6. **Run it always.** Copy `deploy/chatterly.service` to `/etc/systemd/system/` (change the domain and the user), then `sudo systemctl enable --now chatterly`. The database and the keys of the server are kept in `DATA_DIR`: make copies of that folder.
7. **HTTPS.** Copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile` (change the domain) and `sudo systemctl reload caddy`. Caddy gets and renews the certificate by itself.
8. **Updates after every commit.** Let the user run `deploy/update.sh` without a password (`echo 'ubuntu ALL=NOPASSWD: /bin/systemctl restart chatterly' | sudo tee /etc/sudoers.d/chatterly`) and add the three secrets that `.github/workflows/deploy.yml` mentions. From then on, every push to `main` updates the server.
9. **Your own STUN and TURN servers, free, in the same machine** (see "Calls" below).

## With Docker (instead of steps 4 to 8)

1. Do steps 1 to 3 above (the machine, the ports 80 and 443, and the domain). Also open UDP 443 if you want HTTP/3.
2. Install Docker: `curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER` (log out and in again).
3. `git clone <your repository> ~/ChatterlyRenewed && cd ~/ChatterlyRenewed && cp deploy/.env.docker.example .env`, then edit `.env` (the domain at least).
4. `docker compose up -d --build app`. The first build takes a few minutes on the ARM machine. HTTPS: if the machine already has a Caddy, add the block of `deploy/Caddyfile.host` (the API on 3000 AND the web on 3001, or sign-in fails with "JSON.parse: unexpected character") and `sudo systemctl reload caddy`; if not, `docker compose --profile caddy up -d --build` runs one inside Docker.
5. Update: `git pull && docker compose up -d --build app`, or let GitHub do it after every push (`.github/workflows/deploy.yml`; the branch must be the one named in the file: `master` or `main`). Logs: `docker compose logs -f app`.
6. The database, the uploads and the secrets are in the volume `chatterly-data`. Copy it now and then: `docker run --rm -v chatterly-data:/d -v $PWD:/b alpine tar czf /b/chatterly-data.tgz -C /d .` (the real name of the volume starts with the name of the folder, see `docker volume ls`).
7. Calls between different networks need a relay (TURN): run `bash deploy/turn-setup.sh` on the server (it writes the TURN variables of `.env`, opens the ports with iptables and starts coturn and the app), and then, in Oracle Cloud > Networking > your VCN > Security List, add ingress rules (source 0.0.0.0/0) for **UDP 3478** and **TCP 3478** (and **UDP 49152-49252** when calls may connect without the relay; `--private` does not need it). Without that last step Oracle drops the packets before they reach the machine. To make every call private set `RELAY_ONLY=1` (`bash deploy/turn-setup.sh --private`): calls then use only the relay, and are refused when it is down. To check it, make a call and follow "Check that a call really uses the relay" below.

### Secrets of GitHub for the automatic update

`SSH_HOST` (public IP or domain of the server), `SSH_USER` (for example `ubuntu`), `SSH_KEY` (the whole private key, with the lines BEGIN and END) and `SSH_PORT` (22 unless you changed it). Nothing else is needed. Use a key made only for this (`ssh-keygen -t ed25519`) and put its public part in `~/.ssh/authorized_keys` of the server.

## Calls: STUN, TURN and the signalling

- **Signalling** is the WebSocket `/ws` of the backend. Caddy passes it on by itself (`reverse_proxy` understands WebSockets), so nothing else is needed. What travels through it is sealed: the messages are encrypted in the browser and the offers and answers of a call are signed and encrypted between the two people, so the server only forwards them.
- **STUN** tells a browser its public address. The app uses Google's by default; you can use your own (coturn does STUN too).
- **TURN** relays the media when a direct path is impossible (phones on mobile data, strict offices). The media is encrypted frame by frame in the browsers before it reaches TURN, so the relay cannot read it.

Install and start coturn on the machine:

1. `sudo apt install -y coturn` and set `TURNSERVER_ENABLED=1` in `/etc/default/coturn`.
2. Copy `deploy/turnserver.conf` to `/etc/turnserver.conf`, and change `static-auth-secret`, `realm` and `external-ip` (the public IP and the private one of the instance, `ip a` shows it).
3. Open **UDP and TCP 3478** (and **UDP 49152-49252** only if calls may also connect without the relay: with `RELAY_ONLY=1` that range does not need to be public), in the VCN (Security List) _and_ in iptables: `sudo iptables -I INPUT 6 -p udp --dport 3478 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp --dport 3478 -j ACCEPT && sudo iptables -I INPUT 6 -p udp --dport 49152:49252 -j ACCEPT && sudo netfilter-persistent save`.
4. `sudo systemctl enable --now coturn`.
5. Tell the backend, in `chatterly.service`: `Environment=STUN_URLS=stun:chatterly.example.com:3478`, `Environment=TURN_URLS=turn:chatterly.example.com:3478?transport=udp,turn:chatterly.example.com:3478?transport=tcp` and `Environment=TURN_SECRET=<the same secret>`. Then `sudo systemctl daemon-reload && sudo systemctl restart chatterly`. The backend gives every user short-lived TURN credentials (one hour) made from that secret; nobody receives the secret.

## When something fails

| Symptom                                                                              | Cause and cure                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The page loads but nothing works, the console says _CORS_                            | `CORS_ORIGINS` has to be exactly the address in the browser, with `https://` and without a final slash (`https://chatterly.example.com`). Several addresses go separated by commas. The WebSocket checks the same list. The desktop app carries the web app inside and uses the origin `app://chatterly` (Docker already has it; without Docker add it to the list). After changing it: `sudo systemctl restart chatterly`.                           |
| The WebSocket closes at once (code 1008, "origin not allowed")                       | The same: the origin is not in `CORS_ORIGINS`.                                                                                                                                                                                                                                                           |
| Login says the session expired all the time, or every user seems to have the same IP | `TRUST_PROXY=1` is missing: the backend sees Caddy as the only client and the rate limits hit everybody.                                                                                                                                                                                                 |
| The microphone or the camera never asks                                              | The page is not on HTTPS (or you opened it by IP). Use the domain.                                                                                                                                                                                                                                       |
| Calls connect only between people on the same network                                | STUN works but there is no TURN, or its ports are closed. Check with `https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`: add `turn:chatterly.example.com:3478` with a username and a password taken from `/api/rtc/config` (open it signed in) and look for a `relay` candidate. |
| _Frames rejected_ or "Securing…" for ever                                            | The two browsers could not agree on the keys: reload both. If it repeats, look at the console of both browsers and at `journalctl -u chatterly -e`.                                                                                                                                                      |
| `502` from Caddy                                                                     | The backend or the web server is down: `sudo systemctl status chatterly` and `journalctl -u chatterly -e`.                                                                                                                                                                                               |
| After an update nothing changes                                                      | The browser keeps the old files: hard reload (Ctrl+Shift+R).                                                                                                                                                                                                                                             |

## Other servers inside the same machine

Everything above runs in one Always Free instance (the Arm A1 one has, today, 2 OCPU and 12 GB in total, enough for the app, Caddy and coturn). Keep it healthy: `sudo apt install -y unattended-upgrades`, copy the folder `DATA_DIR` now and then (`rsync` to your computer) and keep an eye on the disk with `df -h`.

## Maximum privacy: relay over TLS, no logs

```bash
bash deploy/turn-setup.sh --private --tls --no-logs
```

- `--tls`: the relay answers only over TLS (`turns:`, TCP 5349) with the certificate that Caddy already got for your domain. Whoever watches the network (a mobile operator, a Wi-Fi owner) can no longer read the user names or the control messages of the relay; they still see that someone talks to your server and how much. Open **TCP 5349** (VCN and host) and do **not** open 3478. Open `https://your.domain` once first, so that Caddy has the certificate; run `bash deploy/turn-cert-sync.sh` after every renewal (about every 60 days) or put it in a daily timer.
- `--no-logs`: the relay writes no log at all, so no address is ever stored.
- The operator of the relay still sees the addresses while a call lasts (it has to forward the packets). TLS runs over TCP: on lossy networks audio and video may feel slightly more delay than over UDP.

## Check that a call really uses the relay

With `RELAY_ONLY=1` the app refuses to call when the relay is unavailable, and closes a connection that is found to use a direct path. To see it with your own eyes in a test browser (two accounts, two browsers):

1. Open `chrome://webrtc-internals` (Chrome/Edge) in the browser that makes the call, before the call.
2. Make the call. In the `RTCPeerConnection` of the call open "ICE candidate pair": the selected pair must have a **local candidate of type `relay`** and no `host` or `srflx` one. The candidate grid must list only `relay` candidates.
3. In Firefox use `about:webrtc`: the selected pair must show the candidate type `relay`.
4. Stop the relay (`docker compose stop turn`) and try to call: you must see "Private call unavailable" and the call must not start. Start it again afterwards.
5. Do not copy addresses from these pages into chats or tickets.

## Security checklist for the Oracle Cloud machine (cannot be checked from the repository)

Nothing here can be verified from the code; check each point in the Oracle Cloud Console or on the machine.

- [ ] **Security List / NSG** (Networking > VCN): ingress only for TCP 22 (restricted to your own address, not 0.0.0.0/0), TCP 80, TCP 443, UDP 443 (HTTP/3), UDP 3478 and TCP 3478 (plus UDP 49152-49252 only when `RELAY_ONLY` is not 1). Nothing for 3000, 3001, 4200.
- [ ] **Host firewall** (`sudo iptables -S INPUT`): the same ports; nothing else open.
- [ ] **Listening ports** (`sudo ss -tulpn`): 3000 and 3001 only on `127.0.0.1`; no other service reachable from outside (databases, Docker API on 2375, admin panels).
- [ ] **SSH**: key only (`PasswordAuthentication no`, `PermitRootLogin no`), the deploy key of GitHub limited to this machine.
- [ ] **Secrets**: `.env` has permissions 600 and is not in the repository; `JWT_SECRET`, `SERVER_SECRET`, `TURN_SECRET` are long random values. A TURN secret that was ever shown outside the server must be replaced: `bash deploy/turn-setup.sh --rotate-secret`. If a real secret was ever committed, rotate it and remove it from the Git history (that needs a decision of the owner: it rewrites history).
- [ ] **TURN**: `deploy/turnserver.generated.conf` has mode 640 and group 65534 (coturn runs as `nobody` and must be able to read it, nobody else may); from outside, an allocation without a valid credential is refused (`turnutils_uclient` with a wrong password fails); the relay answers only on the ports above.
- [ ] **TLS**: `curl -I https://your.domain` shows HSTS; the certificate renews (Caddy logs); HTTP redirects to HTTPS; WebSocket works over `wss://`.
- [ ] **Reverse proxy**: the app sees one proxy (`TRUST_PROXY=1`) and Caddy replaces any `X-Forwarded-For` sent by a client.
- [ ] **Updates**: `unattended-upgrades` on; Docker images updated on purpose (the tags are pinned in `docker-compose.yml`; change them deliberately and test).
- [ ] **Backups**: `BACKUP_PASSPHRASE=... docker compose exec app node scripts/backup.mjs backup /data/backups`, copy off the machine, and test a restore into another path. The backup of `secrets.json` and of the uploads folder must be encrypted too.
- [ ] **Monitoring**: disk space (`df -h`), the logs rotate (`docker inspect` shows the log options), an alert if the site or the relay stops answering.
- [ ] **Logs**: the app logs no addresses or queries; coturn logs allocations (addresses) to its container log, which rotates at 5 x 10 MB; decide how long you keep them.
