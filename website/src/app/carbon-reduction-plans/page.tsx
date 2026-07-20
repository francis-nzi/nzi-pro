import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "carbon-reduction-plans");

export const metadata: Metadata = {
  title: "Carbon Reduction Plans",
  description: page?.description,
  alternates: { canonical: "/carbon-reduction-plans" },
};

const service = serviceSchema({
  name: "Carbon Reduction Plans",
  serviceType: "Carbon reduction planning and emissions reporting",
  path: "/carbon-reduction-plans",
  description:
    "We measure and report your carbon emissions, then shape a practical carbon reduction plan for procurement, compliance and board-level decision making, aligned to PPN 006 where public procurement applies.",
});

const breadcrumbs = breadcrumbSchema([{ name: "Carbon Reduction Plans", path: "/carbon-reduction-plans" }]);

export default function CarbonReductionPlansPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Carbon Reduction Plans"}
        title={page?.title ?? "Carbon reduction plans"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel="Discuss carbon reduction plans"
      />
    </>
  );
}
