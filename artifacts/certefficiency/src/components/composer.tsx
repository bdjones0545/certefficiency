import React, { useRef, useEffect, useState } from "react";
import { Send, Paperclip, FileText, X, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import {
  AttachmentKind,
  FILE_PICKER_ACCEPT,
  MAX_UPLOAD_BYTES,
  UNSUPPORTED_FORMAT_MESSAGE,
  formatBytes,
  isAcceptedFile,
} from "@/lib/attachments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PendingAttachmentStatus = "selected" | "uploading" | "uploaded" | "failed";

export interface PendingAttachment {
  localId: string;
  file: File;
  kind: AttachmentKind;
  /** Blob URL for image previews only — caller must revoke on removal/unmount. */
  previewUrl?: string;
  status: PendingAttachmentStatus;
  attachmentId?: string;  // set once upload succeeds
  error?: string;
}

interface ComposerProps {
  /**
   * Called when the user submits text and/or attachments.
   * Must return a Promise — text is only cleared when it resolves.
   * If the Promise rejects, text is preserved so the user can retry.
   */
  onSend: (text: string, attachmentIds: string[]) => Promise<void>;
  /** Called when the user picks a file (image or document). */
  onFileSelected: (file: File) => void;
  /** Current list of pending attachments managed by the parent. */
  pendingAttachments: PendingAttachment[];
  /** Called when the user removes a pending attachment from the preview strip. */
  onRemoveAttachment: (localId: string) => void;
  /** Disables the whole composer (Sarah is generating a response). */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Composer: React.FC<ComposerProps> = ({
  onSend,
  onFileSelected,
  pendingAttachments,
  onRemoveAttachment,
  disabled = false,
}) => {
  const [text, setText] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [text]);

  const uploadedIds = pendingAttachments
    .filter((p) => p.status === "uploaded" && p.attachmentId)
    .map((p) => p.attachmentId!);

  const isUploading = pendingAttachments.some((p) => p.status === "uploading");
  const hasFailedUpload = pendingAttachments.some((p) => p.status === "failed");

  const canSend =
    !disabled &&
    !isUploading &&
    !hasFailedUpload &&
    !submitting &&
    (text.trim().length > 0 || uploadedIds.length > 0);

  const handleSubmit = async () => {
    if (!canSend) return;
    setSubmitting(true);
    const ids = [...uploadedIds];
    const currentText = text.trim();
    try {
      await onSend(currentText, ids);
      // Only clear on success — if onSend throws, the user keeps their text
      setText("");
    } catch {
      // Parent sets its own error state; we just keep the text so user can retry
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleAttachButtonClick = () => {
    setPickError(null);
    fileInputRef.current?.click();
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";

    if (!file) return;

    if (!isAcceptedFile(file)) {
      setPickError(UNSUPPORTED_FORMAT_MESSAGE);
      return;
    }
    if (file.size === 0) {
      setPickError("The selected file is empty.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPickError(`File is too large (${formatBytes(file.size)}). Max 10 MB.`);
      return;
    }

    setPickError(null);
    onFileSelected(file);
  };

  return (
    <div className="px-4 py-4 w-full max-w-4xl mx-auto glass pb-safe">
      {/* ── Attachment preview strip ─────────────────────────────────── */}
      {pendingAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3" aria-label="Selected attachments">
          {pendingAttachments.map((att) =>
            att.kind === "image" ? (
              <div
                key={att.localId}
                className="relative group w-20 h-20 rounded-xl overflow-hidden border border-border bg-muted shrink-0"
              >
                <img
                  src={att.previewUrl}
                  alt={att.file.name}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
                {att.status === "uploading" && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" aria-hidden="true" />
                    <span className="sr-only">Uploading {att.file.name}</span>
                  </div>
                )}
                {att.status === "failed" && (
                  <div className="absolute inset-0 bg-destructive/70 flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-white" aria-hidden="true" />
                    <span className="sr-only">Upload failed for {att.file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.localId)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
                  aria-label={`Remove ${att.file.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              // Documents have no visual preview — name and size are what the
              // learner needs to confirm they picked the right handbook.
              <div
                key={att.localId}
                className={`relative group flex items-center gap-2 max-w-[15rem] h-20 px-3 rounded-xl border shrink-0 ${
                  att.status === "failed"
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-border bg-muted"
                }`}
              >
                {att.status === "uploading" ? (
                  <Loader2 className="w-5 h-5 shrink-0 text-muted-foreground animate-spin" aria-hidden="true" />
                ) : att.status === "failed" ? (
                  <AlertCircle className="w-5 h-5 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <FileText className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate" title={att.file.name}>
                    {att.file.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {att.status === "uploading"
                      ? "Uploading…"
                      : att.status === "failed"
                        ? "Upload failed"
                        : formatBytes(att.file.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.localId)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
                  aria-label={`Remove ${att.file.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      {/* ── Upload / pick errors ─────────────────────────────────────── */}
      {(pickError || pendingAttachments.some((p) => p.error)) && (
        <div role="alert" className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg mb-3">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{pickError ?? pendingAttachments.find((p) => p.error)?.error}</span>
        </div>
      )}

      {/* ── Composer input row ───────────────────────────────────────── */}
      <div className="relative flex items-end gap-2 bg-card border border-border shadow-sm rounded-[24px] p-2 pr-2 pl-4 transition-shadow focus-within:ring-2 focus-within:ring-primary/20">
        <input
          ref={fileInputRef}
          type="file"
          accept={FILE_PICKER_ACCEPT}
          className="hidden"
          onChange={handleFilePicked}
          aria-label="Select a file to attach"
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Sarah anything..."
          aria-label="Message Sarah"
          disabled={disabled || submitting}
          className="w-full max-h-[120px] bg-transparent resize-none outline-none py-3 text-[17px] leading-relaxed hide-scrollbar disabled:opacity-50"
          rows={1}
        />

        <div className="flex items-center gap-2 mb-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            className="rounded-full text-muted-foreground hover:bg-black/5"
            onClick={handleAttachButtonClick}
            disabled={disabled || isUploading || submitting}
            title="Attach a file — PDF, DOCX, TXT, Markdown or an image"
            aria-label={isUploading ? "Uploading file" : "Attach a file"}
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Paperclip className="w-5 h-5" />
            )}
          </Button>

          <Button
            type="button"
            size="iconSm"
            className={`rounded-full transition-all ${
              canSend
                ? "bg-primary text-white hover:bg-primary/90"
                : "bg-muted text-muted-foreground"
            }`}
            disabled={!canSend}
            onClick={() => void handleSubmit()}
            aria-label={submitting ? "Sending message" : "Send message"}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="text-center mt-3 text-[12px] text-muted-foreground font-medium">
        Sarah can make mistakes. Verify important information.
      </div>
    </div>
  );
};
