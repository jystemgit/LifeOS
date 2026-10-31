
import { LocalizedText } from "@/components/language-provider";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { TwoFactorSetup } from "@/components/two-factor-setup";
import { getAuthSession } from "@/lib/auth-session";

export const instant = false;

export default async function SecurityPage() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <AppShell>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><LocalizedText>SISTEMA / SEGURIDAD</LocalizedText></p>
          <h1><LocalizedText>Protege tu espacio</LocalizedText></h1>
          <p className="page-description"><LocalizedText>Configura un segundo factor antes de acceder al centro de comando</LocalizedText></p>
        </div>
      </div>
      <section
        className="auth-card security-card"
        aria-labelledby="security-title"
      >
        <p className="eyebrow"><LocalizedText>AUTENTICACIÓN DE DOS FACTORES</LocalizedText></p>
        <h2 id="security-title">
          <LocalizedText>{session.user.twoFactorEnabled === true
            ? "Verificación en dos pasos activa"
            : "Activa la verificación en dos pasos"}</LocalizedText>
        </h2>
        <p className="auth-description"><LocalizedText>LIFE OS requiere una aplicación TOTP para acceder a la información personal Guarda los códigos de recuperación fuera de este dispositivo</LocalizedText></p>
        <TwoFactorSetup enabled={session.user.twoFactorEnabled === true} />
      </section>
    </AppShell>
  );
}
