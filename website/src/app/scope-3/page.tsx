import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "scope-3");

export const metadata: Metadata = {
  title: "Scope 3 Solutions",
  description: page?.description,
  alternates: { canonical: "/scope-3" },
};

const service = serviceSchema({
  name: "Scope 3 Supply Chain Solutions",
  serviceType: "Scope 3 emissions measurement and supplier engagement",
  path: "/scope-3",
  description:
    "We help organisations measure and report supply-chain emissions, screen categories, engage suppliers and prioritise action so Scope 3 becomes manageable.",
  areaServed: ["United Kingdom"],
});

const breadcrumbs = breadcrumbSchema([{ name: "Scope 3", path: "/scope-3" }]);

export default function Scope3SolutionsPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Scope 3"}
        title={page?.title ?? "Scope 3 solutions"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel="Discuss Scope 3"
        relatedLinks={page?.relatedLinks}
      />
    </>
  );
}
