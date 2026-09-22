import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "./random-uuid";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("randomUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("prefers crypto.randomUUID when the browser exposes it", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });

    expect(randomUuid()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a schema-valid v4 UUID on an insecure origin", () => {
    // Mirrors a page served over plain HTTP: randomUUID is absent while
    // getRandomValues is still available.
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        for (let index = 0; index < bytes.length; index += 1) {
          bytes[index] = index;
        }
        return bytes;
      },
    });

    const id = randomUuid();
    expect(id).toMatch(UUID_V4_PATTERN);
    expect(id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("still returns a v4 UUID when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    expect(randomUuid()).toMatch(UUID_V4_PATTERN);
  });
});
