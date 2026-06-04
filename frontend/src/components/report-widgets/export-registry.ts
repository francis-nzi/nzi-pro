export type WidgetPngExporter = () => Promise<string> | string;

type RegistryShape = {
  exporters: Record<string, WidgetPngExporter>;
};

function getRegistry(): RegistryShape {
  const globalWindow = window as typeof window & { __nziWidgetPngExporters?: RegistryShape };
  if (!globalWindow.__nziWidgetPngExporters) {
    globalWindow.__nziWidgetPngExporters = { exporters: {} };
  }
  return globalWindow.__nziWidgetPngExporters;
}

export function registerWidgetPngExporter(widgetId: string, exporter: WidgetPngExporter): () => void {
  const registry = getRegistry();
  registry.exporters[widgetId] = exporter;
  return () => {
    const current = getRegistry();
    if (current.exporters[widgetId] === exporter) {
      delete current.exporters[widgetId];
    }
  };
}

export function getWidgetPngExporter(widgetId: string): WidgetPngExporter | null {
  return getRegistry().exporters[widgetId] ?? null;
}
