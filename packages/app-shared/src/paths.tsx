import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

/**
 * The shared screens are consumed under two different mounts: `/` on the
 * platform web app and `/network` inside the local hauddy app. All internal
 * links go through this context so the screens stay mount-agnostic —
 * chrome-less content components with no router-flavor assumptions.
 */

export interface PlatformPaths {
  home: string;
  nicknames: string;
  contacts: string;
  account: string;
}

export function makePlatformPaths(base = ''): PlatformPaths {
  const b = base.replace(/\/+$/, '');
  return {
    home: b || '/',
    nicknames: `${b}/nicknames`,
    contacts: `${b}/contacts`,
    account: `${b}/account`,
  };
}

const PlatformPathsContext = createContext<PlatformPaths>(makePlatformPaths(''));

export function PlatformPathsProvider({ base, children }: { base: string; children: ReactNode }) {
  const value = useMemo(() => makePlatformPaths(base), [base]);
  return <PlatformPathsContext.Provider value={value}>{children}</PlatformPathsContext.Provider>;
}

export function usePlatformPaths(): PlatformPaths {
  return useContext(PlatformPathsContext);
}
