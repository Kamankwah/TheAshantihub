// The price a listing with options is "From": the lowest option's effective price when the row carries its variants
// (options that cannot be bought are skipped: `available` false or a counted stock of 0), else the headline price the server sent. Never computed from anything else.
export function cheapestPrice(item) {
  const headline = item?.effective_price ?? item?.price_amount ?? null;
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  const priced = variants
    .map((v) => ({ v, price: v.effective_price ?? v.price_amount ?? null }))
    .filter((x) => x.price != null && x.price !== "" && Number.isFinite(parseFloat(x.price)));
  if (priced.length === 0) return headline;
  const buyable = priced.filter((x) => x.v.available !== false && x.v.stock_quantity !== 0);
  if (buyable.length === 0) return headline;
  return buyable.reduce((lo, x) => (parseFloat(x.price) < parseFloat(lo.price) ? x : lo)).price;
}
