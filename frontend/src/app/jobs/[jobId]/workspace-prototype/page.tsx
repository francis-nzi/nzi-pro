import JobWorkspacePrototype from "@/components/JobWorkspacePrototype";

type WorkspacePrototypePageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function WorkspacePrototypePage({ params }: WorkspacePrototypePageProps) {
  const { jobId } = await params;
  const parsedJobId = Number(jobId);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <JobWorkspacePrototype
        job={{
          jobId: Number.isNaN(parsedJobId) ? 556 : parsedJobId,
          jobNumber: `J${String(Number.isNaN(parsedJobId) ? 556 : parsedJobId).padStart(6, "0")}`,
          jobTitle: "Carbon Reduction Plan",
          clientName: "First Event",
          reportingPeriodLabel: "01 Feb 2025 - 31 Jan 2026",
          statusLabel: "Open",
          ownerLabel: "Tina Hartley",
          crmLabel: "Sample job context",
        }}
        prototypeNote="Prototype shell only. Use this route to review the top-nav layout."
      />
    </div>
  );
}
