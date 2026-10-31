import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "better-auth/crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the LIFE OS database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, options: "-c timezone=UTC" }),
});

async function main() {
  const configuredOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (
    !configuredOwnerEmail ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredOwnerEmail)
  ) {
    throw new Error(
      "Set OWNER_EMAIL to the single owner's email before database setup.",
    );
  }

  const existingUsers = await prisma.user.findMany({
    select: {
      email: true,
      accounts: { select: { providerId: true, password: true } },
    },
  });
  if (existingUsers.length > 1) {
    throw new Error("LIFE OS is single-owner: more than one user already exists.");
  }

  if (existingUsers.length === 1) {
    const [existingOwner] = existingUsers;
    if (existingOwner.email.toLowerCase() !== configuredOwnerEmail) {
      throw new Error(
        "The existing account does not match OWNER_EMAIL; refusing to alter the single owner.",
      );
    }
    if (!existingOwner.accounts.some((account) => account.providerId === "credential" && account.password)) {
      throw new Error(
        "The existing owner has no credential account; refusing to change authentication data.",
      );
    }

    console.info("The owner account already exists; authentication configuration was verified.");
    return;
  }

  const terminal = createInterface({ input: stdin, output: stdout });
  const ownerName =
    (await terminal.question("Owner name [Augusto Valmont]: ")).trim() ||
    "Augusto Valmont";
  terminal.close();

  const password = await readHiddenPassword("Owner password");
  const passwordConfirmation = await readHiddenPassword(
    "Confirm owner password",
  );
  if (password !== passwordConfirmation) {
    throw new Error("The owner passwords do not match.");
  }
  if (password.length < 14 || password.length > 128) {
    throw new Error("The owner password must contain between 14 and 128 characters.");
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(84019211)`;

      const usersCreatedDuringSetup = await transaction.user.count();
      if (usersCreatedDuringSetup > 0) {
        throw new Error(
          "An owner account was created during setup; rerun the seed to verify it.",
        );
      }

      const owner = await transaction.user.create({
        data: {
          name: ownerName,
          email: configuredOwnerEmail,
          emailVerified: false,
        },
        select: { id: true },
      });

      await transaction.account.create({
        data: {
          accountId: owner.id,
          providerId: "credential",
          userId: owner.id,
          password: passwordHash,
        },
      });

    },
  );

  console.info("Created the single owner account.");
}

async function readHiddenPassword(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Owner setup must run from an interactive terminal.");
  }

  stdout.write(`${label} (14–128 characters, input hidden): `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  let password = "";
  try {
    for await (const chunk of stdin) {
      for (const character of chunk) {
        if (character === "\u0003") {
          throw new Error("Owner setup was cancelled.");
        }
        if (character === "\r" || character === "\n") {
          stdout.write("\n");
          return password;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else if (password.length < 128) {
          password += character;
        }
      }
    }
    throw new Error("Input ended before the owner password was entered.");
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

main()
  .catch((error: unknown) => {
    console.error("Failed to configure the owner account.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
