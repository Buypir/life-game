import AppIntents
import Capacitor
import CoreLocation
import UIKit
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // iOS будить застосунок у фоні, коли ти заходиш у збережене місце, — слухач має бути готовий одразу.
        ArrivalWatcher.shared.start()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}


// MARK: - Спільні черги (читає LifeGameNativePlugin, ключі ті самі)

enum SharedQueue {
    static let arrivals = "lifegame.arrivals"
    static let actions = "lifegame.actions"

    static func append(_ key: String, _ item: [String: String]) {
        let defaults = UserDefaults.standard
        var list = defaults.array(forKey: key) as? [[String: String]] ?? []
        list.append(item)
        defaults.set(Array(list.suffix(100)), forKey: key)
    }

    static func now() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}

// MARK: - Приїзди в збережені місця (геозони працюють і з закритою грою)

final class ArrivalWatcher: NSObject, CLLocationManagerDelegate {
    static let shared = ArrivalWatcher()
    private let manager = CLLocationManager()

    func start() {
        manager.delegate = self
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix("place.") else { return }
        let place = String(region.identifier.dropFirst("place.".count))
        SharedQueue.append(SharedQueue.arrivals, ["place": place, "at": SharedQueue.now()])

        let content = UNMutableNotificationContent()
        content.title = Self.titles[place] ?? "Герой на місці"
        content.body = "Поїздку зараховано. Відкрий гру, щоб забрати XP."
        content.sound = .default
        content.userInfo = ["screen": "today"]
        let request = UNNotificationRequest(identifier: "arrive-\(place)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    private static let titles = [
        "home": "Герой удома",
        "office": "Герой в офісі",
        "gym": "Герой у спортзалі"
    ]
}

// MARK: - Siri, Spotlight, кнопка дії: «Відмітити справу»

enum GameTask: String, AppEnum {
    case wake, brush, wash, breakfast, work, study, workout, dinner, plan, sleep, embedded
    case brushEvening = "brush-evening"
    case gymWorkout = "gym-workout"
    case dateWalk = "date-walk"
    case dateDinner = "date-dinner"

    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Справа" }

    static var caseDisplayRepresentations: [GameTask: DisplayRepresentation] {
        [
            .wake: "Прокинувся",
            .brush: "Почистив зуби",
            .wash: "Вмився",
            .breakfast: "Поснідав",
            .work: "Попрацював",
            .study: "Повчився",
            .workout: "Розминка",
            .dinner: "Повечеряв",
            .brushEvening: "Почистив зуби ввечері",
            .plan: "План на завтра",
            .sleep: "Лягаю спати",
            .embedded: "Вчив embedded",
            .gymWorkout: "Тренування в залі",
            .dateWalk: "Прогулянка з дівчиною",
            .dateDinner: "Вечеря з дівчиною"
        ]
    }
}

struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource { "Відмітити справу" }
    static var description: IntentDescription { IntentDescription("Зараховує справу в «Грі про життя».") }
    static var openAppWhenRun: Bool { false }

    @Parameter(title: "Справа")
    var task: GameTask

    func perform() async throws -> some IntentResult & ProvidesDialog {
        SharedQueue.append(SharedQueue.actions, ["action": task.rawValue, "at": SharedQueue.now()])
        return .result(dialog: "Готово! Герой отримає XP, щойно відкриєш гру.")
    }
}

struct LifeGameShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CompleteTaskIntent(),
            phrases: [
                "Mark \(\.$task) in \(.applicationName)",
                "\(.applicationName) \(\.$task)"
            ],
            shortTitle: "Відмітити справу",
            systemImageName: "checkmark.circle")
    }
}
