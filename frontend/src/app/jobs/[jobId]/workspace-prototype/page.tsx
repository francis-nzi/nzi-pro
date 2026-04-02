import JobWorkspacePrototype from "@/components/JobWorkspacePrototype";

export default async function JobWorkspacePrototypePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId: jobIdParam } = await params;
  const jobId = Number(jobIdParam);

  return <JobWorkspacePrototype jobId={Number.isFinite(jobId) ? jobId : 0} />;
}
