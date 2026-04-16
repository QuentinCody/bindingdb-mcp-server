import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const BINDINGDB_BASE = "https://bindingdb.org";

export interface BindingdbFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the BindingDB REST API.
 * Pass `response=application/json` in params to get JSON; default is XML.
 */
export async function bindingdbFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: BindingdbFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? BINDINGDB_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503, 504],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 45_000,
        userAgent: "bindingdb-mcp-server/1.0 (bio-mcp)",
    });
}
