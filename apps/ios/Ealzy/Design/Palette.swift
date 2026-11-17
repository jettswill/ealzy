import SwiftUI
import UIKit

/// «Лампа»: тёплая темнота с золотом бренда и та же лампа днём — газетная бумага.
/// Каждый цвет сам переключается между светлой и тёмной темой.
enum Palette {
    static let ground = dynamic(light: 0xECEAE4, dark: 0x191714)
    static let raised = dynamic(light: 0xF6F5F1, dark: 0x24211C)
    static let ink = dynamic(light: 0x1A1814, dark: 0xF1EBDD)
    static let ink2 = dynamic(light: 0x4F4A40, dark: 0xC2B9A6)
    static let ink3 = dynamic(light: 0x6A6457, dark: 0xA39A88)
    static let rule = dynamic(light: 0x1A1814, dark: 0xF1EBDD, alpha: 0.12)
    static let track = dynamic(light: 0x1A1814, dark: 0xF1EBDD, alpha: 0.10)
    /// Знак бренда: заливка главной кнопки и окна фокуса.
    static let gold = Color(hex: 0xD4BC82)
    /// Текст на золоте.
    static let goldInk = Color(hex: 0x1C1810)
    /// Золото как текст: на светлом фоне темнее, чтобы читалось.
    static let goldText = dynamic(light: 0x7A5E1C, dark: 0xD4BC82)
    /// Свет лампы над главным делом.
    static let pool = dynamic(light: 0xD4BC82, dark: 0xD4BC82, alphaLight: 0.42, alphaDark: 0.30)
    static let pill = dynamic(light: 0xFFFFFF, dark: 0xF1EBDD, alphaLight: 0.86, alphaDark: 0.16)
    static let pillPast = dynamic(light: 0xFFFFFF, dark: 0xF1EBDD, alphaLight: 0.45, alphaDark: 0.12)

    /// Полоса дня 8:00–23:00: рассвет, день, закат, ночь.
    static func lane(_ scheme: ColorScheme) -> LinearGradient {
        let stops: [(Double, UInt32)] = scheme == .dark
            ? [(0, 0x5A4632), (0.18, 0x4A4334), (0.55, 0x463F31), (0.82, 0x5E4129), (1, 0x26222E)]
            : [(0, 0xE8C9A3), (0.18, 0xEADFC6), (0.55, 0xE6DCC4), (0.82, 0xD9A877), (1, 0x5B5266)]
        return LinearGradient(
            stops: stops.map { .init(color: Color(hex: $0.1), location: $0.0) },
            startPoint: .leading, endPoint: .trailing
        )
    }

    private static func dynamic(
        light: UInt32, dark: UInt32, alpha: CGFloat = 1,
        alphaLight: CGFloat? = nil, alphaDark: CGFloat? = nil
    ) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark, alpha: alphaDark ?? alpha)
                : UIColor(hex: light, alpha: alphaLight ?? alpha)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(UIColor(hex: hex))
    }
}

/// Шрифты «Лампы»: New York для главного, SF Pro для всего остального.
enum Typeface {
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .semibold, design: .serif) }
}

/// Оформление: как в iPhone (по умолчанию), светлое или тёмное.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark
    static let storageKey = "appearance"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: return "Как в iPhone"
        case .light: return "Светлая"
        case .dark: return "Тёмная"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

/// Мягкая подложка «под стекло» для плавающих панелей.
struct FloatingPanel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: Capsule())
            .background(Palette.raised.opacity(0.55), in: Capsule())
            .overlay(Capsule().strokeBorder(Palette.rule, lineWidth: 0.5))
            .shadow(color: .black.opacity(0.10), radius: 12, y: 6)
    }
}

extension View {
    func floatingPanel() -> some View { modifier(FloatingPanel()) }
}
