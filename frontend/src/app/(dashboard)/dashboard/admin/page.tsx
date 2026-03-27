import Link from "next/link";

import { AdminSubnav } from "@/components/admin/admin-subnav";

export default function DashboardAdminPage() {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-ink">Panel de Administracion</h1>
      </section>

      <AdminSubnav />

      <section className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-steel">Secciones</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-ink">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-steel">
                <th className="px-3 py-3">Modulo</th>
                <th className="px-3 py-3">Descripcion</th>
                <th className="px-3 py-3 text-right">Ir</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  "/dashboard/admin/settings",
                  "Configuracion",
                  "Define el torneo activo y la puntuacion por ganador y marcador exacto.",
                ],
                [
                  "/dashboard/admin/prizes",
                  "Premios",
                  "Configura costo por ingreso, premios semanales, comision, reserva y bolsa del torneo.",
                ],
                [
                  "/dashboard/admin/users",
                  "Usuarios",
                  "Activa acceso a la app y da de alta participantes dentro del torneo elegido.",
                ],
                [
                  "/dashboard/admin/user-info",
                  "Info usuarios",
                  "Consulta telefono, equipo, modalidad, aval, ambiente y cuenta capturados en settings.",
                ],
                ["/dashboard/admin/seasons", "Temporadas", "Crea, edita y activa torneos."],
                ["/dashboard/admin/matchdays", "Jornadas", "Define jornada, status y cierre automatico."],
                ["/dashboard/admin/odds", "Probabilidades", "Baja raw de odds y sincroniza partidos futuros."],
                ["/dashboard/admin/matches", "Partidos", "Carga juegos y ajusta horarios."],
                [
                  "/dashboard/admin/results",
                  "Resultados",
                  "Baja marcadores, ajusta resultados oficiales y recalcula scoring antes de publicar.",
                ],
                ["/dashboard/admin/hall-of-fame", "Salon de la Fama", "Carga historico manual de podios y records."],
                ["/dashboard/admin/trophies", "Trofeos", "Da de alta trofeos, badges y sus imagenes para reutilizarlos."],
                ["/dashboard/admin/rules", "Editor reglamento", "Carga y actualiza el reglamento vivo que aparece dentro del dashboard."],
                ["/dashboard/admin/teams", "Equipos", "Alta rapida del catalogo de clubes."],
              ].map(([href, label, description]) => (
                <tr key={href} className="text-sm text-ink">
                  <td className="px-3 py-3 font-medium">{label}</td>
                  <td className="px-3 py-3 text-[12px] leading-5 text-justify text-steel">{description}</td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={href}
                      prefetch={false}
                      className="app-pill h-9 px-3 text-[11px] uppercase tracking-[0.16em] text-steel hover:text-ink"
                    >
                      Ir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
