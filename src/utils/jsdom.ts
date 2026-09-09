import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export type JsdomModule = typeof import('jsdom');
type JsdomLoader = () => Promise<JsdomModule>;

let jsdomPromise: Promise<JsdomModule> | undefined;

async function importJSDOM(): Promise<JsdomModule> {
  const require = createRequire(import.meta.url);
  const entrypoint = require.resolve('jsdom');
  return (await import(pathToFileURL(entrypoint).href)) as JsdomModule;
}

/**
 * Resolve jsdom to its installed file before importing it. This keeps
 * transitive relative asset loads anchored to a real filesystem URL instead
 * of the host's bundled module URL.
 */
export function loadJSDOM(): Promise<JsdomModule> {
  jsdomPromise ??= importJSDOM();
  return jsdomPromise;
}

/**
 * Probe jsdom without making it a prerequisite for the rest of the plugin.
 * The optional loader is a test seam for the non-fatal failure contract.
 */
export async function probeJSDOM(
  load: JsdomLoader = loadJSDOM,
): Promise<string | null> {
  try {
    const { JSDOM } = await load();
    const dom = new JSDOM('<!DOCTYPE html><html><body>test</body></html>');
    dom.window.close();
    return null;
  } catch (err) {
    return String(err);
  }
}
