"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Admin Center</h1>
          <p className="text-muted-foreground">Team, lookups, and system management</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Team Management */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>👥</span> Team Management
              </CardTitle>
              <CardDescription>Manage NZI team members, roles, and access</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/admin/team">Manage Team</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Lookups */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📋</span> Lookups
              </CardTitle>
              <CardDescription>Job types, statuses, VAT rates, and other reference data</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/admin/lookups">Manage Lookups</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Datasets & Factors */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📚</span> Datasets & Factors
              </CardTitle>
              <CardDescription>Conversion factor datasets and CSV imports</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/admin/datasets">Manage Datasets</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Templates */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>📄</span> Templates
              </CardTitle>
              <CardDescription>Data capture and report templates</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/admin/templates">Manage Templates</Link>
              </Button>
            </CardContent>
          </Card>

          {/* Archived Clients */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>🗄️</span> Archived Clients
              </CardTitle>
              <CardDescription>View and reactivate archived clients</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/admin/archived-clients">View Archives</Link>
              </Button>
            </CardContent>
          </Card>

          {/* System Settings */}
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>⚙️</span> System Settings
              </CardTitle>
              <CardDescription>Application configuration and preferences</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full" variant="outline">
                <Link href="/admin/settings">Settings</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <Button variant="secondary" asChild>
            <Link href="/">← Back to Hub</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
