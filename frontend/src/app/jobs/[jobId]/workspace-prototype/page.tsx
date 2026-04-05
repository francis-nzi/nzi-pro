import JobWorkspacePrototype from "@/components/JobWorkspacePrototype";

type WorkspacePrototypePageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function WorkspacePrototypePage({ params }: WorkspacePrototypePageProps) {
  const { jobId } = await params;
  const parsedJobId = Number(jobId);
  const resolvedJobId = Number.isNaN(parsedJobId) ? 556 : parsedJobId;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <JobWorkspacePrototype
        jobId={resolvedJobId}
        prototypeNote="Prototype shell only. Use this route to review the top-nav layout."
      />
    </div>
  );
}
