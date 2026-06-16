"use client";

import OneSignal from "react-onesignal";

import { env } from "@/lib/env";

let initPromise: Promise<void> | null = null;
let initAppId: string | null = null;

function hasBrowserSupport() {
  return typeof window !== "undefined" && Boolean(env.oneSignalAppId);
}

function allowsLocalhost() {
  if (typeof window === "undefined") {
    return false;
  }

  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function initializeOneSignal() {
  if (!hasBrowserSupport()) {
    return Promise.resolve();
  }

  if (initPromise && initAppId === env.oneSignalAppId) {
    return initPromise;
  }

  initAppId = env.oneSignalAppId;
  initPromise = OneSignal.init({
    appId: env.oneSignalAppId,
    allowLocalhostAsSecureOrigin: allowsLocalhost(),
    serviceWorkerPath: "onesignal/OneSignalSDKWorker.js",
    serviceWorkerParam: { scope: "/onesignal/" },
  })
    .then(() => {
      OneSignal.Debug.setLogLevel(process.env.NODE_ENV === "development" ? "warn" : "error");
    })
    .catch((error) => {
      initPromise = null;
      initAppId = null;
      throw error;
    });

  return initPromise;
}

export async function loginOneSignal(externalId: string) {
  await initializeOneSignal();
  if (!hasBrowserSupport()) {
    return;
  }

  await OneSignal.login(externalId);
}

export async function logoutOneSignal() {
  await initializeOneSignal();
  if (!hasBrowserSupport()) {
    return;
  }

  await OneSignal.logout();
}

export async function promptOneSignalPush() {
  await initializeOneSignal();
  if (!hasBrowserSupport()) {
    return false;
  }

  return OneSignal.Notifications.requestPermission();
}
