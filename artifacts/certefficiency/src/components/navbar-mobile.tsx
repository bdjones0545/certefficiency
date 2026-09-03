import React, { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Menu, X, Home, Bot, Video, Settings, LogIn, LogOut, BookOpen, Brain, Clock, FileText, Trophy, Trash2, Loader2, PlusCircle, AlertCircle, MessageSquare } from "lucide-react";
import { Logo } from "./logo";
import { Sheet, SheetContent, SheetTrigger } from "./ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useListConversations, useDeleteConversation, useCreateConversation } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const DEV = import.meta.env.DEV;

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/",            label: "Home",            icon: <Home     className="w-5 h-5" /> },
  { href: "/course",      label: "AI Agent Course", icon: <Bot      className="w-5 h-5" /> },
  { href: "/video-course",label: "Video Course",    icon: <Video    className="w-5 h-5" /> },
  { href: "/settings",    label: "Settings",        icon: <Settings className="w-5 h-5" /> },
];

function getModeIcon(mode?: string | null) {
  switch (mode) {
    case "mock_exam":  return <FileText className="w-4 h-4" />;
    case "practice":   return <Brain    className="w-4 h-4" />;
    case "review":     return <Clock    className="w-4 h-4" />;
    case "study_plan": return <Trophy   className="w-4 h-4" />;
    default:           return <BookOpen className="w-4 h-4" />;
  }
}

export const NavbarMobile = () => {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const activeConvId = new URLSearchParams(search).get("c");
  const isLoggedIn = typeof localStorage !== "undefined" && !!localStorage.getItem("certefficiency_token");

  const { data: conversations } = useListConversations({ query: { queryKey: ["conversations"] } });
  const deleteConv = useDeleteConversation();
  const createConv = useCreateConversation();
  const queryClient = useQueryClient();

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [newChatError, setNewChatError] = useState<string | null>(null);

  const handleLogout = () => {
    localStorage.removeItem("certefficiency_token");
    setOpen(false);
    window.location.href = "/auth/login";
  };

  const handleSelectConv = (id: string) => {
    setLocation(`/app?c=${id}`);
    setOpen(false);
  };

  const handleNewChat = async () => {
    setNewChatError(null);
    try {
      const result = await createConv.mutateAsync({ data: { title: "New conversation" } });
      const conv = (result as any).conversation ?? result;
      if (!conv?.id) throw new Error("Conversation was created without an ID");
      queryClient.setQueryData<typeof conversations>(["conversations"], (existing) => {
        if (!existing) return [conv];
        if (existing.some((c) => c.id === conv.id)) return existing;
        return [conv, ...existing];
      });
      setLocation(`/app?c=${conv.id}`);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setOpen(false);
    } catch (err) {
      const detail = DEV && err instanceof Error ? ` (${err.message})` : "";
      setNewChatError(`Couldn't start a new conversation.${detail}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    setDeleteError(null);
    const idToDelete = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await deleteConv.mutateAsync({ id: idToDelete });
      queryClient.setQueryData<typeof conversations>(["conversations"], (existing) =>
        existing ? existing.filter((c) => c.id !== idToDelete) : existing
      );
      if (activeConvId === idToDelete) {
        setLocation("/app");
      }
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      const detail = DEV && err instanceof Error ? ` (${err.message})` : "";
      setDeleteError(`Couldn't delete conversation.${detail}`);
    }
  };

  return (
    <div className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-border glass sticky top-0 z-50 safe-area-top">
      {/* Logo */}
      <Link href="/" onClick={() => setOpen(false)}>
        <Logo className="text-primary cursor-pointer" />
      </Link>

      {/* Hamburger */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button
            aria-label="Open navigation menu"
            className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/5 transition-colors"
          >
            <Menu className="w-5 h-5 text-foreground" />
          </button>
        </SheetTrigger>

        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 h-14 border-b border-border shrink-0">
            <Link href="/" onClick={() => setOpen(false)}>
              <Logo className="text-primary cursor-pointer" />
            </Link>
            <button
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Nav links */}
          <nav className="px-3 py-3 space-y-1 border-b border-border shrink-0">
            {NAV_ITEMS.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  <div
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors text-[15px] font-medium min-h-[48px]",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-black/5",
                    )}
                  >
                    <span className={isActive ? "text-primary" : "text-muted-foreground"}>
                      {item.icon}
                    </span>
                    {item.label}
                    {item.href === "/course" && (
                      <span className="ml-auto text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        NEW
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Conversations section */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 hide-scrollbar">
            <div className="flex items-center justify-between px-1 pb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversations</span>
              <button
                onClick={handleNewChat}
                disabled={createConv.isPending}
                aria-label="New conversation"
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                {createConv.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <PlusCircle className="w-4 h-4" />
                }
              </button>
            </div>

            {newChatError && (
              <div role="alert" className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{newChatError}</span>
              </div>
            )}

            {deleteError && (
              <div role="alert" className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            {!conversations?.length && (
              <div className="flex items-center gap-3 px-4 py-3 text-[14px] text-muted-foreground">
                <MessageSquare className="w-4 h-4 shrink-0" />
                <span>No conversations yet</span>
              </div>
            )}

            {conversations?.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "flex items-center rounded-xl transition-colors group min-h-[44px]",
                  activeConvId === conv.id ? "bg-primary/10 text-primary" : "hover:bg-black/5"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectConv(conv.id)}
                  aria-current={activeConvId === conv.id ? "page" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
                >
                  <span className={cn("shrink-0", activeConvId === conv.id ? "text-primary" : "text-muted-foreground")}>
                    {getModeIcon(conv.mode)}
                  </span>
                  <span className="flex-1 truncate text-[14px]">{conv.title || "New Conversation"}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete conversation: ${conv.title || "New Conversation"}`}
                  onClick={() => { setPendingDeleteId(conv.id); setDeleteError(null); }}
                  className="mr-2 opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 flex items-center justify-center rounded-md hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-all shrink-0"
                >
                  {deleteConv.isPending && pendingDeleteId === conv.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Trash2 className="w-3.5 h-3.5" />
                  }
                </button>
              </div>
            ))}
          </div>

          {/* Footer: login / logout */}
          <div className="px-3 py-4 border-t border-border shrink-0 safe-area-bottom">
            {isLoggedIn ? (
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[15px] font-medium text-destructive hover:bg-destructive/10 transition-colors min-h-[48px]"
              >
                <LogOut className="w-5 h-5" />
                Log out
              </button>
            ) : (
              <Link href="/auth/login" onClick={() => setOpen(false)}>
                <div className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-[15px] font-medium text-foreground hover:bg-black/5 transition-colors min-h-[48px]">
                  <LogIn className="w-5 h-5 text-muted-foreground" />
                  Sign in
                </div>
              </Link>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog */}
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This conversation and all its messages will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
