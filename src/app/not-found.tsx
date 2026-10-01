import type { Metadata } from "next";
import { connection } from "next/server";
import { SiteChrome } from "@/components/site/SiteChrome";
import { Container } from "@/components/ui/Container";
import { ButtonLink } from "@/components/ui/Button";
import { RidgeLine } from "@/components/brand/Logo";
import { IfPublic } from "@/components/site/IfPublic";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default async function NotFound() {
  // Render per request: the header/footer read live settings from the database,
  // which isn't reachable during the build.
  await connection();
  return (
    <SiteChrome>
      <Container className="flex flex-col items-center py-28 text-center md:py-40">
        <RidgeLine className="h-6 w-28 text-bronze" />
        <p className="eyebrow mt-10 text-bronze-text">404</p>
        <h1 className="display-lg mt-4 max-w-2xl">We couldn&apos;t find that page.</h1>
        <p className="lede mt-5 max-w-md text-muted">It may have moved, or the piece you&apos;re looking for is no longer available.</p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <IfPublic path="/furniture">
            <ButtonLink href="/furniture">Explore Furniture</ButtonLink>
          </IfPublic>
          <ButtonLink href="/" variant="secondary">
            Back to Home
          </ButtonLink>
        </div>
      </Container>
    </SiteChrome>
  );
}
