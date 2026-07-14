import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "carbon-reduction-plans");

export const metadata: Metadata = {
  title: "Carbon Reduction Plans",
  description: page?.description,
};

export default function CarbonReductionPlansPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "Carbon Reduction Plans"}
      title={page?.title ?? "Carbon reduction plans"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel="Discuss carbon reduction plans"
    />
  );
}
