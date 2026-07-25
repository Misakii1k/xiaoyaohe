declare const __APP_VERSION__: string;

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_ASR_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
