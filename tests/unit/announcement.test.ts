import { describe, expect, it } from "vitest";
import { announcementStatus, contrastRatio, dismissKey, parseDismissed, safeLinkUrl, withDismissed } from "@/lib/promotions/announcement";
import { siteDateTime, siteDateTimeInput } from "@/lib/site-time";

const at = (iso: string) => new Date(iso);

describe("announcement schedule", () => {
  const a = { enabled: true, startsAt: at("2026-10-01T04:00:00Z"), endsAt: at("2026-10-07T04:00:00Z") };
  it("is scheduled, live, then ended — with the end exclusive", () => {
    expect(announcementStatus(a, at("2026-09-30T12:00:00Z"))).toBe("scheduled");
    expect(announcementStatus(a, at("2026-10-01T04:00:00Z"))).toBe("live");
    expect(announcementStatus(a, at("2026-10-07T03:59:59Z"))).toBe("live");
    expect(announcementStatus(a, at("2026-10-07T04:00:00Z"))).toBe("ended");
    expect(announcementStatus({ ...a, enabled: false }, at("2026-10-03T00:00:00Z"))).toBe("off");
    expect(announcementStatus({ enabled: true, startsAt: null, endsAt: null })).toBe("live");
  });
});

describe("dismissal memory", () => {
  it("is keyed per promotion and wording, so new promotions reappear", () => {
    const first = dismissKey({ id: "clx1abc", revision: 1 });
    const cookie = withDismissed(undefined, first);
    expect(parseDismissed(cookie)).toEqual(["clx1abc.1"]);
    expect(parseDismissed(cookie)).not.toContain(dismissKey({ id: "clx1abc", revision: 2 }));
    expect(parseDismissed(cookie)).not.toContain(dismissKey({ id: "clx2new", revision: 1 }));
  });

  it("keeps a bounded list and ignores junk", () => {
    let cookie = "";
    for (let i = 0; i < 15; i++) cookie = withDismissed(cookie, `id${i}.1`);
    expect(parseDismissed(cookie)).toHaveLength(10);
    expect(parseDismissed(cookie).at(-1)).toBe("id14.1");
    expect(parseDismissed("<script>~ok1.2~a.b")).toEqual(["ok1.2"]);
    expect(parseDismissed(encodeURIComponent("x1.1~y2.3"))).toEqual(["x1.1", "y2.3"]);
  });
});

describe("links and colors", () => {
  it("allows site paths and http(s) only", () => {
    expect(safeLinkUrl("/furniture/sale")).toBe("/furniture/sale");
    expect(safeLinkUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(safeLinkUrl("data:text/html,hi")).toBeNull();
    expect(safeLinkUrl("//evil.example")).toBeNull();
    expect(safeLinkUrl("/\\evil")).toBeNull();
  });

  it("measures WCAG contrast", () => {
    expect(contrastRatio("#1f1e1c", "#f7f3ec")).toBeGreaterThan(15);
    expect(contrastRatio("#7a5c36", "#f7f3ec")).toBeGreaterThan(4.5);
    expect(contrastRatio("#c3a67a", "#f7f3ec")).toBeLessThan(4.5);
  });
});

describe("site date-times", () => {
  it("round-trips a local date-time in the site time zone", () => {
    const t = siteDateTime("2026-10-06T17:30", "America/New_York")!;
    expect(t.toISOString()).toBe("2026-10-06T21:30:00.000Z");
    expect(siteDateTimeInput(t, "America/New_York")).toBe("2026-10-06T17:30");
    expect(siteDateTime("2026-12-01T09:00", "America/New_York")!.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(siteDateTime("2026-10-06T25:00")).toBeNull();
  });
});
