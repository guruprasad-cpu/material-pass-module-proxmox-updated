#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose build --no-cache
docker image inspect material-pass-module:1.1.0 >/dev/null
echo "Built image: material-pass-module:1.1.0"
