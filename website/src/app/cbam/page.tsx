import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "cbam");

export const metadata: Metadata = {
  title: "CBAM Calculation & Reporting | EU & UK CBAM Support",
  description: page?.metaDescription ?? page?.description,
};

export default function CbamPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "CBAM Calculation and Reporting"}
      title={page?.title ?? "CBAM calculation and reporting"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel={page?.ctaLabel ?? "Discuss CBAM support"}
      nextStepTitle={page?.nextStepTitle}
      nextStepDescription={page?.nextStepDescription}
      relatedLinks={page?.relatedLinks}
    />
  );
}
