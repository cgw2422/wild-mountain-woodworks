import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { checkTrustedDevice, trustedDeviceCookieName, type TrustedDeviceRejection } from "./trusted-devices";

/** Better Auth's pending two-factor challenge cookie (set by the two-factor plugin after a correct password). */
const TWO_FACTOR_COOKIE = "two_factor";

export type TrustedSignInResult = { trusted: true; deviceId: string; userId: string } | { trusted: false; reason: TrustedDeviceRejection | "no_challenge"; deviceId?: string };

/**
 * Completes a pending two-factor challenge on a trusted device, using Better
 * Auth's own primitives exactly as its verifyTOTP does on success: the signed
 * challenge cookie is required (so the password was just verified by
 * Better Auth's sign-in), the challenge is consumed once, and the session is
 * created by Better Auth's adapter (so the "deactivated admins never get a
 * session" hook still applies) and set as its signed session cookie.
 *
 * SERVER_ONLY: never routed over HTTP (and the HTTP handler isn't mounted at
 * all); only the sign-in server action calls it via auth.api.
 */
export const trustedDevicePlugin = () =>
  ({
    id: "wm-trusted-device",
    endpoints: {
      signInWithTrustedDevice: createAuthEndpoint("/trusted-device/sign-in", { method: "POST", metadata: { SERVER_ONLY: true } }, async (ctx) => {
        const reject = (reason: TrustedDeviceRejection | "no_challenge", deviceId?: string) => ctx.json<TrustedSignInResult>({ trusted: false, reason, deviceId });

        const challengeCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
        const challenge = await ctx.getSignedCookie(challengeCookie.name, ctx.context.secret);
        if (!challenge) return reject("no_challenge");
        const pending = await ctx.context.internalAdapter.findVerificationValue(challenge);
        if (!pending || new Date(pending.expiresAt).getTime() <= Date.now()) return reject("no_challenge");
        const userId = pending.value;

        const check = await checkTrustedDevice(ctx.getCookie(trustedDeviceCookieName()), userId);
        if (!check.ok) return reject(check.reason, check.deviceId);

        const consumed = await ctx.context.internalAdapter.consumeVerificationValue(challenge);
        if (!consumed || consumed.value !== userId) return reject("no_challenge");
        await ctx.context.internalAdapter.deleteVerificationByIdentifier(`2fa-attempts-${challenge}`).catch(() => undefined);

        const user = await ctx.context.internalAdapter.findUserById(userId);
        if (!user) return reject("no_challenge");
        const session = await ctx.context.internalAdapter.createSession(userId, false);
        if (!session) return reject("inactive", check.device.id);
        await setSessionCookie(ctx, { session, user });
        expireCookie(ctx, challengeCookie);
        return ctx.json<TrustedSignInResult>({ trusted: true, deviceId: check.device.id, userId });
      }),
    },
  }) satisfies BetterAuthPlugin;
