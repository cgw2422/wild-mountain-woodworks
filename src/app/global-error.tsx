"use client";

/** Last-resort error boundary (renders its own <html>). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f3ec", color: "#1f1e1c" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "120px 24px", textAlign: "center" }}>
          <p style={{ letterSpacing: "0.2em", fontSize: 12 }}>WILD MOUNTAIN WOODWORKS</p>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 400, fontSize: 36, margin: "24px 0 12px" }}>Something went wrong.</h1>
          <p style={{ color: "#5c574f", lineHeight: 1.6 }}>Please try again in a moment.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 32, background: "#1f1e1c", color: "#f7f3ec", border: 0, padding: "14px 28px", letterSpacing: "0.16em", fontSize: 12, cursor: "pointer" }}
          >
            TRY AGAIN
          </button>
        </div>
      </body>
    </html>
  );
}
