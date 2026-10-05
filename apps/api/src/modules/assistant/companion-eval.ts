import { COMPANION_PERSONALITY, COMPANION_TONE_EXAMPLES, COMPANION_WRITE_RULES } from "./companion-prompt.js";

export type EvalCheck = {
  id: string;
  title: string;
  pass: boolean;
  detail?: string;
};

export type CompanionEvalScenario = {
  id: string;
  title: string;
  query: string;
  /** Substrings that must appear in the system prompt or tone examples. */
  promptMustInclude?: string[];
  /** Workspace JSON the model would see. */
  workspace: Record<string, unknown>;
  /** Mock model output for action/tone judges. */
  response: {
    answer: string;
    context_used?: string[];
    task_actions?: {
      op: string;
      title?: string | null;
      task_id?: string | null;
      description?: string | null;
    }[];
    goal_actions?: { op: string; title?: string | null }[];
    self_facts?: unknown[];
    person_facts?: unknown[];
  };
  expect: {
    contextUsedIncludes?: string[];
    answerIncludes?: string[];
    answerExcludes?: string[];
    emptyTaskActions?: boolean;
    taskOps?: string[];
    workspaceHas?: string[];
    overflowMention?: boolean;
    /** Looser stems used instead of context/answer includes when judging live model output. */
    liveMentions?: string[];
    /** Live mode: pass if the answer or context_used includes at least one of these stems. */
    liveMentionAny?: string[];
  };
};

const GENERIC_BANNED = [
  "попробуйте составить список",
  "это поможет справиться со стрессом",
  "отличное упражнение",
  "i can help you be more productive",
  "let's start by listing your priorities",
  "рекомендуется осуществлять",
];

