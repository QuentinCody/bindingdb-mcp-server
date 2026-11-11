import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
import { McpServer } from "@bio-mcp/shared/mcp";
import { afterEach, expect, it, vi } from "vitest";
import { downloadWorkflows } from "../spec/downloads";
import { registerCodeMode } from "./code-mode";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(missingAssays = false) {
  // Replace the Cloudflare isolate only; run generated helpers and the real adapter.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockImplementation(async (code, functions) => {
    const staged: Array<Record<string, unknown>> = [];
    const run = new Function("codemode", "__stagedResults", "console", `return (${code})();`);
    return { result: await run(functions, staged, { warn() {}, log() {} }), __stagedResults: staged };
  });
  const subsets = missingAssays ? ["All", "rsid_eaids"] : ["All", "rsid_eaids", "Assays"];
  const html = subsets.map(subset => {
    const file = `BindingDB_${subset}_202610_tsv`;
    return `<a href="/rwd/bind/downloads/${file}.zip">zip</a><a href="/rwd/bind/downloads/${file}.md5">md5</a>`;
  }).join("");
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async url => new Response(String(url).endsWith(".md5") ? "a".repeat(32) : html));
  vi.stubGlobal("fetch", fetch);
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<any> }> })._registeredTools;
  return { tools, fetch };
}

it.each(["", "mcp_"])("discovers and executes the assay manifest recipe through %sbindingdb", async prefix => {
  const f = fixture();
  const recipe = downloadWorkflows[1];
  const search = await f.tools[`${prefix}bindingdb_search`].handler({ query: recipe.title, category: "workflows", max_results: 5 }, {});
  expect(search).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
  expect(JSON.stringify(search)).toContain("include_assays");
  const output = await f.tools[`${prefix}bindingdb_execute`].handler({ code: recipe.code }, {});
  expect(output).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, data: {
    files: [
      { filename: "BindingDB_All_202610_tsv.zip" },
      { filename: "BindingDB_rsid_eaids_202610_tsv.zip" },
      { filename: "BindingDB_Assays_202610_tsv.zip" },
    ],
    assay_join: { reaction_mapping_filename: "BindingDB_rsid_eaids_202610_tsv.zip" },
  } } });
  expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(30 * 1024);
  expect(f.fetch.mock.calls.some(([url]) => String(url).endsWith(".zip"))).toBe(false);
});

it.each(["", "mcp_"])("preserves missing-companion errors through %sbindingdb_execute", async prefix => {
  const f = fixture(true);
  const output = await f.tools[`${prefix}bindingdb_execute`].handler({ code: downloadWorkflows[1].code }, {});
  expect(output).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false } });
  expect(JSON.stringify(output)).toContain("No advertised Assays companion");
});

it.each([
  { __api_error: true, status: 502, message: "listing unavailable" },
  { __staged: true, data_access_id: "bindingdb_fixture" },
  { __stage_error: true, message: "staging unavailable" },
])("assay recipe returns failed or staged discovery handles unchanged %#", async handle => {
  const get = vi.fn().mockResolvedValue(handle);
  const run = new Function("api", `return (async () => { ${downloadWorkflows[1].code} })()`);
  expect(await run({ get })).toEqual(handle);
  expect(get).toHaveBeenCalledTimes(1);
});
