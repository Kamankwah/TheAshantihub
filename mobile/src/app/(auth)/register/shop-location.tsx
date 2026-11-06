import * as Location from "expo-location";
import { useRef, useState } from "react";
import { Text, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { apiMessage } from "../../../lib/errors";
import { mapsReady } from "../../../lib/maps";
import { resumeRegistration, saveShopLocation, type ShopLocationState } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Screen } from "../../../ui/Screen";

const LANDMARK_MAX = 200;
const KUMASI = { latitude: 6.6885, longitude: -1.6244 };
const DENIED = "Allow location, or place the pin on the map";
const NO_ACCURACY = "Your phone didn't say how accurate its location is. Place the pin on the map instead.";
const UNAVAILABLE = "We couldn't get your location. Try again outside or near a window, or place the pin on the map.";
const SAVE_FAILED = "We couldn't save your location. Check your connection and try again.";
const CONTINUE_FAILED = "Your location is saved, but we couldn't load the next step. Check your connection and try again.";

type Draft = { lat: number; lng: number; accuracy: number | null; manual: boolean };
type Point = { latitude: number; longitude: number };

const six = (n: number) => Number(n.toFixed(6));

/** A field-keyed 400 ({accuracy_m: ["..."]} or {lat: ["..."]}): the server's own sentence, shown as sent. */
function fieldMessage(error: unknown): string {
  const body = (error as { status?: number; body?: unknown })?.body;
  if ((error as { status?: number })?.status !== 400 || !body || typeof body !== "object" || (body as { code?: unknown }).code) return "";
  for (const key of ["accuracy_m", "lat", "lng"]) {
    const raw = (body as Record<string, unknown>)[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/**
 * The registration step where a self-registered owner puts the shop on the map: one phone reading (sent with its
 * accuracy) or a pin placed by hand (sent as manual, no accuracy), plus an optional landmark. Nothing is sent until
 * "Save my shop location". The plus code shown afterwards is the server's own answer.
 */
export default function ShopLocation() {
  const { c, radius } = useTheme();
  const ref = useRef<MapView>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [landmark, setLandmark] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [saved, setSaved] = useState<{ state: ShopLocationState; key: string } | null>(null);
  const [error, setError] = useState<string>();

  const key = draft ? JSON.stringify([draft.lat, draft.lng, draft.manual, landmark.trim()]) : null;
  const state = saved && saved.key === key ? saved.state : null;
  const dim = { color: c.dim, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 } as const;

  function place(point: Point) {
    setError(undefined);
    setDraft({ lat: six(point.latitude), lng: six(point.longitude), accuracy: null, manual: true });
  }

  async function useMyLocation() {
    setLocating(true);
    setError(undefined);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError(DENIED);
        return;
      }
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (typeof coords.accuracy !== "number" || !Number.isFinite(coords.accuracy)) {
        setError(NO_ACCURACY);
        return;
      }
      const next = { lat: six(coords.latitude), lng: six(coords.longitude), accuracy: Math.round(coords.accuracy), manual: false };
      setDraft(next);
      ref.current?.animateToRegion?.({ latitude: next.lat, longitude: next.lng, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 300);
    } catch {
      setError(UNAVAILABLE);
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const answer = await saveShopLocation(
        draft.manual ? { lat: draft.lat, lng: draft.lng, manual: true, landmark } : { lat: draft.lat, lng: draft.lng, accuracy_m: draft.accuracy ?? undefined, landmark },
      );
      setSaved({ state: answer, key: key! });
    } catch (e) {
      setError(fieldMessage(e) || apiMessage(e, SAVE_FAILED));
    } finally {
      setSaving(false);
    }
  }

  async function goOn() {
    setContinuing(true);
    setError(undefined);
    try {
      await resumeRegistration();
    } catch {
      setError(CONTINUE_FAILED);
    } finally {
      setContinuing(false);
    }
  }

  const hasMap = mapsReady();
  const coordinate = draft ? { latitude: draft.lat, longitude: draft.lng } : null;
  return (
    <Screen>
      <RegistrationHeader step={3} title="Where is your shop?" back />
      <Text style={dim}>Customers and riders find your shop from this pin. Do this from your phone while you are at your shop, or place the pin on the map by hand.</Text>
      <Button variant="secondary" label="Use my current location" onPress={() => void useMyLocation()} loading={locating} disabled={saving} />
      {draft && !draft.manual && draft.accuracy != null ? <Text style={dim}>{`Your phone's location is accurate to ±${draft.accuracy} m. Drag the pin or tap the map to move it.`}</Text> : null}

      {hasMap ? (
        <View style={{ borderRadius: radius.card, overflow: "hidden", height: 280 }}>
          <MapView
            ref={ref}
            style={{ flex: 1 }}
            accessibilityLabel="Map for placing your shop pin"
            initialRegion={{ ...KUMASI, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
            toolbarEnabled={false}
            showsUserLocation={false}
            onPress={(e) => place(e.nativeEvent.coordinate)}
          >
            {coordinate ? <Marker coordinate={coordinate} title="Your shop" draggable onDragEnd={(e) => place(e.nativeEvent.coordinate)} /> : null}
          </MapView>
        </View>
      ) : (
        <Text style={dim}>The map isn’t available in this version of the app. Use your current location, standing at your shop.</Text>
      )}

      <Field label="Landmark (optional)" value={landmark} onChangeText={setLandmark} maxLength={LANDMARK_MAX} placeholder="e.g. Opposite the Total filling station" />

      {error ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{error}</Text> : null}

      {state ? (
        <View accessibilityRole="summary" style={{ backgroundColor: c.well, borderRadius: radius.card, padding: 14, gap: 4 }}>
          {state.plus_code ? (
            <>
              <Text style={dim}>Plus code</Text>
              <Text selectable style={{ color: c.ink, fontFamily: fonts.bodyBold, fontSize: 18 }}>{state.plus_code}</Text>
            </>
          ) : null}
          {state.landmark ? <Text style={dim}>Landmark</Text> : null}
          {state.landmark ? <Text style={{ color: c.ink, fontFamily: fonts.body, fontSize: 15 }}>{state.landmark}</Text> : null}
          {state.tier_label ? <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 14 }}>{state.tier_label}</Text> : null}
          <Text style={dim}>This is where riders will collect. You can fix it later.</Text>
        </View>
      ) : null}

      {state ? <Button label="Continue" onPress={() => void goOn()} loading={continuing} /> : <Button label="Save my shop location" onPress={() => void save()} loading={saving} disabled={!draft} />}
    </Screen>
  );
}
