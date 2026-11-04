#if canImport(AlarmKit)
import AlarmKit
import Foundation
import SwiftUI

@available(iOS 26.0, *)
struct WakeMetadata: AlarmMetadata {}

@available(iOS 26.0, *)
enum WakeAlarmError: LocalizedError {
    case notAuthorized

    var errorDescription: String? { "Дозволь будильники для гри в Параметрах" }
}

/// Щоденний будильник через AlarmKit: дзвонить як «Годинник» — крізь беззвучний режим і фокус.
@available(iOS 26.0, *)
enum WakeAlarm {
    static func apply(enabled: Bool, hour: Int, minute: Int, title: String) async throws {
        let manager = AlarmManager.shared
        let defaults = UserDefaults.standard
        for value in defaults.stringArray(forKey: SharedKeys.alarmIds) ?? [] {
            if let id = UUID(uuidString: value) { try? manager.cancel(id: id) }
        }
        defaults.removeObject(forKey: SharedKeys.alarmIds)
        guard enabled else { return }

        guard try await manager.requestAuthorization() == .authorized else {
            throw WakeAlarmError.notAuthorized
        }
        // ініціалізатор зі stopButton є з iOS 26.0 (новіший без нього — лише в нових SDK)
        let alert = AlarmPresentation.Alert(
            title: LocalizedStringResource(stringLiteral: title),
            stopButton: AlarmButton(text: "Стоп", textColor: .white, systemImageName: "stop.circle"),
            secondaryButton: nil,
            secondaryButtonBehavior: nil)
        let attributes = AlarmAttributes(
            presentation: AlarmPresentation(alert: alert),
            metadata: WakeMetadata(),
            tintColor: Color(red: 0.23, green: 0.36, blue: 0.99))
        let everyDay: [Locale.Weekday] = [.monday, .tuesday, .wednesday, .thursday, .friday, .saturday, .sunday]
        let schedule = Alarm.Schedule.relative(.init(
            time: .init(hour: hour, minute: minute),
            repeats: .weekly(everyDay)))
        let id = UUID()
        let configuration = AlarmManager.AlarmConfiguration.alarm(schedule: schedule, attributes: attributes)
        _ = try await manager.schedule(id: id, configuration: configuration)
        defaults.set([id.uuidString], forKey: SharedKeys.alarmIds)
    }
}
#endif
