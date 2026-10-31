"use client";
import { LocalizedText } from "@/components/language-provider";


import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type VerificationMethod = "totp" | "backup";

export function TwoFactorSignInForm() {
  const router = useRouter();
  const [method, setMethod] = useState<VerificationMethod>("totp");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const code = String(formData.get("code") ?? "").trim();

    try {
      const result =
        method === "totp"
          ? await authClient.twoFactor.verifyTotp({ code })
          : await authClient.twoFactor.verifyBackupCode({ code });

      if (result.error) {
        setError("El código no es válido o ha caducado Inténtalo otra vez");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("No se pudo verificar el código Inténtalo otra vez");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="verification-code">
        <LocalizedText>{method === "totp" ? "Código de autenticación" : "Código de recuperación"}</LocalizedText>
      </label>
      <input
        autoComplete="one-time-code"
        autoFocus
        id="verification-code"
        inputMode={method === "totp" ? "numeric" : "text"}
        maxLength={method === "totp" ? 6 : 32}
        name="code"
        pattern={method === "totp" ? "[0-9]{6}" : undefined}
        required
        type="text"
      />
      {error && (
        <p className="auth-error" role="alert">
          <LocalizedText>{error}</LocalizedText>
        </p>
      )}
      <button className="auth-submit" disabled={pending} type="submit">
        <LocalizedText>{pending ? "Verificando…" : "Verificar"}</LocalizedText>
      </button>
      <button
        className="auth-text-button"
        onClick={() => {
          setError("");
          setMethod(method === "totp" ? "backup" : "totp");
        }}
        type="button"
      >
        <LocalizedText>{method === "totp"
          ? "Usar un código de recuperación"
          : "Usar la aplicación autenticadora"}</LocalizedText>
      </button>
    </form>
  );
}
