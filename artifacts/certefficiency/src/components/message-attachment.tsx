import React, { useEffect, useState } from "react";
import { ImageIcon, FileText } from "lucide-react";

interface MessageAttachmentProps {
  uploadId: string;
  alt?: string;
  className?: string;
}

/** Pulls the original filename out of a Content-Disposition header, if present. */
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  // RFC 5987 form first (filename*=UTF-8''name), then the plain quoted form.
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Renders a stored upload attached to a message.
 *
 * Fetches with the stored Bearer token rather than putting the JWT in the URL,
 * then branches on the served Content-Type: images render inline, everything
 * else (PDF, DOCX, TXT, Markdown) renders as a labelled document chip. Before
 * documents could be uploaded this component only ever saw images; rendering a
 * PDF through an <img> would produce a silently broken image rather than an
 * error, because the fetch succeeds and only the decode fails.
 */
export const MessageAttachment: React.FC<MessageAttachmentProps> = ({
  uploadId,
  alt = "Attachment",
  className,
}) => {
  const [src, setSrc] = useState<string | null>(null);
  const [isImage, setIsImage] = useState<boolean | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const token =
      typeof localStorage !== "undefined"
        ? localStorage.getItem("certefficiency_token")
        : null;

    fetch(`/api/uploads/${uploadId}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const name = filenameFromDisposition(res.headers.get("content-disposition"));
        const blob = await res.blob();
        return { blob, name };
      })
      .then(({ blob, name }) => {
        if (cancelled) return;
        const imageLike = blob.type.startsWith("image/");
        setIsImage(imageLike);
        setFilename(name);
        setSizeBytes(blob.size);
        // Only images need an object URL; a document chip never loads the bytes.
        if (imageLike) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uploadId]);

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1" role="status">
        <ImageIcon className="w-4 h-4" />
        <span>Attachment unavailable</span>
      </div>
    );
  }

  if (isImage === null) {
    return (
      <div className="w-48 h-32 bg-muted animate-pulse rounded-xl flex items-center justify-center" role="status">
        <ImageIcon className="w-6 h-6 text-muted-foreground" />
        <span className="sr-only">Loading attachment</span>
      </div>
    );
  }

  if (!isImage) {
    return (
      <div className="flex items-center gap-2 max-w-[16rem] px-3 py-2 rounded-xl border border-border bg-card shadow-sm">
        <FileText className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 text-left">
          <div className="text-xs font-medium truncate text-card-foreground" title={filename ?? alt}>
            {filename ?? "Attached document"}
          </div>
          {sizeBytes !== null && (
            <div className="text-[11px] text-muted-foreground">{formatBytes(sizeBytes)}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <img
      src={src!}
      alt={filename ?? alt}
      loading="lazy"
      decoding="async"
      className={className ?? "max-w-sm max-h-64 rounded-xl border border-border shadow-sm object-contain"}
    />
  );
};
