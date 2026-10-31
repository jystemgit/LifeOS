import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { twoFactor } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { getPrisma } from "@/lib/prisma";

function createAuth() {
  const authSecret = process.env.BETTER_AUTH_SECRET;
  const authBaseUrl = process.env.BETTER_AUTH_URL;

  if (!authSecret || authSecret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set to at least 32 characters.",
    );
  }

  if (!authBaseUrl) {
    throw new Error(
      "BETTER_AUTH_URL must be set to the canonical application URL.",
    );
  }

  if (process.env.NODE_ENV === "production" && !authBaseUrl.startsWith("https://")) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production.");
  }

  return betterAuth({
    appName: "LIFE OS",
    baseURL: authBaseUrl,
    secret: authSecret,
    trustedOrigins: [authBaseUrl],
    database: prismaAdapter(getPrisma(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 14,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 12,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": {
          window: 60,
          max: 5,
        },
        "/two-factor/verify-totp": {
          window: 60,
          max: 5,
        },
        "/two-factor/verify-backup-code": {
          window: 60,
          max: 5,
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: "LIFE OS",
        twoFactorTable: "TwoFactor",
        accountLockout: {
          enabled: true,
          maxFailedAttempts: 5,
          durationSeconds: 15 * 60,
        },
      }),
      nextCookies(),
    ],
    advanced: {
      useSecureCookies: process.env.NODE_ENV === "production",
      database: {
        validateSchema: true,
      },
    },
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
let authInstance: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}
