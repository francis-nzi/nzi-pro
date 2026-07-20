import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "scope-3");

export const metadata: Metadata = {
  title: "Scope 3 Solutions",
  description: page?.description,
};

export default function Scope3SolutionsPage() {
  return (
    <ContentPage
      eyebrow={page?.eyebrow ?? "Scope 3"}
      title={page?.title ?? "Scope 3 solutions"}
      description={page?.description ?? ""}
      sections={page?.sections}
      ctaLabel="Discuss Scope 3"
      relatedLinks={page?.relatedLinks}
    />
  );
}
