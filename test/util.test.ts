import { describe, expect, it } from 'vitest';
import { esc } from '../src/util.js';

describe('esc', () => {
  it('neutralises markup in untrusted strings', () => {
    expect(esc('<img src=x onerror=alert(1)>"\'&')).not.toMatch(/[<>"']/);
  });
});
