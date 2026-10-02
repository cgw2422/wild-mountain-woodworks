-- Trusted devices: "Trust this device for 30 days" after a successful authenticator code.
CREATE TABLE "AdminTrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "userAgent" TEXT,
    "firstSeenIp" TEXT,
    "lastSeenIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedById" TEXT,
    CONSTRAINT "AdminTrustedDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminTrustedDevice_tokenHash_key" ON "AdminTrustedDevice"("tokenHash");
CREATE INDEX "AdminTrustedDevice_userId_revokedAt_expiresAt_idx" ON "AdminTrustedDevice"("userId", "revokedAt", "expiresAt");
ALTER TABLE "AdminTrustedDevice" ADD CONSTRAINT "AdminTrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sessions remember when they last proved the second factor (step-up for owner security changes).
ALTER TABLE "AdminSession" ADD COLUMN "twoFactorVerifiedAt" TIMESTAMP(3);

-- Backstop: whatever path changes an admin's password, authenticator or
-- status (Better Auth, admin actions, the admin:create CLI, a manual SQL fix),
-- their trusted devices stop working in the same transaction.
CREATE FUNCTION "wm_revoke_trusted_devices"(uid TEXT, reason TEXT) RETURNS void AS $$
BEGIN
  UPDATE "AdminTrustedDevice" SET "revokedAt" = CURRENT_TIMESTAMP, "revokedReason" = reason
  WHERE "userId" = uid AND "revokedAt" IS NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "wm_trusted_devices_on_password"() RETURNS trigger AS $$
BEGIN
  PERFORM "wm_revoke_trusted_devices"(NEW."userId", 'password_changed');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AdminAccount_password_revokes_trusted_devices"
  AFTER UPDATE OF "password" ON "AdminAccount"
  FOR EACH ROW WHEN (OLD."password" IS DISTINCT FROM NEW."password")
  EXECUTE FUNCTION "wm_trusted_devices_on_password"();

CREATE FUNCTION "wm_trusted_devices_on_two_factor"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "wm_revoke_trusted_devices"(OLD."userId", 'two_factor_changed');
  ELSE
    PERFORM "wm_revoke_trusted_devices"(NEW."userId", 'two_factor_changed');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AdminTwoFactor_secret_revokes_trusted_devices"
  AFTER UPDATE OF "secret" ON "AdminTwoFactor"
  FOR EACH ROW WHEN (OLD."secret" IS DISTINCT FROM NEW."secret")
  EXECUTE FUNCTION "wm_trusted_devices_on_two_factor"();
CREATE TRIGGER "AdminTwoFactor_change_revokes_trusted_devices"
  AFTER INSERT OR DELETE ON "AdminTwoFactor"
  FOR EACH ROW EXECUTE FUNCTION "wm_trusted_devices_on_two_factor"();

CREATE FUNCTION "wm_trusted_devices_on_admin_user"() RETURNS trigger AS $$
BEGIN
  IF OLD."active" AND NOT NEW."active" THEN
    PERFORM "wm_revoke_trusted_devices"(NEW."id", 'account_disabled');
  ELSIF OLD."twoFactorEnabled" AND NOT NEW."twoFactorEnabled" THEN
    PERFORM "wm_revoke_trusted_devices"(NEW."id", 'two_factor_changed');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AdminUser_status_revokes_trusted_devices"
  AFTER UPDATE OF "active", "twoFactorEnabled" ON "AdminUser"
  FOR EACH ROW EXECUTE FUNCTION "wm_trusted_devices_on_admin_user"();
