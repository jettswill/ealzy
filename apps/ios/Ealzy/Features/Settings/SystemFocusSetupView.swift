import SwiftUI

/// Разовая настройка: две Команды, которыми Ealzy включает и выключает режим фокуса iPhone.
struct SystemFocusSetupView: View {
    @Environment(\.openURL) private var openURL
    let focus = SystemFocus.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text("Режим фокуса iPhone")
                    .font(Typeface.display(28))
                    .foregroundStyle(Palette.ink)
                Text("Сам включить «Не беспокоить» приложению iOS не даёт, поэтому Ealzy просит об этом «Команды». "
                     + "Нужно один раз сделать две команды — минута дела. Потом при старте фокуса экран на секунду "
                     + "мигнёт «Командами» и вернётся в Ealzy.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)

                step(1, "Откройте «Команды» и нажмите «+».")
                step(2, "Добавьте действие «Включить/выключить фокусирование»: «Включить» → «Не беспокоить» "
                     + "(или свой режим, например «Работа») → «До выключения».")
                step(3, "Назовите команду точно: «\(SystemFocus.onShortcut)».")
                step(4, "Сделайте вторую так же, но с «Выключить», и назовите «\(SystemFocus.offShortcut)».")

                Button {
                    if let url = URL(string: "shortcuts://create-shortcut") { openURL(url) }
                } label: {
                    Text("Открыть «Команды»")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(Palette.gold, in: Capsule())
                        .foregroundStyle(Palette.goldInk)
                }

                Button { focus.test() } label: {
                    Text("Проверить — включить режим фокуса")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .overlay(Capsule().strokeBorder(Palette.rule))
                        .foregroundStyle(Palette.ink)
                }

                switch focus.lastResult {
                case .ok:
                    Label("Работает: режим фокуса включён. Сейчас выключите его в Пункте управления — дальше Ealzy будет делать это сама.", systemImage: "checkmark.circle")
                        .font(.footnote)
                        .foregroundStyle(Palette.goldText)
                case .missing(let name):
                    Label("Не нашёл команду «\(name)». Проверьте название — буква в букву.",
                          systemImage: "exclamationmark.triangle")
                        .font(.footnote)
                        .foregroundStyle(.red)
                case nil:
                    EmptyView()
                }

                Text("Для встреч iOS сама умеет: Настройки → Фокусирование → режим → «Добавить расписание» по времени. "
                     + "Включить фокус в момент начала встречи из календаря приложение не может — когда оно закрыто, "
                     + "iOS не даёт ему ничего запускать.")
                    .font(.footnote)
                    .foregroundStyle(Palette.ink3)
                    .padding(.top, 6)
            }
            .padding(24)
        }
        .background(Palette.raised.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ number: Int, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(number)")
                .font(.footnote.weight(.bold))
                .foregroundStyle(Palette.goldInk)
                .frame(width: 22, height: 22)
                .background(Palette.gold, in: Circle())
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
