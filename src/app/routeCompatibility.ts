export const compatibilityRedirects: Readonly<Record<string, string>> = {
  '/tools': '/today',
};

export function resolveCompatibilityRoute(path: string): string | undefined {
  return compatibilityRedirects[path];
}
