/** Result returned by every admin server action (safe for client import). */
export type ActionResult = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Optional id of a created record, for client-side navigation. */
  id?: string;
};
