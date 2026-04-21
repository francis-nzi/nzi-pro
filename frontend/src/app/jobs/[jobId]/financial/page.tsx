import { redirect } from "next/navigation";

type FinancialIndexPageProps = {
  params: { jobId: string };
};

export default async function FinancialIndexPage({ params }: FinancialIndexPageProps) {
  const { jobId } = params;
  redirect(`/jobs/${jobId}/financial/quotes`);
}
