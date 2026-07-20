package vn.eno.native_.core

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.graphics.vector.ImageVector

// Map the web's lucide icon names (taxonomy subcategory + category glyphs) to
// the closest OUTLINE material icon — line glyphs in the muted body tone, never
// filled black. Unknown → a neutral label icon so a chip always has a mark.
object LucideIcons {
    fun get(lucide: String?): ImageVector = lucide?.let { map[it] } ?: Icons.Outlined.LocalOffer

    // The 15 top-level category slugs → their taxonomy lucide names (taxonomy.ts).
    fun forCategory(slug: String): ImageVector = get(categoryLucide[slug])

    private val categoryLucide: Map<String, String> = mapOf(
        "vehicles" to "CarFront", "rentals" to "KeyRound", "property" to "Building2",
        "moving-sale" to "PackageOpen", "furniture-appliances" to "Sofa",
        "electronics" to "Smartphone", "fashion-beauty" to "Shirt", "baby-kids" to "Baby",
        "hobbies-sports" to "Dumbbell", "pets" to "PawPrint", "jobs" to "Briefcase",
        "services" to "Wrench", "community-events" to "UsersRound",
        "tickets-travel" to "Plane", "food-drink" to "UtensilsCrossed",
    )

    private val map: Map<String, ImageVector> = mapOf(
        // vehicles
        "Gauge" to Icons.Outlined.Speed, "Bike" to Icons.Outlined.DirectionsBike,
        "Car" to Icons.Outlined.DirectionsCar, "CarFront" to Icons.Outlined.DirectionsCar,
        "Zap" to Icons.Outlined.ElectricBolt, "Wrench" to Icons.Outlined.Build,
        "Truck" to Icons.Outlined.LocalShipping, "KeyRound" to Icons.Outlined.VpnKey,
        "Fuel" to Icons.Outlined.LocalGasStation, "Cog" to Icons.Outlined.Settings,
        // property / home
        "Building2" to Icons.Outlined.Apartment, "Home" to Icons.Outlined.Home,
        "Sofa" to Icons.Outlined.Chair, "BedDouble" to Icons.Outlined.Bed,
        "Refrigerator" to Icons.Outlined.Kitchen, "Lamp" to Icons.Outlined.Lightbulb,
        "Warehouse" to Icons.Outlined.Warehouse, "DoorOpen" to Icons.Outlined.MeetingRoom,
        // electronics
        "Smartphone" to Icons.Outlined.Smartphone, "Laptop" to Icons.Outlined.LaptopMac,
        "Monitor" to Icons.Outlined.DesktopWindows, "Headphones" to Icons.Outlined.Headphones,
        "Camera" to Icons.Outlined.PhotoCamera, "Gamepad2" to Icons.Outlined.SportsEsports,
        "Watch" to Icons.Outlined.Watch, "Tv" to Icons.Outlined.Tv, "Speaker" to Icons.Outlined.Speaker,
        "Tablet" to Icons.Outlined.Tablet, "Printer" to Icons.Outlined.Print, "Router" to Icons.Outlined.Router,
        // fashion / beauty
        "Shirt" to Icons.Outlined.Checkroom, "ShoppingBag" to Icons.Outlined.ShoppingBag,
        "Footprints" to Icons.Outlined.Hiking, "Gem" to Icons.Outlined.Diamond,
        "Glasses" to Icons.Outlined.Visibility, "Sparkles" to Icons.Outlined.AutoAwesome,
        // baby / kids
        "Baby" to Icons.Outlined.ChildCare, "ToyBrick" to Icons.Outlined.Toys, "Backpack" to Icons.Outlined.Backpack,
        // hobbies / sports
        "Dumbbell" to Icons.Outlined.FitnessCenter, "Music" to Icons.Outlined.MusicNote,
        "Book" to Icons.Outlined.MenuBook, "Palette" to Icons.Outlined.Palette,
        "Mountain" to Icons.Outlined.Terrain, "Trophy" to Icons.Outlined.EmojiEvents,
        "Guitar" to Icons.Outlined.MusicNote, "Tent" to Icons.Outlined.Cabin,
        // pets
        "PawPrint" to Icons.Outlined.Pets, "Dog" to Icons.Outlined.Pets, "Cat" to Icons.Outlined.Pets,
        "Fish" to Icons.Outlined.SetMeal, "Bird" to Icons.Outlined.FlutterDash,
        // jobs / services
        "Briefcase" to Icons.Outlined.Work, "GraduationCap" to Icons.Outlined.School,
        "Hammer" to Icons.Outlined.Handyman, "Paintbrush" to Icons.Outlined.FormatPaint,
        "Scissors" to Icons.Outlined.ContentCut, "Stethoscope" to Icons.Outlined.MedicalServices,
        // community / travel / food
        "UsersRound" to Icons.Outlined.Groups, "CalendarDays" to Icons.Outlined.CalendarMonth,
        "Plane" to Icons.Outlined.Flight, "Ticket" to Icons.Outlined.ConfirmationNumber,
        "Hotel" to Icons.Outlined.Hotel, "UtensilsCrossed" to Icons.Outlined.Restaurant,
        "Coffee" to Icons.Outlined.LocalCafe, "Cake" to Icons.Outlined.Cake, "Wine" to Icons.Outlined.WineBar,
        // generic
        "Package" to Icons.Outlined.Inventory2, "PackageOpen" to Icons.Outlined.Inventory2,
        "Tag" to Icons.Outlined.LocalOffer, "Grid" to Icons.Outlined.GridView,
        "Layers" to Icons.Outlined.Layers, "HelpCircle" to Icons.Outlined.HelpOutline,
    )
}
