"use client";

import { useEffect, useMemo, useState } from "react";

import { backendFetch } from "@/lib/api/backend";
import { env } from "@/lib/env";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getBrowserAccessToken } from "@/lib/supabase/session";
import type { MySettlementsResponse, SettlementAssignment } from "@/types/api";

function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: SettlementAssignment["status"]) {
  if (status === "pending_proof") return "Pendiente de pago";
  if (status === "proof_submitted") return "Esperando validación";
  if (status === "confirmed") return "Confirmado";
  return "Rechazado";
}

export function PaymentsPageContent() {
  const [data, setData] = useState<MySettlementsResponse>({ outgoing: [], incoming: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadingIds, setUploadingIds] = useState<string[]>([]);
  const [confirmingIds, setConfirmingIds] = useState<string[]>([]);
  const [rejectingIds, setRejectingIds] = useState<string[]>([]);
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [proofFiles, setProofFiles] = useState<Record<string, File | null>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const accessToken = await getBrowserAccessToken();
      const response = await backendFetch<MySettlementsResponse>("/payments/settlements/mine", accessToken);
      setData(response);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar tu panel de pagos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const pendingOutgoing = useMemo(
    () => data.outgoing.filter((assignment) => assignment.status !== "confirmed"),
    [data.outgoing],
  );
  const pendingIncoming = useMemo(
    () => data.incoming.filter((assignment) => assignment.status === "proof_submitted"),
    [data.incoming],
  );

  async function uploadProofImage(file: File, assignmentId: string) {
    if (!env.supabaseUrl || !env.supabaseAnonKey) {
      throw new Error("Faltan las variables públicas de Supabase para subir fichas.");
    }
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (!allowedTypes.has(file.type)) {
      throw new Error("La ficha debe ser JPG, PNG, WEBP o PDF.");
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("La ficha no puede pesar más de 2 MB.");
    }
    const supabase = createSupabaseBrowserClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new Error("Tu sesión expiró. Vuelve a iniciar sesión.");
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const path = `${userData.user.id}/settlements/${assignmentId}/${crypto.randomUUID()}.${extension}`;
    const { data: uploadRow, error: uploadError } = await supabase.storage
      .from(env.paymentProofsBucket)
      .upload(path, file, {
        contentType: file.type || "image/png",
        upsert: false,
      });
    if (uploadError) {
      throw new Error(uploadError.message);
    }
    return uploadRow.path;
  }

  async function handleSubmitProof(assignmentId: string) {
    const file = proofFiles[assignmentId];
    if (!file) {
      setError("Selecciona una imagen antes de enviar la ficha.");
      return;
    }

    setUploadingIds((current) => [...current, assignmentId]);
    setError(null);
    setMessage(null);
    try {
      const proofObjectPath = await uploadProofImage(file, assignmentId);
      const accessToken = await getBrowserAccessToken();
      await backendFetch(
        `/payments/settlements/${assignmentId}/proof`,
        accessToken,
        {
          method: "PUT",
          body: JSON.stringify({
            proof_object_path: proofObjectPath,
            proof_note: proofNotes[assignmentId] ?? "",
          }),
        },
      );
      setMessage("Ficha enviada.");
      setProofFiles((current) => ({ ...current, [assignmentId]: null }));
      await loadData();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo enviar la ficha.");
    } finally {
      setUploadingIds((current) => current.filter((id) => id !== assignmentId));
    }
  }

  async function handleConfirm(assignmentId: string) {
    setConfirmingIds((current) => [...current, assignmentId]);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/payments/settlements/${assignmentId}/confirm`, accessToken, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage("Pago confirmado.");
      await loadData();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo confirmar el pago.");
    } finally {
      setConfirmingIds((current) => current.filter((id) => id !== assignmentId));
    }
  }

  async function handleReject(assignmentId: string) {
    setRejectingIds((current) => [...current, assignmentId]);
    setError(null);
    setMessage(null);
    try {
      const accessToken = await getBrowserAccessToken();
      await backendFetch(`/payments/settlements/${assignmentId}/reject`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          rejection_reason: rejectReasons[assignmentId] ?? "",
        }),
      });
      setMessage("Pago rechazado.");
      await loadData();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo rechazar el pago.");
    } finally {
      setRejectingIds((current) => current.filter((id) => id !== assignmentId));
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.28em] text-steel">Pagos</p>
        <h1 className="text-2xl font-semibold text-ink">Tus pagos entre jugadores</h1>
        <p className="max-w-3xl text-sm text-steel">
          Aquí ves a quién le tienes que pagar, subes tu ficha y también validas los depósitos que te llegan.
        </p>
      </section>

      <div className="grid border-y border-white/[0.1] sm:grid-cols-3 sm:divide-x sm:divide-white/[0.1]">
        <div className="border-b border-white/[0.1] py-4 sm:border-b-0 sm:px-5 sm:first:pl-0">
          <p className="text-xs uppercase tracking-[0.2em] text-steel">Pagos salientes</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{data.outgoing.length}</p>
        </div>
        <div className="border-b border-white/[0.1] py-4 sm:border-b-0 sm:px-5">
          <p className="text-xs uppercase tracking-[0.2em] text-steel">Pendientes por subir</p>
          <p className="mt-2 text-2xl font-semibold text-coral">{pendingOutgoing.length}</p>
        </div>
        <div className="py-4 sm:px-5">
          <p className="text-xs uppercase tracking-[0.2em] text-steel">Pendientes por validar</p>
          <p className="mt-2 text-2xl font-semibold text-gold">{pendingIncoming.length}</p>
        </div>
      </div>

      {loading ? <p className="text-sm text-steel">Cargando pagos...</p> : null}
      {error ? <p className="text-sm text-coral">{error}</p> : null}
      {message ? <p className="text-sm text-moss">{message}</p> : null}

      <section className="space-y-4 border-t border-white/[0.1] pt-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">Tú pagas</h2>
          <p className="mt-1 text-sm text-steel">Sube la ficha del depósito para que el receptor la valide.</p>
        </div>
        <div className="divide-y divide-white/[0.08] border-b border-white/[0.1]">
          {data.outgoing.map((assignment) => (
            <details key={assignment.id} className="group">
              <summary className="grid cursor-pointer list-none gap-3 py-4 transition hover:bg-white/[0.02] sm:grid-cols-[minmax(0,1.5fr)_minmax(120px,.65fr)_minmax(150px,.8fr)_24px] sm:items-center">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-steel">{assignment.scope_label ?? "Competencia"}</p>
                  <h3 className="mt-1 truncate text-base font-semibold text-ink">{assignment.payee_display_name}</h3>
                </div>
                <p className="text-sm font-semibold text-ink">{formatMoney(assignment.amount)}</p>
                <p className="text-sm text-steel">{statusLabel(assignment.status)}</p>
                <span aria-hidden="true" className="text-lg text-steel transition group-open:rotate-45">+</span>
              </summary>

              <div className="border-t border-white/[0.06] pb-5 pt-4">
                <div className="grid gap-2 text-sm text-steel sm:grid-cols-3">
                  <p>Banco: {assignment.payee_bank_name ?? "-"}</p>
                  <p>Cuenta: {assignment.payee_deposit_account ?? "-"}</p>
                  <p>Contacto: {assignment.payee_contact_phone ?? "-"}</p>
                </div>

              {assignment.proof_image_url ? (
                <div className="mt-4 rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-3 text-sm text-steel">
                  <a href={assignment.proof_image_url} target="_blank" rel="noreferrer" className="text-[#4f7df3] underline-offset-4 hover:underline">
                    Ver ficha enviada
                  </a>
                  <p className="mt-2">Enviada: {formatDateTime(assignment.proof_uploaded_at)}</p>
                  {assignment.auto_confirm_at ? <p className="mt-1">Auto confirmación: {formatDateTime(assignment.auto_confirm_at)}</p> : null}
                  {assignment.proof_note ? <p className="mt-2">{assignment.proof_note}</p> : null}
                </div>
              ) : null}

              {assignment.status !== "confirmed" ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                  <label className="block space-y-2 text-sm">
                    <span className="text-steel">Imagen del depósito</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={(event) =>
                        setProofFiles((current) => ({
                          ...current,
                          [assignment.id]: event.target.files?.[0] ?? null,
                        }))
                      }
                      className="field-control file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold"
                    />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span className="text-steel">Nota opcional</span>
                    <input
                      type="text"
                      value={proofNotes[assignment.id] ?? ""}
                      onChange={(event) =>
                        setProofNotes((current) => ({ ...current, [assignment.id]: event.target.value }))
                      }
                      className="field-control"
                      placeholder="Referencia, banco origen, etc."
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => void handleSubmitProof(assignment.id)}
                      disabled={uploadingIds.includes(assignment.id)}
                      className="secondary-button w-full lg:w-auto"
                    >
                      {uploadingIds.includes(assignment.id) ? "Enviando..." : "Enviar ficha"}
                    </button>
                  </div>
                </div>
              ) : null}
              </div>
            </details>
          ))}
          {!loading && data.outgoing.length === 0 ? (
            <p className="text-sm text-steel">No tienes pagos salientes asignados en este momento.</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4 border-t border-white/[0.1] pt-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">Tú recibes</h2>
          <p className="mt-1 text-sm text-steel">Valida o rechaza la ficha. Si no rechazas dentro de la ventana, se confirma sola.</p>
        </div>
        <div className="divide-y divide-white/[0.08] border-b border-white/[0.1]">
          {data.incoming.map((assignment) => (
            <details key={assignment.id} className="group">
              <summary className="grid cursor-pointer list-none gap-3 py-4 transition hover:bg-white/[0.02] sm:grid-cols-[minmax(0,1.5fr)_minmax(120px,.65fr)_minmax(150px,.8fr)_24px] sm:items-center">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.24em] text-steel">{assignment.scope_label ?? "Competencia"}</p>
                  <h3 className="mt-1 truncate text-base font-semibold text-ink">{assignment.payer_display_name}</h3>
                </div>
                <p className="text-sm font-semibold text-ink">{formatMoney(assignment.amount)}</p>
                <p className="text-sm text-steel">{statusLabel(assignment.status)}</p>
                <span aria-hidden="true" className="text-lg text-steel transition group-open:rotate-45">+</span>
              </summary>

              <div className="border-t border-white/[0.06] pb-5 pt-4">
                <div className="grid gap-2 text-sm text-steel sm:grid-cols-3">
                  <p>Subida: {formatDateTime(assignment.proof_uploaded_at)}</p>
                  <p>Auto confirmación: {formatDateTime(assignment.auto_confirm_at)}</p>
                  <p>Contacto: {assignment.payer_contact_phone ?? "-"}</p>
                </div>

              <div className="mt-4 rounded-[14px] border border-white/[0.08] bg-white/[0.02] p-3">
                {assignment.proof_image_url ? (
                  <a href={assignment.proof_image_url} target="_blank" rel="noreferrer" className="text-sm text-[#4f7df3] underline-offset-4 hover:underline">
                    Ver ficha de depósito
                  </a>
                ) : (
                  <p className="text-sm text-steel">Todavía no han subido una ficha.</p>
                )}
                {assignment.proof_note ? <p className="mt-2 text-sm text-steel">{assignment.proof_note}</p> : null}
                {assignment.rejection_reason ? <p className="mt-2 text-sm text-coral">{assignment.rejection_reason}</p> : null}
                {assignment.confirmed_at ? (
                  <p className="mt-2 text-sm text-moss">
                    Confirmado {assignment.confirmed_automatically ? "automáticamente" : "por ti"} el {formatDateTime(assignment.confirmed_at)}.
                  </p>
                ) : null}
              </div>

              {assignment.status === "proof_submitted" ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                  <label className="block space-y-2 text-sm">
                    <span className="text-steel">Motivo de rechazo</span>
                    <input
                      type="text"
                      value={rejectReasons[assignment.id] ?? ""}
                      onChange={(event) =>
                        setRejectReasons((current) => ({ ...current, [assignment.id]: event.target.value }))
                      }
                      className="field-control"
                      placeholder="Opcional si algo no cuadra"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => void handleConfirm(assignment.id)}
                      disabled={confirmingIds.includes(assignment.id)}
                      className="secondary-button w-full lg:w-auto"
                    >
                      {confirmingIds.includes(assignment.id) ? "Confirmando..." : "Confirmar"}
                    </button>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => void handleReject(assignment.id)}
                      disabled={rejectingIds.includes(assignment.id)}
                      className="app-pill w-full px-4 text-sm text-coral lg:w-auto"
                    >
                      {rejectingIds.includes(assignment.id) ? "Rechazando..." : "Rechazar"}
                    </button>
                  </div>
                </div>
              ) : null}
              </div>
            </details>
          ))}
          {!loading && data.incoming.length === 0 ? (
            <p className="text-sm text-steel">No tienes pagos por validar en este momento.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
