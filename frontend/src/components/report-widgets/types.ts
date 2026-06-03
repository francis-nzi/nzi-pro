export type ReportComparisonYear = {
  year: number;
  jobId?: number | null;
  jobNumber?: string | null;
  isBenchmark?: boolean;
};

export type ScopeCategoryComparisonRow =
  | {
      type: "category";
      scope: string;
      category: string;
      values: Array<number | null>;
    }
  | {
      type: "subtotal";
      scope: string;
      values: Array<number | null>;
    }
  | {
      type: "total";
      values: Array<number | null>;
    };
