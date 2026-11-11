import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { bindingdbFailure } from "./download-read";
import { downloads, readText } from "./downloads";
import { bindingdbFetch } from "./http";

/**
 * BindingDB returns XML by default; inject response=application/json unless
 * the caller overrides it. BindingDB also frequently returns an empty body
 * on zero-result queries — we return `{}` instead of throwing a JSON parse error.
 */
export function createBindingdbApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.method.toUpperCase() !== "GET" || request.body !== undefined) {
            throw bindingdbFailure("BindingDB supports GET without a body", 405);
        }
        if (request.path.startsWith("/bulk/")) return { status: 200, data: await downloads(request.path, request.params ?? {}) };
        const params: Record<string, unknown> = {
            response: "application/json",
            ...(request.params ?? {}),
        };

        // BindingDB's REST endpoints require the `/rest/` prefix. Users sometimes
        // write `api.get('/getLigandsByPDBs', ...)`; transparently rewrite.
        let path = request.path;
        if (
            path.startsWith("/") &&
            !path.startsWith("/rest/") &&
            !path.startsWith("/axis2") &&
            !path.startsWith("/bind/") &&
            !path.startsWith("/databases/")
        ) {
            path = `/rest${path}`;
        }

        const deadlineAt = Date.now() + 45_000;
        const response = await bindingdbFetch(path, params);

        const contentType = response.headers.get("content-type") || "";
        const text = await readText(response, 2 * 1024 * 1024, deadlineAt);

        // BindingDB returns an empty body for zero-result queries. Don't crash.
        if (!text || text.trim() === "") {
            return { status: response.status, data: {} };
        }

        if (!contentType.includes("json")) {
            return { status: response.status, data: text };
        }

        try {
            return { status: response.status, data: JSON.parse(text) };
        } catch {
            // A JSON content-type with an unparseable body is an upstream failure,
            // not data: surface it as an error instead of a successful text payload.
            throw bindingdbFailure("BindingDB returned invalid JSON", 502, {
                response: text.slice(0, 2_000),
                upstream_status: response.status,
                content_type: contentType,
            });
        }
    };
}
