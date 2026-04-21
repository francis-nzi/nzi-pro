import { redirect } from "next/navigation";

type CommunicationsIndexPageProps = {
  params: { jobId: string };
};

export default async function CommunicationsIndexPage({ params }: CommunicationsIndexPageProps) {
  const { jobId } = params;
  redirect(`/jobs/${jobId}/communications/timeline`);
}
