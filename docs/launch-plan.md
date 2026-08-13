# Hauddy Launch Plan

Distilled from brainstorming session. Last updated: 2026-08-11.

---

## Core Philosophy

**This is not a "launch day" — it's Operation: Founding 100.**

The goal for the first phase is not scale. It's recruiting the first 100 people who will genuinely shape the product. 20 who come back consistently beats 1,000 who disappear.

> "Build Barnaba first. Hauddy is the implementation. The Reducing Valve is the engine."

---

## Three Brands to Build in Parallel

| Brand | Role | Channel |
|---|---|---|
| **The Reducing Valve** | Ideas, long-form thinking, intellectual credibility | Newsletter, essays |
| **Barnaba** | Builder, engineer, AI architect | LinkedIn, podcasts, talks |
| **Hauddy** | The software, the community, the OSS project | GitHub, Discord, product |

Each reinforces the others. Content from The Reducing Valve attracts the exact audience who will value Hauddy without needing a hard sell.

**Immediate action:** Add a low-key footer to every Reducing Valve issue:
> *"Alongside these essays, I'm building Hauddy, an open-source communication network for AI agents. If you're interested in helping shape it, I'd love to hear from you."*

---

## Target Audience (Be Specific)

Not "developers." Not "AI enthusiasts." The first 100 are:

- AI engineers building multi-agent systems
- People experimenting with MCP servers
- LangGraph / AutoGen / CrewAI / LangChain builders
- OSS maintainers in the AI space
- AI consultants and solution architects
- Early AI startup founders

The narrower the target, the more efficient every outreach effort becomes.

---

## Channel Strategy

### Primary Channels (do these first)

**LinkedIn — personal profile only, not company page yet**
- Barnaba = Hauddy for the first 6 months; company pages get ignored at this stage
- Posting ratio: 80% lessons/building/engineering/AI thinking, 20% Hauddy
- Cadence: Mon (lesson learned), Wed (demo or technical insight), Fri (weekly progress)
- No marketing language. Stories, not ads.

**GitHub**
- The README matters more than follower count; people arrive via links, not followers
- Must have: good README, CONTRIBUTING.md, public roadmap, changelog, `good first issue` + `help wanted` tags, demo GIF/screenshots
- Enable Discussions; set up issue templates
- Structure as a GitHub Organization (`github.com/hauddy`)

**Discord**
- Name it "Hauddy Community" or "Hauddy Builders" — not "Hauddy Support"
- Channels focused on belonging, not just bug reports: `#introductions`, `#feature-ideas`, `#show-your-workflows`, `#weekly-build-log`, `#random`

**Reddit**
- Don't post "Here's my startup." Post "Here's what I learned building X."
- Target: r/MachineLearning, r/LocalLLaMA, r/LangChain, r/artificial, AI engineering communities
- A single genuine front-page post outperforms months of mediocre ones
- No karma needed; one genuinely useful post is enough

### Secondary Channels (reserve now, activate later)

- Hacker News: "Show HN" launch once you have polished README + working demo + interesting technical story
- Dev.to / Hashnode: technical deep-dives that teach something regardless of whether the reader uses Hauddy
- Developer Discords (LangChain, MCP ecosystem, Claude Code, OpenAI SDK communities): become a contributor first, mention Hauddy only when it genuinely helps

---

## Handle & Namespace Reservation

Do this immediately. Reserve `@hauddy` everywhere even if you won't post for months.

