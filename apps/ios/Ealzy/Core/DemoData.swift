import EventKit
import Foundation

/// Демо-режим для скриншотов в CI (`-EalzyDemo`): без сервера и без доступа к календарю.
/// В обычном запуске не включается.
enum DemoData {
    static let isOn = ProcessInfo.processInfo.arguments.contains("-EalzyDemo")

    private static func at(_ minutesFromNow: Int) -> Date {
        Date().addingTimeInterval(TimeInterval(minutesFromNow * 60))
    }

    static var tasks: [EalzyTask] {
        let cal = Calendar.current
        let tomorrowNoonish = cal.date(bySettingHour: 12, minute: 1, second: 0,
                                       of: cal.date(byAdding: .day, value: 1, to: Date())!)!
        let today = DueClock.dateOnly(Date())
        func task(_ id: String, _ title: String, due: Date?, estimate: Int? = nil,
                  importance: Int = 3, urgency: Int = 3, assignee: String = "user") -> EalzyTask {
            EalzyTask(id: id, title: title, description: nil, status: "todo", dueAt: due,
                      estimateMinutes: estimate, importance: importance, urgency: urgency,
                      kind: "task", assignee: assignee, completedAt: nil, createdAt: nil)
        }
        var list = [
            task("f", "Дописать смету для «Северного двора»", due: tomorrowNoonish, estimate: 90, importance: 5, urgency: 5),
            task("q1", "Оплатить интернет, 790 ₽", due: today, estimate: 5),
            task("q2", "Ответить Ире про субботу", due: today, estimate: 3),
            task("o1", "Вернуть книгу в библиотеку", due: cal.date(byAdding: .day, value: -2, to: today)),
            task("i1", "Подобрать билеты в Казань на 28-е", due: nil, assignee: "ealzy"),
        ]
        let reserve = ["Купить Оле подарок", "Поменять резину", "Записаться к стоматологу", "Разобрать почту",
                       "Продлить страховку", "Найти химчистку", "Позвонить бабушке", "Обновить резюме",
                       "Починить полку", "Сдать показания счётчиков", "Посмотреть курсы английского",
                       "Выбрать подарок Паше", "Заказать фильтры для воды", "Разобрать фото"]
        for (i, title) in reserve.enumerated() {
            list.append(task("r\(i)", title, due: i < 4 ? cal.date(byAdding: .day, value: i + 2, to: today) : nil))
        }
        return list
    }

    static func events(store: EKEventStore) -> [EKEvent] {
        func event(_ title: String, from: Int, minutes: Int, location: String? = nil) -> EKEvent {
            let e = EKEvent(eventStore: store)
            e.title = title
            e.startDate = at(from)
            e.endDate = at(from + minutes)
            e.location = location
            return e
        }
        return [
            event("Бокс", from: -107, minutes: 90, location: "Зал на Тверской"),
            event("Созвон с Пашей", from: 193, minutes: 45),
            event("Ужин с Олей", from: 480, minutes: 120, location: "Хачапурная на Покровке"),
        ].filter { Calendar.current.isDateInToday($0.startDate) }
    }

    static var messages: [ChatMessage] {
        [
            ChatMessage(id: "m1", role: "user", content: "в пятницу забрать костюм из химчистки, и надо что-то Оле на субботу", createdAt: at(-3)),
            ChatMessage(id: "m2", role: "assistant", content: "Пятница, 18:00 — забрать костюм. Химчистка на Сретенке до 20:00.\n\nВ субботу у Оли день рождения. Ты в марте говорил, что она любит ранункулюсы и терпеть не может розы.\n\nНайти доставку ранункулюсов на субботу к 12:00?", createdAt: at(-2)),
        ]
    }
}
