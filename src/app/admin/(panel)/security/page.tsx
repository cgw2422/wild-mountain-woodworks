import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/session";
import { SESSION_IDLE_SECONDS, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { ActionButton, ActionForm, ConfirmAction, Select, SubmitButton, TextInput } from "@/components/admin/forms";
import { AdminLinkButton, Badge, Card, PageHeader, formatDate, table } from "@/components/admin/ui";
import {
  changePassword,
  createAdminUser,
  regenerateBackupCodes,
  replaceAuthenticator,
  resetAdminPassword,
  resetAdminTwoFactor,
  revokeAdminSessions,
  revokeMyOtherSessions,
  revokeMySession,
  setAdminActive,
  setAdminRole,
} from "./actions";
import { BackupCodesButton, PasswordActionButton, RoleSelect } from "./SecurityControls";

export const metadata: Metadata = { title: "Security" };
export const dynamic = "force-dynamic";

/** "Chrome on macOS" from a user-agent string (display only). */
function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

const hoursLabel = (s: number) => (s % 86400 === 0 ? `${s / 86400} day${s === 86400 ? "" : "s"}` : `${Math.round(s / 3600)} hour${s === 3600 ? "" : "s"}`);

export default async function SecurityPage() {
  const admin = await requireAdmin();
  const isOwner = admin.role === "OWNER";
  const [me, sessions, admins] = await Promise.all([
    prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id }, select: { twoFactorEnabled: true, admintwofactors: { select: { id: true } } } }),
    prisma.adminSession.findMany({ where: { userId: admin.id, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" } }),
    isOwner
      ? prisma.adminUser.findMany({
          orderBy: [{ active: "desc" }, { createdAt: "asc" }],
          select: { id: true, name: true, email: true, role: true, active: true, twoFactorEnabled: true, lastLoginAt: true, _count: { select: { adminsessions: true } } },
        })
      : Promise.resolve([]),
  ]);
  const activeOwners = admins.filter((a) => a.role === "OWNER" && a.active).length;

  return (
    <>
      <PageHeader
        title="Security"
        description={`Your password, two-factor authentication and signed-in devices${isOwner ? ", plus admin users and the audit log" : ""}.`}
        actions={isOwner ? <AdminLinkButton href="/admin/security/audit">Audit log</AdminLinkButton> : undefined}
      />
      {/* minmax(0,1fr): wide tables scroll inside their card instead of widening the page on phones. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
        <Card title="Your password" description={`Signed in as ${admin.name} (${admin.email}).`}>
          <ActionForm action={changePassword} resetOnSuccess className="max-w-md space-y-4" successMessage={null}>
            <input type="text" name="username" autoComplete="username" defaultValue={admin.email} hidden readOnly />
            <TextInput name="currentPassword" label="Current password" type="password" autoComplete="current-password" required />
            <TextInput
              name="newPassword"
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              help={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and a number or symbol. A passphrase works well.`}
            />
            <TextInput name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required />
            <p className="text-xs text-neutral-500">Changing your password signs you out on every other device.</p>
            <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Two-factor authentication" description="Required for every admin account.">
          <div className="flex flex-wrap items-center gap-3">
            {me.twoFactorEnabled ? <Badge tone="green">On — authenticator app</Badge> : <Badge tone="red">Not set up</Badge>}
            <BackupCodesButton regenerate={regenerateBackupCodes} />
            <PasswordActionButton
              label="Replace authenticator"
              title="Replace your authenticator app?"
              body="Use this for a new phone. Your current authenticator and backup codes stop working, and you'll set up the new app right away."
              fieldLabel="Your password"
              confirmLabel="Continue"
              action={replaceAuthenticator}
            />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Lost your phone and your backup codes? Ask another owner to reset your two-factor, or run <code>npm run admin:create -- --email you@… --reset-mfa</code> from a trusted machine.
          </p>
        </Card>

        <Card
          title="Where you're signed in"
          description={`Sessions end after ${hoursLabel(SESSION_IDLE_SECONDS)} without activity, and always after ${hoursLabel(SESSION_MAX_AGE_SECONDS)}.`}
          actions={
            sessions.length > 1 ? (
              <ConfirmAction
                action={revokeMyOtherSessions}
                label="Sign out other sessions"
                variant="small"
                title="Sign out everywhere else?"
                body="Every other browser and device signed in to your account is signed out immediately. This one stays signed in."
                confirmLabel="Sign out others"
              />
            ) : undefined
          }
        >
          <ul className="divide-y divide-neutral-100">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{device(s.userAgent)}</span>
                  {s.id === admin.sessionId ? <Badge tone="green" className="ml-2">This device</Badge> : null}
                  <span className="block text-xs text-neutral-500">
                    {s.ipAddress || "Unknown IP"} · signed in {formatDate(s.createdAt, true)} · last active {formatDate(s.updatedAt, true)}
                  </span>
                </span>
                {s.id !== admin.sessionId ? (
                  <ActionButton action={revokeMySession.bind(null, s.id)} variant="small" pendingLabel="Signing out…">
                    Sign out
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        {isOwner ? (
          <Card id="admins" title="Admin users" description="Only owners see this section. Admins manage products, quotes, content and media; owners also manage admin users and security.">
            <div className="space-y-6">
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead className={table.thead}>
                    <tr>
                      <th scope="col" className={table.th}>Name</th>
                      <th scope="col" className={table.th}>Role</th>
                      <th scope="col" className={table.th}>Status</th>
                      <th scope="col" className={table.th}>Last sign-in</th>
                      <th scope="col" className={table.th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className={table.tbody}>
                    {admins.map((u) => {
                      const isSelf = u.id === admin.id;
                      const lastOwner = u.role === "OWNER" && u.active && activeOwners <= 1;
                      return (
                        <tr key={u.id} className={table.tr}>
                          <td className={table.td}>
                            <span className="font-medium text-neutral-900">{u.name}</span>
                            {isSelf ? <span className="ml-1 text-xs text-neutral-500">(you)</span> : null}
                            <span className="block text-xs text-neutral-500">{u.email}</span>
                          </td>
                          <td className={table.td}>
                            {isSelf || lastOwner ? (u.role === "OWNER" ? "Owner" : "Admin") : <RoleSelect name={u.name} role={u.role} change={setAdminRole.bind(null, u.id)} />}
                          </td>
                          <td className={table.td}>
                            <span className="flex flex-wrap gap-1">
                              {u.active ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}
                              {u.twoFactorEnabled ? <Badge tone="green">2FA on</Badge> : <Badge tone="amber">2FA pending</Badge>}
                            </span>
                            <span className="mt-1 block text-xs text-neutral-500">
                              {u._count.adminsessions} active session{u._count.adminsessions === 1 ? "" : "s"}
                            </span>
                          </td>
                          <td className={`${table.td} whitespace-nowrap`}>{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "Never"}</td>
                          <td className={`${table.td} text-right`}>
                            {isSelf ? (
                              <span className="text-xs text-neutral-400">Manage above</span>
                            ) : (
                              <span className="inline-flex flex-wrap justify-end gap-1.5">
                                {u.active ? (
                                  <>
                                    <ConfirmAction
                                      action={revokeAdminSessions.bind(null, u.id)}
                                      label="Sign out everywhere"
                                      variant="small"
                                      title={`Sign ${u.name} out everywhere?`}
                                      body="Use this if you suspect their account is compromised. They can sign in again with their password and authenticator."
                                      confirmLabel="Sign out"
                                    />
                                    <ConfirmAction
                                      action={resetAdminTwoFactor.bind(null, u.id)}
                                      label="Reset 2FA"
                                      variant="small"
                                      title={`Reset two-factor for ${u.name}?`}
                                      body="Their authenticator and backup codes stop working and they're signed out. They'll set up a new authenticator at next sign-in. Only do this after confirming their identity."
                                      confirmLabel="Reset 2FA"
                                    />
                                    <PasswordActionButton
                                      label="Reset password"
                                      variant="small"
                                      title={`Set a new password for ${u.name}`}
                                      body="They'll be signed out everywhere. Share the new password privately and ask them to change it."
                                      fieldLabel="New password"
                                      newPassword
                                      confirmLabel="Set password"
                                      action={resetAdminPassword.bind(null, u.id)}
                                    />
                                    {lastOwner ? (
                                      <span className="self-center text-xs text-neutral-500">Last owner</span>
                                    ) : (
                                      <ConfirmAction
                                        action={setAdminActive.bind(null, u.id, false)}
                                        label="Deactivate"
                                        variant="small"
                                        title={`Deactivate ${u.name}?`}
                                        body="They're signed out immediately and can't sign in until reactivated. Their history is kept."
                                        confirmLabel="Deactivate"
                                      />
                                    )}
                                  </>
                                ) : (
                                  <ActionButton action={setAdminActive.bind(null, u.id, true)} variant="small" pendingLabel="Saving…">
                                    Reactivate
                                  </ActionButton>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="mb-3 text-sm font-semibold text-neutral-900">Add an admin</h3>
                <ActionForm action={createAdminUser} resetOnSuccess className="space-y-4" successMessage={null}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextInput name="name" label="Name" required maxLength={120} autoComplete="off" />
                    <TextInput name="email" label="Email" type="email" required maxLength={254} autoComplete="off" />
                    <Select
                      name="role"
                      label="Role"
                      defaultValue="ADMIN"
                      options={[
                        { value: "ADMIN", label: "Admin — products, quotes, content and media" },
                        { value: "OWNER", label: "Owner — everything, including admin users and security" },
                      ]}
                    />
                    <TextInput
                      name="password"
                      label="Initial password"
                      type="password"
                      required
                      autoComplete="new-password"
                      help={`At least ${PASSWORD_MIN_LENGTH} characters. Share it privately; they'll set up two-factor at first sign-in.`}
                    />
                  </div>
                  <SubmitButton pendingLabel="Adding…">Add admin</SubmitButton>
                </ActionForm>
              </div>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
