# Material Pass Module — Proxmox Docker Package

This is the Docker-ready project source for building the image on your Proxmox Linux VM/LXC guest.

Quick start:

1. Install Docker Engine and Docker Compose plugin in a Debian/Ubuntu guest.
2. Set a secure `SESSION_SECRET` in `docker-compose.yml`.
3. Run `docker compose build --no-cache`.
4. Run `docker compose up -d`.
5. Open `http://<guest-ip>:3000`.

See `PROXMOX-DEPLOYMENT.md` for complete instructions and backup guidance. SQLite data persists under `./data`.

Note: This ZIP contains the Docker build context, not a prebuilt Docker image tar. Build the image on the Linux Docker host.
\n\nFor the 02-Nov-2026 build, follow `PROXMOX-DOCKER-BUILD-GUIDE.md`.\n