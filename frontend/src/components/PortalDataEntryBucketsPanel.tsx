"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function apiBaseUrl(): string {
  return "/api/backend";
}

type Bucket = { bucket_key: string; label: string };
type Mapping = { bucket_id: number; bucket_key: string; match_category: string | null; match_level_1: string | null };

export default function PortalDataEntryBucketsPanel() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [newBucketKey, setNewBucketKey] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl()}/admin/portal-data-entry-buckets`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setBuckets(json.buckets || []);
        setMappings(json.mappings || []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addMapping() {
    if (!newBucketKey || !newCategory.trim()) {
      setStatus("Pick a bucket and enter a category value to match.");
      return;
    }
    const res = await fetch(`${apiBaseUrl()}/admin/portal-data-entry-buckets`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket_key: newBucketKey, match_category: newCategory.trim() }),
    });
    if (res.ok) {
      setNewCategory("");
      setStatus("Mapping added.");
      void load();
    } else {
      const json = await res.json().catch(() => ({}));
      setStatus(json?.detail || "Failed to add mapping.");
    }
  }

  async function removeMapping(bucketId: number) {
    await fetch(`${apiBaseUrl()}/admin/portal-data-entry-buckets/${bucketId}`, {
      method: "DELETE",
      credentials: "include",
    });
    void load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portal Data Entry — Category Buckets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Maps each factor&apos;s category value (as it appears in <code>v_factor_lookup.category</code>) to one of the
          client portal&apos;s Data Entry tabs. Any category not listed here falls back to &quot;Other&quot;. Employee
          Commuting and Purchased Goods and Services are handled by their own separate flows and are never shown here.
        </p>

        {status && <div className="rounded-md bg-muted p-2 text-sm">{status}</div>}

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Select value={newBucketKey} onValueChange={setNewBucketKey}>
              <SelectTrigger>
                <SelectValue placeholder="Bucket" />
              </SelectTrigger>
              <SelectContent>
                {buckets.map((b) => (
                  <SelectItem key={b.bucket_key} value={b.bucket_key}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            className="w-72"
            placeholder="Category value to match (exact)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <Button onClick={() => void addMapping()}>Add Mapping</Button>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-left">Bucket</th>
                  <th className="p-2 text-left">Matched Category</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.bucket_id} className="border-b last:border-0">
                    <td className="p-2">{buckets.find((b) => b.bucket_key === m.bucket_key)?.label || m.bucket_key}</td>
                    <td className="p-2 font-mono text-xs">{m.match_category || m.match_level_1}</td>
                    <td className="p-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => void removeMapping(m.bucket_id)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-3 text-center text-muted-foreground">
                      No mappings yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
