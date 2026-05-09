import Link from "next/link";

export default function DashboardPaymentCancelPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-gold">Pago cancelado</p>
        <h1 className="text-2xl font-semibold text-ink">No se completo el checkout</h1>
        <p className="max-w-2xl text-sm text-steel">
          Puedes volver a intentarlo cuando quieras. Tu lugar y tus datos siguen intactos; solo se cancelo esa sesion
          de pago.
        </p>
      </section>

      <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="text-sm text-steel">
          Regresa a temporada, VIP o Quiniela + y vuelve a abrir Stripe cuando estes listo.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/dashboard/prizes" className="secondary-button">
            Pagar temporada
          </Link>
          <Link href="/dashboard/quiniela-plus" className="app-pill px-4 text-sm">
            Ver Quiniela +
          </Link>
          <Link href="/dashboard/vip" className="app-pill px-4 text-sm">
            Ver VIP
          </Link>
        </div>
      </div>
    </div>
  );
}
