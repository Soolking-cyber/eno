import CoreLocation

// One-shot geolocation for the post wizard's "Use my current location" (web
// parity: post-wizard useMyLocation). Wraps CLLocationManager's delegate dance in
// a single `async` call: request WhenInUse permission if needed, then a single fix.
// MainActor-isolated (the delegate callbacks land here) and single-flight — one
// pending request at a time.
@MainActor
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    enum LocationError: Error { case denied, unavailable }

    private let manager = CLLocationManager()
    private var cont: CheckedContinuation<CLLocationCoordinate2D, Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    /// Resolve the device's coordinate, prompting for WhenInUse access on first use.
    /// Throws `.denied` if the user has refused location, `.unavailable` on failure.
    func current() async throws -> CLLocationCoordinate2D {
        // Single-flight: a second concurrent request is refused rather than clobbering
        // the in-flight continuation (which would leak it and never resume).
        if cont != nil { throw LocationError.unavailable }
        switch manager.authorizationStatus {
        case .denied, .restricted: throw LocationError.denied
        default: break
        }
        return try await withCheckedThrowingContinuation { c in
            cont = c
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .notDetermined: manager.requestWhenInUseAuthorization()  // → didChange → requestLocation
            default: finish(.failure(LocationError.denied))
            }
        }
    }

    // Delegate callbacks are `nonisolated` (CLLocationManagerDelegate is not actor-
    // isolated) but the manager was created on the main actor, so CoreLocation delivers
    // them on the main thread — assumeIsolated hops back onto our MainActor state safely.

    // Fires on the grant/deny that follows requestWhenInUseAuthorization (and once when
    // the delegate is first set — ignored while no request is pending).
    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        MainActor.assumeIsolated {
            guard cont != nil else { return }
            switch m.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: m.requestLocation()
            case .denied, .restricted: finish(.failure(LocationError.denied))
            default: break  // still .notDetermined — keep waiting for the prompt result
            }
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        MainActor.assumeIsolated {
            guard let coord = locs.last?.coordinate else { finish(.failure(LocationError.unavailable)); return }
            finish(.success(coord))
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        MainActor.assumeIsolated { finish(.failure(LocationError.unavailable)) }
    }

    private func finish(_ result: Result<CLLocationCoordinate2D, Error>) {
        guard let c = cont else { return }
        cont = nil
        c.resume(with: result)
    }
}
