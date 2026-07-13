import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "workshops");

export const metadata: Metadata = {
  title: "Net Zero Strategy Workshops",
  description: page?.description,
};

export default function StrategyWorkshopsPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "Workshops"}
      title={page?.title ?? "Net zero strategy workshops"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel="Plan a workshop"
    />
  );
}
