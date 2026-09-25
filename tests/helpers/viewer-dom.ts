import { pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole, type DOMWindow } from 'jsdom';

export interface ViewerPage {
  readonly dom: JSDOM;
  readonly window: DOMWindow;
  readonly document: Document;
  /** Errors reported by the page while it ran (jsdom errors and console errors). */
  readonly errors: readonly string[];
  close(): void;
}

export interface OpenViewerOptions {
  /** Appended to the `file://` URL, e.g. `#graph=G-002&task=T-0003`. */
  readonly hash?: string;
}

/**
 * Opens a generated `index.html` from disk through the `file://` protocol and
 * executes its inline application script, so viewer behaviour is exercised the
 * same way a browser would run it: no server, no network and no bundler.
 *
 * This is the closest available substitute for a real browser in confined
 * sandboxes where no browser process can start.
 */
export async function openViewer(
  file: string,
  options: OpenViewerOptions = {},
): Promise<ViewerPage> {
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  virtualConsole.on('error', (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(' '));
  });
  const dom = await JSDOM.fromFile(file, {
    url: `${pathToFileURL(file).href}${options.hash ?? ''}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });
  // jsdom implements no SVG geometry; the layout engine only needs the box it
  // computes itself, so expose a zero box instead of leaving getBBox undefined.
  const svg = dom.window.document.getElementById('graph') as unknown as {
    getBBox?: () => { x: number; y: number; width: number; height: number };
    clientWidth: number;
    clientHeight: number;
  } | null;
  if (svg && typeof svg.getBBox !== 'function') {
    svg.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  }
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    errors,
    close: () => dom.window.close(),
  };
}

export function taskNodes(page: ViewerPage): Element[] {
  return [...page.document.querySelectorAll('#graph g.node[data-task]')];
}

export function sourceNodes(page: ViewerPage): Element[] {
  return [...page.document.querySelectorAll('#graph g.node[data-source]')];
}

export function edges(page: ViewerPage, mode?: 'full' | 'partial' | 'derives'): Element[] {
  const selector = mode ? `#graph path.edge[data-mode="${mode}"]` : '#graph path.edge';
  return [...page.document.querySelectorAll(selector)];
}

export function taskNode(page: ViewerPage, taskId: string): Element {
  const node = page.document.querySelector(`#graph g.node[data-task="${taskId}"]`);
  if (!node) throw new Error(`task node ${taskId} is not rendered`);
  return node;
}

export function viewportTransform(page: ViewerPage): string {
  const viewport = page.document.getElementById('viewport');
  if (!viewport) throw new Error('#viewport is not rendered');
  return viewport.getAttribute('transform') ?? '';
}

export function viewportScale(page: ViewerPage): number {
  const match = /scale\(([-\d.]+)\)/.exec(viewportTransform(page));
  if (!match) throw new Error(`no scale in transform: ${viewportTransform(page)}`);
  return Number(match[1]);
}

export function viewportTranslate(page: ViewerPage): { x: number; y: number } {
  const match = /translate\(([-\d.]+),([-\d.]+)\)/.exec(viewportTransform(page));
  if (!match) throw new Error(`no translate in transform: ${viewportTransform(page)}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

export function click(page: ViewerPage, element: Element): void {
  element.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/**
 * Drills into a composite task child graph the way a user does: select the
 * composite node, then use the control in the side panel.
 */
export function openChildGraph(page: ViewerPage, compositeTaskId: string): string {
  click(page, taskNode(page, compositeTaskId));
  const button = page.document.querySelector('#details-body .composite-button');
  if (!button) throw new Error(`task ${compositeTaskId} exposes no child graph control`);
  const graphId = button.getAttribute('data-graph') ?? '';
  click(page, button);
  return graphId;
}

export function typeInto(page: ViewerPage, element: Element, value: string): void {
  (element as HTMLInputElement).value = value;
  element.dispatchEvent(new page.window.Event('input', { bubbles: true }));
}

export function setChecked(page: ViewerPage, element: Element, checked: boolean): void {
  const input = element as HTMLInputElement;
  input.checked = checked;
  input.dispatchEvent(new page.window.Event('change', { bubbles: true }));
}

export function mouseDrag(
  page: ViewerPage,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const target = page.document.getElementById('graph');
  if (!target) throw new Error('#graph is missing');
  target.dispatchEvent(
    new page.window.MouseEvent('mousedown', { bubbles: true, clientX: from.x, clientY: from.y }),
  );
  page.window.dispatchEvent(
    new page.window.MouseEvent('mousemove', { bubbles: true, clientX: to.x, clientY: to.y }),
  );
  page.window.dispatchEvent(new page.window.MouseEvent('mouseup', { bubbles: true }));
}

export function wheel(page: ViewerPage, deltaY: number): void {
  const target = page.document.getElementById('graph');
  if (!target) throw new Error('#graph is missing');
  target.dispatchEvent(
    new page.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }),
  );
}
