// Bindings available to the Worker and the Durable Object (see wrangler.toml).
export interface Env {
  /** The single global HubDO namespace (addressed by idFromName("global")). */
  HUB: DurableObjectNamespace;
  /** R2 bucket holding attachment bytes at files/<file_id>. */
  FILES: R2Bucket;
  /** R2 bucket holding app release artifacts (e.g. downloads/mac-arm64-latest.dmg). */
  RELEASES: R2Bucket;
  /** Allowed browser origin for CORS (e.g. https://app.hauddy.com). */
  CORS_ORIGIN: string;
  /** Bearer token gating the /admin/invites endpoint (wrangler secret). */
  ADMIN_TOKEN?: string;
  /** "off" disables the signup/login rate limiter (local dev + tests). */
  RATE_LIMIT?: string;
}
