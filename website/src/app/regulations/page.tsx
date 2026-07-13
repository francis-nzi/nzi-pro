import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "regulations");

export const metadata: Metadata = {
  title: "Net Zero Regulations and Legislation",
  description: page?.description,
};

export default function RegulationsPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "Regulation"}
      title={page?.title ?? "Net zero regulations and legislation"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel="Discuss regulations"
    />
  );
}
