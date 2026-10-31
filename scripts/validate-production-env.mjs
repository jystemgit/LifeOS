import { pathToFileURL } from "node:url";
import { createECDH } from "node:crypto";

const placeholder = /replace|placeholder|change[-_ ]?me|your[-_ ]|example\.com/i;

export function validateProductionEnvironment(env) {
  const errors = [];
  let origin;
  try {
    const url = new URL(env.BETTER_AUTH_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || placeholder.test(url.hostname)) throw new Error();
    origin = url.origin;
  } catch { errors.push("BETTER_AUTH_URL must be the real canonical HTTPS origin, without a path."); }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || placeholder.test(env.BETTER_AUTH_SECRET)) {
    errors.push("BETTER_AUTH_SECRET must be a generated secret of at least 32 characters.");
  }
  try {
    const url = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username ||
      url.pathname.length < 2 || !url.password || placeholder.test(decodeURIComponent(url.password))) throw new Error();
  } catch { errors.push("DATABASE_URL must be a PostgreSQL connection URL with a real database password."); }
  if (!env.OWNER_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL)) {
    errors.push("OWNER_EMAIL must identify the single owner.");
  }
  for (const provider of ["MICROSOFT", "GOOGLE"]) {
    const names = [`${provider}_CLIENT_ID`, `${provider}_CLIENT_SECRET`, `${provider}_REDIRECT_URI`];
    if (!names.some((name) => env[name])) continue;
    if (names.some((name) => !env[name] || placeholder.test(env[name]))) {
      errors.push(`${provider} integration requires all three OAuth settings, or none.`);
      continue;
    }
    if (env[`${provider}_REDIRECT_URI`] !== `${origin}/api/integrations/${provider.toLowerCase()}/callback`) {
      errors.push(`${provider}_REDIRECT_URI must match the canonical integration callback.`);
    }
  }
  if (env.TASK_PUSH_ENABLED && !["true", "false"].includes(env.TASK_PUSH_ENABLED)) {
    errors.push("TASK_PUSH_ENABLED must be true or false.");
  }
  if (env.TASK_PUSH_ENABLED === "true") {
    try {
      const { TASK_PUSH_VAPID_PUBLIC_KEY: publicKey, TASK_PUSH_VAPID_PRIVATE_KEY: privateKey, TASK_PUSH_VAPID_SUBJECT: subject } = env;
      if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey ?? "") || !/^[A-Za-z0-9_-]{43}$/.test(privateKey ?? "")) throw new Error();
      const pair = createECDH("prime256v1");
      pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
      if (pair.getPublicKey().toString("base64url") !== publicKey) throw new Error();
      const url = new URL(subject);
      if (!(url.protocol === "mailto:" && /^[^@\s]+@[^@\s]+$/.test(url.pathname) ||
        url.protocol === "https:" && !url.username && !url.password)) throw new Error();
    } catch { errors.push("Enabled push requires a valid matching VAPID key pair and contact subject."); }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = validateProductionEnvironment(process.env);
  if (errors.length) {
    console.error(`Production configuration rejected:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exitCode = 1;
  } else console.info("Production configuration validated.");
}
