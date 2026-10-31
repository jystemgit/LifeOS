
import { LocalizedText } from "@/components/language-provider";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
import { TwoFactorSignInForm } from "@/components/two-factor-sign-in-form";
import { BrandLogo } from "@/components/brand-logo";
import { getAuthSession } from "@/lib/auth-session";

export const instant = false;

export default async function TwoFactorPage() {
  const session = await getAuthSession();
  if (session) {
    redirect(session.user.twoFactorEnabled === true ? "/" : "/security");
  }

  return (
    <main className="auth-page">
      <header className="auth-header">
        <Link className="auth-brand" href="/">
          <BrandLogo />
          Augusto Valmont <span>LIFE OS</span>
        </Link>
        <div className="auth-header-actions"><LanguageSelector /><ThemeToggle /></div>
      </header>
      <section className="auth-card" aria-labelledby="two-factor-title">
        <p className="eyebrow"><LocalizedText>VERIFICACIÓN DE SEGURIDAD</LocalizedText></p>
        <h1 id="two-factor-title"><LocalizedText>Confirma tu identidad</LocalizedText></h1>
        <p className="auth-description"><LocalizedText>Introduce el código de tu aplicación autenticadora o un código de recuperación</LocalizedText></p>
        <TwoFactorSignInForm />
      </section>
    </main>
  );
}
