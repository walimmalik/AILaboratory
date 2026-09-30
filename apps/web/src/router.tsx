import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ActivityPage } from './pages/Activity.tsx';
import { EquipmentPage, InstrumentModelsPage, InstrumentsPage } from './pages/Instruments.tsx';
import { LabwarePage, VendorsPage } from './pages/Library.tsx';
import { RecordPage } from './pages/Record.tsx';
import { RecordsPage } from './pages/Records.tsx';
import { ReviewPage } from './pages/ReviewInbox.tsx';
import { Shell } from './pages/Shell.tsx';
import { SignInPage } from './pages/SignIn.tsx';
import { WikiPage } from './pages/Wiki.tsx';
import { meQuery } from './session.ts';

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

const signIn = createRoute({
  getParentRoute: () => root,
  path: '/sign-in',
  component: SignInPage,
});

/** Everything else needs a signed-in person. */
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery);
    if (!me) throw redirect({ to: '/sign-in' });
  },
  component: Shell,
});

const index = createRoute({
  getParentRoute: () => app,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/activity' });
  },
});

const activity = createRoute({
  getParentRoute: () => app,
  path: '/activity',
  component: ActivityPage,
});
const review = createRoute({
  getParentRoute: () => app,
  path: '/review',
  component: ReviewPage,
});
const records = createRoute({
  getParentRoute: () => app,
  path: '/records',
  component: RecordsPage,
});
const labware = createRoute({
  getParentRoute: () => app,
  path: '/labware',
  component: LabwarePage,
});
const instruments = createRoute({
  getParentRoute: () => app,
  path: '/instruments',
  component: InstrumentsPage,
});
const instrumentModels = createRoute({
  getParentRoute: () => app,
  path: '/instrument-models',
  component: InstrumentModelsPage,
});
const equipment = createRoute({
  getParentRoute: () => app,
  path: '/equipment',
  component: EquipmentPage,
});
const vendors = createRoute({
  getParentRoute: () => app,
  path: '/vendors',
  component: VendorsPage,
});
const record = createRoute({
  getParentRoute: () => app,
  path: '/records/$id',
  component: RecordPage,
});

const wiki = createRoute({
  getParentRoute: () => app,
  path: '/wiki',
  component: WikiPage,
});
const wikiPage = createRoute({
  getParentRoute: () => app,
  path: '/wiki/$page',
  component: WikiPage,
});

const routeTree = root.addChildren([
  signIn,
  app.addChildren([
    index,
    activity,
    review,
    labware,
    instruments,
    instrumentModels,
    equipment,
    vendors,
    records,
    record,
    wiki,
    wikiPage,
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
