When someone has a bright idea that they want to bring to life, they usually
end up realizing the task is more daunting than they thought and normally
give up after a while, and that's if they even started on it. I wanted to tackle
this problem, why do most people give up on their ideas? Is it because they
have no one else to work with? If someone with no following or status goes
on an arbitrary social media platform they will most likely be ignored and no
one will want to work with them. Connect-Create will be a social platform
for people to connect with other creators and link their skills and ideas and
try their absolute best to create them. Connect-Create will not just be a
platform for users to connect but also have the utilities to bring their ideas
to life such as a workbench and AI guides to finalize their continuous
thought process. The goal is for absolutely any person to be able to create
anything and everything for the benefit of not just themselves, but for the
entire world as well.

# Spec: Connect-Create v1

## Problem

People with a bright idea usually give up before they start or soon after.
Two causes: the task feels daunting, and they have no one to build with.
On general social platforms, a newcomer with no following or status is
ignored. Connect-Create lets anyone with an idea make visible progress
alone and find passionate collaborators based on that progress, not on
popularity.

## Audience

- **Reach**: everyone with ideas (acquired mainly through short-form video).
- **v1 product**: open to any idea category, with a required category tag
  so discovery and, later, curation stay possible.
- Risk to monitor: a mixed audience can make early matches sparse.
  If match rate is low, narrow discovery to the 2-3 most active categories.

## Goals

- G1: A new user with zero followers and zero replies makes measurable
  progress on an idea in their first session (solo-first).
- G2: Collaborators are matched on skill fit and demonstrated progress,
  never on follower count.
- G3: Stalled projects get a concrete, small next step, not generic
  encouragement.
- Success metrics (v1, tracked from day one):
  - 60% of new users complete at least one milestone in session 1
  - 30% of ideas that stay active for 7 days get a collaborator request
  - Week-4 retention of users who completed 3+ milestones

## Non-goals (v1)

- Payments, marketplace, equity or revenue-split tooling
- Mobile apps (responsive web only)
- Follower counts, likes, or any popularity-ranked feed
- Real-time chat or video calls (async messages only)
- AI-generated work product (the guide suggests, humans do the work)
- Learned/ML matching (v1 is rule-based and explainable)

## Core concepts

- **Profile**: display name, skills offered (tags), interests, weekly
  availability, progress score (derived, read-only).
- **Idea/Project**: title, description, category, skills needed (tags),
  status (`open | in_progress | paused | done`), owner, members.
- **Milestone**: belongs to a project; title, optional evidence
  (text, link, or file), state (`todo | done | confirmed`).
- **Workbench**: per-project space with milestones, notes, and files.
- **AI Guide**: assistant that turns a rough idea into scoped milestones
  and proposes next steps for stalled projects.
- **Join request / invite**: a request from a user to a project, or vice
  versa, with a short message.

## Requirements

Numbered for reference in prompts, commits, and reviews.

### Accounts and profiles

1. Users MUST be able to sign up, log in, and log out with email and password.
2. Users MUST be able to create a profile with skills offered (1-20 tags).
3. Users MUST NOT see follower or like counts anywhere in the product.

### Ideas and workbench

4. Users MUST be able to create a project with title, description,
   category, and 1-10 skills needed.
5. Each project MUST have a workbench with milestones (CRUD) and notes.
6. A milestone marked done SHOULD accept evidence (text, URL, or file).
7. A project member other than the milestone's completer MAY confirm a
   milestone, moving it from `done` to `confirmed`.

### Progress

8. The system MUST compute a **project progress score** and a **user
   progress score** (see "Progress rule").
9. Progress scores MUST be derived from data, never directly editable.
10. Each project MUST display a progress indicator (e.g. milestones done
    / total, plus recency of last activity).

### Discovery and matching

11. Users MUST be able to browse open projects ranked by **match score**
    (see "Matching rule").
12. Project owners MUST be able to browse users ranked by fit to a
    project's skills needed.
13. Ranking MUST NOT use any popularity signal (followers, likes, views).
14. Each result SHOULD show why it matched (shared skills, recent progress).
15. A project with no responses after 7 days MUST enter a
    "needs a first collaborator" surface visible to all users.

### Collaboration

16. Users MUST be able to send a join request or invite with a message
    (max 500 chars); recipients MUST be able to accept or decline.
17. Accepted members MUST gain access to the project's workbench.
18. Users MUST be able to message other project members asynchronously
    inside the project.

### AI Guide

19. The AI Guide MUST convert a rough idea into 3-7 scoped milestones
    on request.
20. If a project has no activity for 5 days, the guide MUST suggest
    exactly one next step that takes 30 minutes or less.
21. The guide MUST ground suggestions in the project's own content and
    MUST NOT send any other user's private data to the model.
22. AI suggestions MUST be accepted or edited by the user before they
    become milestones.

### Safety

23. Users MUST be able to report a project, user, or message.
24. Rate limits MUST apply to sign-up, join requests (e.g. 20/day),
    messages, and AI Guide calls.

## Progress rule

A milestone counts toward progress only if it is `done` with evidence
or `confirmed`.

- Confirmed milestone: weight 1.0
- Done with evidence, unconfirmed: weight 0.5
- Done without evidence: weight 0 (visible, but does not score)
- Weights decay by half every 30 days so recent work matters most.
- Anti-gaming: a user cannot confirm their own milestones; at most
  5 milestones per project per day can count; edits that remove
  evidence after scoring void that milestone's weight.

