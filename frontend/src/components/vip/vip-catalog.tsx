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

function money(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
}

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
    <section className="space-y-4" aria-label="Catálogo de VIPs">
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
      <div className={`grid gap-3 ${compact ? "grid-cols-1" : "md:grid-cols-2 2xl:grid-cols-3"}`}>
        {visible.map((item) => {
          const selected = selectedId === item.id;
          return (
            <button key={item.id} type="button" aria-pressed={selected} onClick={() => onSelect(item.id)} className={`flex min-w-0 flex-col rounded-[12px] border p-4 text-left transition ${selected ? "border-mint/60 bg-mint/[0.07] ring-1 ring-mint/25" : "border-white/[0.12] bg-white/[0.02] hover:border-white/30"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-steel">{item.mode}</span>
                <span className={`rounded-full bg-white/[0.05] px-2 py-1 text-xs font-semibold ${item.statusTone}`}>{item.status}</span>
              </div>
              <h3 className="mt-3 break-words text-lg font-semibold leading-snug text-ink">{item.name}</h3>
              <p className="mt-1 break-words text-xs text-steel">{item.context}</p>
              <dl className="mt-4 grid w-full grid-cols-3 gap-2 border-t border-white/[0.08] pt-3">
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-steel">Entrada</dt><dd className="mt-1 text-sm font-semibold text-ink">{money(item.fee)}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-steel">Bolsa</dt><dd className="mt-1 text-sm font-semibold text-ink">{money(item.pool)}</dd></div>
                <div><dt className="text-[10px] uppercase tracking-[0.1em] text-steel">Jugadores</dt><dd className="mt-1 text-sm font-semibold text-ink">{item.participants}</dd></div>
              </dl>
              {item.detail ? <p className="mt-3 text-xs text-steel">{item.detail}</p> : null}
              <div className="mt-auto flex w-full flex-wrap items-center justify-between gap-2 pt-4">
                {item.access ? <span className={`text-xs font-medium ${item.accessTone ?? "text-steel"}`}>Mi acceso: {item.access}</span> : <span />}
                <span className={`text-xs font-semibold ${selected ? "text-mint" : "text-ink"}`}>{selected ? "Seleccionada" : "Ver detalle →"}</span>
              </div>
            </button>
          );
        })}
      </div>
      {visible.length === 0 ? <p className="rounded-[10px] border border-dashed border-white/[0.15] p-5 text-sm text-steel">{query ? "No hay VIPs que coincidan con tu búsqueda." : filter === "archived" ? "No hay VIPs archivadas." : "No hay VIPs activas."}</p> : null}
    </section>
  );
}
