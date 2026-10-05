import { describe, expect, it, vi } from "vitest";
import { clearSession, persistSession, readStoredSession, SESSION_KEY } from "../auth";

describe("session storage", () => {
  it("returns a valid bearer session", () => {
    const storage = {
      getItem: vi
        .fn()
        .mockReturnValue(JSON.stringify({ token: "abc", expires_at: "2999-01-01T00:00:00Z" })),
      removeItem: vi.fn(),
    } as unknown as Storage;

    expect(readStoredSession(storage)).toEqual({
      token: "abc",
      expires_at: "2999-01-01T00:00:00Z",
    });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("removes expired or malformed sessions", () => {
    const expired = {
      getItem: vi
        .fn()
        .mockReturnValue(JSON.stringify({ token: "abc", expires_at: "2020-01-01T00:00:00Z" })),
      removeItem: vi.fn(),
    } as unknown as Storage;
    expect(readStoredSession(expired)).toBeNull();
    expect(expired.removeItem).toHaveBeenCalledWith(SESSION_KEY);

    const malformed = {
      getItem: vi.fn().mockReturnValue("{"),
      removeItem: vi.fn(),
    } as unknown as Storage;
    expect(readStoredSession(malformed)).toBeNull();
  });

  it("keeps the session in localStorage across tab restarts", () => {
    localStorage.clear();
    sessionStorage.clear();
    persistSession({ token: "kept", expires_at: "2999-01-01T00:00:00Z" });
    expect(localStorage.getItem(SESSION_KEY)).toContain("kept");
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
    expect(readStoredSession()?.token).toBe("kept");
    clearSession();
    expect(readStoredSession()).toBeNull();
  });

  it("still reads a session left in sessionStorage", () => {
    localStorage.clear();
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: "legacy", expires_at: "2999-01-01T00:00:00Z" }),
    );
    expect(readStoredSession()?.token).toBe("legacy");
  });

  it("drops a JWT that is already past exp", () => {
    localStorage.clear();
    sessionStorage.clear();
    const exp = Math.floor(Date.now() / 1000) - 30;
    const token = `x.${btoa(JSON.stringify({ ownerId: "user", exp }))}.x`;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token }));
    expect(readStoredSession()).toBeNull();
  });
});
