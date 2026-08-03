"use client";

import { useEffect, useMemo, useState } from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import { apiFetch } from "@/lib/auth";
import { formatEmissions } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyStatePanel, ErrorPanel, SkeletonLoader } from "@/components/shared/DataStates";

type SiteGeo = {
  site_name: string;
  latitude: number | null;
  longitude: number | null;
  geocode_precision: string | null;
};

type BySiteRow = { year: number; total: number; [site: string]: number };

type MappedSite = SiteGeo & { emissions: number; latitude: number; longitude: number };

const MIN_RADIUS = 6;
const MAX_RADIUS = 24;

/**
 * Bubbles sites geocoded to address/postcode/city precision, sized by latest-year
 * emissions from the same by_site data the Facility Leaderboard uses.
 * Sites with no coordinates yet, or resolved only to country level (too
 * coarse to plot meaningfully next to real addresses), are listed
 * separately rather than shown as a misleading pin -- see
 * CLIENT_PORTAL_PHASE_1_5_GEOSPATIAL_MAP_SCOPE.md.
 */
export default function PortalGeoMap() {
  const [sites, setSites] = useState<SiteGeo[] | null>(null);
  const [bySite, setBySite] = useState<BySiteRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      apiFetch("/portal/sites-geo").then((r) =>
        r.ok ? (r.json() as Promise<{ sites: SiteGeo[] }>) : Promise.reject(new Error(`${r.status}`))
      ),
      apiFetch("/portal/reporting-data").then((r) =>
        r.ok ? (r.json() as Promise<{ by_site?: BySiteRow[] }>) : Promise.reject(new Error(`${r.status}`))
      ),
    ])
      .then(([sitesRes, reportingRes]) => {
        setSites(sitesRes.sites ?? []);
        setBySite(reportingRes.by_site ?? []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const { mapped, unmapped } = useMemo(() => {
    if (!sites || !bySite) return { mapped: [] as MappedSite[], unmapped: [] as SiteGeo[] };
    const latest = bySite[bySite.length - 1];
    const mapped: MappedSite[] = [];
    const unmapped: SiteGeo[] = [];
    for (const site of sites) {
      const hasCoords = site.latitude != null && site.longitude != null;
      const preciseEnough = ["address", "postcode", "city"].includes(site.geocode_precision ?? "");
      if (hasCoords && preciseEnough) {
        const emissions = latest ? Number(latest[site.site_name] ?? 0) : 0;
        mapped.push({ ...site, latitude: site.latitude as number, longitude: site.longitude as number, emissions });
      } else {
        unmapped.push(site);
      }
    }
    return { mapped, unmapped };
  }, [sites, bySite]);

  const maxEmissions = Math.max(1, ...mapped.map((s) => s.emissions));

  const bounds: LatLngBoundsExpression | null =
    mapped.length > 0 ? mapped.map((s) => [s.latitude, s.longitude] as [number, number]) : null;

  const body = (() => {
    if (loading) return <SkeletonLoader rows={4} />;
    if (error) return <ErrorPanel description={`Failed to load site locations: ${error}`} />;
    if (!sites || sites.length === 0) {
      return (
        <EmptyStatePanel
          title="No sites recorded yet"
          description="Facility locations will appear here once sites have been added for this client."
        />
      );
    }
    if (mapped.length === 0) {
      return (
        <EmptyStatePanel
          title="No sites mapped yet"
          description="Contact your NZI consultant to add precise coordinates for your sites."
        />
      );
    }

    return (
      <div className="space-y-3">
        <div className="h-80 w-full overflow-hidden rounded-lg border border-border">
          <MapContainer
            bounds={bounds ?? undefined}
            boundsOptions={{ padding: [24, 24] }}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {mapped.map((site) => {
              const ratio = site.emissions / maxEmissions;
              const radius = MIN_RADIUS + ratio * (MAX_RADIUS - MIN_RADIUS);
              return (
                <CircleMarker
                  key={site.site_name}
                  center={[site.latitude, site.longitude]}
                  radius={radius}
                  pathOptions={{ color: "#0f766e", fillColor: "#0f766e", fillOpacity: 0.45, weight: 2 }}
                >
                  <Tooltip>
                    <span className="font-medium">{site.site_name}</span>
                    <br />
                    {formatEmissions(site.emissions)} tCO2e
                  </Tooltip>
                </CircleMarker>
              );
            })}
          </MapContainer>
        </div>

        {unmapped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {unmapped.length} site{unmapped.length !== 1 ? "s" : ""} not shown (no precise location yet):{" "}
            {unmapped.map((s) => s.site_name).join(", ")}
          </p>
        )}
      </div>
    );
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Facility Locations</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
