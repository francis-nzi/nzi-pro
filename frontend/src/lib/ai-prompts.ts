export type PromptFamilyKey = "crp" | "secr" | "annual_carbon_report";

export type PromptSectionKey = "executive_summary" | "emissions_overview" | "actions" | "declaration";

export type PromptFamilyOption = {
  key: PromptFamilyKey;
  label: string;
  description: string;
  sections: PromptSectionKey[];
};

export const PROMPT_FAMILIES: PromptFamilyOption[] = [
  {
    key: "client_insights",
    label: "Client Insights",
    description: "Client dashboard insight outputs and summary analysis.",
    sections: ["executive_summary"],
  },
  {
    key: "crp",
    label: "Carbon Reduction Plan",
    description: "Core report family for carbon reduction plan outputs.",
    sections: ["executive_summary", "emissions_overview", "actions", "declaration"],
  },
  {
    key: "secr",
    label: "SECR",
    description: "Streamlined Energy and Carbon Reporting outputs.",
    sections: ["executive_summary", "emissions_overview", "actions", "declaration"],
  },
  {
    key: "annual_carbon_report",
    label: "Annual Carbon Report",
    description: "Long-form annual reporting outputs.",
    sections: ["executive_summary", "emissions_overview", "actions", "declaration"],
  },
];

const SECTION_LABELS: Record<PromptSectionKey, string> = {
  executive_summary: "Executive Summary",
  emissions_overview: "Emissions Overview",
  actions: "Actions",
  declaration: "Declaration",
};

export function promptFamilyLabel(key: string): string {
  return PROMPT_FAMILIES.find((family) => family.key === key)?.label || key;
}

export function promptFamilyDescription(key: string): string {
  return PROMPT_FAMILIES.find((family) => family.key === key)?.description || "";
}

export function promptSectionLabel(key: string): string {
  return SECTION_LABELS[key as PromptSectionKey] || key;
}

export function promptKeyFor(familyKey: string, sectionKey: string): string {
  return `${familyKey}.${sectionKey}`;
}
