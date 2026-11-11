import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { createBindingdbApiFetch } from "../lib/api-adapter";
import { BINDINGDB_SOURCE, bindingdbResponse } from "../lib/tool-result";
import { bindingdbCatalog } from "../spec/catalog";

interface CodeModeEnv {
    BINDINGDB_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: CodeModeEnv): void {
    const apiFetch = createBindingdbApiFetch();
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof bindingdbResponse>;
        const respond = (input: unknown, extra: unknown) => bindingdbResponse(() => handler(input, extra), env, String(name), extra, input);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond);
        register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "bindingdb",
        catalog: bindingdbCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "bindingdb",
        // Verifiable provenance: bindingdb_execute results carry a _meta.citation.
        source: BINDINGDB_SOURCE,
        catalog: bindingdbCatalog,
        apiFetch,
        preserveApiErrors: true,
        maxInlineBytes: 30 * 1024,
        timeout: 90_000,
        doNamespace: env.BINDINGDB_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
