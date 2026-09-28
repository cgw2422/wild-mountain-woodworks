import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { Card, PageHeader } from "@/components/admin/ui";
import { createProject } from "../actions";
import { NewProjectForm } from "./NewProjectForm";

export const metadata: Metadata = { title: "New project" };

export default async function NewProject() {
  await requireAdmin();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Portfolio", href: "/admin/portfolio" }, { label: "New project" }]} title="New portfolio project" />
      <Card className="max-w-2xl" title="Start with a name" description="The project is saved as a draft. You'll add photos, details and the story next, then publish when it's ready.">
        <NewProjectForm action={createProject} />
      </Card>
    </>
  );
}
