import { runLazyRoute, type RouteHandler } from '../router';
import { tools, type BackupProvider, type ToolSummary } from '../tools/registry';
import type { AppIconName } from '../ui/icons/iconRegistry';

export interface AppModule {
  id: string;
  title: string;
  routes: Array<{ path: string; handler: RouteHandler }>;
  navItem?: { label: string; icon: AppIconName; href: string; order: number };
  backupProvider?: BackupProvider;
  getSummary?: () => Promise<ToolSummary>;
}

const medicationTool = tools.find((tool) => tool.id === 'meds');

if (!medicationTool) {
  throw new Error('The built-in medication module must be registered.');
}

export const appModules: readonly AppModule[] = [
  {
    id: 'medications',
    title: '用药',
    routes: medicationTool.routes,
    navItem: { label: '药品', icon: 'pill', href: '/meds', order: 2 },
    backupProvider: medicationTool.backupProvider,
    getSummary: medicationTool.getSummary,
  },
  {
    id: 'settings',
    title: '设置',
    routes: [
      {
        path: '/settings',
        handler: (_params, root, context) =>
          runLazyRoute(context.signal, () => import('../pages/Settings'), (page) =>
            page.renderSettingsPage(root, context.signal)),
      },
    ],
    navItem: { label: '设置', icon: 'gear', href: '/settings', order: 5 },
  },
];

export const appModuleRoutes = appModules.flatMap((module) => module.routes);
