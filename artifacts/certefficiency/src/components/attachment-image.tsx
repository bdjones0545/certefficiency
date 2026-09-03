import React, { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";

interface AttachmentImageProps {
  uploadId: string;
  alt?: string;
  className?: string;
}

/**
 * Fetches a stored upload image using the stored Bearer token and
 * renders it as an <img>. This avoids embedding the JWT in the URL.
 */
export const AttachmentImage: React.FC<AttachmentImageProps> = ({
  uploadId,
  alt = "Attached image",
  className,
}) => {
  const [src, setSrc] = useState<string | null>(null);
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
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
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
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
        <ImageIcon className="w-4 h-4" />
        <span>Image unavailable</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="w-48 h-32 bg-muted animate-pulse rounded-xl flex items-center justify-center">
        <ImageIcon className="w-6 h-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className ?? "max-w-sm max-h-64 rounded-xl border border-border shadow-sm object-contain"}
    />
  );
};
