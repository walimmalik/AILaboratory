import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ActivityPage } from './pages/Activity.tsx';
import { CalculatorsPage } from './pages/Calculators.tsx';
import {
  AssayTemplatesPage,
  TransferPlansPage,
  WorklistFormatsPage,
} from './pages/DesignLists.tsx';
import { DocumentsPage } from './pages/Documents.tsx';
import { CampaignsPage, ExperimentsPage, RunsPage, SetsPage } from './pages/Experiments.tsx';
import {
  EquipmentPage,
  InstrumentModelsPage,
  InstrumentsPage,
  WorkcellsPage,
} from './pages/Instruments.tsx';
import {
  ContainersPage,
  EntitiesPage,
  EntityKindsPage,
  PlacesPage,
  SamplesPage,
} from './pages/Inventory.tsx';
import { LabwarePage, VendorsPage } from './pages/Library.tsx';
import { LibraryHome } from './pages/LibraryHome.tsx';
import { MemoryPage } from './pages/Memory.tsx';
import { NewRecordPage } from './pages/NewRecord.tsx';
import { LayoutsPage, PlateMapsPage } from './pages/PlateMaps.tsx';
import { LiquidClassesPage, LiquidTypesPage, LotsPage, ReagentsPage } from './pages/Reagents.tsx';
import { RecordPage } from './pages/Record.tsx';
import { RecordsPage } from './pages/Records.tsx';
import { ReviewPage } from './pages/ReviewInbox.tsx';
import { ScanPage } from './pages/Scan.tsx';
import { Shell } from './pages/Shell.tsx';
import { SignInPage } from './pages/SignIn.tsx';
import { SopsPage } from './pages/Sops.tsx';
import { StockPage } from './pages/Stock.tsx';
import { TodayPage } from './pages/Today.tsx';
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
  component: TodayPage,
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
const scanPage = createRoute({
  getParentRoute: () => app,
  path: '/scan',
  component: ScanPage,
});
const records = createRoute({
  getParentRoute: () => app,
  path: '/records',
  component: RecordsPage,
});
const library = createRoute({
  getParentRoute: () => app,
  path: '/library',
  component: LibraryHome,
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
const workcells = createRoute({
  getParentRoute: () => app,
  path: '/workcells',
  component: WorkcellsPage,
});
const equipment = createRoute({
  getParentRoute: () => app,
  path: '/equipment',
  component: EquipmentPage,
});
const inventory = createRoute({
  getParentRoute: () => app,
  path: '/inventory',
  component: StockPage,
  // What to find, when another page sends a name here (Scan's "Find it in Stock").
  validateSearch: (search: Record<string, unknown>): { find?: string } =>
    typeof search.find === 'string' ? { find: search.find } : {},
});
const reagents = createRoute({
  getParentRoute: () => app,
  path: '/reagents',
  component: ReagentsPage,
});
const lots = createRoute({
  getParentRoute: () => app,
  path: '/lots',
  component: LotsPage,
});
const liquidClasses = createRoute({
  getParentRoute: () => app,
  path: '/liquid-classes',
  component: LiquidClassesPage,
});
const liquidTypes = createRoute({
  getParentRoute: () => app,
  path: '/liquid-types',
  component: LiquidTypesPage,
});
const vendors = createRoute({
  getParentRoute: () => app,
  path: '/vendors',
  component: VendorsPage,
});
const containers = createRoute({
  getParentRoute: () => app,
  path: '/containers',
  component: ContainersPage,
});
const places = createRoute({
  getParentRoute: () => app,
  path: '/places',
  component: PlacesPage,
});
const samples = createRoute({
  getParentRoute: () => app,
  path: '/samples',
  component: SamplesPage,
});
const entities = createRoute({
  getParentRoute: () => app,
  path: '/entities',
  component: EntitiesPage,
});
const entityKinds = createRoute({
  getParentRoute: () => app,
  path: '/entity-kinds',
  component: EntityKindsPage,
});
const memory = createRoute({
  getParentRoute: () => app,
  path: '/memory',
  component: MemoryPage,
});
const documents = createRoute({
  getParentRoute: () => app,
  path: '/documents',
  component: DocumentsPage,
});
const sops = createRoute({
  getParentRoute: () => app,
  path: '/sops',
  component: SopsPage,
});
const campaigns = createRoute({
  getParentRoute: () => app,
  path: '/campaigns',
  component: CampaignsPage,
});
const experiments = createRoute({
  getParentRoute: () => app,
  path: '/experiments',
  component: ExperimentsPage,
});
const runs = createRoute({
  getParentRoute: () => app,
  path: '/runs',
  component: RunsPage,
});
const sets = createRoute({
  getParentRoute: () => app,
  path: '/sets',
  component: SetsPage,
});
const plateMaps = createRoute({
  getParentRoute: () => app,
  path: '/plate-maps',
  component: PlateMapsPage,
});
const assayTemplates = createRoute({
  getParentRoute: () => app,
  path: '/assay-templates',
  component: AssayTemplatesPage,
});
const transferPlans = createRoute({
  getParentRoute: () => app,
  path: '/transfer-plans',
  component: TransferPlansPage,
});
const worklistFormats = createRoute({
  getParentRoute: () => app,
  path: '/worklist-formats',
  component: WorklistFormatsPage,
});
const layouts = createRoute({
  getParentRoute: () => app,
  path: '/layouts',
  component: LayoutsPage,
});
const record = createRoute({
  getParentRoute: () => app,
  path: '/records/$id',
  component: RecordPage,
  // The tab and exact expanded History entry are shareable and survive reload.
  validateSearch: (search: Record<string, unknown>): { tab?: string; entry?: string } => ({
    ...(typeof search.tab === 'string' ? { tab: search.tab } : {}),
    ...(typeof search.entry === 'string' &&
    /^(v[1-9]\d*|iev_[0-9A-HJKMNP-TV-Z]{26})$/.test(search.entry)
      ? { entry: search.entry }
      : {}),
  }),
});
const newRecord = createRoute({
  getParentRoute: () => app,
  path: '/new/$kind',
  component: NewRecordPage,
});

const calculators = createRoute({
  getParentRoute: () => app,
  path: '/calculators',
  component: CalculatorsPage,
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
    scanPage,
    library,
    labware,
    instruments,
    instrumentModels,
    workcells,
    equipment,
    inventory,
    reagents,
    lots,
    liquidClasses,
    liquidTypes,
    vendors,
    containers,
    places,
    samples,
    entities,
    entityKinds,
    documents,
    memory,
    sops,
    campaigns,
    experiments,
    runs,
    sets,
    plateMaps,
    layouts,
    assayTemplates,
    transferPlans,
    worklistFormats,
    records,
    record,
    newRecord,
    calculators,
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