export const COMPANION_EVAL_SCENARIOS: CompanionEvalScenario[] = [
  {
    id: "goal-prioritize",
    title: "Uses the active goal when asked to prioritize",
    query: "Что делать в первую очередь?",
    workspace: {
      goals: [{ id: "g1", title: "Запустить лендинг", current_plan: "Дописать оффер на этой неделе" }],
      tasks: [{ id: "t1", title: "Дописать оффер", goal_id: "g1", due_at: "2026-09-04T12:00:00.000Z" }],
    },
    response: {
      answer: "Смотри цель «Запустить лендинг»: сегодня логичнее дописать оффер — это единственный шаг в текущем плане.",
      context_used: ["Запустить лендинг", "Дописать оффер"],
    },
    expect: { contextUsedIncludes: ["Запустить лендинг"], answerIncludes: ["оффер"] },
  },
  {
    id: "empty-profile-question",
    title: "Empty profile asks one question instead of inventing",
    query: "Что мне делать?",
    workspace: { self: { values: [], memories: [] }, goals: [], tasks: [] },
    response: {
      answer: "Пока почти ничего не знаю о тебе. Что сейчас важнее: закрыть хвосты или выбрать одну цель на неделю?",
      task_actions: [],
    },
    expect: { emptyTaskActions: true, answerExcludes: ["ты всегда"] },
  },
  {
    id: "no-cross-user-leak",
    title: "Does not mention another person's private fact",
    query: "Напомни, что я люблю",
    workspace: { self: { memories: [{ content: "люблю ранние подъёмы" }] } },
    response: {
      answer: "Ты писал, что любишь ранние подъёмы — давай от этого танцевать утренний блок.",
      context_used: ["люблю ранние подъёмы"],
    },
    expect: { answerIncludes: ["ранние"], answerExcludes: ["Маша"] },
  },
  {
    id: "pronoun-person",
    title: "Pronoun advice stays on the focused person",
    query: "Что ему подарить?",
    workspace: {
      focused_people: [{ name: "Дима", memories: [{ content: "любит механические клавиатуры" }] }],
    },
    response: {
      answer: "Дима любит механические клавиатуры — возьми кейкапы или компактный набор, не общий «что-нибудь полезное».",
      context_used: ["Дима"],
    },
    expect: { answerIncludes: ["Дима"], contextUsedIncludes: ["Дима"] },
  },
  {
    id: "overflow-acknowledged",
    title: "Overflow summary is used when the list is truncated",
    query: "У меня завал",
    workspace: {
      overflow: { extra_tasks: 12, extra_overdue: 3, extra_goals: 0, extra_projects: 0, extra_spaces: 0 },
      tasks: [{ title: "Отчёт" }, { title: "Созвон" }],
    },
    response: {
      answer: "В фокусе два дела, плюс ещё 12 открытых и 3 просроченных. Давай снимем просрочку первой.",
      context_used: ["Отчёт"],
    },
    expect: { overflowMention: true, workspaceHas: ["overflow"], liveMentionAny: ["12", "просроч", "ещё"] },
  },
  {
    id: "promise-streak",
    title: "Praises a real promise streak",
    query: "Как я держусь?",
    workspace: {
      promises: [{ title: "Ложиться до 23:30", praise_days: 7, due_for_checkin: false }],
    },
    response: {
      answer: "Семь дней «ложиться до 23:30» — это уже ритуал, не героизм. Как тело отзывается на эту неделю?",
      context_used: ["Ложиться до 23:30"],
    },
    expect: { answerIncludes: ["23:30"] },
  },
  {
    id: "broken-promise-no-shame",
    title: "Broken promise gets warmth, not shame",
    query: "Сорвался с обещанием бегать",
    workspace: { promises: [{ title: "Бегать 3 раза в неделю", last_checkin_status: "broken" }] },
    response: {
      answer: "Срыв не отменяет курс. Что конкретно сломалось: время, тело, или обещание было слишком жёстким?",
      task_actions: [],
    },
    expect: { emptyTaskActions: true, answerExcludes: ["ты ленивый"] },
  },
  {
    id: "capture-task-past-tense",
    title: "Captures an errand in the same turn",
    query: "Добавь купить молоко на завтра",
    workspace: { tasks: [], now: { date: "2026-09-04", end_of_this_week: "2026-09-06" } },
    response: {
      answer: "Поставил «купить молоко» на завтра.",
      task_actions: [{ op: "create", title: "Купить молоко" }],
    },
    expect: { taskOps: ["create"], answerIncludes: ["молоко"] },
  },
  {
    id: "update-existing-task",
    title: "Updates the existing open task instead of duplicating",
    query: "Перенеси отчёт на пятницу",
    workspace: { tasks: [{ id: "t-report", title: "Сдать отчёт", status: "todo" }] },
    response: {
      answer: "Перенёс «Сдать отчёт» на пятницу — это та же задача, не новая.",
      task_actions: [{ op: "update", task_id: "t-report", title: "Сдать отчёт" }],
    },
    expect: { taskOps: ["update"] },
  },
  {
    id: "fuzzy-goal-no-dump",
    title: "Fuzzy motives: question, no task dump",
    query: "Синк по целям и плану. Хочу как-то вырасти.",
    workspace: { goals: [] },
    response: {
      answer: "«Вырасти» слишком широко. Это про доход, навык или свободу в календаре?",
      task_actions: [],
      goal_actions: [],
    },
    expect: { emptyTaskActions: true },
  },
  {
    id: "clear-goal-plan",
    title: "Clear goal writes a weekly plan",
    query: "Синк по целям и плану. Хочу пробежать 10 км в октябре.",
    workspace: { goals: [], self: { values: ["здоровье"] } },
    response: {
      answer: "Зафиксировал цель «пробежать 10 км в октябре» и план на эту неделю: три лёгких пробежки.",
      goal_actions: [{ op: "create", title: "Пробежать 10 км в октябре" }],
      task_actions: [{ op: "create", title: "Пробежка 20 минут" }],
    },
    expect: { taskOps: ["create"], answerIncludes: ["10 км"] },
  },
  {
    id: "projects-visible",
    title: "Workspace includes projects",
    query: "Как двигается редизайн?",
    workspace: {
      projects: [{ id: "p1", name: "Редизайн сайта", status: "active" }],
      goals: [{ title: "Запустить лендинг" }],
    },
    response: {
      answer: "Проект «Редизайн сайта» всё ещё active и кормит цель «Запустить лендинг». Какой кусок сегодня реально закрываем?",
      context_used: ["Редизайн сайта"],
    },
    expect: { workspaceHas: ["projects"], contextUsedIncludes: ["Редизайн сайта"] },
  },
  {
    id: "spaces-visible",
    title: "Workspace includes spaces",
    query: "Что по работе?",
    workspace: { spaces: [{ id: "s1", name: "Работа", type: "work" }] },
    response: {
      answer: "В пространстве «Работа» нет датированных дел на сегодня — либо день чистый, либо задачи без даты.",
      context_used: ["Работа"],
    },
    expect: { workspaceHas: ["spaces"] },
  },
  {
    id: "self-fact-tone",
    title: "Durable energy fact is acknowledged as remembered",
    query: "Я лучше думаю утром",
    workspace: { self: { memories: [] } },
    response: {
      answer: "Запомнил: ты лучше думаешь утром. Тогда сложное — в первую половину, рутину — после обеда.",
      self_facts: [{ content: "лучше думает утром" }],
    },
    expect: { answerIncludes: ["утром"], liveMentions: ["утр"] },
  },
  {
    id: "no-invented-mail",
    title: "Does not invent mailbox contents",
    query: "Что в почте?",
    workspace: { mail: { accounts: [], important: [] } },
    response: {
      answer: "Почтовый ящик не подключён — я не вижу писем и не буду их выдумывать.",
    },
    expect: { answerExcludes: ["invoice@"] },
  },
  {
    id: "empty-search",
    title: "Empty discovery does not invent shops",
    query: "Найди кафе рядом",
    workspace: { discovery_results: [], now: { city: "Москва" } },
    response: {
      answer: "По живому поиску ничего не вернулось. Могу сузить район или кухню и поискать ещё раз.",
    },
    expect: { answerExcludes: ["tripadvisor.com"] },
  },
  {
    id: "push-task-now",
    title: "Push task is named firmly, not as a lecture",
    query: "С чего начать?",
    workspace: { tasks: [{ title: "Позвонить клиенту", push: true, due_at: "2026-09-04T10:00:00.000Z" }] },
    response: {
      answer: "Сначала звонок клиенту — он помечен как не откладывать. Остальное подождёт 20 минут.",
      context_used: ["Позвонить клиенту"],
    },
    expect: { answerIncludes: ["звонок"], liveMentions: ["звон"] },
  },
  {
    id: "locale-ru-alive",
    title: "Russian answer stays colloquial",
    query: "Я устал",
    workspace: { now: { locale: "ru" }, tasks: [{ title: "Отчёт" }] },
    response: {
      answer: "Похоже, отчёт ещё висит, а сил уже нет. Давай снимем его на 25 минут или честно перенесём на утро.",
    },
    expect: { answerExcludes: ["рекомендуется осуществлять"] },
  },
  {
    id: "ealzy-assignee",
    title: "Does not mark Ealzy queue work as done in the same breath",
    query: "Сделай сам: собери план поездки",
    workspace: {
      tasks: [
        { id: "t-trip", title: "Собрать план поездки", assignee: "ealzy", status: "todo" },
      ],
    },
    response: {
      answer: "Собрал черновик маршрута в ответе. Саму календарную работу Илзи не помечаю выполненной в этом же ходе.",
      task_actions: [],
    },
    expect: { emptyTaskActions: true },
  },
  {
    id: "values-shape-advice",
    title: "Values change the advice",
    query: "Взять ещё проект?",
    workspace: {
      self: { values: ["семьи больше, чем карьеры"] },
      tasks: [{ title: "Ужин с детьми", due_at: "2026-09-04T18:00:00.000Z" }],
    },
    response: {
      answer: "У тебя в ценностях семья важнее карьеры, и сегодня уже стоит ужин с детьми. Новый проект подождёт, если только он не кормит эту ценность.",
      context_used: ["семьи больше, чем карьеры"],
    },
    expect: { contextUsedIncludes: ["семьи больше, чем карьеры"], liveMentionAny: ["семь", "дет", "ценност"] },
  },
  {
    id: "knows-without-asking",
    title: "Uses portrait and patterns instead of re-asking who they are",
    query: "Что делать?",
    workspace: {
      self: {
        portrait: "Сова, любит короткие ответы. Часто копит просрочку по мелким делам.",
        values: ["спокойствие"],
        patterns: [{ kind: "overdue_cluster", detail: "часто копит просрочку (5): Оплатить счета" }],
      },
      tasks: [{ title: "Оплатить счета", due_at: "2026-08-01T12:00:00.000Z" }],
    },
    response: {
      answer: "Счета снова висят просрочкой — один платёж сейчас, без расспроса кто ты.",
      context_used: ["Оплатить счета"],
    },
    expect: {
      answerIncludes: ["счета"],
      answerExcludes: ["расскажи о себе", "пока почти ничего не знаю"],
      liveMentions: ["счета"],
    },
  },
  {
    id: "settings-telegram-time",
    title: "Changes Telegram notification time in chat, not via profile",
    query: "Присылай утреннее в телеграм в 7:30, вечернее выключи",
    workspace: {
      settings: {
        telegram_linked: true,
        timezone: "Europe/Moscow",
        morning_digest_enabled: true,
        morning_digest_time: "08:00",
        evening_sync_enabled: true,
        evening_sync_time: "21:00",
      },
    },
    response: {
      answer: "Утро теперь в 7:30 по Москве, вечерний синк выключила.",
      context_used: ["settings"],
    },
    expect: {
      answerIncludes: ["7:30"],
      answerExcludes: ["открой профиль"],
      workspaceHas: ["settings"],
    },
  },
  {
    id: "today-agenda-not-tomorrow",
    title: "Today's tasks do not include tomorrow and do not invent 09:00",
    query: "какие дела есть на сегодня?",
    workspace: {
      tasks: [
        { title: "Составить план обучения продажам", when: "today", due_on: "2026-09-09", due_time: null },
        { title: "Переделать отчеты по залу в инциденты", when: "tomorrow", due_on: "2026-09-10", due_time: null },
      ],
    },
    response: {
      answer: "На сегодня: составить план обучения продажам.",
      task_actions: [],
    },
    expect: {
      emptyTaskActions: true,
      answerIncludes: ["план обучения"],
      answerExcludes: ["отчеты по залу", "09:00"],
    },
  },
  {
    id: "voice-multi-capture",
    title: "Voice dump captures every errand in one turn",
    query:
      "слушай надо купить молоко, позвонить в банк, записаться к врачу и отправить документы",
    workspace: { tasks: [], now: { date: "2026-09-04" } },
    response: {
      answer:
        "Записала четыре дела: купить молоко, позвонить в банк, записаться к врачу и отправить документы.",
      task_actions: [
        { op: "create", title: "Купить молоко" },
        { op: "create", title: "Позвонить в банк" },
        { op: "create", title: "Записаться к врачу" },
        { op: "create", title: "Отправить документы" },
      ],
    },
    expect: { taskOps: ["create"], answerIncludes: ["молоко", "банк", "врачу", "документы"] },
  },
  {
    id: "capture-not-tomorrow-agenda",
    title: "Add-a-task-for-tomorrow with a research question is a capture, not an agenda dump",
    query:
      "добавь еще одну задачу на завтра. Свериться с ИИ-шкой. Какие самые важные для АЗС пункты проверки, чтобы больше зарабатывать и лучше для клиентов?",
    workspace: {
      tasks: [
        { title: "Поменять деньги", when: "tomorrow" },
        { title: "Проверить чек-листы от АЗС и понять, что реально можем проверять", when: "tomorrow" },
      ],
    },
    response: {
      answer:
        "Поставила на завтра «свериться с ИИ: важные пункты проверки АЗС». Это рядом с уже стоящей проверкой чек-листов — можно закрывать одним заходом. Коротко по сути: маржа (цены, стоки, списания), сервис на площадке (очереди, чистота, туалет), топливо и безопасность, персонал и смена, программа лояльности.",
      task_actions: [{ op: "create", title: "Свериться с ИИ: важные пункты проверки АЗС" }],
    },
    expect: {
      taskOps: ["create"],
      answerIncludes: ["АЗС"],
      answerExcludes: ["Поменять деньги"],
    },
  },
  {
    id: "bare-errand-capture",
    title: "A short infinitive errand is captured without «добавь»",
    query: "купить лекарства",
    workspace: { tasks: [] },
    response: {
      answer: "Поставил «Купить лекарства» на сегодня.",
      task_actions: [{ op: "create", title: "Купить лекарства" }],
    },
    expect: { taskOps: ["create"], answerIncludes: ["лекарств"] },
  },
  {
    id: "description-updates-existing",
    title: "Add-to-description edits the open task instead of creating another",
    query:
      "добавь в описание задачи необходимые лекарства для поездки с ребенком 5 лет заграницу",
    workspace: {
      tasks: [{ id: "t-meds", title: "Купить лекарства", status: "todo" }],
    },
    response: {
      answer:
        "Добавил в описание «Купить лекарства» аптечку для поездки с ребёнком: жаропонижающее, антигистамин, капли в нос.",
      task_actions: [
        {
          op: "update",
          task_id: "t-meds",
          title: "Купить лекарства",
          description: "• жаропонижающее\n• антигистамин\n• капли в нос",
        },
      ],
    },
    expect: { taskOps: ["update"], answerIncludes: ["Купить лекарства"] },
  },
  {
    id: "telegram-reply-binds-task",
    title: "A Telegram reply edits the quoted task, not a new one",
    query: "добавь в описание аптечку для ребёнка 5 лет",
    workspace: {
      replied_to: {
        role: "assistant",
        content: "Поставил задачу «Купить лекарства» на сегодня.",
      },
      tasks: [{ id: "t-meds", title: "Купить лекарства", status: "todo" }],
    },
    response: {
      answer: "Дописал аптечку в «Купить лекарства».",
      task_actions: [
        {
          op: "update",
          task_id: "t-meds",
          title: "Купить лекарства",
          description: "• парацетамол\n• антигистамин",
        },
      ],
    },
    expect: { taskOps: ["update"], answerIncludes: ["Купить лекарства"] },
  },
];

