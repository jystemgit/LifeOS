"use client";
import { LocalizedText } from "@/components/language-provider";


import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const formData = new FormData(event.currentTarget);

    try {
      const result = await authClient.signIn.email({
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
        callbackURL: "/",
      });

      if (result.error) {
        setError("No se pudo iniciar sesión Revisa tus datos e inténtalo otra vez");
        return;
      }

      if ("twoFactorRedirect" in result.data && result.data.twoFactorRedirect) {
        router.replace("/two-factor");
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("No se pudo conectar con LIFE OS Comprueba tu conexión e inténtalo otra vez");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="email"><LocalizedText>Correo electrónico</LocalizedText></label>
      <input
        autoComplete="username"
        id="email"
        name="email"
        required
        type="email"
      />
      <label htmlFor="password"><LocalizedText>Contraseña</LocalizedText></label>
      <input
        autoComplete="current-password"
        id="password"
        name="password"
        required
        type="password"
      />
      {error && (
        <p className="auth-error" role="alert">
          <LocalizedText>{error}</LocalizedText>
        </p>
      )}
      <button className="auth-submit" disabled={pending} type="submit">
        <LocalizedText>{pending ? "Ingresando…" : "Ingresar"}</LocalizedText>
      </button>
    </form>
  );
}
