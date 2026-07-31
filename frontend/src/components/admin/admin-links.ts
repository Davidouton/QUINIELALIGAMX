export type AdminLink = { href: string; label: string };
export type AdminNavGroup = { id: string; label: string; links: readonly AdminLink[] };

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "overview",
    label: "Inicio",
    links: [
      { href: "/dashboard/admin", label: "Resumen" },
      { href: "/dashboard/admin/stats", label: "Estadísticas" },
    ],
  },
  {
    id: "tournaments",
    label: "Torneos y partidos",
    links: [
      { href: "/dashboard/admin/competitions", label: "Competencias" },
      { href: "/dashboard/admin/seasons", label: "Temporadas e inscripciones" },
      { href: "/dashboard/admin/matchdays", label: "Jornadas" },
      { href: "/dashboard/admin/matches", label: "Partidos" },
      { href: "/dashboard/admin/results", label: "Resultados" },
      { href: "/dashboard/admin/live-score", label: "Marcador en vivo" },
      { href: "/dashboard/admin/odds", label: "Probabilidades" },
      { href: "/dashboard/admin/teams", label: "Equipos" },
      { href: "/dashboard/admin/world-cup-groups", label: "Tablas y grupos" },
      { href: "/dashboard/admin/world-cup-bracket", label: "Playoffs" },
      { href: "/dashboard/admin/nfl-lines", label: "NFL · Líneas" },
    ],
  },
  {
    id: "players",
    label: "Participantes",
    links: [
      { href: "/dashboard/admin/enrollments", label: "Inscritos por torneo" },
      { href: "/dashboard/admin/users", label: "Usuarios y membresías" },
      { href: "/dashboard/admin/user-info", label: "Ficha de usuario" },
      { href: "/dashboard/admin/picks", label: "Picks" },
      { href: "/dashboard/admin/survivor", label: "Survivor" },
      { href: "/dashboard/admin/vip", label: "VIP" },
      { href: "/dashboard/admin/quiniela-plus", label: "Quiniela +" },
    ],
  },
  {
    id: "finance",
    label: "Premios y pagos",
    links: [
      { href: "/dashboard/admin/prizes", label: "Premios" },
      { href: "/dashboard/admin/final-ranking", label: "Ranking final" },
      { href: "/dashboard/admin/payments", label: "Pagos y conciliación" },
    ],
  },
  {
    id: "content",
    label: "Contenido",
    links: [
      { href: "/dashboard/admin/rules", label: "Reglamento" },
      { href: "/dashboard/admin/trophies", label: "Trofeos" },
      { href: "/dashboard/admin/hall-of-fame", label: "Salón de la Fama" },
    ],
  },
  {
    id: "system",
    label: "Sistema",
    links: [{ href: "/dashboard/admin/settings", label: "Configuración" }],
  },
] as const;

export const ADMIN_LINKS: readonly AdminLink[] = ADMIN_NAV_GROUPS.flatMap((group) => group.links);
