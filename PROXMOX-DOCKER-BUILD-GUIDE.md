# Material Pass Module – Proxmox Docker Build (02-Nov-2026)

This bundle contains the latest application source and Docker build files for Linux/Proxmox.
The image tag is `material-pass-module:2026-11-02`.

## Build on Proxmox

Run these commands inside the Linux VM/LXC that has Docker Engine and the Docker Compose plugin installed.

```bash
unzip Material-Pass-Proxmox-Docker-2026-11-02.zip
cd Material-Pass-Proxmox-Docker-2026-11-02
cp .env.example .env
nano .env
```

Set a strong unique `SESSION_SECRET`. Set `APP_BASE_URL` to the URL users will use to open the application. Do not leave the example values.

Build and start:

```bash
mkdir -p data
chmod +x BUILD-IMAGE-LINUX.sh
./BUILD-IMAGE-LINUX.sh
docker compose up -d
```

Check:

```bash
docker image ls | grep material-pass-module
docker compose ps
docker compose logs -f --tail=100
curl -i http://127.0.0.1:3000/api/auth/me
```

Open `http://PROXMOX_HOST_OR_LXC_IP:3000` from a browser. If port 3000 is already in use, change the left side of `3000:3000` in `docker-compose.yml`, for example `3001:3000`, then use port 3001 in the browser and in `APP_BASE_URL`.

## Database and upgrades

- SQLite data is persisted in the `./data` folder on the host, mounted to `/app/data` in the container.
- Before upgrading an existing installation, stop the current container and back up the database:
  ```bash
  docker compose down
  cp -a data data-backup-$(date +%F-%H%M)
  ```
- Copy this project folder over the old source folder (keep the backup), then rebuild and start:
  ```bash
  docker compose build --no-cache
  docker compose up -d
  ```
- Do not delete or replace `data/material.db` when upgrading.
- Confirm the application and key workflows in staging before using the update in production.

## Runtime details

- Node.js 24 is used in both build and runtime stages to match the application's declared engine (`>=24 <25`).
- The container listens on port 3000.
- Persistent database path: `/app/data/material.db`.
- Image name: `material-pass-module:2026-11-02`.

## Important

This environment does not have Docker Engine/BuildKit installed, so the image itself could not be built or exported here. This package is the prepared Docker build context; run the commands above on your Proxmox Docker host to create the actual Linux image.
