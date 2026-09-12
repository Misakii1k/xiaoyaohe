export const compatibilityRedirects: Readonly<Record<string, string>> = {
  '/tools': '/today',
  '/scan-sort': '/scan',
  '/inventory': '/meds/inventory',
  '/medications': '/meds',
};

export function resolveCompatibilityRoute(path: string): string | undefined {
  return compatibilityRedirects[path];
}
