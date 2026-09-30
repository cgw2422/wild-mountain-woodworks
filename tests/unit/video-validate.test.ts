import { describe, expect, it } from "vitest";
import { precheckVideoFile, sniffVideoType, videoMimeFor } from "@/lib/media/validate";
import { isoDuration } from "@/lib/media/video";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("product video validation", () => {
  it("identifies the container from the file's first bytes", () => {
    expect(sniffVideoType(bytes([0, 0, 0, 0x20], "ftyp", "isom"))).toBe("video/mp4");
    expect(sniffVideoType(bytes([0, 0, 0, 0x14], "ftyp", "qt  "))).toBe("video/quicktime");
    expect(sniffVideoType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe("video/webm");
    expect(sniffVideoType(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF\0\0\0\0"))).toBeNull();
  });

  it("checks type, extension and size before uploading", () => {
    expect(precheckVideoFile({ name: "table.mp4", type: "video/mp4", size: 1000 })).toBeNull();
    expect(precheckVideoFile({ name: "IMG_0001.MOV", type: "", size: 1000 })).toBeNull(); // some browsers omit the type
    expect(videoMimeFor({ name: "clip.m4v", type: "" })).toBe("video/mp4");
    expect(precheckVideoFile({ name: "table.avi", type: "video/x-msvideo", size: 1000 })).toMatch(/not a supported video type/);
    expect(precheckVideoFile({ name: "table.mp4", type: "video/webm", size: 1000 })).toMatch(/extension that doesn't match/);
    expect(precheckVideoFile({ name: "big.mp4", type: "video/mp4", size: 201 * 1024 * 1024 })).toMatch(/larger than 200 MB/);
    expect(precheckVideoFile({ name: "empty.mp4", type: "video/mp4", size: 0 })).toMatch(/empty/);
  });

  it("formats durations for structured data", () => {
    expect(isoDuration(75.4)).toBe("PT1M15S");
    expect(isoDuration(3600)).toBe("PT1H");
    expect(isoDuration(0.2)).toBe("PT1S");
  });
});
