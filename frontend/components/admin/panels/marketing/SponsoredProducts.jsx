import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../../apiClient.js";
import { D } from "../../theme.js";
import SponsoredToggle, { isProductListing } from "../SponsoredToggle.jsx";
import { Honest, Section, dim, inputStyle, labelStyle } from "./mkParts.jsx";

// Sponsored products (deals.manage): flag a product so it shows in the storefront Deals row without a discount.
// The current Deals row (live products with a real discount, plus sponsored ones) shows what is sponsored now;
// search finds any other live product to flag. The server decides what counts as live.
export default function SponsoredProducts() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const term = q.trim();
  const deals = useQuery({ queryKey: ["marketing-sponsored-deals"], queryFn: () => apiFetch("/api/storefront/deals/?limit=48") });
  const found = useQuery({
    queryKey: ["marketing-sponsored-search", term],
    enabled: term.length >= 2,
    queryFn: () => apiFetch(`/api/storefront/search/?q=${encodeURIComponent(term)}&kind=products&limit=10`),
  });
  const dealRows = Array.isArray(deals.data) ? deals.data : [];
  const sponsoredNow = new Map(dealRows.filter((d) => d.sponsored).map((d) => [d.id, d]));
  const results = (found.data?.products || []).filter(isProductListing);
  const changed = () => { deals.refetch(); queryClient.invalidateQueries({ queryKey: ["marketing-sponsored-search"] }); };

  return (
    <Section id="ft-sponsored" title="Sponsored products">
      <div style={dim}>A sponsored product appears in the Deals row even without a discount, and says “Sponsored”. Only live products can be flagged.</div>
      <ul aria-label="Sponsored now" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {[...sponsoredNow.values()].map((d) => (
          <li key={d.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem", color: D.text }}>
            <strong>{d.name}</strong><span style={dim}>{d.category_label}</span>
            <SponsoredToggle id={d.id} name={d.name} sponsored onChanged={changed} />
          </li>
        ))}
      </ul>
      {deals.data && sponsoredNow.size === 0 && <Honest>No product is sponsored right now.</Honest>}
      <label style={labelStyle}>Find a product to sponsor
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product name" style={inputStyle} />
      </label>
      {term.length >= 2 && found.data && results.length === 0 && <Honest>No live product matches “{term}”.</Honest>}
      <ul aria-label="Search results" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {results.map((r) => (
          <li key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem", color: D.text }}>
            <strong>{r.name}</strong><span style={dim}>{r.category_label}</span>
            <SponsoredToggle id={r.id} name={r.name} sponsored={sponsoredNow.has(r.id)} onChanged={changed} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
