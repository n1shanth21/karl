// Realistic UNC student listings + buyer phrasings, used by scripts/tune-matching.ts
// to pick LIMITS.matchThreshold / LIMITS.searchThreshold. Owner: Himagna (data branch).

export type CatalogItem = {
  key: string;
  title: string;
  category: string;
  description: string;
  priceCents: number;
};

export type QueryCase = {
  text: string;
  expectKey: string | null; // null = nothing in the catalog should match well
  mustNotMatch?: string[]; // keys that must score clearly below the right answer
};

export const CATALOG: CatalogItem[] = [
  { key: "mini-fridge", title: "Mini fridge", category: "appliances", priceCents: 5000,
    description: "Compact 3.2 cu ft dorm fridge with small freezer. Works great, keeps drinks and snacks cold. Pickup near Granville." },
  { key: "desk-lamp", title: "IKEA desk lamp", category: "furniture", priceCents: 1500,
    description: "Black IKEA LED desk lamp, adjustable arm. Perfect for late-night studying. Bulb included." },
  { key: "lamp-oil", title: "Lamp oil, 32 oz bottle", category: "other", priceCents: 800,
    description: "Clear paraffin lamp oil for oil lanterns and tiki torches. Mostly full bottle." },
  { key: "chem-101", title: "CHEM 101 textbook", category: "books", priceCents: 4500,
    description: "General Chemistry textbook used for CHEM 101 at UNC. Some highlighting, no torn pages." },
  { key: "math-231", title: "MATH 231 textbook", category: "books", priceCents: 4000,
    description: "Calculus textbook for MATH 231 (Calculus of Functions of One Variable II). Good condition." },
  { key: "bike", title: "Trek road bike", category: "bikes", priceCents: 12000,
    description: "Used 21-speed bike, great for getting around campus. Recently tuned up, tires are new." },
  { key: "bike-lock", title: "Kryptonite U-lock", category: "bikes", priceCents: 1800,
    description: "Heavy-duty U-lock with two keys. Keeps your bicycle safe at the bike racks." },
  { key: "microwave", title: "Microwave 700W", category: "appliances", priceCents: 2500,
    description: "Small white microwave, 0.7 cu ft. Heats up ramen and leftovers fast. Fits on a dorm shelf." },
  { key: "monitor", title: "24 inch Dell monitor", category: "electronics", priceCents: 6000,
    description: "1080p Dell computer monitor, 24 inch, HDMI and VGA inputs. Great second screen for a laptop." },
  { key: "hdmi-cable", title: "HDMI cable 6ft", category: "electronics", priceCents: 500,
    description: "6 foot HDMI cable, works with monitors, TVs and game consoles." },
  { key: "rug", title: "Gray area rug 5x7", category: "decor", priceCents: 3000,
    description: "Soft gray 5x7 area rug that fits a dorm or apartment bedroom. Spot clean only." },
  { key: "futon", title: "Black futon couch", category: "furniture", priceCents: 7500,
    description: "Folding futon that works as a couch or a bed. Sturdy metal frame with a black cushion." },
  { key: "coffee-maker", title: "Mr. Coffee 12-cup coffee maker", category: "appliances", priceCents: 1500,
    description: "Drip coffee machine with glass carafe and reusable filter. Brews a full pot in minutes." },
  { key: "keurig-pods", title: "Keurig K-cups, 40 pack", category: "food", priceCents: 1200,
    description: "Box of 40 assorted Keurig K-Cup coffee pods, medium and dark roast. Unopened." },
  { key: "ti-84", title: "TI-84 Plus graphing calculator", category: "electronics", priceCents: 6500,
    description: "Texas Instruments TI-84 Plus graphing calculator with cover. Needed for calculus and stats classes." },
  { key: "hoodie", title: "Carolina hoodie, size M", category: "clothing", priceCents: 2000,
    description: "Light blue UNC Tar Heels pullover hoodie, size medium. Worn a few times." },
  { key: "shower-caddy", title: "Shower caddy", category: "dorm essentials", priceCents: 700,
    description: "Mesh shower tote with handle for carrying toiletries to the communal bathroom." },
  { key: "desk-chair", title: "Ergonomic desk chair", category: "furniture", priceCents: 3500,
    description: "Rolling office chair with lumbar support and adjustable height. Comfortable for long study sessions." },
  { key: "standing-fan", title: "Standing fan", category: "appliances", priceCents: 2000,
    description: "Oscillating pedestal fan with three speeds. Keeps a hot dorm room cool." },
  { key: "air-purifier", title: "HEPA air purifier", category: "appliances", priceCents: 4000,
    description: "Small HEPA air purifier, good for allergies and pollen season. New filter installed." },
  { key: "string-lights", title: "LED string lights, 33ft", category: "decor", priceCents: 800,
    description: "Warm white fairy lights for decorating a dorm room or wall. Plug-in, 33 feet." },
  { key: "mattress-topper", title: "Twin XL mattress topper", category: "dorm essentials", priceCents: 3000,
    description: "3 inch memory foam topper that fits twin XL dorm beds. Makes the mattress much softer." },
];

export const QUERIES: QueryCase[] = [
  { text: "something to keep drinks cold", expectKey: "mini-fridge" },
  { text: "need a desk lamp under $20", expectKey: "desk-lamp", mustNotMatch: ["lamp-oil"] },
  { text: "graphing calculator for calc", expectKey: "ti-84" },
  { text: "chem textbook", expectKey: "chem-101" },
  { text: "something to sit on while studying", expectKey: "desk-chair" },
  { text: "cheap bike to get around campus", expectKey: "bike", mustNotMatch: ["bike-lock"] },
  { text: "something to make coffee", expectKey: "coffee-maker" },
  { text: "mini frige", expectKey: "mini-fridge" },
  { text: "lamp for my dorm desk", expectKey: "desk-lamp", mustNotMatch: ["lamp-oil"] },
  { text: "need to heat up my food", expectKey: "microwave" },
  { text: "second screen for my laptop", expectKey: "monitor" },
  { text: "cant sleep its so hot in my room", expectKey: "standing-fan" },
  { text: "calc 2 book", expectKey: "math-231" },
  { text: "unc sweatshirt", expectKey: "hoodie" },
  { text: "my mattress is so hard, anything to make it softer?", expectKey: "mattress-topper" },
  { text: "concert tickets", expectKey: null },
  { text: "used car", expectKey: null },
  { text: "macbook pro", expectKey: null },
];
