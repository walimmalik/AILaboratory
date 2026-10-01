import { describe, expect, it } from 'vitest';
import { untouchedSuggestions } from './suggestions.ts';

describe('untouchedSuggestions', () => {
  const wash = { id: 'wash', action: 'wash', text: 'Wash 3 times' };
  const suggested = {
    '/steps/wash': { item: wash, note: 'suggested by the assistant (m): step 4' },
    '/variables/diluent': {
      item: { name: 'diluent', kind: 'default', value: '5' },
      note: 'suggested by the assistant (m): the kit sheet',
    },
  };

  it("keeps an untouched suggestion assumed, with the assistant's reason", () => {
    expect(
      untouchedSuggestions(suggested, {
        steps: [{ id: 'coat', text: 'Coat' }, wash],
        variables: [{ name: 'diluent', kind: 'default', value: '6' }],
      }),
    ).toEqual({
      '/steps/wash': { source: 'assumed', note: 'suggested by the assistant (m): step 4' },
    });
  });

  it('leaves out what the person changed or removed', () => {
    expect(untouchedSuggestions(suggested, { steps: [{ ...wash, text: 'Wash 5 times' }] })).toEqual(
      {},
    );
  });
});
