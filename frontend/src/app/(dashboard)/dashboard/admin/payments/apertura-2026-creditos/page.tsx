import Link from "next/link";
import { Ap26CreditPanel } from "@/components/dashboard/ap26-credit-panel";

export default function Apertura2026CreditsPage() {
  return (
    <div className="space-y-6">
      <Link href="/dashboard/admin/payments" className="secondary-button inline-flex w-fit">Volver a Cobros</Link>
      <Ap26CreditPanel eligible={false} admin={true} />
    </div>
  );
}
