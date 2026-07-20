import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "product-carbon-footprinting");

export const metadata: Metadata = {
  title: "Product Carbon Footprinting (PCF) | ISO 14067",
  description: page?.metaDescription ?? page?.description,
  alternates: { canonical: "/product-carbon-footprinting" },
};

const service = serviceSchema({
  name: "Product Carbon Footprinting",
  serviceType: "Product carbon footprint (PCF)",
  path: "/product-carbon-footprinting",
  description:
    "We calculate the carbon footprint of individual products in line with ISO 14067 and the GHG Protocol Product Standard, giving cradle-to-gate or cradle-to-grave figures that stand up to customer, procurement and regulatory scrutiny.",
});

const breadcrumbs = breadcrumbSchema([
  { name: "Product Carbon Footprinting", path: "/product-carbon-footprinting" },
]);

export default function ProductCarbonFootprintingPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
      <ContentPage
        eyebrow={page?.eyebrow ?? "Product Carbon Footprinting"}
        title={page?.title ?? "Product carbon footprinting"}
        description={page?.description ?? ""}
        sections={page?.sections}
        ctaLabel={page?.ctaLabel ?? "Discuss product carbon footprinting"}
        nextStepTitle={page?.nextStepTitle}
        nextStepDescription={page?.nextStepDescription}
        relatedLinks={page?.relatedLinks}
      />
    </>
  );
}
