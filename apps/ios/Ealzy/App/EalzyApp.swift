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
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(tasks)
                .environment(chat)
                .environment(calendar)
                .environment(router)
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
    @State private var showOnboarding = !UserDefaults.standard.bool(forKey: OnboardingView.doneKey)

    var body: some View {
        @Bindable var router = router
        if auth.isSignedIn {
            TabView(selection: $router.tab) {
                TodayView()
                    .tabItem { Label("Сегодня", systemImage: "sun.max") }
                    .tag(AppRouter.Tab.today)
                ChatView()
                    .tabItem { Label("Илзи", systemImage: "bubble.left.and.text.bubble.right") }
                    .tag(AppRouter.Tab.chat)
                SettingsView()
                    .tabItem { Label("Ещё", systemImage: "gearshape") }
                    .tag(AppRouter.Tab.settings)
            }
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
        } else {
            LoginView()
        }
    }
}
