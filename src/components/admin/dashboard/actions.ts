"use server";

import { logActivity } from "@/lib/activity";
import { adminAction, fd } from "@/lib/admin/action";
import { describeRemovalReport, removeSampleContent } from "@/lib/admin/sample-content";
import { revalidateSite } from "@/lib/revalidate";

/** Dashboard → Launch checklist → "Remove sample content". */
export const removeSampleContentAction = adminAction(async (admin, formData: FormData) => {
  const report = await removeSampleContent({ clearPageAndCategoryImages: fd.bool(formData, "clearPageImages") });
  const summary = describeRemovalReport(report);
  await logActivity("sample_content.removed", `${admin.name} removed sample content: ${summary}`, { actorId: admin.id });
  revalidateSite();
  const kept = report.mediaKept.length
    ? ` Kept images are still used in: ${[...new Set(report.mediaKept.flatMap((m) => m.usedIn))].slice(0, 6).join("; ")}${
        report.mediaKept.flatMap((m) => m.usedIn).length > 6 ? "; …" : ""
      }.`
    : "";
  return { ok: true, message: `Done: ${summary}${kept}` };
});
