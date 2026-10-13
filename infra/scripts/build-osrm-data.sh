#!/usr/bin/env bash
# Build the OSRM routing data for the Ashanti Region and (re)start the osrm container.
# Usage: build-osrm-data.sh <compose-project> <compose-file>      (run from cron monthly, or by hand)
#
# Each build goes into its own directory (build-<stamp>) inside the osrm-data volume. The `current`
# symlink, which the osrm service serves, is switched only after extract, partition and customize all
# succeeded. A failed build removes its partial directory and leaves `current` untouched, so routing
# that was already working keeps working across any later restart.
set -euo pipefail
PROJECT="${1:?compose project, e.g. ashantihub}"
COMPOSE_FILE="${2:?path to infra/compose/docker-compose.yml}"
VOLUME="${PROJECT}_osrm-data"
OSMIUM_IMAGE="iboates/osmium:1.19.0"
OSRM_IMAGE="ghcr.io/project-osrm/osrm-backend:v5.27.1"
# Ashanti Region bounding box: lng_min,lat_min,lng_max,lat_max (matches routing/region.py ASHANTI_RING).
BBOX="-2.80,5.80,-0.60,7.50"
STAMP="$(date +%Y%m%d%H%M%S)"
BUILD="build-$STAMP"

# Fail fast on a bad project/compose file, before downloading anything.
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" config -q

WORK="$(mktemp -d)"
OK=0
cleanup() {
  rm -rf "$WORK"
  if [ "$OK" != 1 ]; then
    echo "Build failed; removing partial $BUILD and leaving current untouched" >&2
    docker run --rm -v "$VOLUME:/data" "$OSRM_IMAGE" rm -rf "/data/$BUILD" || true
  fi
}
trap cleanup EXIT

curl -fsSL -o "$WORK/ghana.osm.pbf" https://download.geofabrik.de/africa/ghana-latest.osm.pbf
docker run --rm -v "$WORK:/data" "$OSMIUM_IMAGE" extract --bbox "$BBOX" /data/ghana.osm.pbf -o /data/ashanti.osm.pbf --overwrite
docker volume create "$VOLUME" >/dev/null
# Extract from the /in mount; only the built graph lands in the volume.
docker run --rm -v "$WORK:/in" -v "$VOLUME:/data" "$OSRM_IMAGE" sh -c \
  "set -e; mkdir -p /data/$BUILD && cp /in/ashanti.osm.pbf /data/$BUILD/ashanti.osm.pbf \
   && osrm-extract -p /opt/car.lua /data/$BUILD/ashanti.osm.pbf \
   && osrm-partition /data/$BUILD/ashanti.osrm && osrm-customize /data/$BUILD/ashanti.osrm \
   && rm -f /data/$BUILD/ashanti.osm.pbf"
# Switch atomically, then keep only this build and the previous one.
docker run --rm -v "$VOLUME:/data" "$OSRM_IMAGE" sh -c \
  "set -e; prev=\$(readlink /data/current 2>/dev/null || true); \
   ln -sfn $BUILD /data/current.new && mv -T /data/current.new /data/current; \
   for d in /data/build-*; do n=\$(basename \$d); [ \"\$n\" = $BUILD ] || [ \"\$n\" = \"\$prev\" ] || rm -rf \$d; done"
OK=1
# The osrm service sits in the "routing" compose profile, so deploy.sh never starts it; naming it here
# starts it. --force-recreate makes a monthly refresh load the new data.
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --force-recreate osrm
echo "OSRM data built and osrm restarted for $PROJECT"
