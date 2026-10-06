import { z } from 'zod';
import { Sha256 } from './files.ts';
import { ExactSourceReference, SourceParseIdentity } from './library.ts';
import { DecimalString, Quantity } from './quantity.ts';

const Name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
/** Server-derived facts for the one supported source transcription completion, not arbitrary resolution. */
export const DilutionCompletion = z.strictObject({
  type: z.literal('dilution_final_volume'),
  step: z.string().regex(/^[a-z0-9_-]+$/),
  variable: Name,
  factor: z.strictObject({ variable: Name, value: DecimalString }),
  sample: z.strictObject({ variable: Name, expression: z.string().min(1) }),
  diluent: z.strictObject({ variable: Name, expression: z.string().min(1) }),
  value: Quantity.strict(),
  source: ExactSourceReference.extend({ parse: SourceParseIdentity }),
  passage: z.string().min(1),
  quote: z.string().min(1),
  associationDigest: Sha256,
});
export type DilutionCompletion = z.infer<typeof DilutionCompletion>;
