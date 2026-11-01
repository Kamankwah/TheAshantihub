import type { Listing, PhotoSizes } from "../browse/types";

export type Variant = {
  id: number;
  label: string;
  price_amount: string;
  effective_price?: string | null;
  was_price?: string | null;
  stock_quantity: number | null;
};

export type ListingDetail = Listing & {
  description?: string;
  photos: { id: number; image: string; variants: PhotoSizes }[];
  variants: Variant[];
  has_variants?: boolean;
  stock_quantity?: number | null;
  delivery_time?: string | null;
  return_policy?: string | null;
  brand?: string | null;
  condition?: string | null;
  category?: { id: number; label: string; kind: string; is_food?: boolean; is_accommodation?: boolean };
  cancellation_policy?: string;
};
