import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { bindingdbCatalog } from "../spec/catalog";
import { createBindingdbApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    BINDINGDB_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
    const apiFetch = createBindingdbApiFetch();

    const searchTool = createSearchTool({
        prefix: "bindingdb",
        catalog: bindingdbCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "bindingdb",
        // Verifiable provenance: bindingdb_execute results carry a _meta.citation.
        source: { id: "bindingdb", name: "BindingDB", url: "https://www.bindingdb.org", license: "CC BY 3.0" },
        catalog: bindingdbCatalog,
        apiFetch,
        doNamespace: env.BINDINGDB_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
