import { AdminCenterModuleRouteView } from "@/components/admin-center/AdminCenterModuleRouteView";

export default async function AdminCenterModulePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const resolvedParams = await params;
  return <AdminCenterModuleRouteView slug={resolvedParams.slug} />;
}
