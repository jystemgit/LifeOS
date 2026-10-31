"use client";
import { LocalizedText } from "@/components/language-provider";


import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

type Enrollment = Readonly<{
  totpURI: string;
  backupCodes: string[];
}>;

export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const formData = new FormData(event.currentTarget);

    try {
      const result = await authClient.twoFactor.enable({
        password: String(formData.get("password") ?? ""),
        method: "totp",
        issuer: "LIFE OS",
      });

      if (result.error) {
        setError("No se pudo iniciar la configuración Comprueba tu contraseña");
        return;
      }
      if (result.data.method !== "totp") {
        setError("La aplicación autenticadora devolvió un método inesperado");
        return;
      }

      setEnrollment({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
    } catch {
      setError("No se pudo iniciar la configuración Inténtalo otra vez");
    } finally {
      setPending(false);
    }
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;

    setError("");
    setPending(true);
    const formData = new FormData(event.currentTarget);

    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: String(formData.get("code") ?? "").trim(),
      });

      if (result.error) {
        setError("No se pudo verificar el código Comprueba la hora del dispositivo");
        return;
      }

      setEnrollment(null);
      router.replace("/");
      router.refresh();
    } catch {
      setError("No se pudo verificar el código Inténtalo otra vez");
    } finally {
      setPending(false);
    }
  }

  async function signOut() {
    setError("");
    setPending(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("No se pudo cerrar la sesión Inténtalo otra vez");
        return;
      }
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setError("No se pudo cerrar la sesión Inténtalo otra vez");
    } finally {
      setPending(false);
    }
  }

  if (enabled) {
    return (
      <div className="security-enabled">
        <p className="security-status"><LocalizedText>La verificación en dos pasos está activa para esta cuenta</LocalizedText></p>
        {error && <p className="auth-error" role="alert"><LocalizedText>{error}</LocalizedText></p>}
        <button
          className="auth-submit"
          onClick={signOut}
          disabled={pending}
          type="button"
        >
          <LocalizedText>{pending ? "Cerrando sesión…" : "Cerrar sesión"}</LocalizedText>
        </button>
      </div>
    );
  }

  if (enrollment) {
    return (
      <div className="auth-form">
        <div className="totp-qr">
          <QRCodeSVG value={enrollment.totpURI} size={192} />
        </div>
        <div>
          <h3 className="backup-title"><LocalizedText>Códigos de recuperación</LocalizedText></h3>
          <p className="auth-description"><LocalizedText>Guarda estos códigos ahora, en un lugar seguro Cada código se puede utilizar una sola vez</LocalizedText></p>
          <ul className="backup-code-list">
            {enrollment.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
        <form className="auth-form" onSubmit={confirmEnrollment}>
          <label htmlFor="enrollment-code"><LocalizedText>Introduce el código de seis dígitos de tu aplicación</LocalizedText></label>
          <input
            autoComplete="one-time-code"
            autoFocus
            id="enrollment-code"
            inputMode="numeric"
            maxLength={6}
            name="code"
            pattern="[0-9]{6}"
            required
          />
          {error && <p className="auth-error" role="alert"><LocalizedText>{error}</LocalizedText></p>}
          <button className="auth-submit" disabled={pending} type="submit">
            <LocalizedText>{pending ? "Verificando…" : "Confirmar y proteger LIFE OS"}</LocalizedText>
          </button>
        </form>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={beginEnrollment}>
      <label htmlFor="setup-password"><LocalizedText>Confirma tu contraseña</LocalizedText></label>
      <input
        autoComplete="current-password"
        id="setup-password"
        name="password"
        minLength={14}
        required
        type="password"
      />
      {error && <p className="auth-error" role="alert"><LocalizedText>{error}</LocalizedText></p>}
      <button className="auth-submit" disabled={pending} type="submit">
        <LocalizedText>{pending ? "Preparando…" : "Configurar aplicación autenticadora"}</LocalizedText>
      </button>
    </form>
  );
}
