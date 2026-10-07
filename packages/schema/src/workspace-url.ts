import { WorkspaceSelection } from './workspace.ts';

/** Encode the same validated selection used by the operation and PageContext. */
export function workspaceHref(selection: WorkspaceSelection): string {
  const { experiment, version, view } = WorkspaceSelection.parse(selection);
  const params = new URLSearchParams({ workspace: view.panel, workspaceVersion: String(version) });
  const page = (prefix: string, value: { offset: number; limit: number } | undefined) => {
    if (!value) return;
    params.set(`${prefix}Offset`, String(value.offset));
    params.set(`${prefix}Limit`, String(value.limit));
  };
  page('workspace', view.page);
  if (view.detail) {
    params.set('workspaceDetail', view.detail.id);
    params.set('workspaceDetailVersion', String(view.detail.version));
  }
  if (view.panel === 'plates' && view.map) {
    params.set('workspaceMap', view.map.id);
    params.set('workspaceMapVersion', String(view.map.version));
    params.set('workspacePlate', String(view.map.plate));
    if (view.map.wells) params.set('workspaceWells', view.map.wells.join(','));
    page('workspaceRelated', view.map.relatedPage);
  }
  if (view.panel === 'transfers' && view.plan) {
    params.set('workspacePlan', view.plan.id);
    params.set('workspacePlanVersion', String(view.plan.version));
    if (view.plan.group) params.set('workspaceGroup', view.plan.group);
    page('workspaceGroups', view.plan.groupsPage);
    page('workspaceRows', view.plan.rowsPage);
    page('workspaceRelated', view.plan.relatedPage);
  }
  return `/records/${experiment}?${params.toString()}`;
}

/**
 * undefined means no workspace state. Malformed state throws a readable Error (including ZodError).
 * Other query keys are untouched. Parsing validates structure only; the operation checks scope/version.
 */
export function parseWorkspaceSelection(
  experiment: string,
  params: URLSearchParams,
): WorkspaceSelection | undefined {
  const remaining = new Set<string>();
  for (const key of params.keys()) {
    if (!key.startsWith('workspace')) continue;
    if (remaining.has(key)) throw new Error(`Duplicate workspace query key: ${key}`);
    remaining.add(key);
  }
  if (remaining.size === 0) return undefined;
  const take = (key: string): string | undefined => {
    remaining.delete(key);
    return params.get(key) ?? undefined;
  };
  const integer = (key: string): number => {
    const text = take(key);
    if (text === undefined || !/^(0|[1-9]\d*)$/.test(text)) {
      throw new Error(`${key} must be a canonical nonnegative integer`);
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value)) throw new Error(`${key} must be a safe integer`);
    return value;
  };
  const page = (prefix: string) => {
    const offsetKey = `${prefix}Offset`;
    const limitKey = `${prefix}Limit`;
    if (!params.has(offsetKey) && !params.has(limitKey)) return undefined;
    return { offset: integer(offsetKey), limit: integer(limitKey) };
  };
  const pin = (prefix: string) => {
    const versionKey = `${prefix}Version`;
    if (!params.has(prefix) && !params.has(versionKey)) return undefined;
    const id = take(prefix);
    if (id === undefined) throw new Error(`${prefix} is required with ${versionKey}`);
    return { id, version: integer(versionKey) };
  };
  const panel = take('workspace');
  const version = integer('workspaceVersion');
  const mainPage = page('workspace');
  const detail = pin('workspaceDetail');
  const view: Record<string, unknown> = {
    panel,
    ...(mainPage ? { page: mainPage } : {}),
    ...(detail ? { detail } : {}),
  };
  if (panel === 'plates') {
    const map = pin('workspaceMap');
    if (map) {
      const plate = integer('workspacePlate');
      const wells = take('workspaceWells');
      const relatedPage = page('workspaceRelated');
      view.map = {
        ...map,
        plate,
        ...(wells !== undefined ? { wells: wells.split(',') } : {}),
        ...(relatedPage ? { relatedPage } : {}),
      };
    }
  }
  if (panel === 'transfers') {
    const plan = pin('workspacePlan');
    if (plan) {
      const group = take('workspaceGroup');
      const groupsPage = page('workspaceGroups');
      const rowsPage = page('workspaceRows');
      const relatedPage = page('workspaceRelated');
      view.plan = {
        ...plan,
        ...(group !== undefined ? { group } : {}),
        ...(groupsPage ? { groupsPage } : {}),
        ...(rowsPage ? { rowsPage } : {}),
        ...(relatedPage ? { relatedPage } : {}),
      };
    }
  }
  if (remaining.size) {
    throw new Error(
      `Unsupported or out-of-context workspace query keys: ${[...remaining].join(', ')}`,
    );
  }
  return WorkspaceSelection.parse({ experiment, version, view });
}
