
import { LocalizedText } from "@/components/language-provider";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
import { SignInForm } from "@/components/sign-in-form";
import { BrandLogo } from "@/components/brand-logo";
import { getAuthSession } from "@/lib/auth-session";

export const instant = false;

export default async function SignInPage() {
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
      <section className="auth-card" aria-labelledby="sign-in-title">
        <p className="eyebrow"><LocalizedText>ESPACIO PERSONAL</LocalizedText></p>
        <h1 id="sign-in-title"><LocalizedText>Ingresar a LIFE OS</LocalizedText></h1>
        <p className="auth-description"><LocalizedText>Acceso privado para Augusto Valmont</LocalizedText></p>
        <SignInForm />
      </section>
    </main>
  );
}
