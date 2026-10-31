import { createECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateProductionEnvironment } from "../../scripts/validate-production-env.mjs";

const valid = {
  BETTER_AUTH_URL: "https://lifeos.augustovalmont.com",
  BETTER_AUTH_SECRET: "a-generated-secret-with-more-than-thirty-two-characters",
  DATABASE_URL: "postgresql://lifeos:strong-password@postgres:5432/lifeos",
  OWNER_EMAIL: "owner@example.invalid",
};

describe("production startup configuration", () => {
  it("accepts the production template domain, credentials and disabled optional integrations", () => {
    const template = readFileSync(new URL("../../.env.production.example", import.meta.url), "utf8");
    const domain = template.match(/^LIFEOS_DOMAIN=(.+)$/m)?.[1];
    expect(domain).toBe("lifeos.augustovalmont.com");
    expect(validateProductionEnvironment({ ...valid, BETTER_AUTH_URL: `https://${domain}` })).toEqual([]);
    expect(validateProductionEnvironment(valid)).toEqual([]);
    expect(validateProductionEnvironment({ ...valid, TASK_PUSH_ENABLED: "false" })).toEqual([]);
  });
  it("rejects insecure origins, placeholders and incomplete database settings without echoing values", () => {
    for (const url of ["http://lifeos.augustovalmont.com", "https://localhost", "https://lifeos.example.com", "https://lifeos.augustovalmont.com/path", "https://user:password@host.test"]) {
      expect(validateProductionEnvironment({ ...valid, BETTER_AUTH_URL: url })).not.toEqual([]);
    }
    expect(validateProductionEnvironment({ ...valid, BETTER_AUTH_SECRET: "replace-with-generated-auth-secret" })).not.toEqual([]);
    expect(validateProductionEnvironment({ ...valid, DATABASE_URL: "postgresql://lifeos@postgres/lifeos" })).not.toEqual([]);
    const errors = validateProductionEnvironment({ ...valid, DATABASE_URL: "invalid-secret-value", OWNER_EMAIL: "" });
    expect(errors.length).toBe(2);
    expect(errors.join(" ")).not.toContain("invalid-secret-value");
  });
  it("requires complete optional OAuth configuration and canonical callback", () => {
    expect(validateProductionEnvironment({ ...valid, GOOGLE_CLIENT_ID: "id" })).not.toEqual([]);
    expect(validateProductionEnvironment({ ...valid, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: `${valid.BETTER_AUTH_URL}/api/integrations/google/callback` })).toEqual([]);
    expect(validateProductionEnvironment({ ...valid, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "https://different.test/api/integrations/google/callback" })).not.toEqual([]);
  });
  it("requires valid matching push keys only when enabled", () => {
    const pair = createECDH("prime256v1"); pair.generateKeys();
    const push = { TASK_PUSH_ENABLED: "true", TASK_PUSH_VAPID_PUBLIC_KEY: pair.getPublicKey().toString("base64url"),
      TASK_PUSH_VAPID_PRIVATE_KEY: pair.getPrivateKey().toString("base64url"), TASK_PUSH_VAPID_SUBJECT: "mailto:owner@example.invalid" };
    expect(validateProductionEnvironment({ ...valid, ...push })).toEqual([]);
    expect(validateProductionEnvironment({ ...valid, ...push, TASK_PUSH_VAPID_PRIVATE_KEY: "invalid" })).not.toEqual([]);
    expect(validateProductionEnvironment({ ...valid, TASK_PUSH_ENABLED: "yes" })).not.toEqual([]);
  });
});
