import dynamic from "next/dynamic";

import { TabsContent } from "@/components/ui/tabs";

const JobFinancial = dynamic(() => import("@/components/JobFinancial"), {
  loading: () => <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-muted-foreground">Loading financial sections...</div>,
});

type JobFinancialTabsProps = {
  jobId: number;
  clientId: number | null;
  jobNumber: string | null;
  baseUrl: string;
};

export default function JobFinancialTabs({
  jobId,
  clientId,
  jobNumber,
  baseUrl,
}: JobFinancialTabsProps) {
  return (
    <>
      <TabsContent value="financial-quotes" className="mt-0">
        <JobFinancial
          jobId={jobId}
          clientId={clientId}
          jobNumber={jobNumber}
          baseUrl={baseUrl}
          mode="quotes"
        />
      </TabsContent>

      <TabsContent value="financial-invoices" className="mt-0">
        <JobFinancial
          jobId={jobId}
          clientId={clientId}
          jobNumber={jobNumber}
          baseUrl={baseUrl}
          mode="invoices"
        />
      </TabsContent>

      <TabsContent value="financial-profit-loss" className="mt-0">
        <JobFinancial
          jobId={jobId}
          clientId={clientId}
          jobNumber={jobNumber}
          baseUrl={baseUrl}
          mode="profit-loss"
        />
      </TabsContent>

      <TabsContent value="financial-other-costs" className="mt-0">
        <JobFinancial
          jobId={jobId}
          clientId={clientId}
          jobNumber={jobNumber}
          baseUrl={baseUrl}
          mode="other-costs"
        />
      </TabsContent>
    </>
  );
}
