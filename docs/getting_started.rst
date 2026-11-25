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
