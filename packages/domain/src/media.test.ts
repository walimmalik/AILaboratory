import { describe, expect, it } from 'vitest';
import { mediaTypeOf } from './media.ts';

describe('mediaTypeOf', () => {
  it('reads the extension of the file name, whatever its case or folder', () => {
    expect(mediaTypeOf('DY206 ELISA.PDF')).toBe('application/pdf');
    expect(mediaTypeOf('protocols/elisa.v2/run.py')).toBe('text/x-python');
    expect(mediaTypeOf('C:\\sop-library\\notes.md')).toBe('text/markdown');
  });

  it('calls a name without a known extension binary', () => {
    expect(mediaTypeOf('README')).toBe('application/octet-stream');
    expect(mediaTypeOf('.env')).toBe('application/octet-stream');
    expect(mediaTypeOf('plate.xyz')).toBe('application/octet-stream');
  });
});
