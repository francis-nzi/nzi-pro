import { redirect } from "next/navigation";

type AdminIndexPageProps = {
  params: { jobId: string };
};

export default async function AdminIndexPage({ params }: AdminIndexPageProps) {
  const { jobId } = params;
  redirect(`/jobs/${jobId}/admin/files`);
}
