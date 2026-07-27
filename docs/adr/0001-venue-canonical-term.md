# 0001 — "Venue" is the canonical concept; the `cinemas` table holds venues

A venue is any organizer that presents screenings. A cinema is a *kind* of
venue (a formal movie theatre); other kinds (e.g. a cineclub running
screenings in a Palermo bar) are possible. We chose **venue** as the canonical
code/data term and **sala** as the es-AR display word.

The DB table is `cinemas`, with `cinemaId` foreign keys throughout
(`screenings`, `providers`, `scrape_runs`). It is named after a subtype but
holds the supertype. We accepted that lag rather than block on a rename that
touches every foreign key and query. Until the migration lands, `cinemaId` in
code is the venue id — not a signal that the model is cinema-centric.

Venue-*kind* (cinema vs. cineclub vs. cultural venue) is deliberately **not**
modeled yet, because today every venue we carry is cinema-like. When it is
modeled, it gets its own facet rather than overloading `type: ['indie',
'chain']`, which is a different axis (ownership/scale, drives UX tier).
