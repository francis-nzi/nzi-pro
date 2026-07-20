import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "life-cycle-assessments");

export const metadata: Metadata = {
  title: "Life Cycle Assessments (LCA) | ISO 14040/14044",
  description: page?.metaDescription ?? page?.description,
  alternates: { canonical: "/life-cycle-assessments" },
};

const service = serviceSchema({
  name: "Life Cycle Assessments",
  serviceType: "Life cycle assessment (LCA)",
  path: "/life-cycle-assessments",
  description:
    "We assess the environmental impact of a product or service across its full life cycle, from raw materials to end of life, following ISO 14040 and ISO 14044, to support design, disclosure and procurement decisions.",
});

const breadcrumbs = breadcrumbSchema([
  { name: "Life Cycle Assessments", path: "/life-cycle-assessments" },
]);

export default function LifeCycleAssessmentsPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Life Cycle Assessments"}
        title={page?.title ?? "Life cycle assessments"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel={page?.ctaLabel ?? "Discuss a life cycle assessment"}
        nextStepTitle={page?.nextStepTitle}
        nextStepDescription={page?.nextStepDescription}
        relatedLinks={page?.relatedLinks}
      />
    </>
  );
}
