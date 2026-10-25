import datetime, json, os, sys, tempfile, unittest
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
import health, rank, restore_state

UTC = datetime.timezone.utc
NOW = datetime.datetime(2026, 10, 24, 12, 0, tzinfo=UTC)

def src(name, url, seen=None):
    return {"name": name, "url": url, "seen": (seen or NOW).isoformat()}

class RankTests(unittest.TestCase):
    def topic(self, sources, last=None, **kw):
        t = {"id": "x", "title": "Some Story", "sources": sources, "last_seen": (last or NOW).isoformat()}
        t.update(kw); return {"x": t}

    def test_three_queries_one_outlet_is_one_voice(self):
        T = self.topic([src("gnews-q:a", "https://news.google.com/rss/articles/1"),
                        src("gnews-q:b", "https://news.google.com/rss/articles/1b"),
                        src("gnews-q:c", "https://news.google.com/rss/articles/1c")])
        rank.apply(T, {}, NOW)
        self.assertEqual(T["x"]["kinds"], ["news"])
        self.assertFalse(T["x"]["confirmed"]); self.assertEqual(T["x"]["outlets"], 1)

    def test_two_outlets_two_kinds_confirmed(self):
        T = self.topic([src("gtrends-news:Parade", "https://parade.com/a"),
                        src("gtrends-news:Times", "https://fashiontimes.co.uk/b"),
                        src("google-trends", "https://trends.google.com/x")])
        rank.apply(T, {}, NOW)
        self.assertTrue(T["x"]["confirmed"])
        self.assertEqual(T["x"]["kinds"], ["news", "search"])

    def test_single_source_scaled_down(self):
        one = self.topic([src("hackernews", "https://a.com/1")]); rank.apply(one, {}, NOW)
        two = self.topic([src("hackernews", "https://a.com/1"), src("wikipedia-most-read", "https://en.wikipedia.org/wiki/X")])
        rank.apply(two, {}, NOW)
        self.assertLess(one["x"]["strength"], two["x"]["strength"])

    def test_old_sources_do_not_count(self):
        old = NOW - datetime.timedelta(hours=60)
        T = self.topic([src("hackernews", "https://a.com/1", old), src("wikipedia-most-read", "https://en.wikipedia.org/wiki/X", old)])
        rank.apply(T, {}, NOW)
        self.assertEqual(T["x"]["kinds"], [])

    def test_freshness_halves_every_18_hours(self):
        a = self.topic([src("hackernews", "https://a.com/1")], last=NOW); rank.apply(a, {}, NOW)
        b = self.topic([src("hackernews", "https://a.com/1")], last=NOW - datetime.timedelta(hours=18)); rank.apply(b, {}, NOW)
        self.assertAlmostEqual(b["x"]["strength_parts"]["freshness"], 0.5, places=2)

    def test_ritual_hashtag_is_demoted(self):
        a = self.topic([src("mastodon-trends", "https://mastodon.social/tags/a")], title="#Caturday"); rank.apply(a, {}, NOW)
        b = self.topic([src("mastodon-trends", "https://mastodon.social/tags/b")], title="#SomethingNew"); rank.apply(b, {}, NOW)
        self.assertTrue(a["x"]["ritual"]); self.assertFalse(b["x"]["ritual"])
        self.assertLess(a["x"]["strength"], b["x"]["strength"])

    def test_unmeasured_parts_are_named(self):
        T = self.topic([src("hackernews", "https://a.com/1")]); rank.apply(T, {}, NOW)
        self.assertEqual(T["x"]["strength_measured"], ["freshness", "support"])

    def test_persistence_measured_after_four_runs(self):
        hist = {"x": [[(NOW - datetime.timedelta(hours=h)).isoformat(), 50, 50] for h in (20, 14, 8, 2)],
                "y": [[(NOW - datetime.timedelta(hours=h)).isoformat(), 50, 50] for h in (20, 14, 8, 2, 1)]}
        T = self.topic([src("hackernews", "https://a.com/1")]); rank.apply(T, hist, NOW)
        self.assertIn("persistence", T["x"]["strength_measured"])

class HealthTests(unittest.TestCase):
    def test_state_machine(self):
        self.assertEqual(health.state_for("lane", 0), "live")
        self.assertEqual(health.state_for("lane", 1), "degraded")
        self.assertEqual(health.state_for("lane", 3), "degraded")
        self.assertEqual(health.state_for("lane", 4), "dead")
        self.assertEqual(health.state_for("retired", 9), "retired")
        self.assertEqual(health.state_for("design", 9), "by-design")

    def test_verdict(self):
        self.assertEqual(health.verdict(1), "fresh"); self.assertEqual(health.verdict(4), "fresh")
        self.assertEqual(health.verdict(5), "aging"); self.assertEqual(health.verdict(13), "stale")

    def test_gate_refuses_an_empty_run(self):
        fresh = {"board": {"topics": 408, "newestSighting": (NOW - datetime.timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ")},
                 "laneCounts": {"live": 2}, "generatedAt": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")}
        p = health.gate(fresh, {})
        self.assertEqual(len(p), 2)

    def test_gate_passes_a_good_run(self):
        fresh = {"board": {"topics": 408, "newestSighting": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")},
                 "laneCounts": {"live": 11}, "generatedAt": NOW.strftime("%Y-%m-%dT%H:%M:%SZ")}
        self.assertEqual(health.gate(fresh, {}), [])

    def test_lane_dies_after_four_misses_and_recovers(self):
        d = tempfile.mkdtemp(); health.OUT = d  # no files at all: every lane misses
        prev = {}
        for i in range(4):
            prev, rows = health.update_health(prev, NOW, NOW + datetime.timedelta(hours=3 * i))
        by = {r["id"]: r for r in rows}
        self.assertEqual(by["hn"]["state"], "dead"); self.assertEqual(by["tiktok"]["state"], "by-design")
        with open(os.path.join(d, "hn.json"), "w") as f:
            json.dump([{"title": "t", "fetched_at": (NOW + datetime.timedelta(hours=12)).isoformat()}], f)
        prev, rows = health.update_health(prev, NOW + datetime.timedelta(hours=12), NOW + datetime.timedelta(hours=12, minutes=1))
        self.assertEqual({r["id"]: r for r in rows}["hn"]["state"], "live")

class RestoreTests(unittest.TestCase):
    def test_rejects_small_or_older_store(self):
        old = {"generated_at": "2026-10-13T00:00:00+00:00", "topics": [{}] * 400}
        self.assertFalse(restore_state.acceptable("trends.json", {"generated_at": "2026-10-24T00:00:00+00:00", "topics": [{}] * 10}, old)[0])
        self.assertFalse(restore_state.acceptable("trends.json", {"generated_at": "2026-10-01T00:00:00+00:00", "topics": [{}] * 400}, old)[0])
        self.assertTrue(restore_state.acceptable("trends.json", {"generated_at": "2026-10-24T00:00:00+00:00", "topics": [{}] * 400}, old)[0])

if __name__ == "__main__":
    unittest.main()
