import React, { useState } from "react";
import { useResetPassword } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(() => {
    const resetToken = new URLSearchParams(window.location.search).get("token") || "";
    if (resetToken) {
      // Keep this credential out of browser history and referrer headers after capture.
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    return resetToken;
  });
  const mutation = useResetPassword();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: { token, password } }, {
      onSuccess: () => {
        toast({
          title: "Password reset",
          description: "Your password has been successfully reset. Please log in.",
        });
        setLocation("/auth/login");
      },
      onError: (err) => {
        toast({
          title: "Reset failed",
          description: err.message || "Invalid or expired token.",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-[420px] flex flex-col items-center">
        <Logo className="text-primary mb-8" />
        
        <Card className="w-full card-squircle">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-2xl font-bold">New Password</CardTitle>
            <CardDescription>Enter your new password below</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input 
                  id="password" 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required 
                  minLength={8}
                />
              </div>
              {!token && (
                <div className="space-y-2">
                  <Label htmlFor="token">Reset Token</Label>
                  <Input 
                    id="token" 
                    type="text" 
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required 
                  />
                </div>
              )}
              <Button type="submit" className="w-full mt-2" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
