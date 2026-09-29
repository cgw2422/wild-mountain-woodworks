import { describe, expect, it } from "vitest";
import { storageErrorHint } from "@/lib/storage/errors";

describe("storage error hints", () => {
  it("names the setting to check for common R2 failures", () => {
    expect(storageErrorHint({ name: "InvalidAccessKeyId" })).toMatch(/R2_ACCESS_KEY_ID/);
    expect(storageErrorHint({ name: "SignatureDoesNotMatch" })).toMatch(/R2_SECRET_ACCESS_KEY/);
    expect(storageErrorHint({ name: "AccessDenied" })).toMatch(/Object Read & Write/);
    expect(storageErrorHint({ name: "NoSuchBucket" })).toMatch(/R2_BUCKET/);
    expect(storageErrorHint({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND x.r2.cloudflarestorage.com" })).toMatch(/R2_ACCOUNT_ID/);
    expect(storageErrorHint(new Error("R2 storage is missing configuration: R2_PUBLIC_URL"))).toMatch(/R2_PUBLIC_URL\. Add it in Railway/);
    expect(storageErrorHint(new Error("boom"))).toMatch(/try again/);
  });
});
