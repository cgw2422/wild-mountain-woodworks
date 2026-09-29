/**
 * Plain-language explanation of an object-storage failure, for admins only.
 * Never includes credentials — just which setting to check.
 */
export function storageErrorHint(err: unknown): string {
  const e = err as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const code = e?.Code ?? e?.name ?? e?.code ?? "";
  const message = e?.message ?? "";
  if (/R2 storage is missing configuration/.test(message)) return `${message}. Add it in Railway → Variables and redeploy.`;
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|Unauthorized/i.test(code) || e?.$metadata?.httpStatusCode === 401) {
    return "Cloudflare R2 rejected the access keys. Check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (no extra spaces or quotes).";
  }
  if (/AccessDenied/i.test(code) || e?.$metadata?.httpStatusCode === 403) {
    return "Cloudflare R2 denied access. Make sure the API token has Object Read & Write permission for this bucket.";
  }
  if (/NoSuchBucket/i.test(code)) return "The R2 bucket was not found. Check that R2_BUCKET exactly matches the bucket name.";
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(`${code} ${message}`)) {
    return "The R2 endpoint could not be reached. Check that R2_ACCOUNT_ID is your Cloudflare account ID (not the bucket name or a URL).";
  }
  return "Please try again. If it keeps failing, check the image storage status in Settings and the Railway logs.";
}
