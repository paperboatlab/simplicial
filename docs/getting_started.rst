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
