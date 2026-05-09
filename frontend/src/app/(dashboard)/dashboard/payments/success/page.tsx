import Link from "next/link";

export default function DashboardPaymentSuccessPage() {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-moss">Pago confirmado</p>
        <h1 className="text-2xl font-semibold text-ink">Tu pago ya entro</h1>
        <p className="max-w-2xl text-sm text-steel">
          Stripe ya regreso el pago como exitoso. El backend va a reflejar tu acceso en cuanto llegue la confirmacion
          final del webhook.
        </p>
      </section>

      <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="text-sm text-steel">
          Si acabas de pagar una temporada, una VIP o Quiniela +, puedes volver al dashboard y refrescar en unos
          segundos.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/dashboard" className="secondary-button">
            Volver al dashboard
          </Link>
          <Link href="/dashboard/settings" className="app-pill px-4 text-sm">
            Ir a settings
          </Link>
        </div>
      </div>
    </div>
  );
}
