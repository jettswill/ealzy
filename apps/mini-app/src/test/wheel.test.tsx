import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";
import { targetRotation, wheelArcs } from "../pages/WheelPage";
import type { WheelSpin } from "../types";

const api = new ApiClient(() => "test-token");
const factory = () => api;

function spinResult(extra: Partial<WheelSpin> = {}): WheelSpin {
  return {
    spin_id: "s1",
    segments: [
      { id: "kofeynya", weight: 2, name: "Coffee shop", emoji: "☕", category: "Coffee" },
      { id: "karting", weight: 1, name: "Karting", emoji: "🏎️", category: "Speed" },
      { id: "banya", weight: 1, name: "Banya", emoji: "🧖", category: "Relax" },
    ],
    winner_index: 0,
    winner: {
      type: {
        id: "kofeynya",
        name: "Coffee shop",
        emoji: "☕",
        description: "A new coffee place",
        activity_level: 1,
        emotion_level: 2,
        price_level: 1,
        duration_hours: 1,
        setting: "indoor",
      },
      category: { name: "Coffee", emoji: "☕" },
      places: [
        {
          id: "p1",
          name: "Native",
          city: "Saint Petersburg",
          address: "Gribanova 7",
          image_url: null,
          yandex_url: null,
          yandex_rating: 4.8,
          yandex_reviews: 120,
        },
      ],
      maps_url: "https://yandex.ru/maps/?text=coffee",
    },
    spins_used: 1,
    spins_left: 2,
    spins_limit: 3,
    ...extra,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={factory}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("wheel geometry", () => {
  it("gives named options a wider slice", () => {
    const arcs = wheelArcs([{ weight: 2 }, { weight: 1 }, { weight: 1 }]);
    expect(arcs[0]).toEqual({ start: 0, end: 180, mid: 90 });
    expect(arcs[2]!.end).toBe(360);
  });

  it("lands the winning slice under the pointer after full turns", () => {
    const next = targetRotation(0, 90);
    expect(next).toBe(5 * 360 + 270);
    expect((next + 90) % 360).toBe(0);
    const again = targetRotation(next, 315);
    expect(again).toBeGreaterThan(next + 360 * 4);
    expect((again + 315) % 360).toBe(0);
  });
});

describe("surprise wheel", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    vi.restoreAllMocks();
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
    });
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
  });

  it("asks what you want, spins, shows places and respins with a reason", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    const spin = vi
      .spyOn(api, "spinWheel")
      .mockResolvedValueOnce(spinResult())
      .mockResolvedValueOnce(spinResult({ spins_used: 2, spins_left: 1, winner_index: 1 }));
    renderAt("/surprise");

    expect(await screen.findByText("3 of 3 spins left today")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Calm" }));
    await userEvent.click(screen.getByRole("radio", { name: "Two of us" }));
    await userEvent.type(screen.getByPlaceholderText(/coffee, a bar/), "coffee");
    await userEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));

    expect(spin).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mood: "calm",
        company: "pair",
        want: "coffee",
        only_new: true,
        feedback: null,
      }),
    );
    const disc = await screen.findByRole("img", { name: /Coffee shop, Karting, Banya/ });
    await screen.findByText("Spinning…");
    fireEvent.transitionEnd(disc);
    expect(await screen.findByRole("heading", { name: /Coffee shop/ })).toBeInTheDocument();
    expect(screen.getByText("Native")).toBeInTheDocument();
    expect(screen.getByText(/★ 4.8/)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/too pricey/), "too pricey");
    await userEvent.click(screen.getByRole("button", { name: "Spin again · 2 left" }));
    expect(spin).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "calm", feedback: "too pricey" }),
    );
  });

  it("stops after three spins a day", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 3,
      spins_left: 0,
      spins_limit: 3,
    });
    renderAt("/surprise");
    expect(await screen.findByText(/three spins a day/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Spin the wheel" })).toBeDisabled(),
    );
  });
});
