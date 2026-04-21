import { redirect } from "next/navigation";

type FinancialIndexPageProps = {
  params: Promise<{ jobId: string }>;
};

export default async function FinancialIndexPage({ params }: FinancialIndexPageProps) {
  const { jobId } = await params;
  redirect(`/jobs/${jobId}/financial/quotes`);
}
