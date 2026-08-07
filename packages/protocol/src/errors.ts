import { z } from "zod";

// Spec §8 error codes (initial set).
export const ERROR_CODES = [
  "E_NOT_LINKED",
  "E_IDENTITY_MISMATCH",
  "E_UNSUPPORTED",
  "E_UNKNOWN_AGENT",
  "E_AUTH_FAILED",
  "E_RATE_LIMITED",
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
