import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { requireStaff, type CurrentAdmin } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";
import { fieldErrorsFrom } from "@/lib/validation/forms";
import type { ActionResult } from "./types";

export type { ActionResult } from "./types";

const DENIED: ActionResult = { ok: false, message: "Your role doesn't allow that. Ask an owner if you need access." };

/**
 * Wrap an admin server action: enforces authentication and authorization,
 * converts validation and known database errors into friendly
 * `ActionResult`s, and logs the rest. The role is re-read from the database
 * on every call (getSessionState).
 *
 * `allowed` decides who may run it — default deny.
 *
 * Note: `redirect()`/`notFound()` throw special errors that must propagate,
 * so they are rethrown untouched.
 */
function guarded<Args extends unknown[]>(
  allowed: (admin: CurrentAdmin) => boolean,
  fn: (admin: CurrentAdmin, ...args: Args) => Promise<ActionResult | void>,
  denied: ActionResult = DENIED,
) {
  return async (...args: Args): Promise<ActionResult> => {
    const admin = await requireStaff();
    if (!allowed(admin)) {
      logger.warn("Admin action denied by role", { adminId: admin.id, role: admin.role });
      return denied;
    }
    try {
      return (await fn(admin, ...args)) ?? { ok: true };
    } catch (err) {
      if (isNextControlFlow(err)) throw err;
      if (err instanceof z.ZodError) {
        return { ok: false, message: "Please correct the highlighted fields.", fieldErrors: fieldErrorsFrom(err) };
      }
      if (err instanceof AdminError) return { ok: false, message: err.message, fieldErrors: err.fieldErrors };
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") {
          const target = (err.meta?.target as string[] | string | undefined) ?? "";
          const field = Array.isArray(target) ? target.join(", ") : String(target);
          return {
            ok: false,
            message: `That ${field || "value"} is already in use.`,
            fieldErrors: field ? { [Array.isArray(target) ? target[0]! : field]: "Already in use." } : undefined,
          };
        }
        if (err.code === "P2025") return { ok: false, message: "That record no longer exists." };
        if (err.code === "P2003") return { ok: false, message: "This item is still referenced elsewhere and can't be removed." };
      }
      logger.error("Admin action failed", { error: err });
      return { ok: false, message: "Something went wrong. Please try again." };
    }
  };
}

/**
 * OWNER or ADMIN — ordinary site management (products, quotes, settings…).
 * Editors are refused. The secure default for any action that hasn't been
 * deliberately opened to editors with `permittedAction`.
 */
export function adminAction<Args extends unknown[]>(fn: (admin: CurrentAdmin, ...args: Args) => Promise<ActionResult | void>) {
  return guarded((a) => a.role === "OWNER" || a.role === "ADMIN", fn);
}

/** Staff whose role has `permission` (src/lib/auth/permissions.ts), e.g. editors for "content". */
export function permittedAction<Args extends unknown[]>(permission: Permission, fn: (admin: CurrentAdmin, ...args: Args) => Promise<ActionResult | void>) {
  return guarded((a) => can(a.role, permission), fn);
}

/**
 * OWNER accounts only (admin users, roles and security). Anything other than
 * OWNER is refused — hiding buttons is never the control.
 */
export function ownerAction<Args extends unknown[]>(fn: (admin: CurrentAdmin, ...args: Args) => Promise<ActionResult | void>) {
  return guarded((a) => a.role === "OWNER", fn, { ok: false, message: "Only an owner can do that." });
}

export class AdminError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

function isNextControlFlow(err: unknown) {
  const digest = (err as { digest?: string })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

/** FormData helpers */
export const fd = {
  str(data: FormData, key: string): string {
    const v = data.get(key);
    return typeof v === "string" ? v.trim() : "";
  },
  opt(data: FormData, key: string): string | null {
    const v = fd.str(data, key);
    return v === "" ? null : v;
  },
  bool(data: FormData, key: string): boolean {
    const v = data.get(key);
    return v === "on" || v === "true" || v === "1";
  },
  int(data: FormData, key: string, fallback = 0): number {
    const n = Number.parseInt(fd.str(data, key), 10);
    return Number.isFinite(n) ? n : fallback;
  },
  all(data: FormData, key: string): string[] {
    return data.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
  },
};
