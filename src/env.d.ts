declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SYNC_V2_ENABLED?: string;
  readonly VITE_SYNC_V2_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
