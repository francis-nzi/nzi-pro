import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, courseSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "training");

export const metadata: Metadata = {
  title: "CPD Accredited Training",
  description: page?.description,
  alternates: { canonical: "/training" },
};

const breadcrumbs = breadcrumbSchema([{ name: "Training", path: "/training" }]);

export default function CpdTrainingPage() {
  return (
    <>
      <JsonLd data={courseSchema} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Training"}
        title={page?.title ?? "CPD accredited training"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel="Discuss training"
      />
    </>
  );
}
