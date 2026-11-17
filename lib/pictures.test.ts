import { describe, expect, it } from 'vitest';
import { geminiPicture } from './pictures';

describe('geminiPicture', () => {
  it('finds the image in a model_output step', () => {
    const body = { steps: [{ type: 'thought', content: [{ type: 'text', text: 'hm' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'Here' }, { type: 'image', data: 'AAAA' }] }] };
    expect(geminiPicture(body)).toBe('AAAA');
  });
  it('accepts the output_image shortcut', () => expect(geminiPicture({ output_image: { data: 'BBBB' } })).toBe('BBBB'));
  it('returns null for text only, errors and junk', () => {
    expect(geminiPicture({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot draw that' }] }] })).toBeNull();
    expect(geminiPicture({ error: { message: 'Rate limit exceeded' } })).toBeNull();
    expect(geminiPicture(null)).toBeNull();
    expect(geminiPicture('nope')).toBeNull();
  });
});