export function judgeScenario(
  scenario: CompanionEvalScenario,
  response: CompanionEvalScenario["response"] = scenario.response,
  mode: "fixture" | "live" = "fixture",
): EvalCheck[] {
  const checks: EvalCheck[] = [];
  const answer = response.answer.toLocaleLowerCase();
  const used = (response.context_used ?? []).join(" ").toLocaleLowerCase();
  const mentioned = `${answer}\n${used}`;
  const workspaceText = JSON.stringify(scenario.workspace);
  const { expect: want } = scenario;
  const mentionNeedles =
    mode === "live"
      ? want.liveMentions?.length
        ? want.liveMentions
        : want.liveMentionAny?.length
          ? []
          : [...(want.contextUsedIncludes ?? []), ...(want.answerIncludes ?? [])]
      : [...(want.contextUsedIncludes ?? []), ...(want.answerIncludes ?? [])];
  const mentionHaystack = mode === "live" ? mentioned : "";

  if (mode === "live") {
    for (const needle of mentionNeedles) {
      checks.push({
        id: `${scenario.id}:mention:${needle}`,
        title: `mentions «${needle}»`,
        pass: mentionHaystack.includes(needle.toLocaleLowerCase()),
      });
    }
    if (want.liveMentionAny?.length) {
      checks.push({
        id: `${scenario.id}:mention-any`,
        title: `mentions one of ${want.liveMentionAny.join("/")}`,
        pass: want.liveMentionAny.some((needle) =>
          mentionHaystack.includes(needle.toLocaleLowerCase()),
        ),
      });
    }
  } else {
    for (const needle of want.contextUsedIncludes ?? []) {
      checks.push({
        id: `${scenario.id}:context:${needle}`,
        title: `context_used includes «${needle}»`,
        pass: used.includes(needle.toLocaleLowerCase()),
      });
    }
    for (const needle of want.answerIncludes ?? []) {
      checks.push({
        id: `${scenario.id}:answer:${needle}`,
        title: `answer includes «${needle}»`,
        pass: answer.includes(needle.toLocaleLowerCase()),
      });
    }
  }
  for (const needle of want.answerExcludes ?? []) {
    checks.push({
      id: `${scenario.id}:exclude:${needle}`,
      title: `answer excludes «${needle}»`,
      pass: !answer.includes(needle.toLocaleLowerCase()),
    });
  }
  if (want.emptyTaskActions) {
    checks.push({
      id: `${scenario.id}:no-tasks`,
      title: "no task_actions",
      pass: !(response.task_actions ?? []).length,
    });
  }
  if (want.taskOps) {
    const ops = (response.task_actions ?? []).map((item) => item.op);
    checks.push({
      id: `${scenario.id}:task-ops`,
      title: `task ops ${want.taskOps.join(",")}`,
      pass: want.taskOps.every((op) => ops.includes(op)),
    });
  }
  for (const key of want.workspaceHas ?? []) {
    checks.push({
      id: `${scenario.id}:ws:${key}`,
      title: `workspace has ${key}`,
      pass: Object.prototype.hasOwnProperty.call(scenario.workspace, key) && workspaceText.includes(key),
    });
  }
  if (want.overflowMention) {
    checks.push({
      id: `${scenario.id}:overflow`,
      title: "mentions leftover volume",
      pass: /ещё|просроч|overflow|12|3/.test(answer),
    });
  }
  for (const banned of GENERIC_BANNED) {
    checks.push({
      id: `${scenario.id}:banned:${banned.slice(0, 16)}`,
      title: `not generic «${banned}»`,
      pass: !answer.includes(banned),
    });
  }
  return checks;
}

