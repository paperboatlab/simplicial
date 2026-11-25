list
====

Lists on the wires. A port of type ``numbers`` carries a list of numbers (any length); one of type
``points`` a list of points (one row per point, ``[x, z]``). A list wire is drawn heavier than a
signal's (a points wire also broken), and a list port's dot is a double ring.

.. toctree::
   :maxdepth: 1

   blocks/index

What joins what
---------------

- ``numbers`` joins ``numbers`` and ``vector`` (a vector is a list of fixed length: one of another
  length fails when it arrives) and an `elementwise <https://paperboatlab.org/paperboat/concepts.html#elementwise>`_ block's
  signal ports: that is the map. Range → ``function`` (``f = "x^2"``) → ``gain`` squares and
  scales every item. A list has one unit, every item's: a list in ``m`` into a port in ``rad`` is
  refused.
- ``points`` joins only ``points`` (and ``any``). On a points port ``dimension`` and
  ``components`` describe each point, not the list: points of 2 coordinates into a port expecting
  3 are refused, and coordinate units are checked by position, as a vector's are. A list's own
  length is never declared.
- Neither joins a plain ``signal`` port, and a number is not a list.

Two forms
---------

``list_length``, ``item`` and ``aggregate`` are magic blocks with two forms, picked by ``form``:
``numbers`` (the default) and ``points``, whose ``list`` is a list of points. In the points form
``item`` gives a point (a vector) and ``aggregate`` one value per coordinate: ``mean`` is the
centroid, ``min`` and ``max`` the corners of the bounding box.

On the Board
------------

A ``display`` shows a list's first values and how many there are (a list of points as text:
``5 points: (-1, 1), (-0.5, 0.25), …``); a ``graph`` in a run-once plots a list of numbers over its
index and a list of points as a curve, the second coordinate over the first. Fanning a whole run
out over a list's items (a sweep) is not part of this package yet.
