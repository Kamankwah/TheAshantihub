import type { ReactNode } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import { fonts } from "../theme/fonts";
import { useTheme } from "../theme/useTheme";

type Props = { visible: boolean; onClose: () => void; title: string; children: ReactNode };

/** A bottom sheet over a dim scrim; tapping the scrim or the Close control dismisses it. */
export function Sheet({ visible, onClose, title, children }: Props) {
  const { c } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} />
      <View
        accessibilityViewIsModal
        style={{ backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 }}
      >
        <Text accessibilityRole="header" style={{ color: c.ink, fontFamily: fonts.display, fontSize: 22 }}>
          {title}
        </Text>
        {children}
      </View>
    </Modal>
  );
}
