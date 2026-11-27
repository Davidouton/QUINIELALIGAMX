"use client";

import { useEffect, useState } from "react";
import { backendFetch } from "@/lib/api/backend";
import { getBrowserAccessToken } from "@/lib/supabase/session";

type CreditAmounts = {
  entry_credits: string;
  weekly_award_credits: string;
  final_award_credits: string;
  commission_credits: string;
  balance_credits: string;
  due_credits: string;
  in_favor_credits: string;
};
type Balance = CreditAmounts & {
  display_name: string;
  awards: { week: number; rank: number; credits: string }[];
};
type Mine = Balance & { settled_weeks: number[] };
type Admin = {
  summary: CreditAmounts & {
    participants: number;
    settled_weeks: number[];
    allocated_credits: string;
    reserve_credits: string;
  };
  balances: Balance[];
};

const fields = [
  ["Entrada", "entry_credits"],
  ["Premios semanales", "weekly_award_credits"],
  ["Premio final", "final_award_credits"],
  ["Comisión +", "commission_credits"],
  ["Saldo final", "balance_credits"],
  ["Por aportar", "due_credits"],
  ["A favor", "in_favor_credits"],
] as const;

function showCredits(value: string) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(Number(value));
}

export function Ap26CreditPanel({ eligible, admin }: { eligible: boolean; admin: boolean }) {
  const [own, setOwn] = useState<Mine | null>(null);
  const [adminData, setAdminData] = useState<Admin | null>(null);
  const [failed, setFailed] = useState(false);
  const [noBalance, setNoBalance] = useState(false);

  useEffect(() => {
    let current = true;
    if (eligible) {
      void getBrowserAccessToken()
        .then((token) => backendFetch<Mine>("/leaderboard/ap26-virtual-credits/me", token))
        .then((data) => { if (current) setOwn(data); })
        .catch((err: unknown) => {
          if (!current) return;
          if (err instanceof Error && err.message === "No tienes saldo para esta temporada") setNoBalance(true);
          else setFailed(true);
        });
    }
    return () => { current = false; };
  }, [eligible]);

  async function loadAdmin() {
    try {
      const token = await getBrowserAccessToken();
      setAdminData(await backendFetch<Admin>("/leaderboard/ap26-virtual-credits/admin", token));
    } catch {
      setFailed(true);
    }
  }

  if (!eligible && !admin) return null;
  return (
    <section className="rounded-2xl border border-white/10 px-4 py-4" aria-label="Créditos ficticios Apertura 2026">
      <h2 className="text-base font-semibold">Créditos Apertura 2026</h2>
      <p className="mt-1 text-sm">Créditos ficticios. No es dinero ni genera cobros. Un saldo negativo indica créditos por aportar.</p>
      {noBalance ? <p className="mt-2 text-sm">No tienes saldo para esta temporada.</p> : null}
      {failed ? <p role="alert" className="mt-2 text-sm">No se pudieron consultar los créditos.</p> : null}
      {own ? <>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {fields.map(([label, field]) => <div key={field}>
            <dt>{label}</dt>
            <dd className={field === "balance_credits" ? "font-semibold" : undefined}>{showCredits(own[field])}</dd>
          </div>)}
        </dl>
        {own.awards.length ? <ul className="mt-2 text-sm">
          {own.awards.map((a) => <li key={a.week}>Jornada {a.week}: lugar {a.rank}, {showCredits(a.credits)} créditos</li>)}
        </ul> : null}
      </> : eligible && !failed && !noBalance ? <p role="status" className="mt-2 text-sm">Consultando saldo…</p> : null}
      {admin ? <details className="mt-4 text-sm" onToggle={(event) => {
        if (event.currentTarget.open && !adminData) void loadAdmin();
      }}>
        <summary>Repartición por participante</summary>
        {adminData ? <div className="mt-2 overflow-auto">
          <p>{adminData.summary.participants} participantes · {adminData.summary.settled_weeks.length} jornadas cerradas</p>
          <p className="mt-1">Total asignado: {showCredits(adminData.summary.allocated_credits)} créditos · Reserva de Liguilla no asignada: {showCredits(adminData.summary.reserve_credits)}.</p>
          <table className="mt-2 w-full whitespace-nowrap">
            <thead><tr><th scope="col" className="px-2 text-left">Participante</th>{fields.map(([label, field]) =>
              <th scope="col" className="px-2 text-right" key={field}>{label}</th>)}</tr></thead>
            <tbody>{adminData.balances.map((row, index) => <tr key={index}>
              <th scope="row" className="px-2 text-left">{row.display_name}</th>
              {fields.map(([, field]) => <td className="px-2 text-right" key={field}>{showCredits(row[field])}</td>)}
            </tr>)}</tbody>
            <tfoot><tr><th scope="row" className="px-2 text-left">Total</th>
              {fields.map(([, field]) => <td className="px-2 text-right" key={field}>{showCredits(adminData.summary[field])}</td>)}
            </tr></tfoot>
          </table>
        </div> : !failed ? <p role="status">Consultando repartición…</p> : null}
      </details> : null}
    </section>
  );
}