**Tier 1 — This week:**
- [ ] GitHub Organization (`github.com/hauddy`)
- [ ] LinkedIn Company Page (create but don't invest time posting)
- [ ] X / Twitter (`@hauddy`)
- [ ] Bluesky (`@hauddy`)
- [ ] Discord server + permanent invite link
- [ ] YouTube channel

**Tier 2 — Nice to have:**
- [ ] Reddit `u/hauddy`
- [ ] Dev.to
- [ ] Hashnode
- [ ] Medium
- [ ] Product Hunt maker profile (personal name)
- [ ] npm scope `@hauddy`
- [ ] Hugging Face organization
- [ ] Docker Hub organization

**Defensive domains to consider** (only if cheap): `hauddy.ai`, `hauddy.dev`

**Email aliases to set up** (all forward to you): `hello@`, `support@`, `security@`, `opensource@`

**Brand consistency rule:** Always "Hauddy" — never "HAUDDY", never "Hauddy AI", never "Hauddy Platform".

---

## The Founding 100 Program

Don't say "sign up." Say "apply to join."

Alpha users should feel like collaborators, not customers. Give them an identity:
- Title: **Founding Members** (or "Founding Operators" / "First Signal")
- They get: direct access to you, early access, influence over roadmap, recognition on website
- You get: design partners, not just users

Keep a table of the first 20–30:

| Name | Background | Why they joined | Last touch | Biggest pain point |
|---|---|---|---|---|

This is an advantage you lose as you scale — use it now.

---

## Budget Allocation (~€500 over 2 months)

| Spend | Amount | Why |
|---|---|---|
| Reddit promoted post | €150 | Validate messaging with a technical audience; educational framing, not promotional |
| Content assets (demo video, diagrams) | €100 | High-quality demos get reused everywhere and compound |
| Community experiments (office hours, small thank-yous for contributors) | €100 | Relationship-building beats impressions at this stage |
| Infrastructure, tools, analytics | €100 | Make the project feel professional |
| Buffer | €50 | Pour into what's working |

**Skip:** LinkedIn ads (too expensive per click for a technical audience), Google Search ads (no search intent for a new category).

---

## Content Strategy

### The core rule
> Every week must produce **one genuinely interesting thing** to share — a feature, a design breakthrough, a contributor story, a lesson, a surprising failure.

All content rotates around that one real achievement. Marketing stays authentic because it's always rooted in actual progress.

### Weekly rhythm

| Day | Post |
|---|---|
| Monday | Something learned building Hauddy |
| Wednesday | Short demo video or technical insight |
| Friday | Weekly "State of Hauddy" update |

### Weekly State of Hauddy (publish every Friday)
```
🚢 Hauddy — Week N

✅ ...
✅ ...
❌ Removed: ...
💡 Biggest lesson: ...

Next week:
- ...
```

Transparent and consistent. People start expecting it. Over a year it becomes an incredible story.

### Essay + Release pairing
Every significant Hauddy release can be paired with a Reducing Valve essay. The essay argues the idea; Hauddy is the evidence.

*Example:*
- Essay: "Coordination isn't communication."
- Release: "Hauddy v0.x introduces async negotiation between agents."

### The "Building Hauddy" frame
Don't launch Hauddy. Launch *Building Hauddy*. Posts don't need to mention the product — they document the journey. By week 20, people know Hauddy almost accidentally because they've been following the thinking.

---

## Launch Sequence (not a single launch day)

Every milestone is a launch:

| Week | Milestone |
|---|---|
| 1 | Website + alpha application form |
| 2 | GitHub organization + open source |
| 3 | Invite-only alpha opens |
| 4 | First contributors |
| 5 | 100 GitHub stars |
| 6 | First real feature shipped based on user feedback |
| 7 | Public roadmap post |
| 8 | Hacker News "Show HN" |
| 10+ | Product Hunt (when you have engaged users, testimonials, smooth onboarding) |

Product Hunt and HN: don't do these too early. Wait until you have a polished README, working demo, and a technical story worth telling.

---

## Legal & Compliance

These are required before broader public launch (HN / Product Hunt). Wire them in now while the surface area is small.

### Privacy Policy

Write a single `PRIVACY.md` (source of truth), then surface it everywhere. Cover:
- What's collected: email (signup), agent names, message content + metadata, file attachments, IP/UA for rate-limiting
- Where it's stored: Cloudflare Durable Object SQLite + R2 (US/EU Cloudflare regions)
- Alpha data disclaimer: data may be wiped/reset without notice during alpha
- No selling, no third-party ad tracking
- Contact: privacy@hauddy.com → forwards to you
- Retention: delete on account deletion (to be implemented)

| Surface | Task |
|---|---|
| **GitHub** | Add `PRIVACY.md` to repo root; link from README footer |
| **Landing (hauddy.com)** | Add `/privacy` route serving the policy; add "Privacy" link to footer |
| **Dashboard (app.hauddy.com)** | Add "Privacy Policy" link to Account page footer / Settings screen |
| **Desktop app** | Add "Privacy Policy" link in the About/Account section (opens `https://hauddy.com/privacy` in browser) |

### Cookie Banner

| Surface | Situation | Action needed |
|---|---|---|
| **Landing (hauddy.com)** | Plausible = cookie-free by default; PostHog uses cookies | If using Plausible: no banner needed. If PostHog: add a minimal banner with accept/decline before the script loads |
| **Dashboard (app.hauddy.com)** | Auth token in localStorage, not a cookie. No third-party trackers currently | No banner needed now; revisit if analytics added |
| **Desktop app** | Electron webview + local daemon; no browser cookies in play | No banner needed |
| **GitHub** | GitHub's own cookie policy applies | Nothing to do |

**Decision needed:** Plausible (€9/mo, cookie-free, no banner needed) vs PostHog (free tier, more powerful, requires cookie banner). Plausible is the lower-friction choice for launch.

---

## Week 1 Action Plan

**Theme: Open the doors without announcing the grand opening.**

**Monday — Foundation**
- Polish GitHub README, CONTRIBUTING.md, roadmap, changelog
- Discord server ready
- Alpha application form working
- Analytics configured (Plausible or PostHog)

**Tuesday — Soft Reveal**
- LinkedIn post: talk about the *problem*, not the solution. End with "I'm opening a small alpha for people interested in helping shape it."
- Personally DM 10–15 people you genuinely respect; ask for feedback, not promotion.

**Wednesday — Build in Public**
- Share something tangible: 30-second screen recording, architectural sketch, design evolution, or a technical challenge solved.

**Thursday — Community Day**
- Respond to every comment, question, and DM
- Welcome Discord members
- Ask one open-ended question

**Friday — Ship + Update**
- Ship something (even tiny)
- Publish Week 1 State of Hauddy

**Daily habits (15–20 min total)**
- Reply to every comment
- Comment thoughtfully in AI/dev communities (not promoting, just adding value)
- Log interesting user quotes

---

## Success Metrics (Week 1)

Forget page views. Success looks like:
- 20 alpha requests
- 10 active users
- 5 meaningful conversations
- 3 bug reports
- 2 feature requests
- 1 contributor

---

## Long-term Metric to Obsess Over

**People who came back.** Not users, not traffic, not stars.

If 30 sign up and 20 return — you've built something worth talking about and growth compounds. If 30 sign up and 25 disappear — no amount of marketing fixes that.

---

## The Growth Flywheel

```
Reducing Valve essay / LinkedIn insight
            ↓
Landing page / GitHub
            ↓
Apply for Founding Alpha
            ↓
Discord community
            ↓
Weekly shipping + feedback loop
            ↓
Users share experience / contribute
            ↓
New insight worth writing about
            ↓
(repeat)
```

Ads are not in the loop. If the loop works organically, ads can pour fuel on it later.

---

## The Borrowed Audience Strategy

Instead of: "How do I get 1,000 followers?"
Ask: "How do I get in front of 50,000 people who already care about AI infrastructure?"

- Guest spots on AI engineering podcasts
- Technical articles for established AI newsletters
- Presence in "Awesome AI Agents" lists and ecosystem directories
- Collaboration with maintainers of complementary OSS projects (LangChain, LiteLLM, etc.)

Borrowing trust is faster than manufacturing it.

---

## Notes & Decisions

- **SEO is not a priority for 3–6 months.** First users come from direct links, GitHub, LinkedIn, community posts — not Google search.
- **No company LinkedIn page as primary voice yet.** Barnaba = Hauddy until there's enough momentum; people interact with founders, not brand pages.
- **One community platform to start.** Don't spread across 5 platforms simultaneously. Discord + LinkedIn + GitHub is enough for Phase 1.
- **Hauddy's positioning**: not "AI tool" but "communication layer for AI agents" — enabling infrastructure, like Docker or Stripe, not an end-user app. Audience = builders, not buyers.
- **HAUDY** (CareApp, Japan) exists but is a different market, geography, and category — not a dealbreaker, but worth tracking for trademark purposes.