export function promptContractChecks(): EvalCheck[] {
  const prompt = [COMPANION_PERSONALITY, COMPANION_WRITE_RULES, COMPANION_TONE_EXAMPLES].join("\n");
  const needles = [
    "вот что я вижу в твоих данных",
    "живой разговорный",
    "workspace.projects",
    "workspace.overflow",
    "Good:",
    "Bad:",
    "never a generic pep talk",
    "past tense",
    "workspace.self.portrait",
    "workspace.self.values",
    "assignee ealzy",
    "workspace.settings",
    "when=today",
    "due_time",
    "several independent",
    "voice dump",
    "max 8 new tasks",
    "unrelated task list",
    "добавь задачу на завтра",
    "workspace.replied_to",
  ];
  return needles.map((needle) => ({
    id: `prompt:${needle}`,
    title: `prompt includes «${needle}»`,
    pass: prompt.toLocaleLowerCase().includes(needle.toLocaleLowerCase()),
  }));
}

export function runCompanionEval() {
  const checks = [
    ...promptContractChecks(),
    ...COMPANION_EVAL_SCENARIOS.flatMap((scenario) => judgeScenario(scenario)),
  ];
  const failed = checks.filter((check) => !check.pass);
  return {
    total: checks.length,
    passed: checks.length - failed.length,
    failed,
    scenarioCount: COMPANION_EVAL_SCENARIOS.length,
  };
}

