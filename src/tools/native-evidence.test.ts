import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));

import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function invoke(f: ReturnType<typeof fixture>, name: string, args: unknown, failed = false) {
  const result = await f.tools[name].handler(args, {});
  expect(result.isError === true, JSON.stringify(result).slice(0, 500)).toBe(failed);
  const sc = result.structuredContent;
  const id = sc.staged ? sc.data_access_id : sc.data?.__staged ? sc.data.data_access_id : undefined;
  const staged = id ? await recover(f, id, "") : undefined;
  const proof = await verifyCitationEnvelope({ citation: sc._meta?.citation, structuredContent: sc, toolArguments: args,
    ...(staged ? { materialized: { value: staged } } : {}) });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(30720);
  return { sc, id, data: sc.staged ? staged.structuredContent.data : sc.data?.__staged ? staged : sc.data };
}

it.each(["", "mcp_"])("verifies every %s alias on success and failure", async prefix => {
  const f = fixture();
  try {
    await invoke(f, `${prefix}bindingdb_search`, { query: "temporal" });
    await invoke(f, `${prefix}bindingdb_execute`, { code: "return {value:'001'};" });
    await invoke(f, `${prefix}bindingdb_execute`, { code: "" }, true);
    await invoke(f, `${prefix}bindingdb_query_data`, { data_access_id: "missing", sql: "SELECT * FROM missing" }, true);
    await invoke(f, `${prefix}bindingdb_get_schema`, { data_access_id: "missing" });
  } finally { f.close(); }
});

it.each([
  { wrapper: "getLindsByPDBsResponse", key: "affinities", id: "monomerid" },
  { wrapper: "getLindsByUniprotsResponse", key: "affinities", id: "monomerid" },
  { wrapper: "getLindsByUniprotResponse", key: "bdb.affinities", id: "bdb.monomerid" },
])("recovers all native affinity fields and context for $wrapper", async ({ wrapper, key, id }) => {
  const f = fixture();
  const rows = [{ [id]: "001", affinity: " >10000", note: "α😀".repeat(7000), nested: { zero: 0, missing: null }, sources: ["a|b", null] }];
  const context = { "bdb.hit": "1", alternatives: ["001", "002"] };
  const native = { [wrapper]: { ...context, [key]: rows } };
  vi.stubGlobal("fetch", async () => Response.json(native));
  try {
    const result = await invoke(f, "bindingdb_execute", { code: 'return await api.get("/rest/getLigandsByUniprots");' });
    expect(result.sc._meta.completeness.complete).toBe(false);
    expect(result.data).toEqual(native);
    const schema = await invoke(f, "mcp_bindingdb_get_schema", { data_access_id: result.id });
    expect(schema.data.schema.tables).toHaveProperty("affinities");
    expect(schema.data.schema.tables).toHaveProperty("response_context");
    const projection = await invoke(f, "bindingdb_query_data", { data_access_id: result.id, sql: `SELECT "${id}",typeof("${id}") AS kind,affinity FROM affinities` });
    expect(projection.data.rows[0]).toMatchObject({ [id]: "001", kind: "text", affinity: " >10000" });
    const page = await invoke(f, "mcp_bindingdb_query_data", { data_access_id: result.id, sql: "SELECT native_json FROM affinities" });
    expect(page.data.rows.map((row: { native_json: string }) => JSON.parse(row.native_json))).toEqual(rows);
    const ctx = await invoke(f, "bindingdb_query_data", { data_access_id: result.id, sql: "SELECT native_json FROM response_context" });
    expect(JSON.parse(ctx.data.rows[0].native_json)).toEqual({ [wrapper]: context });
  } finally { f.close(); }
});

it("recovers the complete composed envelope above 30KiB", async () => {
  const f = fixture();
  try {
    const result = await invoke(f, "bindingdb_execute", { code: 'return {notes:"α😀".repeat(12000),values:[null,0,"0001"]};' });
    expect(result.sc.staged).toBe(true);
    expect(result.data).toEqual({ notes: "α😀".repeat(12000), values: [null, 0, "0001"] });
  } finally { f.close(); }
});

it("retains a complete large native error response through API proxy staging", async () => {
  const f = fixture();
  const response = `<html>${"unavailable α".repeat(7000)}</html>`;
  vi.stubGlobal("fetch", async () => new Response(response, { status: 404, headers: { "content-type": "text/html" } }));
  try {
    const result = await invoke(f, "mcp_bindingdb_execute", { code: 'return await api.get("/rest/getLigandsByUniprots");' }, true);
    expect(result.data).toMatchObject({ __api_error: true, status: 404 });
    const evidence = result.data.data.__staged ? await recover(f, result.data.data.data_access_id, "") : result.data.data;
    expect(evidence).toMatchObject({ response, upstream_status: 404, content_type: "text/html" });
  } finally { f.close(); }
});
