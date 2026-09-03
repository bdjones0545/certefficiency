import React from "react";
import { Link } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { Sidebar } from "@/components/sidebar";
import { NavbarMobile } from "@/components/navbar-mobile";

export default function Settings() {
  const { data: me } = useGetMe();
  const logout = useLogout();

  const handleLogout = () => {
    localStorage.removeItem("certefficiency_token");
    window.location.href = "/auth/login";
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <NavbarMobile />
        <div className="max-w-3xl mx-auto w-full px-4 py-8 lg:py-12">
          <h1 className="text-3xl font-bold tracking-tight mb-8">Settings</h1>
          
          <div className="grid gap-8">
            <Card className="card-squircle">
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Manage your personal information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input defaultValue={me?.name} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input defaultValue={me?.email} disabled />
                </div>
              </CardContent>
            </Card>

            <Card className="card-squircle">
              <CardHeader>
                <CardTitle>Subscription</CardTitle>
                <CardDescription>Manage your billing and plan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 bg-black/5 rounded-xl border border-border/50">
                  <div>
                    <p className="font-semibold">{me?.plan === "pro" ? "Pro Plan" : "Free Plan"}</p>
                    <p className="text-sm text-muted-foreground">Access to all AI features</p>
                  </div>
                  <Button variant="outline">Upgrade</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="card-squircle border-destructive/20">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>Irreversible actions</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-4">
                <Button variant="outline" className="w-full sm:w-auto" onClick={handleLogout}>Log out</Button>
                <Button variant="destructive" className="w-full sm:w-auto">Delete account</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