export type CompanionEvalResponse = CompanionEvalScenario["response"];

export type CompanionGenerate = (
  scenario: CompanionEvalScenario,
) => Promise<CompanionEvalResponse>;

export function parseCompanionEvalResponse(raw: unknown): CompanionEvalResponse {
  if (!raw || typeof raw !== "object") return { answer: "" };
  const row = raw as Record<string, unknown>;
  const taskActions = Array.isArray(row.task_actions)
    ? row.task_actions.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const op = (item as { op?: unknown }).op;
        if (typeof op !== "string") return [];
        const title = (item as { title?: unknown }).title;
        const taskId = (item as { task_id?: unknown }).task_id;
        return [
          {
            op,
            title: typeof title === "string" ? title : null,
            task_id: typeof taskId === "string" ? taskId : null,
          },
        ];
      })
    : undefined;
  const goalActions = Array.isArray(row.goal_actions)
    ? row.goal_actions.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const op = (item as { op?: unknown }).op;
        if (typeof op !== "string") return [];
        const title = (item as { title?: unknown }).title;
        return [{ op, title: typeof title === "string" ? title : null }];
      })
    : undefined;
  return {
    answer: typeof row.answer === "string" ? row.answer : "",
    context_used: Array.isArray(row.context_used)
      ? row.context_used.filter((item): item is string => typeof item === "string")
      : undefined,
    task_actions: taskActions,
    goal_actions: goalActions,
    self_facts: Array.isArray(row.self_facts) ? row.self_facts : undefined,
    person_facts: Array.isArray(row.person_facts) ? row.person_facts : undefined,
  };
}

