/**
 * DataPilot MCP — UI resource registry (MCP Apps / io.modelcontextprotocol/ui)
 *
 * UI resources are HTML templates declared upfront under the `ui://` scheme and
 * served via the standard `resources/list` and `resources/read` handlers. A tool
 * links to one through `_meta.ui.resourceUri`; the host fetches the template, renders
 * it in a sandboxed iframe, and pushes the tool's `structuredContent` to it.
 */

import { CHART_TEMPLATE_HTML } from './chart-app.js';

export interface UiResourceDef {
  /** `ui://` URI the tool references and the host reads. */
  uri: string;
  /** Human-readable name shown in resources/list. */
  name: string;
  /** Description shown in resources/list. */
  description: string;
  /** Must be exactly `text/html;profile=mcp-app`. */
  mimeType: string;
  /** The static HTML template (no per-call data). */
  html: string;
  /** `_meta` for the resource — host sandbox hints (CSP, border preference). */
  meta?: Record<string, unknown>;
}

export const UI_MIME = 'text/html;profile=mcp-app';

export const UI_RESOURCES: UiResourceDef[] = [
  {
    uri: 'ui://datapilot/chart',
    name: 'datapilot_chart',
    description: 'Interactive chart widget for SQL query results (bar/line/scatter/pie/histogram).',
    mimeType: UI_MIME,
    html: CHART_TEMPLATE_HTML,
    // Host sandbox hints. The widget is fully self-contained — no external network —
    // so all CSP domain allowlists are empty.
    meta: {
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: [],
          frameDomains: [],
          baseUriDomains: [],
        },
        prefersBorder: true,
      },
    },
  },
];

export function getUiResource(uri: string): UiResourceDef | undefined {
  return UI_RESOURCES.find((r) => r.uri === uri);
}
