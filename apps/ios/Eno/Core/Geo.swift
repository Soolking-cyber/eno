import Foundation
import CoreLocation

// Plottable coordinates for a listing — a bit-for-bit port of web src/lib/geo.ts.
// Prefer the stored lat/lng; otherwise a deterministic district-centroid + an
// id-hash jitter so every listing has a stable, spread-out point on the map.
enum Geo {
    static func coordinates(_ l: ListingCard) -> CLLocationCoordinate2D {
        if let lat = l.lat, let lng = l.lng {
            return CLLocationCoordinate2D(latitude: lat, longitude: lng)
        }
        let city = l.city.lowercased()
        let district = (l.district ?? "").lowercased()
        var baseLat = 10.7769, baseLng = 106.7009 // HCMC center

        if city.contains("hanoi") || city.contains("hà nội") {
            baseLat = 21.0285; baseLng = 105.8542
            if district.contains("tay ho") || district.contains("tây hồ") { baseLat = 21.0718; baseLng = 105.8152 }
            else if district.contains("hoan kiem") || district.contains("hoàn kiếm") { baseLat = 21.0285; baseLng = 105.8522 }
            else if district.contains("cau giay") || district.contains("cầu giấy") { baseLat = 21.0264; baseLng = 105.7977 }
        } else if city.contains("danang") || city.contains("đà nẵng") {
            baseLat = 16.0471; baseLng = 108.2068
            if district.contains("son tra") || district.contains("sơn trà") { baseLat = 16.0820; baseLng = 108.2435 }
            else if district.contains("ngu hanh son") || district.contains("ngũ hành sơn") { baseLat = 16.0279; baseLng = 108.2494 }
            else if district.contains("hai chau") || district.contains("hải châu") { baseLat = 16.0594; baseLng = 108.2199 }
        } else {
            if district.contains("district 2") || district.contains("thao dien") || district.contains("quận 2") { baseLat = 10.8016; baseLng = 106.7368 }
            else if district.contains("binh thanh") || district.contains("bình thạnh") { baseLat = 10.7981; baseLng = 106.7061 }
            else if district.contains("district 1") || district.contains("quận 1") { baseLat = 10.7769; baseLng = 106.7009 }
            else if district.contains("district 7") || district.contains("phu my hung") || district.contains("quận 7") { baseLat = 10.7226; baseLng = 106.7271 }
        }

        // charCodeAt-sum hash (ids are ASCII cuids → unicodeScalars matches JS).
        let idHash = l.id.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        let latOffset = Double((idHash % 20) - 10) * 0.0009
        let lngOffset = Double(((idHash >> 2) % 20) - 10) * 0.0009
        return CLLocationCoordinate2D(latitude: baseLat + latOffset, longitude: baseLng + lngOffset)
    }
}
