import Foundation

// Map the web's lucide icon names (subcategory chips in the taxonomy) to the closest SF
// Symbol. The API sends an icon for ALL 101 subcategories, but this table only covered a
// fraction, so most chips fell through to the neutral "tag" glyph (owner: "most subcats
// don't have icons"). It now covers every name the live /api/categories payload emits.
//
// Only long-standing SF Symbols are used, so nothing renders as a blank box on iOS 17.
// When adding a taxonomy row on the web, add its lucide name here too.
enum LucideSF {
    static func symbol(_ lucide: String?) -> String {
        guard let lucide else { return "tag" }
        return map[lucide] ?? "tag"
    }

    private static let map: [String: String] = [
        // ── vehicles ──
        "Car": "car", "CarFront": "car", "Bike": "bicycle", "BusFront": "bus",
        "Truck": "truck.box", "Gauge": "gauge", "Zap": "bolt", "Fuel": "fuelpump",
        "Wrench": "wrench.and.screwdriver", "Cog": "gearshape", "KeyRound": "key",

        // ── property / rentals ──
        "Building": "building", "Building2": "building.2", "House": "house",
        "Hotel": "bed.double", "BedDouble": "bed.double", "BedSingle": "bed.double",
        "Warehouse": "building.columns", "DoorOpen": "door.left.hand.open",
        "LandPlot": "map", "Map": "map", "Store": "bag",

        // ── home & furniture ──
        "Sofa": "sofa", "Armchair": "sofa", "Table": "square.grid.2x2",
        "Lamp": "lamp.desk", "LampDesk": "lamp.desk", "Refrigerator": "refrigerator",
        "WashingMachine": "washer", "CookingPot": "fork.knife", "Utensils": "fork.knife",
        "UtensilsCrossed": "fork.knife", "BrushCleaning": "sparkles", "Boxes": "shippingbox",
        "Archive": "archivebox", "Package": "shippingbox", "PackageOpen": "shippingbox",
        "PackageSearch": "shippingbox",

        // ── electronics ──
        "Smartphone": "iphone", "TabletSmartphone": "ipad.and.iphone", "Tablet": "ipad",
        "Laptop": "laptopcomputer", "Monitor": "display", "TvMinimal": "tv", "Tv": "tv",
        "Headphones": "headphones", "Headset": "headphones", "Speaker": "hifispeaker",
        "Camera": "camera", "Gamepad2": "gamecontroller", "Watch": "applewatch",
        "HardDrive": "internaldrive", "Printer": "printer", "Router": "wifi.router",
        "Cable": "cable.connector", "Code": "chevron.left.forwardslash.chevron.right",

        // ── fashion & beauty ──
        "Shirt": "tshirt", "ShoppingBag": "bag", "ShoppingBasket": "basket",
        "Footprints": "shoeprints.fill", "Glasses": "eyeglasses", "Gem": "sparkles",
        "Sparkles": "sparkles", "Mars": "figure.stand", "Venus": "figure.dress.line.vertical.figure",
        "Stamp": "seal",

        // ── baby & kids ──
        "Baby": "figure.child", "Milk": "drop", "ToyBrick": "square.grid.3x3",
        "Backpack": "backpack", "Shapes": "square.on.circle",

        // ── hobbies & sports ──
        "Dumbbell": "dumbbell", "BicepsFlexed": "figure.strengthtraining.traditional",
        "Volleyball": "figure.volleyball", "Guitar": "guitars", "Music": "music.note",
        "Book": "book", "BookOpen": "book", "Palette": "paintpalette",
        "Mountain": "mountain.2", "Tent": "tent", "Trophy": "trophy", "Dices": "die.face.5",

        // ── pets ──
        "PawPrint": "pawprint", "Dog": "dog", "Cat": "cat", "Fish": "fish", "Bird": "bird",
        "Bone": "pawprint", "Flower2": "leaf", "Sprout": "leaf",

        // ── jobs & services ──
        "Briefcase": "briefcase", "GraduationCap": "graduationcap", "Hammer": "hammer",
        "HardHat": "hammer", "Paintbrush": "paintbrush", "Scissors": "scissors",
        "Stethoscope": "stethoscope", "Languages": "globe",
        "Presentation": "chart.bar.doc.horizontal", "ClipboardList": "list.clipboard",
        "Megaphone": "megaphone", "ConciergeBell": "bell",
        "HandHeart": "hand.raised", "HeartHandshake": "heart", "Heart": "heart",

        // ── community, travel & food ──
        "UsersRound": "person.3", "CalendarDays": "calendar",
        "MessagesSquare": "bubble.left.and.bubble.right",
        "PlaneTakeoff": "airplane.departure", "Plane": "airplane",
        "Ticket": "ticket", "TicketPercent": "ticket",
        "Coffee": "cup.and.saucer", "Cookie": "birthday.cake", "Cake": "birthday.cake",
        "Salad": "leaf", "Wine": "wineglass",

        // ── generic ──
        "Tag": "tag", "Grid": "square.grid.2x2", "Layers": "square.stack.3d.up",
        "MoreHorizontal": "ellipsis", "HelpCircle": "questionmark.circle",
    ]
}
