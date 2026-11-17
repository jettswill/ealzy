import BackgroundTasks
import SwiftUI

@main
struct EalzyApp: App {
    static let refreshTaskId = "ru.ealzy.app.refresh"

    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var auth = AuthStore()
    @State private var tasks = TasksStore()
    @State private var chat = ChatStore()
    @State private var calendar = PhoneCalendar()
    @State private var router = AppRouter.shared
    @State private var focus = FocusSession()
    @AppStorage(Appearance.storageKey) private var appearance = Appearance.system.rawValue
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(tasks)
                .environment(chat)
                .environment(calendar)
                .environment(router)
                .environment(focus)
                .tint(Palette.goldText)
                .preferredColorScheme(Appearance(rawValue: appearance)?.colorScheme)
                .onOpenURL { url in
                    if !router.handle(url) { auth.handleCallback(url) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .ealzyTasksChanged)) { _ in
                    Task { await tasks.load() }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active where auth.isSignedIn:
                Task { await refreshAll() }
            case .background:
                Self.scheduleRefresh()
            default:
                break
            }
        }
        // Дела, записанные через Telegram или сайт, тоже должны звенеть вовремя, а Илзи —
        // знать свежий календарь: время от времени iOS будит приложение в фоне.
        .backgroundTask(.appRefresh(Self.refreshTaskId)) {
            Self.scheduleRefresh()
            guard Keychain.readToken() != nil else { return }
            await refreshAll()
        }
    }

    @MainActor
    private func refreshAll() async {
        await chat.flushQueue()
        await calendar.sync()
        tasks.nextEvent = calendar.nextEventItem
        await tasks.load()
    }

    static func scheduleRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: refreshTaskId)
        request.earliestBeginDate = Date().addingTimeInterval(30 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}

struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(TasksStore.self) private var tasks
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(AppRouter.self) private var router
    @Environment(ChatStore.self) private var chat
    @Environment(FocusSession.self) private var focus
    @State private var showOnboarding = !DemoData.isOn && !UserDefaults.standard.bool(forKey: OnboardingView.doneKey)
    @State private var ilziDetent: PresentationDetent = .medium

    var body: some View {
        @Bindable var router = router
        if auth.isSignedIn {
            ZStack(alignment: .bottom) {
                // «Сегодня» ⇄ «Запас» — и вкладками, и свайпом влево-вправо.
                TabView(selection: $router.tab) {
                    TodayView().tag(AppRouter.Tab.today)
                    ReserveView().tag(AppRouter.Tab.reserve)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .background { LampBackground() } // свет лампы на весь экран, общий для обеих вкладок
                .onChange(of: router.tab) { UISelectionFeedbackGenerator().selectionChanged() }

                BottomBar(tab: $router.tab, openIlzi: { router.openIlzi() })
            }
            .sheet(isPresented: $router.isIlziOpen) {
                IlziSheet(detent: $ilziDetent)
                    .presentationDetents([.medium, .large], selection: $ilziDetent)
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(30)
                    .presentationBackground(Palette.raised)
            }
            .onChange(of: router.isIlziOpen) { if router.isIlziOpen { ilziDetent = .medium } }
            .onChange(of: router.focusRequest) {
                router.isIlziOpen = false
                if focus.isRunning { focus.isPresented = true }
            }
            .onChange(of: tasks.tasks) {
                // Дело фокуса закрыли из виджета или уведомления — фокус заканчивается.
                if let id = focus.state?.taskId, let task = tasks.tasks.first(where: { $0.id == id }), !task.isOpen {
                    focus.finish()
                }
            }
            .sheet(isPresented: $router.showSettings) { SettingsView() }
            .task {
                await auth.refresh()
                await chat.flushQueue()
                await calendar.sync()
                tasks.nextEvent = calendar.nextEventItem
                await tasks.load()
                // Разрешения спрашивает знакомство; потом — только переподписка на push.
                if !showOnboarding, await ReminderScheduler.shared.isAuthorized() {
                    await ReminderScheduler.shared.requestPermission()
                }
                await AppDelegate.upload()
            }
            .sheet(isPresented: $showOnboarding) { OnboardingView() }
            .fullScreenCover(isPresented: Binding(get: { focus.isRunning && focus.isPresented }, set: { focus.isPresented = $0 })) {
                FocusView()
            }
        } else {
            LoginView()
        }
    }
}

/// Заголовок экрана: крупно слева, «Ещё» справа на той же линии.
struct ScreenHeader: View {
    @Environment(AppRouter.self) private var router
    let title: String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(title)
                .font(Typeface.display(30))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Spacer(minLength: 0)
            Button { router.showSettings = true } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Palette.ink2)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Ещё")
            .padding(.trailing, -10)
        }
    }
}

/// Нижняя панель: «Сегодня» и «Все дела» одной сеткой; Илзи — лёгкая круглая кнопка рядом.
struct BottomBar: View {
    @Binding var tab: AppRouter.Tab
    let openIlzi: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            HStack(spacing: 2) {
                item("Сегодня", "sun.max", selected: tab == .today) { withAnimation(.snappy) { tab = .today } }
                item("Все дела", "checklist", selected: tab == .reserve) { withAnimation(.snappy) { tab = .reserve } }
            }
            .padding(.horizontal, 6)
            .frame(height: 62)
            .floatingPanel()

            Spacer(minLength: 12)

            Button(action: openIlzi) {
                Image("IlziMark")
                    .resizable()
                    .frame(width: 28, height: 28)
                    .foregroundStyle(Palette.goldText)
                    .frame(width: 58, height: 58)
                    .floatingPanel()
                    .overlay(Circle().strokeBorder(Palette.gold.opacity(0.55), lineWidth: 1))
            }
            .accessibilityLabel("Илзи")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    /// Одна сетка для всех кнопок: иконка в одинаковой рамке, подпись на одной линии.
    private func item(_ title: String, _ icon: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 19, weight: .regular))
                    .frame(width: 28, height: 24, alignment: .center)
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .frame(height: 13)
            }
            .frame(width: 80, height: 54)
            .foregroundStyle(selected ? Palette.goldText : Palette.ink3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
