import { McpServer } from "@bio-mcp/shared/mcp";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { expect, it, vi } from "vitest";
import { createBindingdbApiFetch } from "../lib/api-adapter";
import { bindingdbCatalog } from "../spec/catalog";
import { registerCodeMode } from "./code-mode";
import { registerGetSchema } from "./get-schema";
import { registerQueryData } from "./query-data";

it("registers both aliases and discovers the temporal release workflow", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  for (const name of ["bindingdb_search", "bindingdb_execute", "bindingdb_query_data", "bindingdb_get_schema"]) {
    expect(tools[name]).toBeDefined(); expect(tools[`mcp_${name}`]).toBeDefined();
  }
  const result = await tools.mcp_bindingdb_search.handler({ query: "Discover dated BindingDB measurements for temporal validation", category: "workflows", max_results: 5 }, {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
  expect(JSON.stringify(result)).toContain("/bulk/releases");
  expect(await tools.mcp_bindingdb_query_data.handler({ data_access_id: "bindingdb_fixture", sql: "SELECT 1" }, {})).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: expect.any(Object) });
  expect(bindingdbCatalog.endpointCount).toBe(bindingdbCatalog.endpoints.length);
});

it("stages complete measurement dates, qualifiers and nested source fields above 30KiB", async () => {
  const raw = { getLigandsByUniprotsResponse: { affinities: [{ monomerid: "001", affinity: ">1000", publication_date: "2020", curation_date: "", source_text: "α".repeat(17_000) }] } };
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(raw)));
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      stored.push((await request.json() as { data: unknown }).data);
      return json({ success: true, tables_created: ["affinities"], total_rows: 1, input_rows: 1, table_row_counts: { affinities: 1 } });
    }
    return json({ success: true, schema: { tables: { affinities: { columns: [{ name: "monomerid" }] } } } });
  } }) } as unknown as DurableObjectNamespace;
  try {
    const proxy = createApiProxyTool({ apiFetch: createBindingdbApiFetch(), catalog: bindingdbCatalog, doNamespace: namespace, stagingPrefix: "bindingdb", maxInlineBytes: 30 * 1024 });
    const result = await proxy.handler({ method: "GET", path: "/rest/getLigandsByUniprots", params: { uniprot: "P00533" } }, { sql: () => [] });
    expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String) });
    expect(JSON.parse(stored[0] as string)).toEqual(raw);
    expect(stored[1]).toEqual(raw);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30_000);
  } finally { vi.unstubAllGlobals(); }
});

it.each([
  { __api_error: true, status: 502, message: "release listing unavailable" },
  { __staged: true, data_access_id: "bindingdb_fixture" },
  { __stage_error: true, message: "staging unavailable" },
])("recipe preserves failed or staged handles %#", async handle => {
  const run = new Function("api", `return (async () => { ${bindingdbCatalog.workflows![0].code} })()`);
  expect(await run({ get: vi.fn().mockResolvedValue(handle) })).toEqual(handle);
});
