import JobWorkspacePrototype from "@/components/JobWorkspacePrototype";

export default function JobWorkspacePrototypePage({
  params,
}: {
  params: { jobId: string };
}) {
  const jobId = Number(params?.jobId);

  return <JobWorkspacePrototype jobId={Number.isFinite(jobId) ? jobId : 0} />;
}
