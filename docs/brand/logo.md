# Logo

The plan.video identity: a mark, a wordmark, and their horizontal lockup. Files live in
`assets/logo/`. Use `design.md` for color and type around the logo.

## Idea

The mark is a squirrel, sitting, holding a play button. Squirrels put things away to use
later, and plan.video does the same with posts: you make them now and they go out on their
own. The play button it holds is the video. Its tail rises and rolls into a round curl, open
at the bottom like the bowl of a p, so the letter the identity started from is still there.
The mark is one colour: the play button is set off from the chest by a thin gap, not by colour.
The wordmark sets the domain in Geist SemiBold and replaces the dot with the play triangle:
`plan ▶ video`.

## Construction

The mark sits on a 32-unit grid as one filled path: the squirrel with its eye as a hole, and
the play button.

| Part | Geometry |
| --- | --- |
| Tail | An S that rises from the base and rolls forward into a round curl: a round hole and a round tip, open at the bottom |
| Body | Sits on a flat base it shares with the tail; the space between the tail and the back ends in a round bottom |
| Head | Rounded, with a short snout, a round eye and an ear whose tip is slightly rounded |
| Play button | A rounded triangle held at the chest, set off by a gap of even width all round |
| Bounds | `x 3.3–28.7`, `y 2–30`, centred on the grid |

Path: `MARK_PATH` in `apps/web/src/components/brand/logo.tsx`, the same as `assets/logo/mark-black.svg`.
It was drawn on a larger grid from circles and smooth curves, then flattened to this one path.

The wordmark uses Geist SemiBold with `-0.03em` tracking. The triangle is `0.40em` tall,
`0.38em` wide, sits on the baseline, and takes `0.09em` of space before it and `0.11em` after.
In the lockup the mark is cap height tall, sits on the baseline, and is followed by `0.30em`.

## Loading screen

While a dashboard opens (guest mode's demo, or the account's), the squirrel draws itself at
56 px in the middle of the window. A 1-unit stroke, kept to the inside of the mark, traces the
outline (148.2 long) from the base of the tail, up over the curl, round the head and down the
chest by 0.7 s; the play button is drawn as the pen rounds the paws. The body then fills in by
0.9 s, the eye opening with it, and the fill takes the stroke over without the edge moving. It
holds to 1.3 s, then fades while the outline is wiped away from where it began, once every
1.8 s. Every move eases in and out. It is white on near-black, or black on white in the light
theme; without motion the whole mark stands and breathes. A page never opens partway through
the drawing: the screen fades out once the whole mark has stood a beat. It lives in
`apps/web/index.html` (`#boot-splash`), drawn on a canvas by a worker so it keeps moving while
the page's script holds up the main thread, and `apps/web/src/components/page-loader.tsx`
decides when it shows.

## Mascot poses

The same squirrel, drawn the same way (one colour, one path), turns up in a few quiet moments.
They live in `apps/web/src/components/brand/mascot.tsx`.

| Pose | Where |
| --- | --- |
| `SquirrelAsleep`: the logo's squirrel dozing off where it sits, eye shut, the play button tipping as its grip loosens, two z's | A calendar week or month with nothing on it, and the List view of an account with no posts |
| `SquirrelPhone`: holding a phone with a play button on it | The icon on the "Posted to …" notice when a post goes out |
| `SquirrelPeek`: looking over an edge, from the top of its tail to just above the play button, its two front paws on the edge in front of its snout; drawn down to the edge and no further, so the thing it looks over hides the rest | Over the top edge of the homepage's closing card, in the card's colour |

Keep them to moments like these; the logo itself stays the sitting squirrel.

## Files

| File | Use |
| --- | --- |
| `assets/logo/mark-black.svg`, `mark-white.svg` | Mark alone: site header (next to the wordmark), favicon, sidebar headers, inline UI |
| `assets/logo/mark-badge-dark.svg`, `mark-badge-light.svg` | App icon, social avatar on a mixed background, the dashboard's workspace badge |
| `assets/logo/wordmark-black.svg`, `wordmark-white.svg` | Primary logo when the name must read: site header, title cards, end cards |
| `assets/logo/lockup-black.svg`, `lockup-white.svg` | Mark and wordmark together: documents, partner pages |

Pick black on light backgrounds and white on dark ones. The badge is the only version that
carries its own background.

## Rules

- Keep clear space of at least 4/32 of the grid on every side.
- Keep the gap round the play button; in one colour it is what sets the button apart from the chest.
- The play button stays the colour of the squirrel; the mark has no second colour.
- In the site header the mark stands on its own, without the badge's tile.
- Use the mark at 16 px or larger. Use the wordmark at 20 px cap height or larger.
- Do not recolor, outline, rotate, add effects, or set the wordmark in another typeface.
- Do not place the mark and the play-dot wordmark inside the same badge; use the lockup.
