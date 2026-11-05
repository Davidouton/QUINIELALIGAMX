"use client";

import { normalizedVipSearch } from "@/lib/vip-display";

export type VipCatalogFilter = "active" | "archived";
export type VipCatalogItem = {
  id: string;
  name: string;
  mode: string;
  context: string;
  archived: boolean;
  status: string;
  statusTone: string;
  fee: number;
  pool: number;
  participants: number;
  access?: string;
  accessTone?: string;
  detail?: string;
};

export function VipCatalog({ items, filter, onFilterChange, search, onSearchChange, selectedId, onSelect, compact = false }: {
  items: VipCatalogItem[];
  filter: VipCatalogFilter;
  onFilterChange: (filter: VipCatalogFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const archivedCount = items.filter((item) => item.archived).length;
  const query = normalizedVipSearch(search);
  const visible = items.filter((item) => item.archived === (filter === "archived") && (
    !query || normalizedVipSearch(`${item.name} ${item.mode} ${item.context} ${item.status}`).includes(query)
  ));

  return (
    <section className="space-y-3" aria-label="Catálogo de VIPs">
      <div className={`flex gap-3 ${compact ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"}`}>
        <div className="flex flex-wrap gap-2" aria-label="Filtrar VIPs">
          {([
            ["active", "Activas", items.length - archivedCount],
            ["archived", "Archivadas", archivedCount],
          ] as const).map(([value, label, count]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)} className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${filter === value ? "border-mint/50 bg-mint/10 text-mint" : "border-white/[0.12] text-steel hover:text-ink"}`}>
              {label} <span className="ml-1 text-xs opacity-75">{count}</span>
            </button>
          ))}
        </div>
        <label className={`grid gap-1 ${compact ? "w-full" : "w-full sm:max-w-[340px]"}`}>
          <span className="sr-only">Buscar VIP por nombre o modalidad</span>
          <input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar VIP por nombre o modalidad" className="field-control w-full rounded-[8px] px-3 text-sm" />
        </label>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-1" : "md:grid-cols-2 2xl:grid-cols-3"}`}>
        {visible.map((item) => {
          const selected = selectedId === item.id;
          return (
            <button key={item.id} type="button" aria-label={`${item.name}, ${item.status}`} aria-pressed={selected} onClick={() => onSelect(item.id)} className={`flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint ${selected ? "border-mint/60 bg-mint/[0.07] text-mint" : "border-white/[0.12] bg-white/[0.02] text-ink hover:border-white/30"}`}>
              <span className="min-w-0 break-words text-sm font-semibold leading-5">{item.name}</span>
              <span aria-hidden="true" className={`shrink-0 text-sm ${selected ? "text-mint" : "text-steel"}`}>{selected ? "✓" : "›"}</span>
              {selected ? <span className="sr-only">Seleccionada</span> : null}
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? <p className="rounded-[10px] border border-dashed border-white/[0.15] p-5 text-sm text-steel">{query ? "No hay VIPs que coincidan con tu búsqueda." : filter === "archived" ? "No hay VIPs archivadas." : "No hay VIPs activas."}</p> : null}
    </section>
  );
}
