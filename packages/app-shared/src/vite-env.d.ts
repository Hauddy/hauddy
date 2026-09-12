// Environment consumed by this shared package; compatible with Vite hosts.
interface ImportMetaEnv {
  readonly VITE_HAUDDY_PLATFORM?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
