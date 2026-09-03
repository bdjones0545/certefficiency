import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useListConversations, useCreateConversation, useGetMe, useDeleteConversation } from "@workspace/api-client-react";
import { PlusCircle, MoreHorizontal, FileText, Settings, BookOpen, Clock, Brain, Trophy, LogOut, Loader2, AlertCircle, Trash2 } from "lucide-react";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";
import { getInitials, cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const DEV = import.meta.env.DEV;

export const Sidebar = ({ className, currentConversationId }: { className?: string, currentConversationId?: string }) => {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const activeId = new URLSearchParams(search).get("c") ?? undefined;
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const { data: conversations } = useListConversations({ query: { queryKey: ["conversations"] }});
  const createConv = useCreateConversation();
  const deleteConv = useDeleteConversation();
  const [newChatError, setNewChatError] = React.useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const handleLogout = () => {
    localStorage.removeItem("certefficiency_token");
    window.location.href = "/auth/login";
  };

  const handleNewChat = async () => {
    setNewChatError(null);
    devLog("new_chat_clicked");

    try {
      devLog("create_request_started");
      const result = await createConv.mutateAsync({
        data: { title: "New conversation" },
      });

      // Backend canonical shape: { conversation: {...} } — also accepts flat
      const conv = (result as any).conversation ?? result;

      if (!conv?.id) {
        throw new Error("Conversation was created without an ID");
      }

      devLog("frontend_conversation_received", { conversation_id: conv.id });

      // Optimistically insert into the sidebar list so it appears instantly
      queryClient.setQueryData<typeof conversations>(["conversations"], (existing) => {
        if (!existing) return [conv];
        // Don't duplicate if already present
        if (existing.some((c) => c.id === conv.id)) return existing;
        return [conv, ...existing];
      });

      devLog("active_conversation_updated", { conversation_id: conv.id });

      setLocation(`/app?c=${conv.id}`);

      // Invalidate to sync server state (conversations list + the new conv)
      queryClient.invalidateQueries({ queryKey: ["conversations"] });

    } catch (err) {
      const detail = DEV && err instanceof Error ? ` (${err.message})` : "";
      devLog("new_chat_failed", { error: String(err) });
      setNewChatError(`Couldn't start a new conversation. Please try again.${detail}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return;
    setDeleteError(null);
    const idToDelete = pendingDeleteId;
    setPendingDeleteId(null);

    try {
      await deleteConv.mutateAsync({ id: idToDelete });

      // Remove from cache optimistically
      queryClient.setQueryData<typeof conversations>(["conversations"], (existing) =>
        existing ? existing.filter((c) => c.id !== idToDelete) : existing
      );

      // Navigate away if the deleted conv was active
      if (activeId === idToDelete) {
        setLocation("/app");
      }

      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      const detail = DEV && err instanceof Error ? ` (${err.message})` : "";
      setDeleteError(`Couldn't delete conversation.${detail}`);
    }
  };

  const getModeIcon = (mode?: string) => {
    switch(mode) {
      case "mock_exam":   return <FileText className="w-4 h-4 text-muted-foreground" />;
      case "practice":    return <Brain    className="w-4 h-4 text-muted-foreground" />;
      case "review":      return <Clock    className="w-4 h-4 text-muted-foreground" />;
      case "study_plan":  return <Trophy   className="w-4 h-4 text-muted-foreground" />;
      default:            return <BookOpen className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className={cn("w-[280px] h-screen bg-sidebar border-r border-sidebar-border flex flex-col hidden lg:flex shrink-0", className)}>
      <div className="p-4 flex flex-col gap-4">
        <Link href="/">
          <Logo className="text-primary hover:opacity-80 transition-opacity px-2 cursor-pointer" />
        </Link>

        <Button
          variant="outline"
          className="w-full justify-start gap-2 h-12 border-border/60 hover:bg-black/5 rounded-[12px]"
          onClick={handleNewChat}
          disabled={createConv.isPending}
        >
          {createConv.isPending
            ? <Loader2 className="w-5 h-5 text-primary animate-spin" />
            : <PlusCircle className="w-5 h-5 text-primary" />
          }
          <span className="font-medium text-[15px]">
            {createConv.isPending ? "Creating…" : "New Chat"}
          </span>
        </Button>

        {newChatError && (
          <div role="alert" className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{newChatError}</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 hide-scrollbar">
        <div className="px-3 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversations</div>

        {deleteError && (
          <div role="alert" className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg mb-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{deleteError}</span>
          </div>
        )}

        {conversations?.map((conv) => (
          <div
            key={conv.id}
            className={cn(
              "flex items-center rounded-xl transition-colors group",
              activeId === conv.id ? "bg-black/5 font-medium" : "hover:bg-black/5"
            )}
          >
            <button
              type="button"
              onClick={() => setLocation(`/app?c=${conv.id}`)}
              aria-current={activeId === conv.id ? "page" : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left"
            >
              {getModeIcon(conv.mode)}
              <span className="flex-1 truncate text-[15px]">{conv.title || "New Conversation"}</span>
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

      {/* Delete confirmation dialog — single instance, controlled by pendingDeleteId */}
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

      <div className="p-4 border-t border-sidebar-border bg-sidebar mt-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Open account menu" className="flex w-full items-center gap-3 hover:bg-black/5 p-2 rounded-xl cursor-pointer transition-colors text-left">
              <Avatar className="h-10 w-10 border border-black/5">
                <AvatarFallback className="bg-primary/10 text-primary">{getInitials(me?.name || "")}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium truncate leading-tight">{me?.name}</p>
                <p className="text-[13px] text-muted-foreground truncate leading-tight">{me?.plan === "guest" ? "Guest User" : "Pro Plan"}</p>
              </div>
              <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" className="cursor-pointer flex items-center gap-2">
                <Settings className="w-4 h-4" />
                <span>Settings</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive cursor-pointer flex items-center gap-2">
              <LogOut className="w-4 h-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

function devLog(event: string, data?: Record<string, unknown>) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[new-chat] ${event}`, data ?? "");
  }
}
