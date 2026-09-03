import React, { useEffect, useRef, useCallback } from "react";
import { Sidebar } from "@/components/sidebar";
import { NavbarMobile } from "@/components/navbar-mobile";
import { Composer, PendingImage } from "@/components/composer";
import { AttachmentImage } from "@/components/attachment-image";
import {
  useGetConversation,
  useListMessages,
  useSendMessage,
  useCreateConversation,
  Message,
  useGetSarahJob,
  getGetConversationQueryKey,
  getGetSarahJobQueryKey,
} from "@workspace/api-client-react";
import { isValidSarahJobId, extractSarahJobId } from "@/lib/sarah-job";
import { useLocation, useSearch } from "wouter";
import ReactMarkdown from "react-markdown";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Brain, BookOpen, Clock, FileText, AlertCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const DEV = import.meta.env.DEV;

/** §2 — every significant stage logs a correlationId so the full flow is traceable. */
function devLog(event: string, data?: Record<string, unknown>) {
  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[chat] ${event}`, data ?? "");
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageWithAttachments = Message & { attachmentIds?: string[] | null };

// ---------------------------------------------------------------------------
// Chat bubble
// ---------------------------------------------------------------------------
const ChatBubble = ({ message }: { message: MessageWithAttachments }) => {
  const isUser = message.role === "user";

  if (message.messageType === "system_notice") {
    return (
      <div className="flex justify-center my-6">
        <span className="text-[13px] text-muted-foreground bg-black/5 px-4 py-1.5 rounded-full font-medium">
          {message.content}
        </span>
      </div>
    );
  }

  if (message.messageType === "error") {
    return (
      <div className="flex justify-start my-6">
        <div className="flex gap-4 max-w-[85%] md:max-w-[75%]">
          <Avatar className="w-8 h-8 shrink-0 mt-1 ring-1 ring-border/50">
            <AvatarFallback className="bg-primary text-white text-xs">S</AvatarFallback>
          </Avatar>
          <div className="px-5 py-3.5 bg-destructive/10 border border-destructive/20 shadow-sm card-squircle rounded-tl-[4px] flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-[15px] text-destructive/90">{message.content}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full my-6", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] md:max-w-[75%] gap-4", isUser ? "flex-row-reverse" : "flex-row")}>
        {!isUser && (
          <Avatar className="w-8 h-8 shrink-0 mt-1 ring-1 ring-border/50">
            <AvatarFallback className="bg-primary text-white text-xs">S</AvatarFallback>
          </Avatar>
        )}
        <div className="flex flex-col gap-2">
          {/* Attached images (user messages only) */}
          {isUser && message.attachmentIds?.length ? (
            <div className="flex flex-wrap gap-2 justify-end">
              {message.attachmentIds.map((id) => (
                <AttachmentImage key={id} uploadId={id} />
              ))}
            </div>
          ) : null}

          {/* Text content */}
          {message.content ? (
            <div className={cn(
              "px-5 py-3.5 text-[17px] leading-relaxed",
              isUser
                ? "bg-primary text-white card-squircle rounded-tr-[4px]"
                : "bg-card text-card-foreground border border-border shadow-sm card-squircle rounded-tl-[4px]"
            )}>
              {message.messageType === "text" || !message.messageType ? (
                <div className={cn(
                  "prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:my-0",
                  isUser
                    ? "prose-invert prose-a:text-white prose-a:underline hover:prose-a:text-white/80"
                    : "dark:prose-invert"
                )}>
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <div className={cn(
                  "prose prose-sm max-w-none prose-p:leading-relaxed",
                  isUser ? "prose-invert" : "dark:prose-invert"
                )}>
                  {message.content}
                  <div className="mt-2 text-xs opacity-70 italic">[Interactive {message.messageType} block]</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Typing indicator
// ---------------------------------------------------------------------------
const TypingIndicator = () => (
  <div className="flex justify-start my-6">
    <div className="flex gap-4">
      <Avatar className="w-8 h-8 shrink-0 ring-1 ring-border/50">
        <AvatarFallback className="bg-primary text-white text-xs">S</AvatarFallback>
      </Avatar>
      <div className="px-5 py-4 bg-card border border-border shadow-sm card-squircle rounded-tl-[4px] flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-primary/40 animate-pulse" />
        <span className="w-2 h-2 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: "150ms" }} />
        <span className="w-2 h-2 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------------
export default function Home() {
  const [, setLocation] = useLocation();
  // useSearch() is the Wouter v3 hook for query-string reactivity.
  // window.location.search is NOT reactive — it never re-renders when ?c= changes.
  const search = useSearch();
  const conversationId = new URLSearchParams(search).get("c");
  const queryClient = useQueryClient();

  const { data: conversation, isError: conversationNotFound } = useGetConversation(
    conversationId || "",
    { query: { enabled: !!conversationId, queryKey: getGetConversationQueryKey(conversationId ?? "") } }
  );

  // Graceful recovery: if the URL carries a ?c= that no longer exists (deleted
  // or never owned), clear it so the user sees a clean empty state.
  useEffect(() => {
    if (conversationId && conversationNotFound) {
      setLocation("/app");
    }
  }, [conversationId, conversationNotFound, setLocation]);

  // Poll messages every 3 s when the list is empty — catches Sarah's opening
  // message arriving asynchronously after conversation creation.
  const { data: messages } = useListMessages(
    conversationId || "",
    {
      query: {
        enabled: !!conversationId,
        // Use a stable short key so all invalidations use the same format:
        //   ["messages", conversationId]
        queryKey: ["messages", conversationId ?? "disabled"],
        refetchInterval: (query) => {
          const msgs = query.state.data;
          // Keep polling until Sarah's opening message arrives, then stop
          // (further updates come via job invalidation).
          if (!msgs || msgs.length === 0) return 3000;
          return false;
        },
      },
    }
  );

  const createConv = useCreateConversation();
  const sendMsg = useSendMessage();

  // §11 — activeJobId is scoped per conversation; reset on conversationId change.
  // Invariant: activeJobId is always null or a validated UUID string — never an object.
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [sarahInitPending, setSarahInitPending] = React.useState(false);

  // ── Pending image uploads ─────────────────────────────────────────────────
  const [pendingImages, setPendingImages] = React.useState<PendingImage[]>([]);

  // isValidJobId guards the polling hook.
  // A non-string or non-UUID value must never reach getGetSarahJobUrl() — it
  // would produce /api/sarah/jobs/[object%20Object] in the fetch URL.
  const isValidJobId = isValidSarahJobId(activeJobId);

  const { data: job } = useGetSarahJob(
    activeJobId ?? "",
    {
      query: {
        queryKey: getGetSarahJobQueryKey(activeJobId ?? ""),
        // Only fire when we have a syntactically valid UUID. This prevents
        // objects from coercing to "[object Object]" in the URL template literal.
        enabled: isValidJobId,
        refetchInterval: (query) => {
          const status = query.state.data?.status;
          return status === "completed" || status === "failed" ? false : 2000;
        },
      },
    }
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  // §11 — Reset ALL per-conversation state when navigating to a different conversation.
  // This ensures the disabled state from a job in conversation A does not bleed into B.
  useEffect(() => {
    setActiveJobId(null);
    setSendError(null);
    setSarahInitPending(false);
    setPendingImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, [conversationId]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      setPendingImages((prev) => {
        prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
        return prev;
      });
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeJobId]);

  // §11/§2 — Clear active job on completion or failure; refetch messages in both cases.
  useEffect(() => {
    const status = job?.status;
    if (status === "completed" || status === "failed") {
      devLog(status === "completed" ? "job_completed" : "job_failed", {
        job_id: activeJobId,
        conversation_id: conversationId,
      });
      setActiveJobId(null);
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
        devLog("messages_invalidated", { conversation_id: conversationId });
      }
    }
  }, [job?.status, conversationId, queryClient, activeJobId]);

  // ── Image file selected from picker ──────────────────────────────────────
  const handleImageFile = useCallback(async (file: File) => {
    const localId = crypto.randomUUID();
    const previewUrl = URL.createObjectURL(file);

    devLog("image_upload_clicked", { filename: file.name, mimeType: file.type, sizeBytes: file.size });

    const pending: PendingImage = { localId, file, previewUrl, status: "uploading" };
    setPendingImages((prev) => [...prev, pending]);

    try {
      const token =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("certefficiency_token")
          : null;

      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/uploads/images", {
        method: "POST",
        body: formData,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        let errMsg = `Upload failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) errMsg = body.error;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      const data = await res.json();
      const attachmentId: string | undefined = data?.attachment?.id;
      if (!attachmentId) throw new Error("Server returned an invalid upload response.");

      setPendingImages((prev) =>
        prev.map((img) =>
          img.localId === localId
            ? { ...img, status: "uploaded", attachmentId }
            : img
        )
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Upload failed. Please try again.";
      setPendingImages((prev) =>
        prev.map((img) =>
          img.localId === localId ? { ...img, status: "failed", error: errMsg } : img
        )
      );
    }
  }, []);

  const handleRemoveImage = useCallback((localId: string) => {
    setPendingImages((prev) => {
      const removed = prev.find((img) => img.localId === localId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((img) => img.localId !== localId);
    });
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  // §13 — Returns a Promise. Composer only clears text on resolution.
  // On rejection, the Composer preserves the user's text so they can retry.
  const handleSend = async (content: string, attachmentIds: string[]): Promise<void> => {
    setSendError(null);

    // §2 — generate a correlation ID that will flow through every log stage
    const corrId = crypto.randomUUID();

    devLog("send_clicked", {
      corrId,
      conversation_id: conversationId,
      message_length: content.length,
      attachment_count: attachmentIds.length,
    });

    let targetConvId = conversationId ?? "";

    // ── Create conversation if none is active ────────────────────────────
    if (!targetConvId) {
      setSarahInitPending(true);
      devLog("create_conversation_request_started", { corrId });

      try {
        const raw = await createConv.mutateAsync({
          data: { title: content.substring(0, 50) || "New conversation" },
        });

        // §4 — normalize: backend returns flat Conversation; accept both shapes
        const newConv = (raw as any).conversation ?? raw;
        if (!newConv?.id) {
          throw new Error("Conversation response missing id");
        }

        targetConvId = newConv.id;

        devLog("frontend_conversation_received", { corrId, conversation_id: targetConvId });
        devLog("active_conversation_updated",    { corrId, conversation_id: targetConvId });

        setLocation(`/app?c=${targetConvId}`);

        // Keep sidebar in sync — sidebar uses the ["conversations"] override key
        queryClient.invalidateQueries({ queryKey: ["conversations"] });

      } catch (err) {
        setSarahInitPending(false);
        const detail = DEV && err instanceof Error ? ` (${err.message})` : "";
        devLog("new_chat_failed", { corrId, error: String(err) });
        setSendError(`Couldn't start a new conversation. Please try again.${detail}`);
        throw err; // Let Composer keep the text
      }

      setSarahInitPending(false);
    }

    devLog("message_request_started", { corrId, conversation_id: targetConvId });

    // ── Send the message ─────────────────────────────────────────────────
    try {
      const res = await sendMsg.mutateAsync({
        id: targetConvId,
        data: {
          content,
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        } as any,
      });

      // Extract and validate the job ID from the mutation result.
      // The backend contract is { jobId: string } at the top level.
      // extractSarahJobId() returns null — never an object — for any invalid shape.
      const jobId = extractSarahJobId(res);

      devLog("sarah_job_created", { corrId, conversation_id: targetConvId, job_id: jobId });

      if (jobId !== null) {
        setActiveJobId(jobId);
      } else {
        // jobId is absent or not a valid UUID. Stop the loading state and show a
        // retryable error. This path also protects against [object Object] URLs.
        console.error("[chat] sarah_job_id_invalid", {
          corrId,
          conversation_id: targetConvId,
          rawType: typeof (res as unknown as Record<string, unknown>).jobId,
        });
        setSendError("Sarah couldn't confirm your message was received. Please try again.");
      }

      // Clear uploaded images — send succeeded
      setPendingImages((prev) => {
        prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
        return [];
      });

      // Immediately invalidate messages so the user message appears without waiting for polling
      queryClient.invalidateQueries({ queryKey: ["messages", targetConvId] });
      devLog("messages_invalidated", { corrId, conversation_id: targetConvId, job_id: jobId });

      // Resolution signals Composer to clear text (§13)
    } catch (err) {
      const detail = DEV && err instanceof Error ? ` (${err.message})` : "";
      devLog("send_failed", { corrId, error: String(err) });
      setSendError(`Message couldn't be sent. Please try again.${detail}`);
      throw err; // Composer keeps the text — user can retry (§13)
    }
  };

  // §11 — composer is disabled only while a job for THIS conversation is active
  const composerDisabled = !!activeJobId || sendMsg.isPending;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar currentConversationId={conversationId || undefined} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <NavbarMobile />

        {conversation && (
          <div className="h-14 border-b border-border bg-background/95 backdrop-blur flex items-center px-6 shrink-0 z-10">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {conversation.mode === "mock_exam" ? <FileText className="w-4 h-4" /> :
               conversation.mode === "practice" ? <Brain className="w-4 h-4" /> :
               conversation.mode === "review"   ? <Clock className="w-4 h-4" /> :
               <BookOpen className="w-4 h-4" />}
              <span className="capitalize">{conversation.mode.replace("_", " ")}</span>
            </div>
            <div className="ml-auto text-sm font-medium">{(conversation as any).certificationName || "General"}</div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto hide-scrollbar" ref={scrollRef}>
          <div className="max-w-4xl mx-auto px-4 py-8 pb-32">
            {!messages?.length ? (
              <div className="flex flex-col items-center justify-center h-[50vh] text-center max-w-md mx-auto fade-in">
                <Avatar className="w-16 h-16 mb-6 ring-4 ring-primary/10">
                  <AvatarFallback className="bg-primary text-white text-xl font-medium">S</AvatarFallback>
                </Avatar>
                <h1 className="headline-text mb-3 text-foreground">Hi, I'm Sarah.</h1>

                {conversationId && (sarahInitPending || messages?.length === 0) ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                    <span>Sarah is preparing your session…</span>
                  </div>
                ) : (
                  <p className="body-text text-muted-foreground">
                    I'm your personal certification study partner. Let's build a plan to get you certified. What exam are you preparing for?
                  </p>
                )}
              </div>
            ) : (
              (messages as MessageWithAttachments[]).map((msg) => {
                devLog("assistant_message_rendered", { message_id: msg.id, role: msg.role });
                return <ChatBubble key={msg.id} message={msg} />;
              })
            )}

            {activeJobId && <TypingIndicator />}

            {sendError && (
              <div className="flex justify-center my-4">
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-4 py-2 rounded-full">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {sendError}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background via-background/95 to-transparent pt-6">
          <Composer
            onSend={handleSend}
            onImageFile={handleImageFile}
            pendingImages={pendingImages}
            onRemoveImage={handleRemoveImage}
            disabled={composerDisabled}
          />
        </div>
      </div>
    </div>
  );
}
