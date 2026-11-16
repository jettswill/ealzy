import BackgroundTasks
import SwiftUI

@main
struct EalzyApp: App {
    static let refreshTaskId = "ru.ealzy.app.refresh"

    @State private var auth = AuthStore()
    @State private var tasks = TasksStore()
    @State private var chat = ChatStore()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        ReminderScheduler.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .environment(tasks)
                .environment(chat)
                .onOpenURL { auth.handleCallback($0) }
                .onReceive(NotificationCenter.default.publisher(for: .ealzyTasksChanged)) { _ in
                    Task { await tasks.load() }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active where auth.isSignedIn:
                Task { await tasks.load() }
            case .background:
                Self.scheduleRefresh()
            default:
                break
            }
        }
        // Дела, записанные через Telegram или сайт, тоже должны звенеть вовремя:
        // раз в какое-то время iOS будит приложение, и оно переставляет напоминания.
        .backgroundTask(.appRefresh(Self.refreshTaskId)) {
            Self.scheduleRefresh()
            guard Keychain.readToken() != nil,
                  let list: [EalzyTask] = try? await APIClient.shared.get("/tasks") else { return }
            await ReminderScheduler.shared.reschedule(for: list)
        }
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

    var body: some View {
        if auth.isSignedIn {
            TabView {
                TodayView()
                    .tabItem { Label("Сегодня", systemImage: "sun.max") }
                ChatView()
                    .tabItem { Label("Илзи", systemImage: "bubble.left.and.text.bubble.right") }
            }
            .task {
                await auth.refresh()
                await tasks.load()
                await ReminderScheduler.shared.requestPermission()
            }
        } else {
            LoginView()
        }
    }
}
