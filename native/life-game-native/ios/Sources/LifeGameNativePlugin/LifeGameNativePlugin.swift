import Capacitor
import CoreLocation
import Foundation

/// Ключі в UserDefaults, спільні з кодом застосунку (AppDelegate.swift): туди пишуть геозони й Siri.
enum SharedKeys {
    static let arrivals = "lifegame.arrivals"
    static let actions = "lifegame.actions"
    static let alarmIds = "lifegame.alarmIds"
}

/// Міст між грою (Angular) і iOS: місце зараз, геозони, приїзди й дії з Siri, справжній будильник.
@objc(LifeGameNativePlugin)
public class LifeGameNativePlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "LifeGameNativePlugin"
    public let jsName = "LifeGameNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlaces", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeArrivals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeActions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alarmSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAlarm", returnType: CAPPluginReturnPromise)
    ]

    private var manager: CLLocationManager?
    private var locationCalls: [CAPPluginCall] = []

    override public func load() {
        DispatchQueue.main.async {
            let manager = CLLocationManager()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            self.manager = manager
        }
    }

    // MARK: - місце зараз

    @objc func currentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let manager = self.manager else {
                call.reject("Геолокація ще не готова")
                return
            }
            self.locationCalls.append(call)
            switch manager.authorizationStatus {
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                self.failLocation("Немає дозволу на геолокацію", code: "1")
            default:
                manager.requestLocation()
            }
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !locationCalls.isEmpty else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            failLocation("Немає дозволу на геолокацію", code: "1")
        default:
            break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, !locationCalls.isEmpty else { return }
        let calls = locationCalls
        locationCalls = []
        for call in calls {
            call.resolve([
                "lat": location.coordinate.latitude,
                "lon": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy
            ])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        failLocation(error.localizedDescription, code: "2")
    }

    private func failLocation(_ message: String, code: String) {
        let calls = locationCalls
        locationCalls = []
        for call in calls { call.reject(message, code) }
    }

    // MARK: - геозони

    /// Замінює всі відстежувані місця. Події «приїхав» ловить AppDelegate навіть із закритою грою.
    @objc func setPlaces(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        let places = call.getArray("places", JSObject.self) ?? []
        DispatchQueue.main.async {
            guard let manager = self.manager else {
                call.reject("Геолокація ще не готова")
                return
            }
            for region in manager.monitoredRegions where region.identifier.hasPrefix("place.") {
                manager.stopMonitoring(for: region)
            }
            guard enabled, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
                call.resolve(["monitoring": 0, "always": false])
                return
            }
            if manager.authorizationStatus != .authorizedAlways {
                manager.requestAlwaysAuthorization()
            }
            var count = 0
            for place in places {
                guard let id = place["id"] as? String,
                      let lat = (place["lat"] as? NSNumber)?.doubleValue,
                      let lon = (place["lon"] as? NSNumber)?.doubleValue else { continue }
                let wanted = (place["radius"] as? NSNumber)?.doubleValue ?? 150
                let radius = min(max(wanted, 100), manager.maximumRegionMonitoringDistance)
                let region = CLCircularRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                    radius: radius,
                    identifier: "place.\(id)")
                region.notifyOnEntry = true
                region.notifyOnExit = false
                manager.startMonitoring(for: region)
                count += 1
            }
            call.resolve(["monitoring": count, "always": manager.authorizationStatus == .authorizedAlways])
        }
    }

    // MARK: - черги з AppDelegate

    @objc func takeArrivals(_ call: CAPPluginCall) {
        call.resolve(["arrivals": Self.take(SharedKeys.arrivals)])
    }

    @objc func takeActions(_ call: CAPPluginCall) {
        call.resolve(["actions": Self.take(SharedKeys.actions)])
    }

    private static func take(_ key: String) -> [[String: String]] {
        let defaults = UserDefaults.standard
        let list = defaults.array(forKey: key) as? [[String: String]] ?? []
        defaults.removeObject(forKey: key)
        return list
    }

    // MARK: - справжній будильник

    @objc func alarmSupported(_ call: CAPPluginCall) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            call.resolve(["supported": true])
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    @objc func setAlarm(_ call: CAPPluginCall) {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            let enabled = call.getBool("enabled") ?? false
            let hour = call.getInt("hour") ?? 7
            let minute = call.getInt("minute") ?? 30
            let title = call.getString("title") ?? "Час прокидатись!"
            Task {
                do {
                    try await WakeAlarm.apply(enabled: enabled, hour: hour, minute: minute, title: title)
                    call.resolve(["scheduled": enabled])
                } catch {
                    call.reject("Не вдалося поставити будильник: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("Справжній будильник потребує iOS 26")
    }
}
