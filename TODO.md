# next

Ordered roughly by what is blocking what. Everything here is wanted; nothing
here is started.

## autocorrect the obvious typo

Type `pront`, get `print`. The pieces already exist: `lint.js` knows every
builtin and keyword, and since the scope work it also knows every name bound
anywhere in reach, per scope. A name that resolves nowhere and sits within one
or two edits of a name that does is not ambiguous — it is a typo.

Two halves, and they are worth keeping separate:

- **Say it.** The existing "not defined in this scope" squiggle gains a
  suggestion: `"pront" is not defined — did you mean print?`. Cheap, and it
  cannot do any harm, because it only ever adds words to a message that was
  already being shown.
- **Fix it.** Tapping the warning bar currently jumps to the error; tapping a
  suggestion would apply it. Correction has to stay a deliberate tap. Silent
  autocorrect in a code editor is how `l` becomes `I` and an afternoon
  disappears, and this editor's whole argument is that a wrong squiggle costs
  more than a missing one — a wrong *edit* costs more still.

Edit distance is Levenshtein capped at 1 for short names and 2 for long ones,
against builtins first and names in scope second. Adjacent-key transposition
deserves a lower cost than an arbitrary substitution: on a phone keyboard the
likely typos are neighbours.

## tips, and a help agent

`✦ Tips` works, but only once `API` in `edit.js` points at a proxy holding the
key — `worker/worker.js` is written and waiting for a Cloudflare URL. See the
Configuration section of the README.

Beyond one-shot review, the ask is a help agent: something you can put a
question to about the file in front of you, rather than a fixed five-line
review prompt. That wants a small conversation UI in the cell, and history,
which the cell does not have yet.

## the repaint, if it stays slow

Every keystroke re-tokenises the whole buffer and rewrites `#hl` wholesale,
because `#ed` is transparent and `#hl` is the text you see. The cost therefore
scales with the file rather than with what was typed.

The fix is to split `#hl` into one element per line and touch only the line
that changed. Two things make it real work rather than a tidy-up: a triple
quoted string means an edit on one line can change how every line below it
tokenises, so the open-string state has to be tracked per line and the repaint
extended downwards when it changes; and `#hl` has to keep wrapping *pixel*
identically to `#ed`, or the highlight and the squiggles drift away from the
caret. That second one cannot be checked except on the device.

Two rounds of micro-optimisation have not settled this. Before spending the
refactor, get the key-down-to-painted number the counter now reports — if it
is inside a frame, the cost is not here and this would be wasted.

## haptics

The pad calls `navigator.vibrate(3)` on every key. iOS Safari does not
implement it, so the tick this keyboard was designed around has never fired on
an iPhone. There is a known workaround — a hidden `<input type="checkbox"
switch>` toggled per press triggers the system haptic on iOS 17.4+ — but it is
a hack riding on a control's side effect, and it should be tried deliberately
rather than slipped in.
