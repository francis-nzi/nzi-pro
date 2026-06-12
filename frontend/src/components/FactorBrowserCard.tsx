import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FactorBrowserFactor = {
  scope: string;
  category: string;
  report_label: string;
  original_id: string;
  uom: string;
  dataset_id: number | null;
  factor_db_id: number | null;
  factor: number | null;
  ghg_unit: string | null;
  column_text?: string | null;
  is_custom?: boolean;
  methodology_default?: boolean;
  methodology_default_label?: string | null;
};

type ActionProps = {
  label: string;
  variant?: "default" | "outline";
  disabled?: boolean;
};

type FactorBrowserCardProps = {
  title: string;
  factorSearchQuery: string;
  onFactorSearchQueryChange: (value: string) => void;
  factorScopeFilter: string;
  onFactorScopeFilterChange: (value: string) => void;
  factorCategoryFilter: string;
  onFactorCategoryFilterChange: (value: string) => void;
  factorCategoryOptions: string[];
  onSearch: () => void;
  factorsLoading: boolean;
  methodologyCountry: string;
  templateFactors: FactorBrowserFactor[];
  factorsTotal: number;
  factorsHasMore: boolean;
  loadingMoreFactors: boolean;
  onLoadMore: () => void;
  getFactorTitle: (factor: FactorBrowserFactor) => string;
  getFactorSubtitle: (factor: FactorBrowserFactor) => string;
  getActionProps: (factor: FactorBrowserFactor) => ActionProps;
  onSelectFactor: (factor: FactorBrowserFactor) => void;
  isFactorSelected?: (factor: FactorBrowserFactor) => boolean;
  emptyMessage?: string;
  searchPlaceholder?: string;
  listMaxHeightClassName?: string;
};

export default function FactorBrowserCard({
  title,
  factorSearchQuery,
  onFactorSearchQueryChange,
  factorScopeFilter,
  onFactorScopeFilterChange,
  factorCategoryFilter,
  onFactorCategoryFilterChange,
  factorCategoryOptions,
  onSearch,
  factorsLoading,
  methodologyCountry,
  templateFactors,
  factorsTotal,
  factorsHasMore,
  loadingMoreFactors,
  onLoadMore,
  getFactorTitle,
  getFactorSubtitle,
  getActionProps,
  onSelectFactor,
  isFactorSelected,
  emptyMessage = "No factors found. Try adjusting your search or filters.",
  searchPlaceholder = "Search by label, category, or ID...",
  listMaxHeightClassName = "max-h-96",
}: FactorBrowserCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 min-w-0">
        <div className="space-y-3">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
            <div className="min-w-0">
              <Label htmlFor={`${title.replace(/\s+/g, "-").toLowerCase()}-search`}>Search Factors</Label>
              <Input
                id={`${title.replace(/\s+/g, "-").toLowerCase()}-search`}
                placeholder={searchPlaceholder}
                value={factorSearchQuery}
                className="w-full min-w-0"
                onChange={(e) => onFactorSearchQueryChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearch();
                }}
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor={`${title.replace(/\s+/g, "-").toLowerCase()}-scope`}>Scope</Label>
              <Select value={factorScopeFilter} onValueChange={onFactorScopeFilterChange}>
                <SelectTrigger id={`${title.replace(/\s+/g, "-").toLowerCase()}-scope`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Scopes</SelectItem>
                  <SelectItem value="Scope 1">Scope 1</SelectItem>
                  <SelectItem value="Scope 2">Scope 2</SelectItem>
                  <SelectItem value="Scope 3">Scope 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor={`${title.replace(/\s+/g, "-").toLowerCase()}-category`}>Category</Label>
              <Select value={factorCategoryFilter} onValueChange={onFactorCategoryFilterChange}>
                <SelectTrigger id={`${title.replace(/\s+/g, "-").toLowerCase()}-category`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  {factorCategoryOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end md:justify-self-end">
              <Button onClick={onSearch} disabled={factorsLoading} className="w-full md:w-auto">
                {factorsLoading ? "Searching..." : "Search"}
              </Button>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Methodology defaults loaded for <span className="font-medium text-foreground">{methodologyCountry}</span>.
          </div>
          <div className="text-sm text-muted-foreground">
            Showing {templateFactors.length} of {factorsTotal} factors
          </div>
        </div>

        <div className={`border rounded-md ${listMaxHeightClassName} overflow-y-auto min-w-0`}>
          {templateFactors.length === 0 && !factorsLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">{emptyMessage}</div>
          ) : (
            <div className="divide-y">
              {templateFactors.map((factor, index) => {
                const selected = isFactorSelected ? Boolean(isFactorSelected(factor)) : false;
                const uniqueKey = `${factor.original_id}_${factor.dataset_id}_${factor.factor_db_id}_${index}`;
                const action = getActionProps(factor);

                return (
                  <div
                    key={uniqueKey}
                    className={`p-3 transition-colors ${selected ? "bg-primary/5" : "hover:bg-muted/50"}`}
                  >
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs ${
                              factor.scope === "Scope 1"
                                ? "bg-red-100 text-red-800"
                                : factor.scope === "Scope 2"
                                  ? "bg-orange-100 text-orange-800"
                                  : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {factor.scope}
                          </span>
                          {factor.is_custom && (
                            <span className="inline-block px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-800 font-semibold">
                              CUSTOM
                            </span>
                          )}
                          {factor.methodology_default && (
                            <span
                              className="inline-block px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800 font-semibold"
                              title={factor.methodology_default_label || "Matches company methodology default"}
                            >
                              DEFAULT
                            </span>
                          )}
                          <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
                            {getFactorTitle(factor)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground break-words">
                          {getFactorSubtitle(factor) || factor.original_id}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
                          <span className="font-mono">Factor: {factor.factor?.toFixed(5) || "N/A"}</span>
                          <span className="text-muted-foreground">
                            {factor.uom} {"->"} {factor.ghg_unit}
                          </span>
                        </div>
                      </div>
                      <div className="md:justify-self-end">
                        <Button
                          size="sm"
                          onClick={() => onSelectFactor(factor)}
                          disabled={action.disabled || selected}
                          variant={action.variant || (selected ? "outline" : "default")}
                          className="w-full md:w-auto"
                        >
                          {selected ? "Selected" : action.label}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {factorsHasMore && (
                <div className="p-4 text-center">
                  <Button onClick={onLoadMore} disabled={loadingMoreFactors} variant="outline" className="w-full">
                    {loadingMoreFactors ? "Loading..." : `Load More (${Math.max(factorsTotal - templateFactors.length, 0)} remaining)`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
