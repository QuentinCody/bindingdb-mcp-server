import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { flattenObject, type SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const row = (value: unknown) => ({
    ...(record(value) ? { ...flattenObject(value, 2), ...Object.fromEntries(Object.entries(value).map(([key, item]) =>
        [key, item !== null && typeof item === "object" ? JSON.stringify(item) : item])) } : { value }),
    native_json: JSON.stringify(value),
});
const unwrap = (value: unknown) => record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
    ? value.structuredContent.data : value;

export class BindingdbDataDO extends RestStagingDO {
    protected getTabularData(value: unknown): unknown {
        const data = unwrap(value);
        if (Array.isArray(data)) {
            const sample = data[0];
            const target = record(sample) && !("affinity" in sample || "affinity_type" in sample || "monomerid" in sample || "bdb_monomerid" in sample)
                && ("target_name" in sample || "uniprot_id" in sample || "pdb_id" in sample);
            return { [target ? "targets" : "affinities"]: data.map(row) };
        }
        if (!record(data)) return data;
        if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(row) };
        for (const wrapper of ["getLindsByPDBsResponse", "getLindsByUniprotsResponse", "getLindsByUniprotResponse", "getLigandsByUniprotsResponse"]) {
            const response = data[wrapper];
            if (!record(response)) continue;
            const key = ["affinities", "bdb.affinities"].find(name => Array.isArray(response[name]));
            if (key) return {
                affinities: (response[key] as unknown[]).map(row),
                response_context: [{ native_json: JSON.stringify({ ...data, [wrapper]: Object.fromEntries(Object.entries(response).filter(([name]) => name !== key)) }) }],
            };
        }
        if (Array.isArray(data.files)) return {
            files: data.files.map(row),
            response_context: [{ native_json: JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "files"))) }],
        };
        return { native_observations: [row(data)] };
    }

    protected getSchemaHints(value: unknown): SchemaHints {
        const tables = this.getTabularData(value);
        const columnTypes: Record<string, string> = { native_json: "TEXT" };
        if (record(tables)) for (const values of Object.values(tables)) {
            if (!Array.isArray(values)) continue;
            for (const item of values) if (record(item)) for (const [key, value] of Object.entries(item)) {
                if (typeof value === "string") columnTypes[key] = "TEXT";
            }
        }
        return { columnTypes };
    }
}
