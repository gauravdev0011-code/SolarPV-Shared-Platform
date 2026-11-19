const DEFAULT_API_BASE_URL = "/api/v1";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiBaseUrl(): string {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  const baseUrl = configuredBaseUrl || DEFAULT_API_BASE_URL;

  return baseUrl.replace(/\/+$/, "");
}

function validateApiPath(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiError("API paths must be relative to the configured API base.");
  }

  const pathname = path.split(/[?#]/, 1)[0] ?? "";

  for (const segment of pathname.split("/")) {
    let decodedSegment: string;

    try {
      decodedSegment = decodeURIComponent(segment);
    } catch {
      throw new ApiError("API paths must use valid URL encoding.");
    }

    if (
      decodedSegment === "." ||
      decodedSegment === ".." ||
      decodedSegment.includes("/") ||
      decodedSegment.includes("\\")
    ) {
      throw new ApiError("API paths cannot contain directory traversal segments.");
    }
  }
}

export function apiDownloadUrl(path: string): string {
  validateApiPath(path);
  return `${getApiBaseUrl()}${path}`;
}

export async function requestJson<ResponseBody>(
  path: string,
  init?: RequestInit,
): Promise<ResponseBody> {
  validateApiPath(path);

  let response: Response;

  try {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");

    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
    });
  } catch {
    if (init?.signal?.aborted) throw new DOMException("Request was cancelled.", "AbortError");
    throw new ApiError("The API could not be reached.");
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.clone().json() as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail.trim();
    } catch {
      // Some proxies and non-JSON error responses have no readable detail.
    }
    const suffix = detail ? ` ${detail}` : "";
    throw new ApiError(`The API request to ${path} failed with status ${response.status}.${suffix}`, response.status);
  }

  if (response.status === 204) {
    return undefined as ResponseBody;
  }

  try {
    return (await response.json()) as ResponseBody;
  } catch {
    throw new ApiError("The API returned an invalid JSON response.", response.status);
  }
}

export async function requestBlob(path: string): Promise<Blob> {
  validateApiPath(path);
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, { headers: { Accept: "application/x-ndjson" } });
  } catch {
    throw new ApiError("The API could not be reached.");
  }
  if (!response.ok) throw new ApiError(`SOLARIS could not prepare the validation detail download (HTTP ${response.status}).`, response.status);
  return response.blob();
}
