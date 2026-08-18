# Egglings Website — Standalone Build

This version keeps each page self-contained:

- `index.html` — landing page with its CSS + JavaScript inline
- `form.html` — hatchlist flow with its CSS + JavaScript inline
- `images/` — cleaned transparent WebP artwork and animated WebP character loops
- `netlify.toml` — Netlify routes and headers

## Updates in this revision

- Re-cut all three Eggling character images so the original lime/cream backgrounds no longer show around the characters or between the feet.
- Rebuilt the animated WebP loops from the cleaned transparent character assets.
- Added a cracked-shell transition between the hero and the next section.
- Added a scroll-linked cracked egg that travels across the viewport with a parallax arc.
- Added an egg-shaped custom mouse follower with shell-fragment click feedback on desktop.
- Added lightweight click/crack audio generated with the browser Web Audio API.
- Added animated loading screens to both pages.
- Kept the native WebGL cartoon background on the landing page.
- Kept responsive, section-scoped styling and the 3-step hatchlist form.

## Campaign information currently used

- Supply: 1,500
- Price: TBA
- Launch: TBA
- Network: Robinhood
- X: `@Egglings_nft`
- Required actions: Follow + Like/Retweet the provided X post
- Partner window: winners submitted within 48hrs

## Form behavior

The form is configured for **Netlify Forms** with the form name `egglings-hatchlist`.

The 5-second social-action sequence confirms that the action link was opened; it does not falsely claim direct X API verification. Genuine follow/like/retweet verification would require X authentication/API access.

On a local preview, the final submission displays a preview success state. On a deployed Netlify site it posts to Netlify Forms.
