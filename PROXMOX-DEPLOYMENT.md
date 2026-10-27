# Material Pass Module — Proxmox Linux Docker Deployment

This package contains the Docker build context. Build the image on the Proxmox Linux host (or another Linux Docker host) using the included Dockerfile. A prebuilt image archive is not included because Docker is not available in the packaging environment.

## 1. Requirements
- Proxmox VE with a Debian/Ubuntu Linux VM or LXC container.
- Docker Engine and Docker Compose plugin installed inside that guest/container.
- If using an LXC container, enable nesting and keyctl in Proxmox options; a dedicated VM is usually the simpler, more isolated Docker host.
- TCP port 3000 available on the guest/container firewall.

## 2. Copy and extract
Copy this ZIP to the Linux guest/container and run:

```bash
unzip material-pass-module-proxmox-docker.zip
cd material-pass-module-docker
```

If the extracted folder name differs, `cd` into the folder containing `Dockerfile` and `docker-compose.yml`.

## 3. Configure before first start
Edit `docker-compose.yml` and replace `SESSION_SECRET` with a long random secret. Example generation command:

```bash
openssl rand -hex 32
```

Paste the generated value into the compose file. Keep it private. Do not commit it to a public repository.

The SQLite database is persisted in `./data` on the host, mounted to `/app/data` in the container. Back up this directory before deployment or upgrades.

## 4. Build and start
From the directory containing `docker-compose.yml`:

```bash
mkdir -p data
chmod 755 data
docker compose build --no-cache
docker compose up -d
docker compose ps
docker compose logs -f material-pass
```

The image is tagged `material-pass-module:1.1.0`.

## 5. Open the application
Browse to:

`http://<LINUX-GUEST-IP>:3000`

Use the IP address of the VM/LXC guest running Docker, not necessarily the Proxmox host IP.

## 6. Back up the database
Stop writes briefly or stop the app before copying the database for a consistent simple backup:

```bash
mkdir -p backups
docker compose stop material-pass
cp -a data/material.db "backups/material.db.$(date +%F-%H%M%S)"
docker compose start material-pass
```

Keep backups outside the deployment folder too. Do not overwrite a live `material.db` with an empty database.

## 7. Updating the application
1. Back up `data/material.db` and the full `data/` directory.
2. Copy the new source into a separate staging directory.
3. Run `docker compose build --no-cache` and test against a COPY of the production database first.
4. Only then schedule the production replacement.

## Notes
- The server uses `DB_PATH`, defaulting to `/app/data/material.db`, and listens on `PORT` (default 3000).
- Do not expose port 3000 directly to the public internet; restrict access to trusted networks or put the app behind an appropriately secured reverse proxy/VPN.
- Verify login, pass creation, PDF/QR generation, arrival/return transactions, and Excel export in a staging deployment before production use.
