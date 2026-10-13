#!/usr/bin/env bash
# Build the OSRM routing data for the Ashanti Region and (re)start the osrm container.
# Usage: build-osrm-data.sh <compose-project> <compose-file>      (run from cron monthly, or by hand)
set -euo pipefail
PROJECT="${1:?compose project, e.g. ashantihub}"
COMPOSE_FILE="${2:?path to infra/compose/docker-compose.yml}"
VOLUME="${PROJECT}_osrm-data"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# Ashanti Region bounding box: lng_min,lat_min,lng_max,lat_max (matches routing/region.py ASHANTI_RING).
BBOX="-2.80,5.80,-0.60,7.50"

curl -fsSL -o "$WORK/ghana.osm.pbf" https://download.geofabrik.de/africa/ghana-latest.osm.pbf
docker run --rm -v "$WORK:/data" iboates/osmium:latest extract --bbox "$BBOX" /data/ghana.osm.pbf -o /data/ashanti.osm.pbf --overwrite
docker volume create "$VOLUME" >/dev/null
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"
docker run --rm -v "$WORK:/in" -v "$VOLUME:/data" "$OSRM_IMAGE" sh -c \
  "cp /in/ashanti.osm.pbf /data/ashanti.osm.pbf && osrm-extract -p /opt/car.lua /data/ashanti.osm.pbf && osrm-partition /data/ashanti.osrm && osrm-customize /data/ashanti.osrm"
# The osrm service sits in the "routing" compose profile, so deploy.sh never starts it; naming it here
# starts it. --force-recreate makes a monthly refresh load the new files.
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --force-recreate osrm
echo "OSRM data built and osrm restarted for $PROJECT"
