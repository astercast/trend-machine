#!/usr/bin/env python3
"""Completeness wave seed (2026-10-15): the phenomena the board missed.

The 2026-10-15 completeness audit (research record:
fleet-ops/research-audits/trend-completeness-2026-10-15.md) probed
about 70 major 2025-2026 phenomena against the topic store and found
the consumer half of the internet missing: no food, product, beauty,
or health category existed at all, and sports held 10 topics against
entertainment's 71. These 15 topics are the misses that cleared the
house evidence bar (2+ real sources each, verified 2026-10-15 via
web research). Four open new categories: product, food, beauty,
health. Velocity (0-100) and saturation are editorial estimates per
the seed formula in PIPELINE.md; opportunity is computed, never
hand-written.

MERGE behavior: like pipeline/seed.py, this upserts by id and
preserves every existing topic. UNLIKE seed.py's main(), it preserves
the store's generated_at and generator exactly: generated_at is the
Live Wire's freshness anchor, and re-stamping it would relabel every
lane. The wave is appended to the store note instead.
"""
import json, os

WAVE_TS = "2026-10-15T15:12:00-07:00"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "trends.json")
NOTE = ("Completeness wave (2026-10-15): researched and verified "
        "2026-10-15 via web sources (2+ real sources per topic); "
        "corroborate on next pipeline refresh.")

def T(id, title, summary, category, platforms, hashtags, velocity, saturation,
      first_seen, sources, angles, hooks, who_to_watch, guide_links):
    pen = {"low": 0.0, "medium": 0.35, "high": 0.6}[saturation]
    return {
        "id": id, "title": title, "summary": summary, "category": category,
        "platforms": platforms, "hashtags": hashtags,
        "velocity": velocity, "saturation": saturation,
        "opportunity_score": round(velocity * (1 - pen)),
        "first_seen": first_seen, "last_seen": WAVE_TS,
        "seeded": True, "seed_note": NOTE,
        "verification": "verified",
        "sources": [{"name": n, "url": u} for n, u in sources],
        "angles": angles, "hooks": hooks, "who_to_watch": who_to_watch,
        "guide_links": guide_links,
        "format_family": None, "format_tags": [], "trend_type": "topic",
        "stale": False,
    }

