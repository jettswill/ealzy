import SwiftUI

/// Сессия с Илзи во весь экран: наговорить всё из головы → разбор → принять → одно «сейчас».
struct SessionView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(TasksStore.self) private var tasks
    @Environment(AppRouter.self) private var router
    @Environment(FocusSession.self) private var focus
    @State private var store: SessionStore
    @State private var recorder = SessionRecorder()
    @State private var typing = false
    @State private var startingFocus: EalzyTask?
    @State private var renaming: SessionTask?
    @State private var renameText = ""
    @FocusState private var editorFocused: Bool

    init(mode: SessionMode) {
        _store = State(initialValue: SessionStore(mode: mode))
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            switch store.stage {
            case .compose, .transcribing: compose
            case .thinking: thinking("Илзи раскладывает…", "Дела, направления и мысли — по полочкам.")
            case .review, .applying: review
            case .done: done
            }
        }
        .background { LampBackground().ignoresSafeArea() }
        .background(Palette.ground.ignoresSafeArea())
        .onDisappear { recorder.cancel() }
        .onChange(of: store.transcript) { store.saveDraft() }
        .onChange(of: focus.isRunning) { if focus.isRunning { dismiss() } }
        .sheet(item: $startingFocus) { StartFocusSheet(task: $0) }
        .alert("Название дела", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Что сделать", text: $renameText)
            Button("Готово") {
                if let task = renaming {
                    let clean = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !clean.isEmpty { store.titles[task.key] = clean }
                }
                renaming = nil
            }
            Button("Отмена", role: .cancel) { renaming = nil }
        }
    }

    // MARK: Верх

    private var topBar: some View {
        HStack {
            Button(store.stage == .done ? "Готово" : "Закрыть") {
                recorder.cancel()
                dismiss()
            }
            .font(.body)
            .foregroundStyle(Palette.ink2)
            Spacer()
            Text(store.mode.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.ink3)
            Spacer()
            if store.stage == .review {
                Button("Заново") { store.reset() }
                    .font(.body)
                    .foregroundStyle(Palette.ink2)
            } else {
                Color.clear.frame(width: 60, height: 1)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 50)
    }

    // MARK: Рассказ

    private var compose: some View {
        VStack(alignment: .leading, spacing: 0) {
            if recorder.state == .idle && store.transcript.isEmpty {
                modePicker.padding(.top, 8)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if store.transcript.isEmpty && !typing {
                        Text(store.mode.prompt)
                            .font(Typeface.display(26))
                            .foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Говори сколько нужно — хоть полчаса. Можно ставить на паузу и дописывать.")
                            .font(.subheadline)
                            .foregroundStyle(Palette.ink3)
                    } else {
                        TextEditor(text: $store.transcript)
                            .focused($editorFocused)
                            .scrollContentBackground(.hidden)
                            .font(.body)
                            .foregroundStyle(Palette.ink)
                            .frame(minHeight: 220)
                            .overlay(alignment: .topLeading) {
                                if store.transcript.isEmpty {
                                    Text("Пиши всё подряд…")
                                        .foregroundStyle(Palette.ink3)
                                        .padding(.top, 8)
                                        .padding(.leading, 5)
                                        .allowsHitTesting(false)
                                }
                            }
                    }
                    if store.unsentAudio != nil && store.stage == .compose {
                        Button { Task { await store.retryUnsent() } } label: {
                            Label("Отправить сохранённую запись ещё раз", systemImage: "arrow.clockwise")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Palette.goldText)
                        }
                    }
                    if let error = store.errorMessage ?? recorder.errorMessage {
                        Text(error).font(.footnote).foregroundStyle(Palette.dayMark)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 20)
            }
            .scrollDismissesKeyboard(.interactively)

            recordControls
        }
    }

    private var modePicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(SessionMode.allCases) { mode in
                    let on = store.mode == mode
                    Button { withAnimation(.snappy) { store.mode = mode } } label: {
                        Label(mode.title, systemImage: mode.icon)
                            .font(.subheadline.weight(on ? .semibold : .regular))
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .background(on ? Palette.gold : .clear, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? .clear : Palette.rule))
                            .foregroundStyle(on ? Palette.goldInk : Palette.ink)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 24)
        }
    }

    private var recordControls: some View {
        VStack(spacing: 14) {
            if store.stage == .transcribing {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Распознаю запись…").font(.subheadline).foregroundStyle(Palette.ink2)
                }
                .frame(height: 96)
            } else if recorder.state == .idle {
                HStack(spacing: 18) {
                    if !store.transcript.isEmpty {
                        Button {
                            Task { await recorder.start() }
                        } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 22))
                                .frame(width: 56, height: 56)
                                .overlay(Circle().strokeBorder(Palette.rule))
                                .foregroundStyle(Palette.ink)
                        }
                        .accessibilityLabel("Дописать голосом")
                        Button {
                            editorFocused = false
                            Task { await store.analyze() }
                        } label: {
                            Text("Разобрать")
                                .font(.body.weight(.semibold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 56)
                                .background(Palette.gold, in: Capsule())
                                .foregroundStyle(Palette.goldInk)
                        }
                    } else {
                        Button {
                            Task { await recorder.start() }
                        } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 30))
                                .frame(width: 84, height: 84)
                                .background(Palette.gold, in: Circle())
                                .foregroundStyle(Palette.goldInk)
                        }
                        .accessibilityLabel("Начать говорить")
                    }
                }
                if store.transcript.isEmpty && !typing {
                    Button("Или написать текстом") {
                        typing = true
                        editorFocused = true
                    }
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
                }
            } else {
                VStack(spacing: 10) {
                    LevelBars(level: recorder.state == .recording ? recorder.level : 0)
                        .frame(height: 28)
                    Text(Self.clock(recorder.elapsed))
                        .font(.system(size: 34, weight: .light))
                        .monospacedDigit()
                        .foregroundStyle(Palette.ink)
                    Text(recorder.state == .paused ? "На паузе" : "Слушаю…")
                        .font(.footnote)
                        .foregroundStyle(Palette.ink3)
                }
                HStack(spacing: 22) {
                    Button {
                        recorder.state == .paused ? recorder.resume() : recorder.pause()
                    } label: {
                        Image(systemName: recorder.state == .paused ? "mic.fill" : "pause.fill")
                            .font(.system(size: 22))
                            .frame(width: 60, height: 60)
                            .overlay(Circle().strokeBorder(Palette.rule))
                            .foregroundStyle(Palette.ink)
                    }
                    .accessibilityLabel(recorder.state == .paused ? "Продолжить" : "Пауза")
                    Button {
                        if let audio = recorder.finish() { Task { await store.transcribe(audio) } }
                    } label: {
                        Label("Готово", systemImage: "checkmark")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 28)
                            .frame(height: 60)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.goldInk)
                    }
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 24)
        .padding(.top, 8)
    }

    private func thinking(_ title: String, _ subtitle: String) -> some View {
        VStack(spacing: 14) {
            Spacer()
            ProgressView().controlSize(.large)
            Text(title).font(Typeface.display(24)).foregroundStyle(Palette.ink)
            Text(subtitle).font(.subheadline).foregroundStyle(Palette.ink3)
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(24)
    }

    // MARK: Разбор

    @ViewBuilder
    private var review: some View {
        if let proposal = store.proposal {
            ZStack(alignment: .bottom) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(proposal.summary)
                            .font(Typeface.display(22))
                            .foregroundStyle(Palette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        if let reflection = proposal.reflection {
                            Text(reflection)
                                .font(.body)
                                .foregroundStyle(Palette.ink2)
                                .padding(.top, 12)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if let now = store.nowTask {
                            nowCard(now, reason: proposal.now?.reason, step: proposal.now?.firstStep)
                                .padding(.top, 22)
                        }

                        if !proposal.goals.isEmpty {
                            sectionTitle("Направления")
                            ForEach(proposal.goals) { goalRow($0) }
                        }

                        ForEach(SessionBucket.allCases) { bucket in
                            let items = proposal.tasks.filter {
                                store.bucket(of: $0) == bucket && $0.key != store.nowKey
                            }
                            if !items.isEmpty {
                                sectionTitle(bucket.title)
                                ForEach(items) { taskRow($0, goals: proposal.goals) }
                            }
                        }

                        if !proposal.thoughts.isEmpty {
                            sectionTitle("Не дела — сохраню в заметку")
                            ForEach(proposal.thoughts, id: \.self) { thought in
                                Text("· \(thought)")
                                    .font(.subheadline)
                                    .foregroundStyle(Palette.ink2)
                                    .padding(.vertical, 4)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        if let alignment = proposal.alignment {
                            sectionTitle("Что к целям, а что шум")
                            Text(alignment)
                                .font(.subheadline)
                                .foregroundStyle(Palette.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if !proposal.questions.isEmpty {
                            sectionTitle("Подумать")
                            ForEach(proposal.questions, id: \.self) { question in
                                Button {
                                    dismiss()
                                    router.ask(question)
                                } label: {
                                    HStack(alignment: .top) {
                                        Text(question).multilineTextAlignment(.leading)
                                        Spacer(minLength: 8)
                                        Image(systemName: "bubble.left")
                                    }
                                    .font(.subheadline)
                                    .foregroundStyle(Palette.ink)
                                    .padding(.vertical, 8)
                                }
                            }
                        }

                        if let error = store.errorMessage {
                            Text(error).font(.footnote).foregroundStyle(Palette.dayMark).padding(.top, 16)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 14)
                    .padding(.bottom, 120)
                }

                Button {
                    Task { await store.apply(tasks: tasks) }
                } label: {
                    Group {
                        if store.stage == .applying {
                            ProgressView().tint(Palette.goldInk)
                        } else {
                            Text(applyTitle)
                        }
                    }
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(Palette.gold, in: Capsule())
                    .foregroundStyle(Palette.goldInk)
                }
                .disabled(store.stage == .applying)
                .padding(.horizontal, 24)
                .padding(.bottom, 20)
            }
        }
    }

    private var applyTitle: String {
        let n = store.pickedCount
        if n == 0 { return "Сохранить только заметку" }
        return "Записать \(n) \(TodayView.plural(n, "дело", "дела", "дел"))"
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(Palette.ink3)
            .padding(.top, 28)
            .padding(.bottom, 6)
    }

    private func nowCard(_ task: SessionTask, reason: String?, step: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("СЕЙЧАС")
                .font(.caption.weight(.bold))
                .tracking(0.8)
                .foregroundStyle(Palette.goldText)
            Text(store.title(of: task))
                .font(Typeface.display(22))
                .foregroundStyle(Palette.ink)
            if let reason { Text(reason).font(.subheadline).foregroundStyle(Palette.ink2) }
            if let step {
                Label(step, systemImage: "arrow.turn.down.right")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
            }
            Menu {
                bucketMenu(task)
            } label: {
                Text("Не сейчас")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.ink3)
            }
            .padding(.top, 2)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.pool.opacity(0.55), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Palette.gold.opacity(0.5)))
    }

    private func goalRow(_ goal: SessionGoal) -> some View {
        let picked = !goal.isNew || store.pickedGoals.contains(goal.key)
        return HStack(alignment: .top, spacing: 12) {
            if goal.isNew {
                Button {
                    if store.pickedGoals.contains(goal.key) { store.pickedGoals.remove(goal.key) }
                    else { store.pickedGoals.insert(goal.key) }
                } label: { CheckBox(checked: picked) }
                .buttonStyle(.plain)
            } else {
                Image(systemName: "scope")
                    .foregroundStyle(Palette.goldText)
                    .frame(width: 24)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(goal.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(picked ? Palette.ink : Palette.ink3)
                let meta = [goal.isNew ? "новое направление" : "уже есть", goal.horizonTitle].compactMap { $0 }
                Text(meta.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Palette.ink3)
                if let why = goal.why {
                    Text(why).font(.caption).foregroundStyle(Palette.ink2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }

    private func taskRow(_ task: SessionTask, goals: [SessionGoal]) -> some View {
        let picked = store.pickedTasks.contains(task.key)
        let goal = task.goalKey.flatMap { key in goals.first { $0.key == key } }
        var meta: [String] = []
        if task.isUpdate { meta.append("уже есть в делах") }
        if task.isForIlzi { meta.append("сделает Илзи") }
        if let due = task.dueAt { meta.append("срок " + due.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "ru_RU")))) }
        if let minutes = task.estimateMinutes { meta.append("~" + TodayView.duration(TimeInterval(minutes * 60))) }
        if let sphere = task.sphereTitle { meta.append(sphere) }
        return HStack(alignment: .top, spacing: 12) {
            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                withAnimation(.snappy) { store.toggle(task) }
            } label: { CheckBox(checked: picked) }
            .buttonStyle(.plain)
            .accessibilityLabel(picked ? "Не записывать" : "Записать")
            VStack(alignment: .leading, spacing: 3) {
                Text(store.title(of: task))
                    .font(.subheadline)
                    .foregroundStyle(picked ? Palette.ink : Palette.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                if let goal {
                    Label(goal.title, systemImage: "scope")
                        .font(.caption)
                        .foregroundStyle(Palette.goldText)
                        .lineLimit(1)
                }
                if !meta.isEmpty {
                    Text(meta.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Palette.ink3)
                }
            }
            Spacer(minLength: 0)
            Menu {
                Button { store.makeNow(task) } label: { Label("Сделать сейчас", systemImage: "bolt") }
                bucketMenu(task)
                Button {
                    renameText = store.title(of: task)
                    renaming = task
                } label: { Label("Переименовать", systemImage: "pencil") }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body)
                    .foregroundStyle(Palette.ink3)
                    .frame(width: 36, height: 30)
            }
        }
        .padding(.vertical, 7)
    }

    @ViewBuilder
    private func bucketMenu(_ task: SessionTask) -> some View {
        ForEach(SessionBucket.allCases.filter { $0 != .now }) { bucket in
            Button(bucket.title) { withAnimation(.snappy) { store.move(task, to: bucket) } }
        }
    }

    // MARK: Готово

    private var done: some View {
        let result = store.result
        let nowTask = result?.nowTaskId.flatMap { id in tasks.tasks.first { $0.id == id } }
        let count = result?.tasks.count ?? 0
        let goals = result?.goals.count ?? 0
        return VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 20)
            Text("Голова разгружена.")
                .font(Typeface.display(34))
                .foregroundStyle(Palette.ink)
            Text(doneLine(count: count, goals: goals))
                .font(.body)
                .foregroundStyle(Palette.ink2)
                .padding(.top, 10)
            if let nowTask {
                VStack(alignment: .leading, spacing: 8) {
                    Text("СЕЙЧАС")
                        .font(.caption.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(Palette.goldText)
                    Text(nowTask.title)
                        .font(Typeface.display(24))
                        .foregroundStyle(Palette.ink)
                    if let step = store.proposal?.now?.firstStep {
                        Label(step, systemImage: "arrow.turn.down.right")
                            .font(.subheadline)
                            .foregroundStyle(Palette.ink2)
                    }
                }
                .padding(.top, 36)
                Button { startingFocus = nowTask } label: {
                    Label("Начать", systemImage: "play.fill")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Palette.gold, in: Capsule())
                        .foregroundStyle(Palette.goldInk)
                }
                .padding(.top, 22)
            }
            Spacer()
            Button {
                dismiss()
                withAnimation { router.tab = .today }
            } label: {
                Text(nowTask == nil ? "К делам" : "Позже — к делам")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .overlay(Capsule().strokeBorder(Palette.rule))
                    .foregroundStyle(Palette.ink)
            }
            .padding(.bottom, 20)
        }
        .padding(.horizontal, 24)
    }

    private func doneLine(count: Int, goals: Int) -> String {
        var parts: [String] = []
        if count > 0 { parts.append("Записала \(count) \(TodayView.plural(count, "дело", "дела", "дел"))") }
        if goals > 0 { parts.append("\(goals) \(TodayView.plural(goals, "новое направление", "новых направления", "новых направлений"))") }
        let head = parts.isEmpty ? "Дел не добавила" : parts.joined(separator: " и ")
        return head + ". Мысли — в заметке сессии, ничего не потерялось."
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// Волна громкости под таймером записи.
private struct LevelBars: View {
    let level: Double

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            ForEach(0..<15, id: \.self) { index in
                let shape = 1 - abs(Double(index) - 7) / 8
                Capsule()
                    .fill(Palette.gold)
                    .frame(width: 4, height: max(4, 28 * level * shape))
            }
        }
        .animation(.easeOut(duration: 0.1), value: level)
    }
}
