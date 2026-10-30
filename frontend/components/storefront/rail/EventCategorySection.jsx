import RadioOptions from "./RadioOptions.jsx";

// "Category" on the Events page: the event categories (kind "event") as a
// radio-style list; the value is the slug, "All categories" clears it.
export default function EventCategorySection({ categories, filters, setFilters }) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  return (
    <RadioOptions
      name="ah-rail-event-category"
      groupLabel="Category"
      allLabel="All categories"
      options={categories.map((c) => ({ value: c.slug, label: c.label, icon: c.icon }))}
      value={filters?.category}
      onChange={(category) => setFilters((f) => ({ ...f, category }))}
    />
  );
}
