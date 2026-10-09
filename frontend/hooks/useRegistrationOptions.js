import { useCategories } from './useCategories.js'
import { useZones } from './useZones.js'

const rows = (data) => (Array.isArray(data) ? data : data?.results ?? [])

// Choices for the scout's Register a business wizard: the categories of the
// chosen kind of business (product or service — never event categories, and
// none until a kind is chosen) and the areas (zones). Both are the public
// plain-array endpoints GET /api/listings/categories/ and /api/listings/zones/;
// reading them through useCategories/useZones shares the app's cache.
export function useRegistrationOptions(kind) {
  const categories = useCategories()
  const zones = useZones()
  return {
    categories: kind ? rows(categories.data).filter((category) => category.kind === kind) : [],
    zones: rows(zones.data),
    isLoading: categories.isLoading || zones.isLoading,
    isError: categories.isError || zones.isError,
  }
}
