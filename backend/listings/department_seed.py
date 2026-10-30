"""Seed data for the shopper department tree (Plan M1, Task 4). Pure data: no model imports, so a data migration can
import it safely.

DEPARTMENTS lists the Amazon.com shop-by-department departments and their sub-categories, except Prime Video, Amazon
Music, Kindle E-readers & Books and Amazon Appstore (digital products AshantiHub does not sell). Each entry is
`(slug, label, icon, colour, [sub-category labels])`; a sub-category's slug is `sub_slug(department_slug, label)`.
The list order is the department seed order (`Category.sort_order`), which the "most visited" fallback uses.

OLD_TO_DEPARTMENT maps the product categories that existed before the tree (migrations 0002/0009/0020) to the
department each now sits under; see listings/migrations/0024_seed_departments_and_map.py for the documented table."""
from django.utils.text import slugify

EXCLUDED_DEPARTMENTS = ("Prime Video", "Amazon Music", "Kindle E-readers & Books", "Amazon Appstore")

DEPARTMENTS = [
    ("electronics", "Electronics", "📱", "#000080", [
        "Accessories & Supplies", "Camera & Photo", "Car & Vehicle Electronics", "Cell Phones & Accessories",
        "Headphones", "Home Audio", "Office Electronics", "Portable Audio & Video", "Security & Surveillance",
        "Television & Video", "Wearable Technology",
    ]),
    ("computers", "Computers", "💻", "#2E86AB", [
        "Computer Accessories & Peripherals", "Computer Components", "Computers & Tablets", "Data Storage",
        "External Components", "Laptop Accessories", "Monitors", "Networking Products", "Printers", "Tablet Accessories",
    ]),
    ("smart-home", "Smart Home", "🏠", "#4527A0", [
        "Smart Home Lighting", "Smart Locks & Entry", "Smart Plugs & Outlets", "Smart Speakers & Displays",
        "Smart Thermostats", "Security Cameras & Systems",
    ]),
    ("home-kitchen", "Home & Kitchen", "🍳", "#E8621A", [
        "Bath", "Bedding", "Furniture", "Home Décor", "Kitchen & Dining", "Storage & Organization",
        "Vacuums & Floor Care", "Heating, Cooling & Air Quality", "Irons & Steamers", "Event & Party Supplies",
    ]),
    ("appliances", "Appliances", "🧊", "#0277BD", [
        "Dishwashers", "Freezers & Ice Makers", "Ranges, Ovens & Cooktops", "Refrigerators", "Small Appliances",
        "Washers & Dryers", "Parts & Accessories",
    ]),
    ("beauty-personal-care", "Beauty & Personal Care", "💄", "#E91E8C", [
        "Fragrance", "Hair Care", "Makeup", "Nail Care", "Oral Care", "Personal Care", "Shave & Hair Removal",
        "Skin Care", "Tools & Accessories",
    ]),
    ("health-household", "Health & Household", "💊", "#2E8B57", [
        "Baby & Child Care", "Health Care", "Household Supplies", "Medical Supplies & Equipment",
        "Sexual Wellness", "Sports Nutrition", "Stationery & Gift Wrap", "Vitamins & Dietary Supplements",
        "Wellness & Relaxation",
    ]),
    ("grocery-gourmet-food", "Grocery & Gourmet Food", "🛒", "#6A0572", [
        "Beverages", "Breakfast Foods", "Canned, Jarred & Packaged Foods", "Dairy, Cheese & Eggs",
        "Fresh Produce", "Frozen", "Meat & Seafood", "Pantry Staples", "Snacks & Sweets",
    ]),
    ("baby", "Baby", "🍼", "#C2185B", [
        "Activity & Entertainment", "Apparel & Accessories", "Baby & Toddler Toys", "Baby Care", "Car Seats & Accessories",
        "Diapering", "Feeding", "Gifts", "Nursery", "Potty Training", "Strollers & Accessories",
    ]),
    ("toys-games", "Toys & Games", "🧸", "#F57F17", [
        "Action Figures & Statues", "Arts & Crafts", "Building Toys", "Dolls & Accessories", "Dress Up & Pretend Play",
        "Games", "Learning & Education", "Puzzles", "Stuffed Animals & Plush Toys", "Sports & Outdoor Play",
    ]),
    ("video-games", "Video Games", "🎮", "#4A4A6A", [
        "Accessories", "Consoles", "Legacy Systems", "PC Games", "PlayStation", "Nintendo", "Xbox",
    ]),
    ("womens-fashion", "Women's Fashion", "👗", "#CC0000", [
        "Clothing", "Shoes", "Jewelry", "Watches", "Handbags & Wallets", "Accessories",
    ]),
    ("mens-fashion", "Men's Fashion", "👔", "#000080", [
        "Clothing", "Shoes", "Jewelry", "Watches", "Accessories",
    ]),
    ("girls-fashion", "Girls' Fashion", "👚", "#E91E8C", [
        "Clothing", "Shoes", "Jewelry", "Watches", "Accessories", "School Uniforms",
    ]),
    ("boys-fashion", "Boys' Fashion", "👕", "#2E86AB", [
        "Clothing", "Shoes", "Jewelry", "Watches", "Accessories", "School Uniforms",
    ]),
    ("luggage", "Luggage", "🧳", "#8B4513", [
        "Backpacks", "Briefcases", "Carry-ons", "Duffel Bags", "Suitcases", "Travel Accessories",
    ]),
    ("sports-outdoors", "Sports & Outdoors", "⚽", "#006400", [
        "Athletic Clothing", "Camping & Hiking", "Cycling", "Exercise & Fitness", "Fan Shop", "Fishing",
        "Hunting & Shooting", "Outdoor Recreation", "Team Sports", "Water Sports",
    ]),
    ("automotive", "Automotive", "🚗", "#B8860B", [
        "Car Care", "Car Electronics & Accessories", "Exterior Accessories", "Interior Accessories", "Lights & Lighting",
        "Motorcycle & Powersports", "Oils & Fluids", "Replacement Parts", "Tires & Wheels", "Tools & Equipment",
    ]),
    ("tools-home-improvement", "Tools & Home Improvement", "🔧", "#F57F17", [
        "Building Supplies", "Electrical", "Hardware", "Kitchen & Bath Fixtures", "Light Bulbs", "Lighting & Ceiling Fans",
        "Measuring & Layout Tools", "Painting Supplies & Wall Treatments", "Power & Hand Tools", "Rough Plumbing",
        "Safety & Security",
    ]),
    ("patio-lawn-garden", "Patio, Lawn & Garden", "🌿", "#2E8B57", [
        "Gardening & Lawn Care", "Grills & Outdoor Cooking", "Outdoor Décor", "Outdoor Furniture", "Outdoor Lighting",
        "Pest Control", "Plants, Seeds & Bulbs", "Pools, Hot Tubs & Supplies", "Power Equipment",
    ]),
    ("pet-supplies", "Pet Supplies", "🐾", "#8B4513", [
        "Birds", "Cats", "Dogs", "Fish & Aquatic Pets", "Horses", "Reptiles & Amphibians", "Small Animals",
    ]),
    ("arts-crafts", "Arts, Crafts & Sewing", "🎨", "#C2185B", [
        "Beading & Jewelry Making", "Crafting", "Drawing & Painting Supplies", "Fabric", "Knitting & Crochet",
        "Model & Hobby Building", "Needlework", "Printmaking", "Scrapbooking & Stamping", "Sewing",
    ]),
    ("handmade", "Handmade Products", "🧵", "#B8860B", [
        "Clothing, Shoes & Accessories", "Home & Kitchen", "Jewelry", "Beauty & Grooming", "Toys & Games", "Artwork",
    ]),
    ("office-products", "Office Products", "📎", "#4A4A6A", [
        "Calendars, Planners & Personal Organizers", "Office & School Supplies", "Office Electronics",
        "Office Furniture & Lighting", "Paper", "Pens, Pencils & Writing Supplies", "Presentation Supplies",
    ]),
    ("industrial-scientific", "Industrial & Scientific", "🔬", "#000080", [
        "Abrasive & Finishing Products", "Cutting Tools", "Janitorial & Sanitation Supplies", "Lab & Scientific Products",
        "Material Handling", "Occupational Health & Safety", "Packaging & Shipping Supplies", "Power Transmission",
    ]),
    ("musical-instruments", "Musical Instruments", "🎸", "#4527A0", [
        "Amplifiers & Effects", "Band & Orchestra", "Drums & Percussion", "Guitars", "Keyboards & MIDI",
        "Live Sound & Stage", "Studio Recording Equipment", "Ukuleles, Mandolins & Banjos",
    ]),
    ("movies-tv", "Movies & TV", "🎬", "#CC0000", [
        "Blu-ray", "DVD", "Box Sets", "Children & Family", "Collectibles", "TV Series",
    ]),
    ("books", "Books", "📚", "#006400", [
        "Arts & Photography", "Biographies & Memoirs", "Business & Money", "Children's Books", "Cookbooks, Food & Wine",
        "History", "Literature & Fiction", "Religion & Spirituality", "Science & Math", "Textbooks",
    ]),
    ("software", "Software", "💿", "#2E86AB", [
        "Accounting & Finance", "Antivirus & Security", "Business & Office", "Design & Illustration",
        "Education & Reference", "Operating Systems", "Photography & Graphics", "Video",
    ]),
    ("collectibles-fine-art", "Collectibles & Fine Art", "🖼️", "#B8860B", [
        "Collectible Coins", "Collectibles", "Entertainment Collectibles", "Fine Art", "Sports Collectibles",
    ]),
]

# The product categories that existed before the tree, and the department each now sits under. Every key must be a
# product-kind category slug seeded by migrations 0002/0009/0020; every value a department slug above.
OLD_TO_DEPARTMENT = {
    "shops": "home-kitchen",
    "pharmacy": "health-household",
    "grocery": "grocery-gourmet-food",
    "beverages": "grocery-gourmet-food",
    "petrol": "automotive",
}


def sub_slug(department_slug, label):
    """The slug of a sub-category: its department's slug plus its slugified label, within the 50-character limit."""
    return f"{department_slug}-{slugify(label)}"[:50].rstrip("-")
