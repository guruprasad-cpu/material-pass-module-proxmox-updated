# Material Pass Module — Docker deployment

This package builds a Linux Docker image locally on the Proxmox Linux Docker host. You do not need to install Node.js or configure Vue on the host.

## Quick start

1. Copy this extracted folder to the Linux machine/container that already has Docker and the Docker Compose plugin.
2. (Optional, for existing data) Stop the old application and copy its `material.db` into this folder's `data/material.db` **before starting Docker**. Do not overwrite an existing database without a backup.
3. From this folder, run:

   ```bash
   docker compose up -d --build
   ```

4. Find the Linux host/container IP with `hostname -I`, then open `http://YOUR-IP:3000` from an office computer.
5. Check startup with `docker compose logs -f material-pass` and status with `docker compose ps`.

The first command downloads the base Node image, builds the frontend and Linux SQLite native dependency, creates the image `material-pass-module:latest`, and starts the container. The app restarts automatically after a Docker/container restart.

## Default login

- Username: `admin`
- Password: `Admin@123`

Log in, create a new administrator, test it, and remove the default account. Change `SESSION_SECRET` in `docker-compose.yml` before office use. Do not expose this app directly to the public internet; use your office network and HTTPS/reverse proxy if remote access is needed.

## Useful commands

```bash
# View logs
docker compose logs -f material-pass

# Restart
docker compose restart material-pass

# Stop without deleting data
docker compose down

# Rebuild after replacing application source
docker compose up -d --build

# Backup database (run from this folder)
cp data/material.db "data/material.db.backup-$(date +%Y%m%d-%H%M%S)"
```

## Data persistence

The SQLite database is stored in `./data/material.db` on the Linux filesystem, not inside the disposable container. Removing/recreating the container does not remove the database. Back up this file regularly.

## Network access and QR codes

Port `3000` is published on the Linux host. Open the application using that host's reachable IP/hostname, not `localhost` on a different PC. For very large passes where the QR code uses a scan-page link, use the same reachable host address when generating the PDF. If needed, set `APP_BASE_URL` in `docker-compose.yml`, e.g. `http://192.168.1.50:3000`, then run `docker compose up -d`.

## Troubleshooting

```bash
docker compose ps
docker compose logs --tail=200 material-pass
```

If port 3000 is already occupied, change the left side of the port mapping from `3000:3000` to `3001:3000` and use port 3001 in the browser. Do not change the container-side port.
