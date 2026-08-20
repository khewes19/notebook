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
