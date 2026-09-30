/** A sales-workflow rule was violated; `message` is safe to show to the user. */
export class SalesError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "SalesError";
  }
}
