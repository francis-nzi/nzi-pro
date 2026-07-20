import type { Metadata } from "next";
import { ContentPage } from "@/components/ContentPage";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbSchema, serviceSchema } from "@/lib/schema";
import { servicePages } from "@/content/site";

const page = servicePages.find((item) => item.slug === "cbam");

export const metadata: Metadata = {
  title: "CBAM Calculation & Reporting | EU & UK CBAM Support",
  description: page?.metaDescription ?? page?.description,
  alternates: { canonical: "/cbam" },
};

const service = serviceSchema({
  name: "CBAM Calculation and Reporting",
  serviceType: "Carbon Border Adjustment Mechanism (CBAM) reporting",
  path: "/cbam",
  description:
    "We calculate embedded emissions and prepare the reporting organisations need to meet Carbon Border Adjustment Mechanism (CBAM) obligations for affected goods, including data collection from suppliers and submission-ready reports.",
});

const breadcrumbs = breadcrumbSchema([{ name: "CBAM", path: "/cbam" }]);

export default function CbamPage() {
  return (
    <>
      <JsonLd data={service} />
      <JsonLd data={breadcrumbs} />
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
    </>
  );
}
