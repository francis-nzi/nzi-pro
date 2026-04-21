import { redirect } from "next/navigation";

type CommunicationsIndexPageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function CommunicationsIndexPage({ params }: CommunicationsIndexPageProps) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}/communications/timeline`);
}
