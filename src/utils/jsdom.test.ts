import { describe, expect, test } from 'bun:test';
import { loadJSDOM, probeJSDOM } from './jsdom';

describe('jsdom loader', () => {
  test('loads jsdom and constructs a basic document', async () => {
    const { JSDOM } = await loadJSDOM();
    const dom = new JSDOM('<p id="message">hello</p>');

    expect(dom.window.document.querySelector('#message')?.textContent).toBe(
      'hello',
    );
    dom.window.close();
  }, 15_000);

  test('shares the in-flight module load', async () => {
    const [first, second] = await Promise.all([loadJSDOM(), loadJSDOM()]);

    expect(first.JSDOM).toBe(second.JSDOM);
    expect(first.VirtualConsole).toBe(second.VirtualConsole);
  });

  test('reports loader failures without throwing from the probe', async () => {
    const result = await probeJSDOM(async () => {
      throw new Error('jsdom unavailable');
    });

    expect(result).toBe('Error: jsdom unavailable');
  });
});
