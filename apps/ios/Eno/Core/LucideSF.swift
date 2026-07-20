import Foundation

// Map the web's lucide icon names (used for subcategory chips in the taxonomy)
// to the closest SF Symbol. Covers the subcategory set; unknown names fall back
// to a neutral tag glyph so a chip always has a mark.
enum LucideSF {
    static func symbol(_ lucide: String?) -> String {
        guard let lucide else { return "tag" }
        return map[lucide] ?? "tag"
    }

    private static let map: [String: String] = [
        // vehicles
        "Gauge": "gauge", "Bike": "bicycle", "Car": "car", "CarFront": "car",
        "Zap": "bolt", "Wrench": "wrench.and.screwdriver", "Truck": "truck.box",
        "KeyRound": "key", "Fuel": "fuelpump", "Cog": "gearshape",
        // property / rentals / home
        "Building2": "building.2", "Home": "house", "Sofa": "sofa", "BedDouble": "bed.double",
        "Refrigerator": "refrigerator", "Lamp": "lamp.desk", "Utensils": "fork.knife",
        "Warehouse": "building.columns", "DoorOpen": "door.left.hand.open",
        // electronics
        "Smartphone": "iphone", "Laptop": "laptopcomputer", "Monitor": "display",
        "Headphones": "headphones", "Camera": "camera", "Gamepad2": "gamecontroller",
        "Watch": "applewatch", "Tv": "tv", "Speaker": "hifispeaker", "Tablet": "ipad",
        "HardDrive": "internaldrive", "Printer": "printer", "Router": "wifi.router",
        // fashion / beauty
        "Shirt": "tshirt", "ShoppingBag": "bag", "Footprints": "shoe", "Watch2": "applewatch",
        "Gem": "sparkles", "Glasses": "eyeglasses", "Sparkles": "sparkles",
        // baby / kids
        "Baby": "figure.child", "ToyBrick": "square.grid.3x3", "Backpack": "backpack",
        // hobbies / sports
        "Dumbbell": "dumbbell", "Music": "music.note", "Book": "book",
        "Palette": "paintpalette", "Mountain": "mountain.2", "Bike2": "bicycle",
        "Trophy": "trophy", "Guitar": "guitars", "Tent": "tent",
        // pets
        "PawPrint": "pawprint", "Dog": "dog", "Cat": "cat", "Fish": "fish", "Bird": "bird",
        // jobs / services
        "Briefcase": "briefcase", "GraduationCap": "graduationcap", "Hammer": "hammer",
        "Paintbrush": "paintbrush", "Sparkle": "sparkles", "Scissors": "scissors",
        "Stethoscope": "stethoscope", "Truck2": "truck.box", "Laptop2": "laptopcomputer",
        // community / travel / food
        "UsersRound": "person.3", "CalendarDays": "calendar", "Plane": "airplane",
        "Ticket": "ticket", "Hotel": "bed.double", "UtensilsCrossed": "fork.knife",
        "Coffee": "cup.and.saucer", "Cake": "birthday.cake", "Wine": "wineglass",
        // generic
        "Package": "shippingbox", "PackageOpen": "shippingbox", "Tag": "tag",
        "Grid": "square.grid.2x2", "Layers": "square.stack.3d.up", "MoreHorizontal": "ellipsis",
        "HelpCircle": "questionmark.circle",
    ]
}
