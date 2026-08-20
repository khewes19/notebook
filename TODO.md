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

The pad calls `navigator.vibrate(3)` on every key. iOS Safari does not
implement it, so the tick this keyboard was designed around has never fired on
an iPhone. There is a known workaround — a hidden `<input type="checkbox"
switch>` toggled per press triggers the system haptic on iOS 17.4+ — but it is
a hack riding on a control's side effect, and it should be tried deliberately
rather than slipped in.
