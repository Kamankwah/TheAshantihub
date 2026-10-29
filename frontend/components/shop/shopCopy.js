// Constants and sentences the shopper pages (BuyBox, CartPage, CheckoutPage, ...) share, spelled once.

// A counted stock at or below this reads "Only N left" (the number itself always comes from the server).
export const LOW_STOCK_AT = 5;

// Shown when the opening gate is closed and useCanBuy has no label of its own.
export const OPENS_SOON = "Opens soon";

// The cart guard has not answered (or failed): ordering waits, with this reason.
export const guardUncheckedText = (failed) => (failed
  ? "We couldn't check your delivery limits yet. Try again shortly."
  : "Checking your delivery limits…");

// While delivery fees are on, a door-to-door order needs a pin (the server answers fee_status "needs_location").
export const PIN_YOUR_DOOR = "Pin your door on the map so we can work out the delivery fee.";

// A counted stock caps what a quantity "+" may reach; a line with no stock_quantity is never capped here.
export const atStockCap = (line) => line.stock_quantity != null && Number(line.quantity) >= Number(line.stock_quantity);

// Visually hidden, still read aloud.
export const SR_ONLY = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };
