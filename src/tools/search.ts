import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bindingdbFetch } from "../lib/http";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface SearchEnv {
    BINDINGDB_DATA_DO?: {
        idFromName(name: string): unknown;
        get(id: unknown): { fetch(req: Request): Promise<Response> };
    };
}

/**
 * Convenience ligand lookup by PDB. For all other patterns (UniProt, SMILES
 * similarity, target-by-compound), use Code Mode bindingdb_execute.
 */
export function registerSearch(server: McpServer, env?: SearchEnv): void {
    server.registerTool(
        "bindingdb_ligands_by_pdb",
        {
            title: "Ligands by PDB",
            description:
                "Find ligands + binding affinities for a PDB structure. Empty-result queries may return an empty body (shown here as {}).",
            inputSchema: {
                pdb: z
                    .string()
                    .min(1)
                    .describe("PDB identifier (e.g. 1Q0L) or comma-separated PDB IDs."),
                cutoff: z
                    .number()
                    .optional()
                    .describe("Affinity cap in nM (e.g. 100). Default: server-side default."),
                identity: z
                    .number()
                    .optional()
                    .describe("Sequence identity cutoff percent (e.g. 92)."),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: SearchEnv })?.env;
            try {
                const params: Record<string, unknown> = {
                    pdb: String(args.pdb),
                    response: "application/json",
                };
                if (args.cutoff !== undefined) params.cutoff = args.cutoff;
                if (args.identity !== undefined) params.identity = args.identity;

                const response = await bindingdbFetch("/rest/getLigandsByPDBs", params);

                if (!response.ok) {
                    const body = await response.text().catch(() => "");
                    throw new Error(
                        `BindingDB API error: HTTP ${response.status}${body ? ` - ${body.slice(0, 300)}` : ""}`,
                    );
                }

                // BindingDB can return empty body on no-results. Handle gracefully.
                const text = await response.text();
                let data: unknown;
                if (!text || text.trim() === "") {
                    data = {};
                } else {
                    try {
                        data = JSON.parse(text);
                    } catch {
                        data = text;
                    }
                }

                const responseSize = JSON.stringify(data).length;
                if (shouldStage(responseSize) && runtimeEnv?.BINDINGDB_DATA_DO) {
                    const staged = await stageToDoAndRespond(
                        data,
                        runtimeEnv.BINDINGDB_DATA_DO as DurableObjectNamespace,
                        "ligands_by_pdb",
                        undefined,
                        undefined,
                        "bindingdb",
                        (extra as { sessionId?: string })?.sessionId,
                    );
                    return createCodeModeResponse(
                        {
                            staged: true,
                            data_access_id: staged.dataAccessId,
                            total_rows: staged.totalRows,
                            _staging: staged._staging,
                            message: `Results staged. Use bindingdb_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                        },
                        { meta: { staged: true, data_access_id: staged.dataAccessId } },
                    );
                }

                return createCodeModeResponse(
                    { data },
                    { meta: { fetched_at: new Date().toISOString() } },
                );
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `bindingdb_ligands_by_pdb failed: ${msg}`);
            }
        },
    );
}
