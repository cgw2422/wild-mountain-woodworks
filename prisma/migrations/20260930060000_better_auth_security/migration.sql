-- Move admin authentication to Better Auth, add mandatory two-factor
-- support, reduce roles to OWNER/ADMIN and record IP/user agent in the
-- audit log. Existing passwords keep working: their hashes move to
-- "AdminAccount" (credential provider) and are upgraded on next sign-in.

-- 1. Roles: EDITOR had the same access as ADMIN; fold it in.
UPDATE "AdminUser" SET "role" = 'ADMIN' WHERE "role"::text = 'EDITOR';
BEGIN;
CREATE TYPE "AdminRole_new" AS ENUM ('OWNER', 'ADMIN');
ALTER TABLE "public"."AdminUser" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "AdminUser" ALTER COLUMN "role" TYPE "AdminRole_new" USING ("role"::text::"AdminRole_new");
ALTER TYPE "AdminRole" RENAME TO "AdminRole_old";
ALTER TYPE "AdminRole_new" RENAME TO "AdminRole";
DROP TYPE "public"."AdminRole_old";
ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
COMMIT;

-- 2. Sessions: the old token format can't be carried over; everyone signs in again.
DELETE FROM "AdminSession";
DROP INDEX "AdminSession_tokenHash_key";
ALTER TABLE "AdminSession" DROP COLUMN "lastSeenAt",
DROP COLUMN "tokenHash",
ADD COLUMN     "token" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
CREATE UNIQUE INDEX "AdminSession_token_key" ON "AdminSession"("token");

-- 3. New Better Auth tables.
CREATE TABLE "AdminAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AdminVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminVerification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AdminTwoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    CONSTRAINT "AdminTwoFactor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminAccount_userId_idx" ON "AdminAccount"("userId");
CREATE INDEX "AdminVerification_identifier_idx" ON "AdminVerification"("identifier");
CREATE INDEX "AdminTwoFactor_userId_idx" ON "AdminTwoFactor"("userId");
CREATE INDEX "AdminTwoFactor_secret_idx" ON "AdminTwoFactor"("secret");
ALTER TABLE "AdminAccount" ADD CONSTRAINT "AdminAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminTwoFactor" ADD CONSTRAINT "AdminTwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Carry existing password hashes into the credential account, then drop the column.
INSERT INTO "AdminAccount" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
SELECT 'acct_' || "id", "id", 'credential', "id", "passwordHash", now(), now() FROM "AdminUser";
ALTER TABLE "AdminUser" DROP COLUMN "passwordHash",
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- 5. Audit log: where the action came from.
ALTER TABLE "ActivityLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;
