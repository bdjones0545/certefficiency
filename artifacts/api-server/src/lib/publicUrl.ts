const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function validateOrigin(candidate: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Public URL configuration is invalid");
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Public URL must not contain credentials, a query, or a fragment");
  }
  if (url.pathname !== "/") {
    throw new Error("Public URL must be an origin without a path");
  }
  if (production && url.protocol !== "https:") {
    throw new Error("Public URL must use HTTPS in production");
  }
  if (!production && url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Public URL must use HTTP or HTTPS");
  }
  if (production && LOCAL_HOSTS.has(url.hostname)) {
    throw new Error("Public URL cannot use a loopback host in production");
  }

  return url.origin;
}

/** Resolve a server-configured public origin. Request headers are never trusted. */
export function getPublicBaseUrl(): string {
  const explicit = process.env.CERTEFFICIENCY_PUBLIC_URL?.trim();
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  const candidate = explicit
    ? explicit
    : replitDomain
      ? `https://${replitDomain}`
      : devDomain
        ? `https://${devDomain}`
        : "http://localhost:8080";

  return validateOrigin(candidate, process.env.NODE_ENV === "production");
}

export { validateOrigin };
