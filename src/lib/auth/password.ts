import { hashPassword } from "better-auth/crypto";

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, validatePasswordStrength } from "./password-rules";

/**
 * Hash a password the same way Better Auth does (scrypt), for the controlled
 * bootstrap paths (seed, admin:create) and owner-created accounts.
 */
export function hashAdminPassword(password: string): Promise<string> {
  return hashPassword(password);
}