topics = [
T("labubu-pop-mart", "Labubu and the Pop Mart blind box economy",
  "A palm sized plush elf from Pop Mart's The Monsters line became the defining consumer craze of 2025: blind boxes, bag charms, restock lines, and celebrity clips. Pop Mart's 2025 revenue rose 185 percent to 37.12 billion yuan with profit nearly tripling, and The Monsters alone brought in 34.7 percent of first half revenue. The board had no product category at all before this topic.",
  "product", ["tiktok", "instagram", "youtube"], ["#labubu", "#popmart", "#blindbox"], 84, "high",
  "2025-04-01T00:00:00-07:00",
  [("Finimize", "https://finimize.com/content/pop-marts-labubu-craze-powered-another-blowout-year"), ("AInvest", "https://www.ainvest.com/news/rise-pop-mart-mini-labubu-cultural-phenomenon-driving-retail-commerce-growth-2508/")],
  ["Why blind boxes print money: the Labubu formula in plain words", "The pull video as a format: what makes an opening work", "The dupe wave: Lafufu and the copycat economy"],
  ["The plush toy that outsold everything", "People line up at dawn for a keychain"],
  ["Pop Mart drop and restock trackers"], ["niche/positioning", "packaging/hooks"]),

T("jellycat-amuseables", "Jellycat Amuseables and the kidult plush economy",
  "London's Jellycat turned plush toys into an adult collectible economy: Amuseables (smiling food and objects with names and backstories), in store experiences where staff cook your plush at the FAO Schwarz diner or the Selfridges fish and chips shop, and designs that retire for good. Sales rose 43 percent to 450 million pounds in 2025 with profits nearly doubling, and adults buying for themselves drive the growth.",
  "product", ["tiktok", "instagram"], ["#jellycat", "#amuseables", "#kidult"], 76, "medium",
  "2024-06-01T00:00:00-07:00",
  [("The Sun", "https://www.thesun.co.uk/shopping/40618513/where-to-buy-jellycats/"), ("Yahoo Lifestyle", "https://y.gogonow.de/www.yahoo.com/lifestyle/article/a-4000-trip-for-a-75-plush-toy-pancake-inside-the-jellycat-diner-craze-174749971.html")],
  ["The experience is the product: Jellycat's retail theater, explained", "Kidult economics: why adults collect plush now", "Retired designs and the scarcity playbook"],
  ["A $75 plush pancake people fly in for", "The toy store adults took over"],
  ["Jellycat drop trackers and collector accounts"], ["niche/positioning", "audience/community"]),

T("dubai-chocolate", "Dubai chocolate: the pistachio bar that ate the internet",
  "A pistachio and knafeh filled chocolate bar from Dubai's FIX Dessert Chocolatier went viral in late 2023 and never really left: every major chocolate brand has since launched its own version, most recently Ghirardelli's Dubai style squares. The bar built a whole flavor lane of its own, pistachio cream everything, from lattes to ice cream sandwiches.",
  "food", ["tiktok", "instagram", "youtube"], ["#dubaichocolate", "#pistachio", "#knafeh"], 82, "high",
  "2023-12-01T00:00:00-08:00",
  [("Allrecipes", "https://www.allrecipes.com/ghirardelli-dubai-style-chocolate-squares-12173364"), ("VegNews", "https://vegnews.com/viral-dubai-chocolate-tiktok-dairy-free")],
  ["Every brand's Dubai bar, taste tested and ranked", "How one bar created a flavor: the pistachio cream economy", "Make it at home: the knafeh crunch, demystified"],
  ["The chocolate bar that broke the internet twice", "Pistachio cream is the new pumpkin spice"],
  ["FIX Dessert Chocolatier", "Snack and candy launch trackers"], ["niche/positioning", "packaging/hooks"]),

T("matcha-everything", "Matcha everything, and the shortage behind it",
  "Matcha moved from niche tea to the default cafe order, and demand hit supply: Japan's tencha leaf prices rose about 220 percent in 2025 as harvests tightened, cafes rationed ceremonial grade powder, and the shortage itself became content. Two trends in one: the drink, and the scarcity economy forming around it.",
  "food", ["tiktok", "instagram"], ["#matcha", "#matchalatte"], 80, "medium",
  "2024-09-01T00:00:00-07:00",
  [("Perfect Daily Grind", "https://perfectdailygrind.com/2026/07/what-is-the-problem-with-matcha/"), ("Grey Journal", "https://greyjournal.net/play/why-is-matcha-so-popular-2026")],
  ["Ceremonial vs culinary grade: what cafes are not telling you", "The shortage, explained: tencha, harvests, and 220 percent", "Matcha at home without the cafe price"],
  ["Your matcha is about to get more expensive", "The drink that outgrew its own farms"],
  ["Specialty tea importers and cafe accounts"], ["niche/positioning", "packaging/hooks"]),

T("protein-everything", "Protein everything: the protein maxxing era",
  "Protein became the headline nutrient of the decade: cottage cheese sales up 82 percent from 2022 to 2025 (Circana), protein sodas, protein coffee, protein chips, and protein maxxing as a named TikTok discipline with daily gram targets. A food trend you can measure in grocery scanner data, not just views.",
  "food", ["tiktok", "youtube", "instagram"], ["#protein", "#proteinmaxxing", "#cottagecheese"], 78, "medium",
  "2023-06-01T00:00:00-07:00",
  [("NorthJersey.com", "https://www.northjersey.com/story/news/bergen/2026/06/30/tiktok-protein-maxxing-trend-cottage-cheese-shortage/90659121007/"), ("Grainews", "https://www.grainews.ca/daily/cottage-cheese-surge-reflects-protein-demand/")],
  ["Protein maxxing, audited: what the targets actually require", "The cottage cheese comeback, in grocery data", "Every protein product launch this month, ranked by grams per dollar"],
  ["Cottage cheese is up 82 percent. Here is why", "The nutrient that ate the grocery store"],
  ["Grocery trend trackers (Circana reports)"], ["niche/positioning", "packaging/hooks"]),

T("kpop-demon-hunters", "KPop Demon Hunters: the animated takeover",
  "Netflix's animated KPop Demon Hunters (June 2025) became the platform's most popular film of all time, and the story kept growing into 2026: the soundtrack set an all time record for weeks at No. 1 on Billboard's soundtrack chart, and its song Golden spent eight weeks atop the Hot 100. A movie, a music act, and a fandom operating as one thing.",
  "entertainment", ["youtube", "tiktok", "instagram"], ["#kpopdemonhunters", "#golden", "#netflix"], 90, "medium",
  "2025-06-20T00:00:00-07:00",
  [("PR Newswire", "https://www.newswire.ca/news-releases/netflix-s-kpop-demon-hunters-is-coming-to-toca-boca-world-tm-this-october-818602999.html"), ("Billboard via Rockum", "https://www.rockumweb.com/reportes/2563/billboard-top-soundtracks-kpop-demon-hunters-sets-all-time-record-with-63-weeks-at-no-1")],
  ["How an animated film out-charted real pop stars", "The soundtrack strategy: songs written like a real group's comeback", "Fandom economics: games, merch, and a singing theater run"],
  ["The cartoon that beat every real pop star", "Netflix's biggest movie ever is animated"],
  ["Netflix film trackers", "Billboard chart watchers"], ["niche/entertainment", "niche/music"]),

T("chicken-jockey", "Chicken Jockey: the Minecraft Movie theater phenomenon",
  "A Minecraft Movie (April 2025) turned one shouted line into a theater ritual: crowds erupted at chicken jockey, theaters posted warnings, and clips of the chaos outran the film's own marketing. It opened to 157 million dollars in the US, the biggest opening ever for a video game movie, and finished near 958 million worldwide.",
  "entertainment", ["tiktok", "youtube", "x"], ["#chickenjockey", "#minecraftmovie"], 85, "high",
  "2025-04-04T00:00:00-07:00",
  [("Uproxx", "https://uproxx.com/movies/a-minecraft-movie-chicken-jockey-meme-explained/"), ("TheGamer", "https://www.thegamer.com/a-minecraft-movie-2025-united-states-box-office-report/")],
  ["The participatory screening: when audiences become the show", "Video game movies ranked by opening weekend", "Theater etiquette wars: the chicken jockey debate"],
  ["Two words that shut down movie theaters", "The meme that carried a billion dollar movie"],
  ["Box office trackers"], ["niche/entertainment", "packaging/hooks"]),

T("grow-a-garden", "Grow a Garden: the Roblox game that broke the record",
  "A gentle Roblox farming game became the biggest live game on Earth: Grow a Garden peaked at 22.3 million concurrent players on August 23, 2025, past Fortnite's all time mark, before a rival Roblox title (Steal a Brainrot) passed it that September. The biggest gaming stories now break inside Roblox, not on store shelves.",
  "gaming", ["youtube", "tiktok"], ["#growagarden", "#roblox"], 88, "medium",
  "2025-03-26T00:00:00-07:00",
  [("Wikipedia", "https://en.wikipedia.org/wiki/Grow_a_Garden"), ("Dexerto", "https://www.dexerto.com/roblox/record-breaking-roblox-game-grow-a-garden-is-heading-to-theaters-3280497/")],
  ["How a farming idle game beat every shooter on Earth", "The admin war event format: live spectacle inside a kids' game", "Roblox economics for people who still think it is a kids' app"],
  ["22 million people farmed at the same time", "The biggest game in the world costs nothing"],
  ["Roblox trend trackers (RoTrends)"], ["niche/gaming", "packaging/titles"]),
]

