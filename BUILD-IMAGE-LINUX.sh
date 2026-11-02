#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose build --no-cache
docker image inspect material-pass-module:2026-11-02 >/dev/null
echo "Built image: material-pass-module:2026-11-02"
