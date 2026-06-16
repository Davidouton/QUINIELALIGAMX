"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { initializeOneSignal, loginOneSignal, logoutOneSignal } from "@/lib/onesignal/client";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function OneSignalProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    let mounted = true;
    const supabase = createSupabaseBrowserClient();

    async function syncOneSignalIdentity(userId: string | null | undefined) {
      await initializeOneSignal();
      if (!mounted) {
        return;
      }

      if (userId) {
        await loginOneSignal(userId);
        return;
      }

      await logoutOneSignal();
    }

    void supabase.auth.getSession()
      .then(({ data }) => syncOneSignalIdentity(data.session?.user.id))
      .catch((error) => {
        console.warn("OneSignal identity sync failed", error);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncOneSignalIdentity(session?.user.id).catch((error) => {
        console.warn("OneSignal auth sync failed", error);
      });
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return <>{children}</>;
}
