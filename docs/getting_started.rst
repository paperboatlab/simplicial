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

- ``.pst``: a Paperboat Simplicial Station, the things in a scene, their settings and how they
  connect.
- ``.psf``: a Paperboat Simplicial Flow, the node graph that turns a station into results.

**File › Open…** (Ctrl O) and **Save as…** (Ctrl Shift S) ask where first: this computer (the
browser's own picker; Save as downloads the file) or one of your Malachite hubs, with how many flows
and stations each holds. A flow opened from a hub, or saved into one, puts Simplicial in that hub:
the bar shows the hub's selector and the file's path in it, and **Save** (Ctrl S) writes it back
there. Without Malachite there are no hubs, and Open goes straight to the browser's picker. For now
Simplicial opens flows; a station opens from its own command.

A flow file holds everything you made on the station: the Flow, the Station's objects, the
variables, your Board layout and the run settings you changed. A dot after its name in the bar
means there are changes not saved, and opening another file or starting a new one asks first.
**File › New project** goes back to what the station started with. **Open recent**, in the File
menu, lists the last five files you opened or saved; one in a hub is read again from there. The
browser also keeps unsaved work as you go: after a reload Simplicial offers it back (**Restore
your last session?**).
