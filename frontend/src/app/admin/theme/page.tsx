"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
}

type ThemeSetting = {
  value: string;
  type: string;
  description: string;
};

type ThemeSettings = {
  [key: string]: ThemeSetting;
};

export default function ThemeSettingsPage() {
  const [settings, setSettings] = useState<ThemeSettings>({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [formData, setFormData] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    fetchSettings();
  }, []);

  async function fetchSettings() {
    try {
      setLoading(true);
      const res = await fetch(`${apiBaseUrl()}/theme-settings`);
      if (!res.ok) throw new Error("Failed to fetch theme settings");
      const data = await res.json();
      setSettings(data.settings || {});
      
      // Initialize form data
      const initial: { [key: string]: string } = {};
      Object.entries(data.settings || {}).forEach(([key, setting]) => {
        initial[key] = (setting as ThemeSetting).value;
      });
      setFormData(initial);
    } catch (err) {
      setStatus(`Error: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      setStatus("Saving...");
      const res = await fetch(`${apiBaseUrl()}/theme-settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "Failed to save settings");
      }

      setStatus("Theme settings saved successfully! Refresh pages to see changes.");
      fetchSettings();
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }

  async function handleReset() {
    if (!confirm("Reset all theme settings to defaults?")) {
      return;
    }

    try {
      setStatus("Resetting...");
      const res = await fetch(`${apiBaseUrl()}/theme-settings/reset`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || "Failed to reset settings");
      }

      setStatus("Theme settings reset to defaults! Refresh pages to see changes.");
      fetchSettings();
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: formData.primary_color || '#F26624' }}>
            Theme Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Customize colors and branding across the application
          </p>
        </div>
        <Button variant="secondary" asChild>
          <Link href="/admin">← Back to Admin</Link>
        </Button>
      </div>

      {status && (
        <div className="mb-4 p-3 bg-muted rounded-md text-sm">
          {status}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading theme settings...</div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Color Settings</CardTitle>
              <CardDescription>
                Define the primary colors used throughout the application. Changes will apply after page refresh.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.entries(settings).map(([key, setting]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key} className="flex items-center gap-2">
                    <span className="font-medium">
                      {key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                    </span>
                    <div
                      className="w-8 h-8 rounded border-2 border-gray-300"
                      style={{ backgroundColor: formData[key] }}
                    />
                  </Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      id={key}
                      type="color"
                      value={formData[key] || '#000000'}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                      className="w-24 h-10 cursor-pointer"
                    />
                    <Input
                      type="text"
                      value={formData[key] || ''}
                      onChange={(e) => setFormData({ ...formData, [key]: e.target.value })}
                      placeholder="#F26624"
                      className="flex-1 font-mono"
                    />
                  </div>
                  {setting.description && (
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  )}
                </div>
              ))}

              <div className="flex gap-2 pt-4">
                <Button onClick={handleSave}>Save Changes</Button>
                <Button variant="outline" onClick={handleReset}>
                  Reset to Defaults
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>See how your colors look</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold mb-2" style={{ color: formData.primary_color }}>
                  Sample Heading
                </h2>
                <p className="text-muted-foreground">
                  This is how your primary color will appear in headings and titles.
                </p>
              </div>
              <div className="flex gap-2">
                <Button style={{ backgroundColor: formData.button_color, borderColor: formData.button_color }}>
                  Primary Button
                </Button>
                <Button variant="outline">Secondary Button</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