topics += [
T("switch-2", "Nintendo Switch 2: the fastest console launch ever",
  "The Switch 2 launch (June 2025) became the fastest selling home console launch in US history (Circana), and it kept the pace: 17.37 million units sold in during its first seven months, ahead of the original Switch's trajectory. Midnight lines, stock trackers, and launch bundles made hardware a content beat again.",
  "gaming", ["youtube", "tiktok", "x"], ["#switch2", "#nintendo"], 86, "medium",
  "2025-06-05T00:00:00-07:00",
  [("TechSpot", "https://www.techspot.com/news/111039-nintendo-switch-2-now-fastest-selling-home-console.html"), ("Video Games Chronicle", "https://www.videogameschronicle.com/news/nintendo-switch-2-sales-remain-well-ahead-of-switch-1-despite-a-softer-first-christmas-in-some-markets/")],
  ["Launch economics: how Switch 2 outran every console before it", "Stock tracker culture: the hunt as content", "Mario Kart World and the bundle strategy"],
  ["The fastest selling console in US history", "Nintendo did it again, faster"],
  ["Circana games reporting", "Nintendo sales trackers"], ["niche/gaming", "packaging/titles"]),

T("caitlin-clark-effect", "The Caitlin Clark effect: the WNBA's surge",
  "The WNBA's 2025 regular season was its most watched since 1998 (969,000 average viewers), and games featuring Caitlin Clark averaged about 1.26 million viewers, roughly 200 percent above games without her. One player bending an entire league's ratings, attendance, and franchise values is the sports business story of the decade so far.",
  "sports", ["youtube", "x", "tiktok"], ["#wnba", "#caitlinclark"], 84, "medium",
  "2024-04-01T00:00:00-07:00",
  [("SportsPro", "https://www.sportspro.com/insights/features/wnba-2025-season-review-tv-viewership-attendances-sponsorship-valuations/"), ("EssentiallySports", "https://www.essentiallysports.com/wnba-basketball-news-just-say-you-hate-caitlin-clark-award-winning-journalist-faces-backlash-over-fever-broadcast-comments/")],
  ["The Clark effect in numbers: ratings, sellouts, valuations", "What a rising league does with a once in a generation draw", "The Fever economy: one team's 273 percent valuation jump"],
  ["One player tripled a league's audience", "The most valuable rookie season in sports"],
  ["Front Office Sports", "WNBA ratings trackers"], ["niche/sports", "packaging/titles"]),

T("hyrox-fitness-racing", "HYROX and the fitness racing boom",
  "Fitness racing turned the workout into a spectator sport: HYROX participation went from about 570,000 athletes in the 2024/25 season toward a projected 1.5 million in 2025/26, with run clubs and hybrid training reshaping gym culture around it. The race is the content: standardized stations, a finish line photo, and a time to beat.",
  "sports", ["instagram", "tiktok", "youtube"], ["#hyrox", "#fitnessracing", "#runclub"], 80, "medium",
  "2024-09-01T00:00:00-07:00",
  [("SportsPro", "https://www.sportspro.com/features/finance-investment/hyrox-business-model-mass-participation-private-equity-investment/"), ("mindbodygreen", "https://www.mindbodygreen.com/articles/next-era-of-fitness-is-structured-social-and-competitive")],
  ["HYROX explained: eight stations, one clock, no surprises", "Why fitness went social and competitive at the same time", "Run clubs to race day: the participation funnel"],
  ["The workout became a sport with 1.5 million racers", "Gym class grew up and got a finish line"],
  ["HYROX race calendar", "Endurance sports business press"], ["niche/sports", "audience/community"]),

T("prediction-markets", "Prediction markets go mainstream",
  "Kalshi and Polymarket turned betting on events into a mainstream public signal: combined monthly volume grew from under 5 billion dollars in September 2025 to about 24 billion by April 2026 (Pew Research figures), and Kalshi sits in the US App Store top 15 free apps in the October 15, 2026 chart. News, sports, and culture now get priced in public, in real time.",
  "culture", ["x", "youtube"], ["#kalshi", "#polymarket", "#predictionmarkets"], 87, "medium",
  "2024-11-01T00:00:00-08:00",
  [("CoinLaw", "https://coinlaw.io/prediction-market-statistics/"), ("Blockonomi", "https://blockonomi.com/prediction-market-statistics-2026-kalshi-polymarket-and-the-numbers-behind-the-boom/")],
  ["What prediction markets got right that polls got wrong", "The market as a news source: reading Kalshi like a wire", "Sports books vs event markets: the turf war"],
  ["The crowd now prices the news live", "24 billion dollars a month on maybes"],
  ["Kalshi and Polymarket public dashboards"], ["niche/positioning", "packaging/hooks"]),

T("glp1-era", "The GLP-1 era: weight loss drugs as culture",
  "GLP-1 drugs (Ozempic, Wegovy, Zepbound) became a cultural force, not just a medical one: about 12 percent of US adults say they have taken one, 11 percent are currently taking one for weight loss (Gallup), and awareness sits above 90 percent. Food brands, gyms, airlines, and fashion are all quietly repricing around them.",
  "health", ["tiktok", "youtube", "instagram"], ["#glp1", "#ozempic", "#wegovy"], 81, "medium",
  "2023-01-01T00:00:00-08:00",
  [("Pew Research Center", "https://pewresearch.org/short-reads/2026/01/23/6-facts-about-obesity-and-weight-loss-drugs-in-the-u-s/"), ("Gizmodo", "https://gizmodo.com/11-of-americans-are-currently-taking-a-glp-1-weight-loss-drug-like-wegovy-2000782666")],
  ["The GLP-1 economy: who gains and who reprices", "Food after GLP-1: smaller portions, protein first", "What the surveys actually say, minus the hype"],
  ["One in nine adults is on one", "The drug class reshaping dinner"],
  ["Gallup and Pew health surveys"], ["niche/positioning", "packaging/hooks"]),

T("booktok-romantasy", "BookTok and the romantasy boom",
  "TikTok's BookTok community rebuilt publishing from the reading chair up: romantasy leads the boom, Rebecca Yarros's Fourth Wing was named Europe's BookTok bestseller of the year for 2026, and TikTok counts more than 50 million BookTok books sold across Europe in 2025 alone. Sprayed edges, midnight release parties, and backlist titles outselling new releases are the new normal.",
  "culture", ["tiktok", "instagram"], ["#booktok", "#romantasy", "#fourthwing"], 83, "medium",
  "2023-05-02T00:00:00-07:00",
  [("Parade", "https://parade.com/books/fourth-wing-most-read-book-of-2026-on-goodreads"), ("TikTok Newsroom via TikTok News Hub", "https://tiktoknewshub.com/news/booktok-bestseller-of-the-year-fourth-wing/")],
  ["The BookTok to bestseller pipeline, step by step", "Romantasy's tropes are a recommendation engine", "Sprayed edges and the physical book revival"],
  ["TikTok sells 50 million books a year now", "The genre that ate publishing"],
  ["BookTok creators", "Publishers Weekly bestseller data"], ["audience/community", "niche/positioning"]),

T("fragrance-boom", "The fragrance boom: FragranceTok, Arab perfumes, and dupes",
  "Fragrance became a Gen Z collecting culture: US mass market fragrance sales rose 17 percent in the first half of 2025 on the strength of dupe culture (Circana), UAE house Lattafa sold over 63 million dollars on US TikTok Shop in twelve months (Charm.io), and the fragrance wardrobe replaced the single signature scent.",
  "beauty", ["tiktok", "instagram"], ["#fragrancetok", "#perfumetok", "#lattafa"], 80, "medium",
  "2024-01-01T00:00:00-08:00",
  [("Scento", "https://www.scento.com/blog/perfume-dupe-market-statistics-2026"), ("Accio", "https://www.accio.com/business/hot-selling-lattafa-perfumes")],
  ["Dupe culture, audited: what buyers actually get", "Arab perfumes' Western breakout: oud goes mainstream", "The fragrance wardrobe: collecting scents like sneakers"],
  ["Perfume is the new sneaker drop", "A $25 scent outselling the $300 original"],
  ["FragranceTok creators", "WWD beauty market coverage"], ["niche/positioning", "packaging/hooks"]),
]


def main():
    ids = [t["id"] for t in topics]
    assert len(ids) == len(set(ids)), "duplicate ids in wave"
    with open(OUT) as f:
        store = json.load(f)
    existing = {t["id"] for t in store.get("topics", [])}
    collisions = existing & set(ids)
    assert not collisions, f"topic ids already in store: {collisions}"
    store["topics"] = store.get("topics", []) + topics
    store["note"] = (store.get("note") or "") + (
        " +15 completeness-wave seeds 2026-10-15 (the consumer-culture "
        "pass: product, food, beauty, and health categories opened; "
        "see fleet-ops research audit trend-completeness-2026-10-15).")
    # generated_at and generator are preserved exactly: generated_at is
    # the Live Wire freshness anchor (see module docstring).
    with open(OUT, "w") as f:
        json.dump(store, f, indent=2, ensure_ascii=False)
    print(f"[seed-completeness] +{len(topics)} topics -> {OUT} "
          f"(store now {len(store['topics'])}, generated_at preserved: "
          f"{store['generated_at']})")


if __name__ == "__main__":
    main()
