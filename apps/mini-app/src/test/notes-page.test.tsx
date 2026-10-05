import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";

const ownerId = "11111111-1111-4111-8111-111111111111";
const token = `x.${btoa(JSON.stringify({ ownerId }))}.x`;
const api = new ApiClient(() => token);
const factory = () => api;

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={factory}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("notes pages", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token }));
    localStorage.removeItem("ealzy.language");
    vi.restoreAllMocks();
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "UTC",
    });
    vi.spyOn(api, "request").mockImplementation(async (path, init) => {
      if (path === "/api/notes") return [] as never;
      if (path.startsWith("/api/notes/") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const id = path.split("/")[3];
        const timestamp = new Date().toISOString();
        return {
          id,
          title: body.title,
          content: body.content,
          plain_text: body.plain_text,
          revision: 1,
          deleted_at: null,
          created_at: timestamp,
          updated_at: timestamp,
        } as never;
      }
      return {} as never;
    });
  });

  it("creates a note locally and opens the rich text editor", async () => {
    renderAt("/notes");
    expect(await screen.findByRole("heading", { name: "Заметки" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Новая заметка" }));
    expect(await screen.findByLabelText("Название заметки")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Название заметки"), "Идея поездки");
    await waitFor(async () => {
      expect((await api.notes(ownerId))[0]).toMatchObject({
        title: "Идея поездки",
      });
    });
  });

  it("previews an AI action and creates nothing before confirmation", async () => {
    const note = await api.createNote(ownerId);
    await api.updateNote(ownerId, {
      ...note,
      title: "Новый продукт",
      plain_text: "Проверить спрос",
    });
    const preview = vi.spyOn(api, "previewNoteAction").mockResolvedValue({
      id: "draft-1",
      note_id: note.id,
      action: "tasks",
      payload: { tasks: [{ title: "Поговорить с пользователями" }] },
    });
    const confirm = vi.spyOn(api, "confirmNoteAction").mockResolvedValue({
      draft: {
        id: "draft-1",
        note_id: note.id,
        action: "tasks",
        payload: { tasks: [{ title: "Поговорить с пользователями" }] },
      },
      entities: [],
    });

    renderAt(`/notes/${note.id}`);
    await userEvent.click(await screen.findByRole("button", { name: "Создать задачи" }));
    expect(await screen.findByDisplayValue("Поговорить с пользователями")).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(note.id, "tasks");
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Подтвердить и создать" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });
});
