"use client";

import { useEffect, useRef, useState } from "react";
import { pushStatusSchema, waitForPushWorker, type PushStatus } from "@/domain/task-push";
import { useLanguage, LocalizedDate } from "./language-provider";

async function requestStatus(body?: unknown): Promise<PushStatus> {
  const response = await fetch("/api/tasks/push", { cache: "no-store",
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result: unknown = await response.json();
  if (!response.ok) {
    if (result && typeof result === "object" && "error" in result && typeof result.error === "string")
      throw new Error(result.error);
    throw new Error("No se pudo actualizar la configuración push");
  }
  return pushStatusSchema.parse(result);
}
async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager ? registration.pushManager.getSubscription() : null;
}
function applicationKey(value: string) {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
export function TaskPushSettings() {
  const { t, locale } = useLanguage();
  const [capable, setCapable] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const revision = useRef(0);

  async function refresh(explicit = false) {
    if (busy.current && !explicit) return;
    const readingRevision = revision.current;
    const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setCapable(supported);
    if (!supported) { setStatus(await requestStatus()); return; }
    const subscription = await currentSubscription();
    const next = await requestStatus(subscription ? { action: Notification.permission === "granted" ? "status" : "revoke",
      endpoint: subscription.endpoint } : undefined);
    if (readingRevision !== revision.current) return;
    setPermission(Notification.permission); setSubscribed(!!subscription); setStatus(next);
  }
  useEffect(() => {
    let active = true;
    async function read() {
      if (!active || document.visibilityState === "hidden") return;
      try { await refresh(); if (active) setError(""); }
      catch { if (active) setError("No se pudo actualizar la configuración push"); }
    }
    void read();
    const timer = setInterval(() => void read(), 60000);
    window.addEventListener("focus", read);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", read); };
  }, []);

  async function enable() {
    if (busy.current) return;
    busy.current = true; revision.current++;
    setPending(true); setError("");
    let created: PushSubscription | null = null;
    try {
      if (!status?.configured || !status.publicKey || !status.workerReady) throw new Error("El trabajador push no está disponible Revisa la configuración");
      const granted = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      setPermission(granted);
      if (granted !== "granted") { setError("Permiso de notificaciones no concedido Los avisos en la aplicación siguen activos"); return; }
      const registration = await navigator.serviceWorker.register("/task-reminders-sw.js", { scope: "/" });
      await waitForPushWorker(registration);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && (status.subscription?.keyChanged || status.subscription?.expired || status.subscription?.failed ||
        !status.subscription?.active)) {
        await requestStatus({ action: "revoke", endpoint: subscription.endpoint });
        if (!await subscription.unsubscribe()) throw new Error("No se pudo desactivar la suscripción del navegador");
        subscription = null;
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(status.publicKey) });
        created = subscription;
      }
      setStatus(await requestStatus({ action: "subscribe", subscription: { ...subscription.toJSON(), publicKey: status.publicKey, locale } }));
      setSubscribed(true);
    } catch (cause) {
      if (created) {
        try {
          await requestStatus({ action: "revoke", endpoint: created.endpoint });
          if (!await created.unsubscribe()) throw new Error("Unsubscribe failed");
        } catch { setError("No se pudo revertir la suscripción Usa Desactivar para volver a intentar"); setSubscribed(true); return; }
      }
      console.error("Task push activation failed");
      setError(cause instanceof Error && cause.name === "NotAllowedError"
        ? "Permiso de notificaciones no concedido Los avisos en la aplicación siguen activos"
        : cause instanceof Error ? cause.message : "No se pudo actualizar la configuración push");
    } finally { busy.current = false; setPending(false); }
  }
  async function disable() {
    if (busy.current) return;
    busy.current = true; revision.current++;
    setPending(true); setError("");
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        setStatus(await requestStatus({ action: "revoke", endpoint: subscription.endpoint }));
        if (!await subscription.unsubscribe()) throw new Error("No se pudo desactivar la suscripción del navegador");
      }
      setSubscribed(false); await refresh(true);
    } catch (cause) { console.error("Task push deactivation failed"); setError(cause instanceof Error ? cause.message : "No se pudo actualizar la configuración push"); }
    finally { busy.current = false; setPending(false); }
  }

  return <details className="section">
    <summary>{t("Notificaciones push opcionales")}</summary>
    <p>{t("Los avisos en la aplicación no requieren permiso Push necesita permiso del navegador y un trabajador del servidor activo")}</p>
    <p className="task-item-meta">{t("El aviso push no muestra títulos ni notas personales La entrega puede retrasarse por el navegador o el sistema operativo")}</p>
    {capable === false && <p role="status">{t("Este navegador o conexión no admite push Los avisos en la aplicación siguen activos")}</p>}
    {permission === "denied" && <p role="status">{t("Permiso denegado Cambia el permiso en el navegador Los avisos en la aplicación siguen activos")}</p>}
    {status && !status.configured && <p role="status">{t(status.configurationError ? "Configuración push inválida Revisa las claves del servidor" : "Push no está configurado en el servidor")}</p>}
    {status?.configured && !status.workerReady && <p role="status">{t("El trabajador push no está disponible Revisa la configuración")}</p>}
    {status?.workerError && <p role="alert">{t("El trabajador push informó un error Revisa el servidor")}</p>}
    {status?.lastRunAt && <p className="task-item-meta">{t("Última ejecución del trabajador")}: <LocalizedDate value={new Date(status.lastRunAt)} options={{ dateStyle: "short", timeStyle: "short" }} /></p>}
    {!!status?.failedDeliveries && <p role="alert">{status.failedDeliveries} {t("envíos push fallidos Revisa el servidor Los recordatorios siguen en la aplicación")}</p>}
    {status?.subscription && (status.subscription.expired || status.subscription.failed || status.subscription.keyChanged) &&
      <p role="status">{t("La suscripción venció o cambió Vuelve a activar las notificaciones")}</p>}
    {status?.subscription?.active && subscribed && permission === "granted" &&
      <p role="status">{t(status.workerReady ? "Push activo en este dispositivo" : "Suscripción guardada sin entrega confirmada del servidor")}</p>}
    {error && <p role="alert" className="form-error">{t(error)}</p>}
    <div className="tm-toolbar">
      {!!status?.failedDeliveries && <button type="button" className="auth-text-button" disabled={pending || !status.configured} onClick={async () => {
        if (busy.current) return;
        busy.current = true; revision.current++;
        setPending(true);
        try { await requestStatus({ action: "retry" }); await refresh(true); setError(""); }
        catch { setError("No se pudo actualizar la configuración push"); }
        finally { busy.current = false; setPending(false); }
      }}>{t("Reintentar envíos push fallidos")}</button>}
      <button type="button" className="auth-text-button" disabled={pending || !capable || permission === "denied" || !status?.configured || !status.workerReady}
        onClick={() => void enable()}>{t("Activar o renovar push en este dispositivo")}</button>
      <button type="button" className="auth-text-button" disabled={pending || !capable || !subscribed}
        onClick={() => void disable()}>{t("Desactivar push en este dispositivo")}</button>
      <button type="button" className="auth-text-button" disabled={pending} onClick={async () => {
        if (busy.current) return;
        busy.current = true; revision.current++;
        setPending(true);
        try { await refresh(true); setError(""); }
        catch { setError("No se pudo actualizar la configuración push"); }
        finally { busy.current = false; setPending(false); }
      }}>{t("Actualizar estado push")}</button>
    </div>
  </details>;
}
