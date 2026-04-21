import { redirect } from "next/navigation";

type AdminIndexPageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function AdminIndexPage({ params }: AdminIndexPageProps) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}/admin/files`);
}
