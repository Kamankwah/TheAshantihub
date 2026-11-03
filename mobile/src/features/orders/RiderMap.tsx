import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

import { mapsReady } from "../../lib/maps";
import { fonts } from "../../theme/fonts";
import { useTheme } from "../../theme/useTheme";
import type { Tracking } from "./queries";

const LIVE = ["picked_up", "at_customer"];
type Coord = { latitude: number; longitude: number };

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The server's [lat, lng] pairs as map coordinates; a pair that is not a number is dropped, never drawn at 0,0. */
export function routePoints(route: [number, number][] | null | undefined): Coord[] {
  return (route ?? []).filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1])).map(([latitude, longitude]) => ({ latitude, longitude }));
}

/** How far the rider is, in the server's own words about how it was worked out. Never minutes, never an arrival time. */
export function distanceLine(leg: Tracking["leg"] | undefined): string | null {
  if (!leg || !finite(Number(leg.distance_km))) return null;
  return `About ${Number(leg.distance_km)} km away${leg.basis ? ` · ${leg.basis}` : ""}`;
}

/**
 * The buyer's live delivery view: the rider (first name and vehicle only) and the delivery pin on a map, with the
 * distance in words. With no position, no pin, or a build without maps, the same facts are given as text.
 */
export function RiderMap({ tracking }: { tracking: Tracking | undefined }) {
  const { c, radius } = useTheme();
  const ref = useRef<MapView>(null);
  const rider = tracking?.rider;
  const live = !!tracking && LIVE.includes(tracking.stage);
  const hasFix = !!rider && finite(rider.lat) && finite(rider.lng);
  const drop = tracking?.drop && finite(tracking.drop.lat) && finite(tracking.drop.lng) ? tracking.drop : null;
  const coords: Coord[] = hasFix ? [{ latitude: rider!.lat!, longitude: rider!.lng! }, ...(drop ? [{ latitude: drop.lat, longitude: drop.lng }] : [])] : [];
  const key = coords.map((p) => `${p.latitude},${p.longitude}`).join("|");

  useEffect(() => {
    if (coords.length > 0) ref.current?.fitToCoordinates?.(coords, { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: true });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tracking || !live) return null;
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 14 } as const;
  if (tracking.rider_busy) return <Text style={dim}>Your rider is finishing another delivery first.</Text>;
  if (!hasFix) return <Text style={dim}>Your rider’s location isn’t available right now.</Text>;

  const who = [rider!.first_name, rider!.vehicle_type].filter(Boolean).join(" · ");
  const headline = rider!.first_name ? `${rider!.first_name} is on the way${rider!.vehicle_type ? ` · ${rider!.vehicle_type}` : ""}` : "Your rider is on the way";
  const distance = distanceLine(tracking.leg);
  const route = routePoints(tracking.route);
  const staleNote = rider!.stale ? (rider!.age_s != null ? `Last location ${Math.max(1, Math.round(rider!.age_s / 60))} min ago` : "Last location is out of date") : null;
  const first = coords[0];
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 15 }}>{headline}</Text>
      {mapsReady() ? (
        <View style={{ borderRadius: radius.card, overflow: "hidden", height: 240 }}>
          <MapView
            ref={ref}
            style={{ flex: 1 }}
            accessibilityLabel="Map of your rider and delivery location"
            initialRegion={{ latitude: first.latitude, longitude: first.longitude, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
            toolbarEnabled={false}
            showsUserLocation={false}
          >
            <Marker coordinate={coords[0]} title={who || "Your rider"} pinColor={rider!.stale ? "gray" : "black"} />
            {drop ? <Marker coordinate={coords[1]} title="Your delivery location" pinColor="green" /> : null}
            {route.length > 1 ? <Polyline coordinates={route} strokeColor={c.ink} strokeWidth={4} /> : null}
          </MapView>
        </View>
      ) : null}
      {mapsReady() ? <Text style={{ ...dim, fontSize: 12 }}>{drop ? "Dark pin: your rider. Green pin: your delivery location." : "Dark pin: your rider."}</Text> : null}
      {distance ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{distance}</Text> : null}
      {staleNote ? <Text style={dim}>{staleNote}</Text> : null}
      {!drop ? <Text style={dim}>Your address has no map pin, so the route can’t be shown.</Text> : null}
    </View>
  );
}
