# Transitions

Any clip can carry two transitions:

- `transition`: how the clip **goes out**. In a [`<sequence>`](./sequences.md), where the next clip starts as this one ends, it blends the two, centered on the cut. Anywhere else (a clip on its own, the last clip of a sequence, a clip before a gap) the clip plays out over whatever is under it, ending as it ends.
- `transitionIn`: how the clip **comes in**, over whatever is under it, from its start. Where the clip before it in a sequence already has a `transition` into it, that one plays instead.

```tsx
{/* One video that fades in and slides out */}
<video src="/Movies/clip.mp4" width={1920} height={1080} start={0} end={8}
  transitionIn={{ type: "dissolve", duration: "0.5s" }}
  transition={{ type: "pushLeft", duration: "0.5s" }} />

{/* Cuts in a sequence */}
<sequence>
  <video src="/Movies/intro.mp4" width={1920} height={1080} start={0} end={12} transition={{ type: "fadeToBlack", duration: "20f" }} />
  <video src="/Movies/main.mp4" width={1920} height={1080} start={12} end={24} transition={{}} />  {/* dissolve, 1s */}
  <video src="/Movies/outro.mp4" width={1920} height={1080} start={24} end={30} transition={{ type: "fadeToBlack" }} />  {/* out to black at the end */}
</sequence>
```

```ts
type TransitionSpec = {
  type?:      TransitionType;   // default "dissolve"
  duration?:  Time;             // default 1 second
  direction?: "left" | "right" | "up" | "down";               // default: the type's own
  easing?:    "linear" | "easeIn" | "easeOut" | "easeInOut";  // default: the type's own
  color?:     string;           // default: the type's own (black or white)
};
```

```tsx
{/* A whip that goes down, played at an even speed */}
<video src="/Movies/clip.mp4" width={1920} height={1080} start={0} end={8}
  transitionIn={{ type: "whip", direction: "down", easing: "linear" }} />

{/* A fade through dark blue */}
<video src="/Movies/clip.mp4" width={1920} height={1080} start={0} end={8}
  transition={{ type: "fadeToBlack", color: "#102A5C" }} />
```

## Types

Every type plays; the editor's pickers offer six of them (dissolve, fadeToBlack, blur, slideFromRight, zoomIn, whip). Between two clips, each one plays as described. On a clip's own start or end, the clip plays its half of it with nothing on the other side: it arrives from the right (or below) and leaves by the left (or top).

| `type` | Between two clips | On one clip |
| ------ | ------ | ------ |
| `"dissolve"` (default) | Crossfade between the two clips. | Fades in or out. |
| `"slideFromRight"` | The next clip slides in from the right. | Slides in from the right, out to the left. |
| `"slideFromLeft"` | The next clip slides in from the left. | Slides in from the left, out to the right. |
| `"fadeToBlack"` | Fade out to black, then in to the next clip. | Comes up from black, or goes to black, then fades. |
| `"fadeToWhite"` | Fade out to white, then in to the next clip. | The same through white. |
| `"flash"` | A cut under a white flash that comes up quickly and fades slower. | Appears or goes under a white flash. |
| `"blur"` | Crossfade while the outgoing clip blurs and the next one sharpens. | Sharpens in, or blurs out. |
| `"pushLeft"` | The next clip pushes the current one out to the left. | Pushes in from the right, out to the left. |
| `"pushUp"` | The next clip pushes the current one out to the top. | Pushes in from below, out to the top. |
| `"whip"` | A fast push to the left with motion blur, like a whip pan. | Whips in from the right, out to the left. |
| `"zoomIn"` | The current clip zooms in and fades as the next one settles in. | Settles in from a little larger, or grows and fades. |
| `"zoomOut"` | The current clip shrinks and fades as the next one zooms out into place. | Grows into place, or shrinks and fades. |
| `"crossZoom"` | Zooms into the current clip, blurring, and out of the next one. | Zooms out of a blur, or into one. |
| `"spin"` | The next clip spins in from the middle. | Spins in from the middle, or spins away into it. |
| `"wipe"` | The next clip is wiped on from the left edge. | Wiped on from the left, or off to the right. |
| `"iris"` | The next clip opens out of a circle from the middle. | Opens out of a circle, or closes into one. |

## Semantics

- `duration` takes any [time format](./timing.md#time-formats). Between two clips it is centered on the cut: half plays before it, half after. On one clip it plays inside the clip: from its start for `transitionIn`, up to its end for `transition`.
- `direction` is the way what moves goes: the next clip comes in going that way, and on one clip it arrives or leaves going that way. It applies to `slideFromRight`, `slideFromLeft`, `pushLeft`, `pushUp`, `whip` and `wipe`; left out, each goes its own way (as in the table).
- `easing` is the curve the transition plays along, in place of the type's own. `"linear"` plays it at an even speed.
- `color` is the colour `fadeToBlack`, `fadeToWhite` and `flash` go through. Any CSS colour.
- A **partial value merges** into the clip's existing `type` and `duration`: `transition={{ duration: 2 }}` keeps the current type; `transition={{}}` applies the defaults. `direction`, `easing` and `color` don't merge: left out, each goes back to the type's own.
- **`null` removes** the clip's transition.
- A transition is not an element of its own: it is a prop of its clip, so it moves, trims and copies with it.
