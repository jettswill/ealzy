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
                .background(Palette.ground.ignoresSafeArea())
                .onChange(of: router.tab) { UISelectionFeedbackGenerator().selectionChanged() }

                BottomBar(tab: $router.tab) { router.openIlzi() }
            }
            .overlay(alignment: .topTrailing) {
                Button { router.showSettings = true } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(Palette.ink2)
                        .frame(width: 44, height: 44)
                        .floatingPanel()
                }
                .accessibilityLabel("Ещё")
                .padding(.trailing, 16)
                .padding(.top, 2)
            }
            .sheet(isPresented: $router.isIlziOpen) {
                IlziSheet(detent: $ilziDetent)
                    .presentationDetents([.medium, .large], selection: $ilziDetent)
                    .presentationDragIndicator(.visible)
                    .presentationCornerRadius(30)
                    .presentationBackground(Palette.raised)
            }
            .onChange(of: router.isIlziOpen) { if router.isIlziOpen { ilziDetent = .medium } }
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
            .fullScreenCover(isPresented: Binding(get: { focus.isRunning }, set: { if !$0 { focus.finish() } })) {
                FocusView()
            }
        } else {
            LoginView()
        }
    }
}

/// Нижняя панель: «Сегодня» и «Запас» слева, круглая золотая Илзи справа.
struct BottomBar: View {
    @Binding var tab: AppRouter.Tab
    let openIlzi: () -> Void

    var body: some View {
        HStack(alignment: .center) {
            HStack(spacing: 0) {
                item(.today, "Сегодня", "sun.max")
                item(.reserve, "Запас", "tray")
            }
            .padding(.horizontal, 6)
            .frame(height: 64)
            .floatingPanel()

            Spacer()

            Button(action: openIlzi) {
                Image("IlziMark")
                    .resizable()
                    .frame(width: 30, height: 30)
                    .foregroundStyle(Palette.goldInk)
                    .frame(width: 64, height: 64)
                    .background(Palette.gold, in: Circle())
                    .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
            }
            .accessibilityLabel("Илзи")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func item(_ value: AppRouter.Tab, _ title: String, _ icon: String) -> some View {
        Button {
            withAnimation(.snappy) { tab = value }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: icon).font(.system(size: 20, weight: .regular))
                Text(title).font(.system(size: 11, weight: .semibold))
            }
            .frame(width: 96, height: 56)
            .foregroundStyle(tab == value ? Palette.goldText : Palette.ink3)
        }
        .accessibilityLabel(title)
        .accessibilityAddTraits(tab == value ? .isSelected : [])
    }
}
