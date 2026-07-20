import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "life-cycle-assessments");

export const metadata: Metadata = {
  title: "Life Cycle Assessments (LCA) | ISO 14040/14044",
  description: page?.metaDescription ?? page?.description,
};

export default function LifeCycleAssessmentsPage() {
  return (
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
  );
}
