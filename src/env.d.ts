declare const __APP_VERSION__: string;
/** Android versionCode，由 vite.config.ts 在构建期从 package.json 映射注入。 */
declare const __APP_VERSION_CODE__: number;

declare module '*.svg?raw' {
  const content: string;
  export default content;
}
