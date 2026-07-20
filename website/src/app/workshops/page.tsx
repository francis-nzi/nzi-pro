import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "workshops");

export const metadata: Metadata = {
  title: "Net Zero Strategy Workshops",
  description: page?.description,
  alternates: { canonical: "/workshops" },
};

const service = serviceSchema({
  name: "Net Zero Strategy Workshops",
  serviceType: "Facilitated Net Zero strategy workshops",
  path: "/workshops",
  description:
    "Facilitated sessions that help leadership teams agree ambition, understand the data and leave with a workable Net Zero plan.",
  areaServed: ["United Kingdom"],
});

const breadcrumbs = breadcrumbSchema([{ name: "Workshops", path: "/workshops" }]);

export default function StrategyWorkshopsPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Workshops"}
        title={page?.title ?? "Net zero strategy workshops"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel="Plan a workshop"
      />
    </>
  );
}
