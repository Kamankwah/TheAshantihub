import { useListings } from "../../hooks/useListings.js";
import ProductCarousel from "../shop/ProductCarousel.jsx";
import { SECTION } from "./storefrontType.js";

const FILTERS = { kind: "product", ordering: "-created_at" };

// New arrivals: the newest published products from GET /api/listings/ (goods
// only, newest first, first page), in the same themed carousel the product
// page uses. Services, stays and events have their own pages. Hidden when
// there are none or the request fails, so an empty marketplace shows no
// placeholder tiles.
export default function NewArrivalsRow({ onOpen }) {
  const { data, isError } = useListings(FILTERS);
  const items = !isError && data?.pages?.[0]?.results ? data.pages[0].results.slice(0, 12) : [];
  if (items.length === 0) return null;
  return (
    <div style={{ ...SECTION, paddingTop: 28 }}>
      <ProductCarousel title="New arrivals" items={items} onOpen={onOpen} />
    </div>
  );
}
