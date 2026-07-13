import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "training");

export const metadata: Metadata = {
  title: "CPD Accredited Training",
  description: page?.description,
};

export default function CpdTrainingPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "Training"}
      title={page?.title ?? "CPD accredited training"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel="Discuss training"
    />
  );
}
