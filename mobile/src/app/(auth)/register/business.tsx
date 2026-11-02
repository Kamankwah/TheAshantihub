import * as ImagePicker from "expo-image-picker";
import { usePreventScreenCapture } from "expo-screen-capture";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { RegistrationHeader } from "../../../features/business/RegistrationHeader";
import { messageFor } from "../../../lib/authApi";
import { resumeRegistration, saveBusinessInfo, type Picked } from "../../../lib/registrationApi";
import { fonts } from "../../../theme/fonts";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Screen } from "../../../ui/Screen";

const ASHANTI_ONLY = "AshantiHub only admits businesses in the Ashanti Region. Your address must begin with “A”.";
const BAD_FORMAT = "Enter a valid Ghana Post GPS address, like AK-039-5028.";

async function pickPhoto(name: string): Promise<Picked | undefined> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
  const asset = result.canceled ? undefined : result.assets?.[0];
  return asset ? { uri: asset.uri, name: `${name}.jpg`, type: asset.mimeType ?? "image/jpeg" } : undefined;
}

export default function BusinessInfo() {
  usePreventScreenCapture(); // the Ghana Card must not end up in screenshots or recordings
  const { c } = useTheme();
  const [gps, setGps] = useState("");
  const [phone, setPhone] = useState("");
  const [formal, setFormal] = useState(false);
  const [tin, setTin] = useState("");
  const [card, setCard] = useState("");
  const [front, setFront] = useState<Picked>();
  const [back, setBack] = useState<Picked>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    const address = gps.trim().toUpperCase();
    if (!/^[A-Z]{2}-\d{3,4}-\d{4}$/.test(address)) return setErrors({ gps: BAD_FORMAT });
    if (address[0] !== "A") return setErrors({ gps: ASHANTI_ONLY });
    setBusy(true);
    setErrors({});
    try {
      await saveBusinessInfo({
        gps_address: address,
        business_contact_phone: phone.trim(),
        is_formal: formal,
        ...(card.trim() ? { ghana_card_number: card.trim() } : {}),
        ...(formal && tin.trim() ? { tin: tin.trim() } : {}),
        ...(front ? { ghana_card_front_image: front } : {}),
        ...(back ? { ghana_card_back_image: back } : {}),
      });
      await resumeRegistration();
    } catch (e) {
      setErrors({ form: messageFor(e, "We couldn't save your business details. Check them and try again.") });
    } finally {
      setBusy(false);
    }
  }

  const Toggle = ({ on, label }: { on: boolean; label: string }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: formal === on }}
      onPress={() => setFormal(on)}
      style={{ flex: 1, minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: formal === on ? c.gold : "transparent" }}
    >
      <Text style={{ color: formal === on ? c.onGold : c.ink, fontFamily: fonts.bodyBold, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );

  const Upload = ({ label, value, onPick }: { label: string; value?: Picked; onPick: (p?: Picked) => void }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label} added` : label}
      onPress={async () => onPick(await pickPhoto(label.replace(/\W+/g, "-").toLowerCase()))}
      style={{ flex: 1, minHeight: 96, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.ink, alignItems: "center", justifyContent: "center", backgroundColor: c.surface }}
    >
      <Text style={{ color: c.ink, fontFamily: fonts.bodySemi, fontSize: 13 }}>{value ? `${label} ✓` : label}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <RegistrationHeader step={2} title="Tell us about your business" back />
      <View accessibilityRole="radiogroup" style={{ flexDirection: "row", backgroundColor: c.well, borderRadius: 12, padding: 4, gap: 4 }}>
        <Toggle on={true} label="Formal (registered)" />
        <Toggle on={false} label="Informal" />
      </View>
      {formal ? <Field label="TIN" value={tin} onChangeText={setTin} placeholder="Tax Identification Number" helper="Only needed for formal businesses." /> : null}
      <Field label="Ghana Card number (optional)" value={card} onChangeText={setCard} autoCapitalize="characters" placeholder="GHA-000000000-0" />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Upload label="Card front" value={front} onPick={setFront} />
        <Upload label="Card back" value={back} onPick={setBack} />
      </View>
      <Field label="Ghana Post GPS address" value={gps} onChangeText={setGps} autoCapitalize="characters" placeholder="AK-039-5028" helper="Example: AK-039-5028" error={errors.gps} />
      <Field label="Business contact phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
      {errors.form ? <Text accessibilityRole="alert" style={{ color: c.red, fontFamily: fonts.bodySemi, fontSize: 13 }}>{errors.form}</Text> : null}
      <Text style={{ color: c.dim, fontFamily: fonts.body, fontSize: 13 }}>Our team verifies every business before it goes live.</Text>
      <Button label="Continue" onPress={submit} loading={busy} />
    </Screen>
  );
}
