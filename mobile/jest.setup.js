// Icon fonts are not loaded under Jest; render a plain view in place of each icon.
jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Icon = (props) => React.createElement(View, { accessibilityElementsHidden: true, testID: `icon-${props.name}` });
  Icon.glyphMap = {};
  return { Feather: Icon, Ionicons: Icon, MaterialIcons: Icon };
});
require("react-native-gesture-handler/jestSetup");
// The worklets runtime does not exist under Jest; skip the gesture handler's UI-runtime install.
jest.mock("react-native-gesture-handler/lib/module/handlers/gestures/installUIRuntimeBindings", () => ({ installUIRuntimeBindings: () => {} }));
