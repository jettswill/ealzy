import SwiftUI
import WidgetKit

/// Снимки виджета «день свободен / всё сделано» для проверки глазами в CI
/// (запуск с `-EalzyWidgetGallery`). Сам виджет в симуляторе не сфотографировать.
struct WidgetGallery: View {
    static var isOn: Bool { ProcessInfo.processInfo.arguments.contains("-EalzyWidgetGallery") }

    private static let full: WidgetSnapshot = {
        var s = WidgetSnapshot(updatedAt: Date(), headline: "", focus: [], next: [], quickCount: 0,
                               reserveCount: 19, nextEvent: nil, doneCount: 4)
        s.laterToday = [.init(id: "1", title: "Созвон с Пашей", meta: "19:00"),
                        .init(id: "2", title: "Ужин с Олей", meta: "21:00")]
        s.tomorrowEvents = [.init(id: "3", title: "Бокс", meta: "9:00"),
                            .init(id: "4", title: "Планёрка", meta: "12:00"),
                            .init(id: "5", title: "Стоматолог", meta: "17:30")]
        s.tomorrow = [.init(id: "6", title: "Забрать костюм из химчистки", meta: "завтра 18:00"),
                      .init(id: "7", title: "Оплатить интернет", meta: "завтра")]
        s.week = [.init(id: "8", title: "Купить Оле подарок", meta: "чт"),
                  .init(id: "9", title: "Поменять резину", meta: "пт")]
        s.overdueCount = 1
        s.somedayCount = 9
        return s
    }()

    /// Как переключатель страниц в настоящем виджете.
    private var dots: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle().fill(index == 0 ? Palette.goldText : Palette.ink3.opacity(0.4)).frame(width: 5, height: 5)
            }
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Palette.ink3)
        }
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(Palette.rule.opacity(0.5), in: Capsule())
    }

    private static let empty = WidgetSnapshot(updatedAt: Date(), headline: "", focus: [], next: [], quickCount: 0,
                                              reserveCount: 0, nextEvent: nil)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 16) {
                    tile(Self.full, .systemSmall, width: 170, height: 170)
                    tile(Self.empty, .systemSmall, width: 170, height: 170)
                }
                tile(Self.full, .systemMedium, width: 364, height: 170)
                tile(Self.full, .systemMedium, width: 364, height: 170, mode: .ahead)
                tile(Self.empty, .systemMedium, width: 364, height: 170)
                tile(Self.full, .systemLarge, width: 364, height: 382)
            }
            .padding(16)
        }
        .background(Color.gray.opacity(0.35))
    }

    private func tile(_ snapshot: WidgetSnapshot, _ family: WidgetFamily, width: CGFloat, height: CGFloat,
                      mode: FreeDayView.Mode = .rest) -> some View {
        FreeDayView(snapshot: snapshot, family: family, mode: mode, accessory: AnyView(dots))
            .padding(16)
            .frame(width: width, height: height)
            .background(Palette.ground, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}
