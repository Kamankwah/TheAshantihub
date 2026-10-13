#!/usr/bin/env bash
# Build the OSRM routing data for the Ashanti Region and (re)start the osrm container.
# Usage: build-osrm-data.sh <compose-project> <compose-file>      (run from cron monthly, or by hand)
#
# Each build goes into its own directory (build-<stamp>) inside the osrm-data volume. The `current`
# symlink, which the osrm service serves, is switched only after extract, partition and customize all
# succeeded. A failed build removes its partial directory and leaves `current` untouched, so routing
# that was already working keeps working across any later restart. The cleanup never removes the
# directory `current` points to, whatever fails and whenever.
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

# Run a shell snippet against the osrm-data volume (in the osrm image: has sh, rm, ln, mv, readlink).
# Extra arguments become $1, $2 ... in the snippet.
vol() { local snippet="$1"; shift; docker run --rm -v "$VOLUME:/data" "$OSRM_IMAGE" sh -c "$snippet" sh "$@"; }

WORK="$(mktemp -d)"
OK=0
cleanup() {
  rm -rf "$WORK"
  if [ "$OK" != 1 ]; then
    echo "Build did not complete; removing partial $BUILD unless current points to it" >&2
    # Re-check inside the volume: never delete the build that `current` points to.
    vol '[ "$(readlink /data/current 2>/dev/null)" = "$1" ] || rm -rf "/data/$1"' "$BUILD" || true
  fi
}
trap cleanup EXIT

curl -fsSL -o "$WORK/ghana.osm.pbf" https://download.geofabrik.de/africa/ghana-latest.osm.pbf
docker run --rm -v "$WORK:/data" "$OSMIUM_IMAGE" extract --bbox "$BBOX" /data/ghana.osm.pbf -o /data/ashanti.osm.pbf --overwrite
docker volume create "$VOLUME" >/dev/null
# The clipped PBF is mounted read-only at /in. osrm-extract writes its output next to its input, so the
# PBF is copied into the build directory, extracted there, and deleted once the graph is built.
docker run --rm -v "$WORK:/in:ro" -v "$VOLUME:/data" "$OSRM_IMAGE" sh -c \
  "set -e; mkdir -p /data/$BUILD && cp /in/ashanti.osm.pbf /data/$BUILD/ashanti.osm.pbf \
   && osrm-extract -p /opt/car.lua /data/$BUILD/ashanti.osm.pbf \
   && osrm-partition /data/$BUILD/ashanti.osrm && osrm-customize /data/$BUILD/ashanti.osrm \
   && rm -f /data/$BUILD/ashanti.osm.pbf"

# Which build is live now (empty on a first build). Read-only; a failure here only means "unknown".
PREV="$(vol 'readlink /data/current 2>/dev/null || true' || true)"

# The one step that matters: atomic switch. OK=1 the moment it succeeds, so from here on the trap can
# never remove this build. If the container dies after mv but before returning, the trap's readlink
# check still protects the build.
vol 'set -e; ln -sfn "$1" /data/current.new && mv -T /data/current.new /data/current' "$BUILD"
OK=1

# Housekeeping after a successful switch. Can never fail the script; keeps the new and previous builds
# only, and removes root-level leftovers of the older in-place builds.
vol 'for d in /data/build-*; do [ -e "$d" ] || continue; n=$(basename "$d"); [ "$n" = "$1" ] || [ "$n" = "$2" ] || rm -rf "$d"; done
     rm -f /data/ashanti.osm.pbf /data/ashanti.osrm* /data/current.new' "$BUILD" "$PREV" || true

# The osrm service sits in the "routing" compose profile, so deploy.sh never starts it; naming it here
# starts it. --force-recreate makes a monthly refresh load the new data.
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --force-recreate osrm
echo "OSRM data built and osrm restarted for $PROJECT"
