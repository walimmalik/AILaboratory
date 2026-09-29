import { labwareImportOpentrons, type OpentronsDefinition } from '@ailab/schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api.ts';

/** Drafts a labware type from an Opentrons definition file the person picks, then opens it. */
export function ImportOpentrons() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const run = useMutation({
    mutationFn: async (file: File) => {
      let definition: unknown;
      try {
        definition = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not JSON`);
      }
      return api.run(labwareImportOpentrons, {
        definition: definition as OpentronsDefinition,
        reason: `Imported from ${file.name}`,
      });
    },
    onSuccess: async (record) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['records'] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
      ]);
      await navigate({ to: '/records/$id', params: { id: record.id } });
    },
  });
  return (
    <div className="import">
      <label className="btn">
        {run.isPending ? 'Importing…' : 'Import Opentrons JSON'}
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          disabled={run.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) run.mutate(file);
          }}
        />
      </label>
      {run.error && <p className="error-text">{run.error.message}</p>}
    </div>
  );
}