User progress score = sum of decayed weights across their projects.
Project progress score = same, per project.

## Matching rule

For a user U and a project P with skills needed S:

```
skill_fit      = |S ∩ U.skills| / |S|             (0 to 1)
progress       = normalize(P.progress_score)      (0 to 1)
user_progress  = normalize(U.progress_score)      (0 to 1)
availability   = overlap of weekly hours bands    (0 to 1)

match(U -> P)  = 0.5*skill_fit + 0.25*progress + 0.15*user_progress
                 + 0.10*availability
```

- Weights live in config, not code constants, so they can be tuned.
- Brand-new users and projects get a neutral baseline progress value
  (0.5) for 14 days so they are not buried.
- Ties break by most recent activity, then random seeded per request
  (prevents a fixed winner).

## Interfaces

Base path `/api/v1`. JSON. Session cookie auth.

```
POST   /auth/signup            {email, password, name}      -> 201 {user}
POST   /auth/login             {email, password}            -> 200 {user}
GET    /me                                                  -> 200 {user, progress}
PUT    /me/profile             {skills[], interests[], availability}

POST   /projects               {title, description, category, skillsNeeded[]}
                                                            -> 201 {id}
GET    /projects/:id                                        -> 200 {project, progress}
GET    /projects?skills=&category=&sort=match               -> 200 {items[], nextCursor}
GET    /projects/:id/candidates                             -> 200 {items[]}  (owner only)

POST   /projects/:id/milestones     {title}                 -> 201 {id}
PATCH  /milestones/:id              {state, evidence?}      -> 200
POST   /milestones/:id/confirm                              -> 200

POST   /projects/:id/requests       {message}               -> 201 {id}
POST   /requests/:id/accept | /decline                      -> 200

POST   /projects/:id/guide/plan     {}                      -> 200 {suggestions[]}
POST   /projects/:id/guide/nudge    {}                      -> 200 {suggestion}

POST   /reports                     {targetType, targetId, reason}
```

Errors: `400` validation, `401` unauthenticated, `403` forbidden,
`404` missing, `429` rate limited. Never `500` for bad input.

### Data model (sketch)

`users`, `profiles`, `skills`, `profile_skills`, `projects`,
`project_skills`, `project_members`, `milestones`, `evidence`,
`join_requests`, `messages`, `reports`, `progress_events`
(append-only log that scores are computed from).

## Acceptance criteria

- [ ] Given a new user with no activity, when they post a project,
      then it appears in results for users with overlapping skills (R11)
- [ ] Given a vague idea, when the user runs the guide, then they get
      3-7 milestones that they can accept or edit (R19, R22)
- [ ] Given a new user with no replies, when they complete a milestone
      with evidence, then their progress indicator updates (R8, R10)
- [ ] Given two projects with equal skill fit, the one with more recent
      confirmed progress ranks higher (R11, R13)
- [ ] Given a user confirms their own milestone, then the API returns
      403 (progress rule)
- [ ] Given a project idle for 5 days, then the guide returns exactly
      one next step estimated at 30 minutes or less (R20)
- [ ] Given a project with zero requests after 7 days, then it appears
      in the "needs a first collaborator" list (R15)
- [ ] Given any response or UI, then no follower/like counts appear (R3)
- [ ] Edge: empty or duplicate skills return 400, not 500
- [ ] Edge: a user cannot read a workbench of a project they are not a
      member of (R17)
- [ ] Edge: the 21st join request in a day returns 429 (R24)
- [ ] Privacy: guide prompts contain only the requesting project's data (R21)
- [ ] Performance: p95 < 300 ms for `GET /projects?sort=match` at 50 rps
      with 10k projects

## Constraints and decisions

- **Stack**: TypeScript everywhere. Backend Node + Fastify, Postgres,
  Drizzle ORM, Zod for validation. Frontend React + Vite + TanStack Query.
  pnpm workspace monorepo with a shared types package.
- **Why Postgres**: skill matching reduces to array/set overlap, which
  works well with GIN indexes. No need for a separate search service in v1.
- **Matching is rule-based** so it's explainable and tunable. Revisit
  after real usage data exists.
- **Scores computed from an event log**, cached per user and project,
  recomputed on change. Rejected: stored mutable counters (easy to
  corrupt, hard to audit).
- **AI calls go through the backend only**, with per-user rate limits.
  The API key never reaches the client.
- **Solo-first**: every feature a project needs must work with one member.

## Open questions

- Ownership and credit for jointly built work: v1 shows credit only;
  a terms-of-use decision is needed before launch.
- Moderation capacity: who reviews reports at launch?
- Are file uploads in v1 or links only? (Default: links only, add
  uploads after storage and abuse handling are designed.)
- Should project visibility be public by default or members-only?
  (Default: public summary, private workbench.)

If something here is ambiguous or conflicts with another requirement,
ask rather than guess.

## Plan

Each milestone ships with tests and is independently demoable.

1. Monorepo scaffold, CI, DB migrations, auth (R1)
2. Profiles and skills (R2, R3)
3. Projects and discovery list with simple skill filter (R4, R11 basic)
4. Workbench: milestones, evidence, confirmation (R5-R7)
5. Progress events and scoring (R8-R10)
6. Match score ranking and "needs a first collaborator" (R11-R15)
7. Join requests and project messaging (R16-R18)
8. AI Guide: plan and nudge (R19-R22)
9. Reporting, rate limits, hardening (R23-R24)
