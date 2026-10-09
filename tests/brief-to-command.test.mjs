import { describe, it, expect } from 'vitest';
import { parseBrief, validateBrief, buildCommand } from '../scripts/brief-to-command.mjs';

const kit = { variants: ['default', 'terang', 'tegas'], templates: ['cover', 'point', 'stat', 'quote', 'comparison', 'cta'], icons: ['spark', 'chart'] };
const ok = '---\njudul: Uji\ncolorVariant: terang\ntemplateHint:\n  hook: cover\nicons: [spark]\n---\n## Suasana\nTegas.\n';

describe('brief-to-command', () => {
  it('parses front matter and body', () => {
    const { meta, body } = parseBrief(ok);
    expect(meta).toMatchObject({ judul: 'Uji', colorVariant: 'terang', templateHint: { hook: 'cover' }, icons: ['spark'] });
    expect(body).toContain('Tegas.');
  });
  it('accepts a valid brief and builds one command without image reading', () => {
    const { meta, body } = parseBrief(ok);
    expect(validateBrief(meta, kit).errors).toEqual([]);
    expect(buildCommand(meta, body, 'EDU-9')).toContain('Jangan baca gambar');
  });
  it('reports every problem', () => {
    const { meta } = parseBrief('---\njudul: X\ncolorVariant: neon\ntemplateHint:\n  hook: banner\nicons: [nope]\n---\nx');
    expect(validateBrief(meta, kit).errors).toHaveLength(3);
  });
  it('rejects text without front matter', () => {
    expect(() => parseBrief('tanpa front matter')).toThrow();
  });
});
