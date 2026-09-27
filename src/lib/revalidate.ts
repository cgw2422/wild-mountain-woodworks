import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Public pages render dynamically, but the client router cache and any
 * cached segments are refreshed after admin edits so changes appear
 * immediately without redeploying.
 */
export function revalidateSite() {
  revalidatePath("/", "layout");
}
