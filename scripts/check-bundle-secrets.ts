/**
 * Fails if anything secret appears in the JavaScript/CSS sent to browsers.
 *
 *   npm run build && npm run check:bundle
 *
 * Scans .next/static (everything a browser can download) for:
 *   - the actual values of secret environment variables present at build time
 *   - patterns that only ever belong on the server (connection strings,
 *     Stripe secret keys, private keys, the development auth secret)
 *   - server-only modules that must never be bundled for the client
 */
import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), ".next", "static");

const SECRET_ENV = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "POSTMARK_SERVER_TOKEN",
  "ADMIN_PASSWORD",
];

const PATTERNS: Array<[string, RegExp]> = [
  ["PostgreSQL connection string", /postgres(ql)?:\/\/[^\s"'`]+:[^\s"'`]+@/i],
  ["Stripe secret key", /\bsk_(live|test)_[0-9a-zA-Z]{10,}/],
  ["Stripe webhook secret", /\bwhsec_[0-9a-zA-Z]{10,}/],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["Development auth secret", /wild-mountain-development-only-secret/],
  ["Prisma client (server-only)", /PrismaClientKnownRequestError|@prisma\/adapter-pg/],
  ["Password hashing (server-only)", /bcryptjs|hashAdminPassword/],
];

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|mjs|css|json|map|txt|html)$/.test(name)) yield full;
  }
}

try {
  statSync(ROOT);
} catch {
  console.error("No .next/static found — run `npm run build` first.");
  process.exit(1);
}

const secrets = SECRET_ENV.map((k) => [k, process.env[k]] as const).filter((e): e is readonly [string, string] => Boolean(e[1] && e[1].length >= 8));
const problems: string[] = [];
let scanned = 0;
for (const file of files(ROOT)) {
  scanned++;
  const text = readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file);
  for (const [name, value] of secrets) if (text.includes(value)) problems.push(`${rel}: contains the value of ${name}`);
  for (const [label, re] of PATTERNS) if (re.test(text)) problems.push(`${rel}: looks like ${label}`);
}

console.log(`Scanned ${scanned} client files for ${secrets.length} secret values and ${PATTERNS.length} patterns.`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("No secrets found in client bundles.");
