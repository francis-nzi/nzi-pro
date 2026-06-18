import dynamic from "next/dynamic";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsContent } from "@/components/ui/tabs";

const JobCommunications = dynamic(() => import("@/components/JobCommunications"), {
  loading: () => <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-muted-foreground">Loading communications...</div>,
});
const ClientTimeline = dynamic(() => import("@/components/ClientTimeline"), {
  loading: () => <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-muted-foreground">Loading CRM activity...</div>,
});

type JobCommunicationsTabsProps = {
  jobId: number;
  baseUrl: string;
  clientDbId: number | null;
};

export default function JobCommunicationsTabs({
  jobId,
  baseUrl,
  clientDbId,
}: JobCommunicationsTabsProps) {
  return (
    <>
      <TabsContent value="communications-timeline" className="mt-0">
        <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="timeline" />
      </TabsContent>

      <TabsContent value="communications-inbox" className="mt-0">
        <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="inbox" />
      </TabsContent>

      <TabsContent value="communications-notes" className="mt-0">
        <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="notes" />
      </TabsContent>

      <TabsContent value="communications-email" className="mt-0">
        <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="email" />
      </TabsContent>

      <TabsContent value="communications-automation" className="mt-0">
        <JobCommunications jobId={jobId} baseUrl={baseUrl} mode="automation" />
      </TabsContent>

      <TabsContent value="communications-crm" className="mt-0">
        {clientDbId ? (
          <ClientTimeline clientId={clientDbId} baseUrl={baseUrl} jobId={jobId} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>CRM Timeline</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">No client linked to this job.</CardContent>
          </Card>
        )}
      </TabsContent>
    </>
  );
}
