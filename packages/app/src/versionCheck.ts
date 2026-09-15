import { useEffect, useState } from "react";
import {
  createVersionChecker,
  semverLt,
  type VersionResult,
} from "./version-store";
export { semverLt, type VersionResult } from "./version-store";
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? "0.0.0";
const checker = createVersionChecker();
export function fetchVersion(
  endpoint = "https://api.hauddy.com",
  force = false,
): void {
  void checker.check(endpoint, force);
}
export function useVersionResult(): VersionResult | null {
  const [result, setResult] = useState(checker.get);
  useEffect(() => {
    const unsubscribe = checker.subscribe(() => setResult(checker.get()));
    setResult(checker.get());
    const refresh = () => {
      if (!document.hidden) void checker.check(checker.get()?.endpoint);
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return result;
}
export function hasSoftUpdate(): boolean {
  const result = checker.get();
  return !!(result?.latest && semverLt(APP_VERSION, result.latest));
}
export function hasHardUpdate(): boolean {
  const result = checker.get();
  return !!(result?.min && semverLt(APP_VERSION, result.min));
}
