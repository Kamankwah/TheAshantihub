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
// The native map does not exist under Jest; render plain views that keep the props a test needs to read.
jest.mock("react-native-maps", () => {
  const React = require("react");
  const { View } = require("react-native");
  const make = (name) => {
    const C = (props) => React.createElement(View, { testID: name, accessibilityLabel: props.accessibilityLabel, ...props });
    C.displayName = name;
    return C;
  };
  return { __esModule: true, default: make("map"), Marker: make("map-marker"), Polyline: make("map-polyline"), PROVIDER_DEFAULT: null };
});
