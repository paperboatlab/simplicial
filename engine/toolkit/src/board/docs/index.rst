board
=========

The blocks the Board shows: monitors drawn as instruments, and controls the user works during a
run. See the `Board <https://paperboatlab.github.io/paperboat/board.html>`_ for how instruments are laid out.

.. toctree::
   :maxdepth: 1

   blocks/index

Monitors
--------

``graph`` plots ``in`` over time (a vector in a clock run as one trace per component, in a run-once
by index; a list of points in a run-once as y over x). ``display`` shows its latest number, text,
vector or list (a long list as its first values and its length). ``scope`` takes ``a``, ``b``… by
its ``inputs`` param (2–26), each a channel, a vector one per component. ``view3d`` has no wire of
its own: its instrument draws the Station's scene with the same view as the Station.

Controls and indicators
-----------------------

A monitor that declares outputs runs as an ordinary block and is shown from its first output.
``switch`` (0 or 1) is flipped by the user: ``mode`` ``toggle`` (a click flips it) or
``momentary`` (on while held), ``initial`` its state at the start, ``key`` a keyboard key for it.
``lamp`` is lit while ``in`` passes ``threshold`` by ``op`` (the default ``> 0.5`` lights on a
boolean); with ``latch`` it stays on from its first trip. Its output can end a run (a Step flow's
``when`` → ``stop``).
