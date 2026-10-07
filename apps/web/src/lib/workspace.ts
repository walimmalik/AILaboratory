import {
  experimentsWorkspace,
  parseWorkspaceSelection,
  WorkspaceProjection,
  type WorkspaceSelection,
  type WorkspaceView,
  workspaceHref,
} from '@ailab/schema';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../api.ts';

export { workspaceHref };
export function workspaceContext(
  selection: WorkspaceSelection | undefined,
  shown: { id: string; version: number } | undefined,
  search: Record<string, unknown>,
): WorkspaceSelection | undefined {
  const url = parseWorkspace(search);
  return selection &&
    shown?.id === selection.experiment &&
    shown.version === selection.version &&
    !url.error &&
    (url.view !== undefined || search.tab === undefined) &&
    workspaceHref({ ...selection, view: url.view ?? { panel: 'design' } }) ===
      workspaceHref(selection) &&
    (url.version === undefined || url.version === selection.version)
    ? selection
    : undefined;
}
export function workspaceSearch(selection: WorkspaceSelection): Record<string, string | number> {
  // TanStack JSON-escapes strings that look like numbers. Keep the codec's integer fields
  // numeric at this boundary so the actual URL has workspaceVersion=6, not =%226%22.
  return Object.fromEntries(
    Array.from(new URLSearchParams(workspaceHref(selection).split('?')[1]), ([key, value]) => [
      key,
      /(?:Version|Offset|Limit|Plate)$/.test(key) ? Number(value) : value,
    ]),
  );
}
/** Restore only a supported experiment workspace, through the same typed router boundary. */
export function workspaceReturn(
  href: string | undefined,
): { id: string; search: Record<string, string | number> } | undefined {
  const match = href && /^\/records\/(exp_[0-9A-HJKMNP-TV-Z]{26})\?([^#]+)$/.exec(href);
  if (!match?.[1] || !match[2]) return undefined;
  try {
    const selection = parseWorkspaceSelection(match[1], new URLSearchParams(match[2]));
    return selection ? { id: selection.experiment, search: workspaceSearch(selection) } : undefined;
  } catch {
    return undefined;
  }
}
/** Preserve malformed route state so the screen can explain refusal, rather than drop selectors. */
export function parseWorkspace(
  search: Record<string, unknown>,
  experiment = 'exp_00000000000000000000000000',
): { view?: WorkspaceView; version?: number; error?: string } {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (!key.startsWith('workspace')) continue;
      if (!(typeof value === 'string' || typeof value === 'number'))
        throw new Error('Unsupported workspace selection');
      params.set(key, String(value));
    }
    const selection = parseWorkspaceSelection(experiment, params);
    return selection ? { view: selection.view, version: selection.version } : {};
  } catch (error) {
    return {
      error: `${error instanceof Error ? error.message : 'Invalid workspace selection'}. Open Design to choose a view again.`,
    };
  }
}
export const workspaceQuery = (id: string, view: WorkspaceView, version?: number) =>
  queryOptions({
    queryKey: ['record', id, 'workspace', version, view],
    queryFn: () =>
      api.run(experimentsWorkspace, {
        id,
        view,
        ...(version === undefined ? {} : { expectedVersion: version }),
      }),
  });
/** Never navigate to a model-supplied href. Our schema-validated selection supplies the fixed app URL. */
export function workspaceToolSelection(output: unknown): WorkspaceSelection | undefined {
  const result = WorkspaceProjection.safeParse(output);
  if (
    !result.success ||
    result.data.panel !== result.data.selection.view.panel ||
    result.data.experiment.id !== result.data.selection.experiment ||
    result.data.experiment.version !== result.data.selection.version
  )
    return undefined;
  return result.data.selection;
}
