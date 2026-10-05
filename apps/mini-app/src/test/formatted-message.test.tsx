import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormattedMessage } from "../components/FormattedMessage";

describe("FormattedMessage", () => {
  it("renders task lines as cards with a muted caption", () => {
    render(
      <FormattedMessage>
        {`Доброе утро! Вот ваши задачи на сегодня:

**Составить план обучения продажам** — срок до 11 сентября.
**Поставить кулер на 108** — срок до 11 сентября.

Удачного дня!`}
      </FormattedMessage>,
    );

    expect(screen.getByRole("heading", { name: "Доброе утро! Вот ваши задачи на сегодня" })).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Составить план обучения продажам")).toBeInTheDocument();
    expect(within(list).getAllByText("срок до 11 сентября.")).toHaveLength(2);
    expect(within(list).getByText("Поставить кулер на 108")).toBeInTheDocument();
    expect(screen.getByText("Удачного дня!")).toBeInTheDocument();
  });

  it("renders bold-colon paragraphs as numbered steps", () => {
    render(
      <FormattedMessage>
        {`Чтобы начать, можешь попробовать следующие шаги:

**Определить цель**: что именно ты хочешь достичь в своей осознанности.
**Выбрать метод**: медитация, дневник или прогулки.
**Запланировать время**: выдели конкретный слот.`}
      </FormattedMessage>,
    );

    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getByText("Определить цель")).toBeInTheDocument();
    expect(within(list).getByText(/что именно ты хочешь достичь/)).toBeInTheDocument();
    expect(within(list).getByText("Выбрать метод")).toBeInTheDocument();
    expect(within(list).getByText("Запланировать время")).toBeInTheDocument();
  });

  it("renders numbered task titles and captions", () => {
    render(
      <FormattedMessage>
        {`Сейчас выведу просроченные задачи.

1. **Изучать курсы Вани** — ежедневное, цель: на основе ИИ
2. **Продумать стратегию продукта** — передать Эльдару

Все остальные уже были в списке.`}
      </FormattedMessage>,
    );

    expect(screen.getByText("Сейчас выведу просроченные задачи.")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByText("Изучать курсы Вани")).toBeInTheDocument();
    expect(within(list).getByText("ежедневное, цель: на основе ИИ")).toBeInTheDocument();
    expect(within(list).getByText("Продумать стратегию продукта")).toBeInTheDocument();
    expect(screen.getByText("Все остальные уже были в списке.")).toBeInTheDocument();
  });

  it("renders quotes and italic footnotes", () => {
    render(
      <FormattedMessage>
        {`Коротко по плану.

> Не давить: это твой ход.

_Если захочешь — разберём мотивы._`}
      </FormattedMessage>,
    );

    expect(screen.getByText("Не давить: это твой ход.")).toBeInTheDocument();
    expect(screen.getByText("Если захочешь — разберём мотивы.")).toBeInTheDocument();
  });
});
