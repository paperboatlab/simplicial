Getting started
===============

.. note:: Not written yet: installing with ``paperboat app install simplicial`` once Simplicial is in
   the app registry, opening a station, and a first run.

Ports
-----

The page is served on ``http://127.0.0.1:30471``. Each station runs on its own port, from ``51301``
up: the examples take ``51301`` to ``51310``, and further stations the next free ones.

Files
-----

Simplicial works file by file:

- ``.pst``: a Paperboat Simplicial Station, the definitive station: its code and blocks, the scene
  (the objects, their properties and links), its variables, its starter flow and Board. Simplicial
  never writes one; a new version is packed (``paperboat pack``).
- ``.psf``: a Paperboat Simplicial Flow, a child of one station: only what differs from it (the
  station variables and object properties it changed, objects added or removed, the flow's own
  variables, the flow, the Board, the run settings). It points to its station by name, version and
  a path relative to itself; :doc:`flow_files` has the format.

**File › Open…** (Ctrl O) and **Save as…** (Ctrl Shift S) ask where first: this computer (the
browser's own picker; Save as downloads the file) or one of your Malachite hubs, with how many flows
and stations each holds. A flow opened from a hub, or saved into one, puts Simplicial in that hub:
the bar shows the hub's selector and the file's path in it, and **Save** (Ctrl S) writes it back
there. Without Malachite there are no hubs, and Open goes straight to the browser's picker.

A window works on one station. Opening a flow finds its station: at the flow's path first, then by
name in the hub, among the installed stations (yours and the examples), and the running ones (the
exact version first, then the newest). On this window's station the flow opens at once; on another,
Simplicial asks first: **Switch** starts that station if it isn't running and reopens the window on
it with the flow, **New window** does the same in a new one. Picking a ``.pst`` opens its station on
its starter, a new flow.

What Simplicial says when a flow and its station don't meet:

- **Can't find** the station anywhere it looked: **Find the station…** (a ``.pst`` in the hub; one
  with another name asks before it is used), **Open without a station** (the flow read only, its
  blocks unknown, nothing runs), or Cancel.
- Found **elsewhere** than the flow's path: it opens there, and the flow is marked changed; Save
  keeps the new place.
- Another **version** of the station, or the same one changed since the flow was saved: a
  notification. A change that no longer fits (a variable gone, an object or property renamed, an
  object of a type the station hasn't) is kept in the file, unused, like a lost block;
  **File › Review changes…** keeps or removes each.
- The station **doesn't start** (its build fails, say): the wait screen says why, with **Show log**,
  **Retry** and **Open without a station**.
- Saved in **another hub** than its station's: the flow finds it by name next time.

A value the flow changed of its station's has a dot after its name, in the **Variables** card and in
an object's properties on the Station page; point at it to see the station's value. **Reset to the
station's** (in an open variable; the dot itself on the Station page) puts it back. A dot after the
file's name in the bar means there are changes not saved, and opening another file or starting a new
one asks first. **File › New project** goes back to what the station started with. **Open recent**,
in the File menu, lists the last five files you opened or saved; one in a hub is read again from
there. The browser also keeps unsaved work as you go: after a reload Simplicial offers it back
(**Restore your last session?**).
