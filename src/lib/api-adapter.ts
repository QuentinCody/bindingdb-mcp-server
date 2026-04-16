import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { bindingdbFetch } from "./http";

/**
 * BindingDB returns XML by default; inject response=application/json unless
 * the caller overrides it. BindingDB also frequently returns an empty body
 * on zero-result queries — we return `{}` instead of throwing a JSON parse error.
 */
export function createBindingdbApiFetch(): ApiFetchFn {
    return async (request) => {
        const params: Record<string, unknown> = {
            response: "application/json",
            ...(request.params ?? {}),
        };

        const response = await bindingdbFetch(request.path, params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(
                `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            ) as Error & { status: number; data: unknown };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        const text = await response.text();

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
            // Malformed JSON or non-JSON masquerading as JSON — surface as text.
            return { status: response.status, data: text };
        }
    };
}