export type CompanionEvalRun = {
  total: number;
  passed: number;
  failed: EvalCheck[];
  scenarioCount: number;
  scenarios: {
    id: string;
    title: string;
    answer: string;
    context_used: string[];
    task_ops: string[];
    goal_ops: string[];
    failed: EvalCheck[];
  }[];
};

export async function runCompanionEvalGenerated(
  generate: CompanionGenerate,
  options: { mode?: "fixture" | "live" } = {},
): Promise<CompanionEvalRun> {
  const mode = options.mode ?? "fixture";
  const checks = [...promptContractChecks()];
  const scenarios: CompanionEvalRun["scenarios"] = [];
  for (const scenario of COMPANION_EVAL_SCENARIOS) {
    const response = await generate(scenario);
    const judged = judgeScenario(scenario, response, mode);
    checks.push(...judged);
    scenarios.push({
      id: scenario.id,
      title: scenario.title,
      answer: response.answer,
      context_used: response.context_used ?? [],
      task_ops: (response.task_actions ?? []).map((item) => item.op),
      goal_ops: (response.goal_actions ?? []).map((item) => item.op),
      failed: judged.filter((check) => !check.pass),
    });
  }
  const failed = checks.filter((check) => !check.pass);
  return {
    total: checks.length,
    passed: checks.length - failed.length,
    failed,
    scenarioCount: COMPANION_EVAL_SCENARIOS.length,
    scenarios,
  };
}
