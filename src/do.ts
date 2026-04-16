import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class BindingdbDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        // BindingDB often returns { getLindsByPDBsResponse: { affinities: [...] } }
        // or simple arrays of affinity records.
        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                const s = sample as Record<string, unknown>;
                if (
                    "monomerid" in s ||
                    "affinity" in s ||
                    "affinity_type" in s ||
                    "bdb_monomerid" in s
                ) {
                    return {
                        tableName: "affinities",
                        indexes: ["monomerid", "affinity_type", "smile", "target_name"],
                    };
                }
                if ("target_name" in s || "uniprot_id" in s || "pdb_id" in s) {
                    return {
                        tableName: "targets",
                        indexes: ["target_name", "uniprot_id", "pdb_id"],
                    };
                }
            }
        }

        return undefined;
    }
}
