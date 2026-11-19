import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, requestJson } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("requests JSON from the configured API boundary", async () => {
    const payload = { status: "ok" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson<typeof payload>("/health")).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/health", expect.any(Object));
    const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(requestOptions.headers).get("Accept")).toBe("application/json");
  });

  it("returns a safe API error for unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(requestJson("/health")).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "The API request to /health failed with status 503.",
    });
  });

  it("includes a safe server detail so missing resources are actionable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Job not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await expect(requestJson("/workspaces/default/jobs/old-job")).rejects.toMatchObject({
      status: 404,
      message: "The API request to /workspaces/default/jobs/old-job failed with status 404. Job not found.",
    });
  });

  it("blocks unsafe paths before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson("//other-host/path")).rejects.toBeInstanceOf(ApiError);
    await expect(requestJson("/assets/../private")).rejects.toBeInstanceOf(ApiError);
    await expect(requestJson("/assets/%2e%2e/private")).rejects.toBeInstanceOf(ApiError);
    await expect(requestJson("/assets/a%2fb")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("converts network failures into a safe API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network details")));

    await expect(requestJson("/health")).rejects.toMatchObject({
      name: "ApiError",
      status: null,
      message: "The API could not be reached.",
    });
  });
});
