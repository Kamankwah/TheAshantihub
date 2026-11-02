export type PhotoSizes = { thumb: string | null; medium: string | null; large: string | null };

export type Listing = {
  id: number;
  name: string;
  price_amount: string;
  effective_price?: string | null;
  sale_price?: string | null;
  was_price?: string | null;
  main_photo: string | null;
  main_photo_variants?: PhotoSizes;
  avg_rating?: number | null;
  review_count?: number | null;
  is_promoted?: boolean;
  business_owner?: { id: number; name: string; identity_verified?: boolean };
};

export type Page<T> = { count: number; next: string | null; results: T[] };
export type Department = { id: number; slug: string; label: string; icon?: string };
