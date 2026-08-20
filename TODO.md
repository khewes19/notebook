# next

Ordered roughly by what is blocking what. Everything here is wanted; nothing
here is started.

## tips, and a help agent

`✦ Tips` works, but only once `API` in `edit.js` points at a proxy holding the
key — `worker/worker.js` is written and waiting for a Cloudflare URL. See the
Configuration section of the README.

Beyond one-shot review, the ask is a help agent: something you can put a
question to about the file in front of you, rather than a fixed five-line
review prompt. That wants a small conversation UI in the cell, and history,
which the cell does not have yet.

## haptics

Solved by handing the keyboard back to iOS: the system keyboard brings its own
feedback, and navigator.vibrate - which iOS Safari does not implement, so the
tick this pad was designed around never once fired on an iPhone - stopped
mattering. It is only worth reopening if SYSKB ever goes back to false.

## a service worker, once the app settles

Every launch fetches all ten files — about 116 KB — from GitHub Pages. On a
slow connection that is ten round trips before the editor draws, and with no
connection the app may not open at all, since nothing of it lives on the phone.
The README's claim that it "works, online or off" is true opening `index.html`
from disk and false from Pages. A service worker makes it true.

Stale-while-revalidate is the strategy that fits: serve from the cache
immediately, fetch the new copy in the background, use it on the next launch.
Launch becomes instant and offline works, at the price of always running one
launch behind. That price is wrong while the app is changing every few minutes
— every "did that fix it?" would need a second reload before it meant anything
— which is the only reason this is not done yet.

Two things it must ship with. A version constant, so bumping it on deploy
clears the old cache instead of leaving the app a version behind for good. And
a way out: a service worker stays installed and keeps answering requests after
the page that registered it has changed or gone, until something explicitly
unregisters it or a new one replaces it — so a broken one can keep serving a
broken app to itself. A version value that makes it unregister and step aside
is the escape hatch, and it should exist before the first one is deployed.

Scope is the one wrinkle, and it is fine: served from `/notebook/`, it can only
control that path, which is exactly the path we want.

Does nothing for typing, which is already local, and nothing for haptics or
file access. This is about launching and about being usable with no signal.
